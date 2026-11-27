## git access for knit (docs/04).
##
## Policy: the write path (M3+) is *always* the git CLI — hooks, credentials,
## LFS and the exact semantics live there. The read path is CLI in the M0/M1
## scaffold too; M1.1 swaps `statusOf`/`logOf`/diff to libgit2 without changing
## their signatures or output (the CLI behaviour is pinned by tests).
##
## Every process:
##   - runs as `git -C <repo> -c core.quotePath=false …`
##   - inherits the user env minus GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_PREFIX
##   - has a hard timeout (writes 120 s, network 300 s, reads 30 s)
##   - is recorded in a bounded in-memory console ring (docs/02 §3.8)

import std/[algorithm, json, locks, monotimes, os, osproc, streams, strutils,
            strtabs, tables, times]
when defined(posix):
  import std/posix

import ./[events, gitlib, types]

type
  GitResult* = object
    code*: int
    output*: string
    error*: string
    ms*: int64
    timedOut*: bool

  ConsoleEntry* = object
    cmd*: string
    ms*: int64
    ok*: bool
    detail*: string

const
  BlockedEnv = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX"]
  DrainLimit = 8 * 1024 * 1024   ## 8 MB per stream; larger git output is not
                                 ## useful to the UI and would blow the IPC cap.
  ConsoleLimit = 500

type
  SharedConsoleEntry = object
    cmdPtr: ptr UncheckedArray[char]
    cmdLen: int
    ms: int64
    ok: bool
    detailPtr: ptr UncheckedArray[char]
    detailLen: int

var
  consoleLock: Lock
  consoleRing: array[ConsoleLimit, SharedConsoleEntry]
  consoleHead = 0
  consoleCount = 0

initLock(consoleLock)

proc freeSharedConsole(e: var SharedConsoleEntry) =
  if e.cmdPtr != nil:
    deallocShared(e.cmdPtr)
    e.cmdPtr = nil
  e.cmdLen = 0
  if e.detailPtr != nil:
    deallocShared(e.detailPtr)
    e.detailPtr = nil
  e.detailLen = 0

proc allocSharedStr(s: string): (ptr UncheckedArray[char], int) =
  if s.len == 0:
    return (nil, 0)
  let buf = cast[ptr UncheckedArray[char]](allocShared(s.len))
  copyMem(buf, unsafeAddr s[0], s.len)
  (buf, s.len)

proc readSharedStr(p: ptr UncheckedArray[char], n: int): string =
  if p == nil or n <= 0:
    return ""
  result = newString(n)
  copyMem(addr result[0], p, n)

# --- process plumbing ------------------------------------------------------

proc sanitizeUtf8*(s: string): string =
  ## Git may emit raw bytes (legacy encodings on Windows). JSON must be valid
  ## UTF-8, so invalid sequences become U+FFFD (docs/04 §5).
  result = newStringOfCap(s.len)
  var i = 0
  while i < s.len:
    let b = ord(s[i])
    if b < 0x80:
      result.add s[i]
      inc i
      continue
    var need = 0
    var code = 0
    var minimum = 0
    if (b and 0xE0) == 0xC0:
      need = 1; code = b and 0x1F; minimum = 0x80
    elif (b and 0xF0) == 0xE0:
      need = 2; code = b and 0x0F; minimum = 0x800
    elif (b and 0xF8) == 0xF0:
      need = 3; code = b and 0x07; minimum = 0x10000
    else:
      result.add "\xEF\xBF\xBD"
      inc i
      continue
    var ok = i + need < s.len
    if ok:
      for k in 1 .. need:
        let c = ord(s[i + k])
        if (c and 0xC0) != 0x80:
          ok = false
          break
        code = (code shl 6) or (c and 0x3F)
    if ok and code >= minimum and code <= 0x10FFFF and
        not (code >= 0xD800 and code <= 0xDFFF):
      result.add s[i .. i + need]
      i += need + 1
    else:
      result.add "\xEF\xBF\xBD"
      inc i

proc gitBin*(): string =
  getEnv("KNIT_GIT", "git")

proc buildEnv(extra: seq[(string, string)]): StringTableRef =
  ## Docs/04 §2: never inherit GIT_DIR & friends, ask git not to take optional
  ## locks on read, and keep its own credential handling intact.
  result = newStringTable(modeCaseSensitive)
  for pair in envPairs():
    if pair.key.toUpperAscii() in BlockedEnv:
      continue
    result[pair.key] = pair.value
  result["GIT_OPTIONAL_LOCKS"] = "0"
  result["GIT_TERMINAL_PROMPT"] = "1"
  for (key, value) in extra:
    result[key] = value

proc recordCommand(args: openArray[string], ms: int64, ok: bool,
                   detail = "") =
  var display = "git"
  for arg in args:
    if arg.len == 0:
      continue
    display.add ' '
    if arg.contains(' ') or arg.contains('\t'):
      display.add '"' & arg & '"'
    else:
      display.add arg
  var shortDetail = detail.strip()
  if shortDetail.len > 500:
    shortDetail = shortDetail[0 ..< 500]
  let (cp, cl) = allocSharedStr(display)
  let (dp, dl) = allocSharedStr(shortDetail)
  acquire(consoleLock)
  if consoleCount == ConsoleLimit:
    freeSharedConsole(consoleRing[consoleHead])
    consoleHead = (consoleHead + 1) mod ConsoleLimit
    dec consoleCount
  let idx = (consoleHead + consoleCount) mod ConsoleLimit
  consoleRing[idx] = SharedConsoleEntry(
    cmdPtr: cp, cmdLen: cl, ms: ms, ok: ok, detailPtr: dp, detailLen: dl)
  inc consoleCount
  release(consoleLock)
  emitEvent("git:command", %*{"cmd": display, "ms": ms, "ok": ok,
                               "detail": shortDetail})

proc consoleEntries*(): seq[ConsoleEntry] =
  acquire(consoleLock)
  result = newSeqOfCap[ConsoleEntry](consoleCount)
  for i in 0 ..< consoleCount:
    let idx = (consoleHead + i) mod ConsoleLimit
    let e = consoleRing[idx]
    result.add ConsoleEntry(
      cmd: readSharedStr(e.cmdPtr, e.cmdLen),
      ms: e.ms,
      ok: e.ok,
      detail: readSharedStr(e.detailPtr, e.detailLen))
  release(consoleLock)

proc clearConsole*() =
  acquire(consoleLock)
  for i in 0 ..< consoleCount:
    let idx = (consoleHead + i) mod ConsoleLimit
    freeSharedConsole(consoleRing[idx])
  consoleHead = 0
  consoleCount = 0
  release(consoleLock)

type
  SharedBuf = object
    data: ptr UncheckedArray[char]
    len, cap: int

  DrainCtx = object
    stream: Stream
    buf: ptr SharedBuf
    limit: int

proc appendShared(buf: ptr SharedBuf, src: pointer, n: int) =
  ## Reader threads must not hand GC-managed strings to the worker. They append
  ## raw bytes into shared memory; the worker materialises the string after the
  ## join. This keeps every Nim string owned by one thread.
  if n <= 0:
    return
  let need = buf.len + n
  if need > buf.cap:
    var cap = max(4096, buf.cap * 2)
    while cap < need:
      cap *= 2
    let fresh = cast[ptr UncheckedArray[char]](allocShared(cap))
    if buf.len > 0 and buf.data != nil:
      copyMem(fresh, buf.data, buf.len)
    if buf.data != nil:
      deallocShared(buf.data)
    buf.data = fresh
    buf.cap = cap
  copyMem(addr buf.data[buf.len], src, n)
  buf.len = need

proc takeShared(buf: ptr SharedBuf): string =
  result = newString(buf.len)
  if buf.len > 0 and buf.data != nil:
    copyMem(addr result[0], buf.data, buf.len)
  if buf.data != nil:
    deallocShared(buf.data)
  buf.data = nil
  buf.len = 0
  buf.cap = 0

proc drainWorker(ctx: ptr DrainCtx) {.thread.} =
  var chunk: array[8192, char]
  while true:
    let n = ctx.stream.readData(addr chunk[0], chunk.len)
    if n <= 0:
      break
    if n > 0 and ctx.buf.len < ctx.limit:
      let take = min(n, ctx.limit - ctx.buf.len)
      appendShared(ctx.buf, addr chunk[0], take)
    # Once the cap is hit we keep draining but stop buffering: the child must
    # never block on a full pipe.

proc killProcessTree*(process: Process, graceMs = 200) =
  ## Terminate a child process and its descendants (docs/04 §2, docs/07 M3.1).
  if process == nil:
    return
  let pid = process.processID
  when defined(windows):
    try:
      let tk = startProcess("taskkill", args = @["/T", "/F", "/PID", $pid],
                            options = {poUsePath, poDaemon})
      discard waitForExit(tk, 3000)
      tk.close()
    except CatchableError:
      discard
    try:
      process.kill()
    except CatchableError:
      discard
  elif defined(posix):
    if pid > 0:
      # Signal both the process group (-pid) and the process itself.
      discard posix.kill(Pid(-pid), SIGTERM)
      discard posix.kill(Pid(pid), SIGTERM)
    try:
      process.terminate()
    except CatchableError:
      discard
    var waited = 0
    while waited < graceMs:
      if process.peekExitCode() >= 0:
        return
      sleep(25)
      waited += 25
    if pid > 0:
      discard posix.kill(Pid(-pid), SIGKILL)
      discard posix.kill(Pid(pid), SIGKILL)
    try:
      process.kill()
    except CatchableError:
      discard
  else:
    try:
      process.kill()
    except CatchableError:
      discard

proc runGitOnce(cwd: string, args: openArray[string], stdin = "",
                timeoutMs = 30_000,
                extraEnv: seq[(string, string)] = @[],
                okCodes: seq[int] = @[0]): GitResult =
  ## Spawn git, capture stdout/stderr on two drain threads, enforce a timeout.
  ## `cwd` is passed via `-C` so the caller's working directory never matters.
  var argv = @["-C", cwd, "-c", "core.quotePath=false"]
  argv.add @args
  let started = getMonoTime()
  var process: Process
  try:
    const procOpts = when defined(windows): {poUsePath, poDaemon} else: {poUsePath}
    process = startProcess(gitBin(), args = argv, env = buildEnv(extraEnv),
                           options = procOpts)
  except OSError as e:
    let ms = (getMonoTime() - started).inMilliseconds
    result = GitResult(code: -1, error: e.msg, ms: ms)
    recordCommand(args, ms, false, e.msg)
    return

  var outBuf = SharedBuf()
  var errBuf = SharedBuf()
  var outCtx = DrainCtx(stream: process.outputStream, buf: addr outBuf,
                        limit: DrainLimit)
  var errCtx = DrainCtx(stream: process.errorStream, buf: addr errBuf,
                        limit: DrainLimit)
  var outThread: Thread[ptr DrainCtx]
  var errThread: Thread[ptr DrainCtx]
  createThread(outThread, drainWorker, addr outCtx)
  createThread(errThread, drainWorker, addr errCtx)

  try:
    if stdin.len > 0:
      let input = process.inputStream
      input.write(stdin)
      input.flush()
    let input = process.inputStream
    input.close()             # EOF: git commit -F - waits for this
  except CatchableError:
    discard

  var code: int
  var waitError = ""
  try:
    code = waitForExit(process, timeoutMs)
  except CatchableError as e:
    code = -1
    waitError = e.msg
  let elapsed = (getMonoTime() - started).inMilliseconds
  if elapsed >= timeoutMs.int64:
    result.timedOut = true
    killProcessTree(process, graceMs = 2000)
  joinThread(outThread)
  joinThread(errThread)
  try:
    process.close()
  except CatchableError:
    discard

  let outText = takeShared(addr outBuf)
  let errText = takeShared(addr errBuf)
  result.code = code
  result.output = sanitizeUtf8(outText)
  result.error = sanitizeUtf8(errText & waitError)
  result.ms = elapsed
  let ok = code in okCodes
  recordCommand(args, elapsed, ok, if ok: "" else: result.error)

proc isLockContention(res: GitResult): bool =
  let low = res.error.toLowerAscii()
  "index.lock" in low or "unable to create" in low

proc runGit*(cwd: string, args: openArray[string], stdin = "",
             timeoutMs = 30_000,
             extraEnv: seq[(string, string)] = @[],
             okCodes: seq[int] = @[0],
             retryLock = false): GitResult =
  ## Run git with optional index.lock retry backoff (50/150/400 ms, docs/04 §6).
  result = runGitOnce(cwd, args, stdin, timeoutMs, extraEnv, okCodes)
  if retryLock and result.code notin okCodes and not result.timedOut and
      isLockContention(result):
    for delay in [50, 150, 400]:
      sleep(delay)
      result = runGitOnce(cwd, args, stdin, timeoutMs, extraEnv, okCodes)
      if result.code in okCodes or result.timedOut or not isLockContention(result):
        break

proc quotePath*(path: string): string =
  ## Only used for display; git argv is passed as an array on purpose.
  path.replace('\\', '/')

proc unquoteGitPath(path: string): string =
  ## Undo git's C-style path quoting when core.quotePath does not cover it
  ## (tabs/newlines in names). Invalid escapes are kept verbatim.
  if path.len < 2 or path[0] != '"':
    return path
  var i = 1
  while i < path.len:
    if path[i] == '"':
      break
    if path[i] == '\\' and i + 1 < path.len:
      inc i
      case path[i]
      of 'n': result.add '\n'
      of 't': result.add '\t'
      of 'r': result.add '\r'
      of '"': result.add '"'
      of '\\': result.add '\\'
      elif path[i] in {'0'..'7'}:
        var value = 0
        var count = 0
        while count < 3 and i < path.len and path[i] in {'0'..'7'}:
          value = value * 8 + (ord(path[i]) - ord('0'))
          inc i
          inc count
        dec i
        result.add char(value)
      else:
        result.add path[i]
    else:
      result.add path[i]
    inc i

proc stripDiffPrefix*(path: string): string =
  ## `a/x`, `b/x` → `x`; `/dev/null` stays.
  var p = path.unquoteGitPath()
  if p == "/dev/null":
    return p
  if p.len >= 2 and p[1] == '/':
    p = p[2 .. ^1]
  p

# --- status ---------------------------------------------------------------

proc bumpStatus(dirty: var Dirty, xy: string) =
  if xy.len < 2:
    return
  let indexSt = xy[0]
  let workTreeSt = xy[1]
  if indexSt in {'M', 'T', 'R', 'C', 'A', 'D'}:
    inc dirty.staged
  if workTreeSt in {'M', 'T', 'D'}:
    inc dirty.unstaged

proc parseStatusV2*(raw: string): tuple[branch: string, detached: bool,
    head: string, ahead: int, behind: int, dirty: Dirty] =
  ## `git status --porcelain=v2 --branch -z`, NUL-separated.
  result.ahead = -1
  result.behind = -1
  let records = raw.split('\0')
  var i = 0
  while i < records.len:
    let rec = records[i]
    inc i
    if rec.len == 0:
      continue
    if rec[0] == '#':
      let rest = rec[2 .. ^1]
      if rest.startsWith("branch.oid "):
        result.head = rest["branch.oid ".len .. ^1]
        if result.head == "(initial)":
          result.head = ""
      elif rest.startsWith("branch.head "):
        let name = rest["branch.head ".len .. ^1]
        if name == "(detached)":
          result.detached = true
        else:
          result.branch = name
      elif rest.startsWith("branch.ab "):
        let parts = rest["branch.ab ".len .. ^1].splitWhitespace()
        if parts.len == 2:
          try:
            result.ahead = parseInt(parts[0].replace("+", ""))
            result.behind = parseInt(parts[1].replace("-", ""))
          except ValueError:
            discard
      continue
    case rec[0]
    of '1', '2':
      let sp = rec.find(' ')
      if sp > 0 and sp + 3 <= rec.len:
        bumpStatus(result.dirty, rec[sp + 1 .. sp + 2])
      if rec[0] == '2':
        inc i   # rename/copy records carry the original path as the next record
    of 'u':
      inc result.dirty.conflicted
    of '?':
      inc result.dirty.untracked
    else:
      discard

proc gitDirOf*(repoPath: string): string =
  ## Resolve the actual git dir: plain `.git` dir, or the `gitdir:` file used
  ## by worktrees and submodules.
  let dotGit = repoPath / ".git"
  if dirExists(dotGit):
    return dotGit
  if fileExists(dotGit):
    try:
      let text = readFile(dotGit).strip()
      if text.startsWith("gitdir:"):
        let target = text["gitdir:".len .. ^1].strip()
        let resolved = if target.isAbsolute: target else: repoPath / target
        if dirExists(resolved):
          return resolved
    except CatchableError:
      discard
  ""

proc lastCommitAtOf*(repoPath: string): int64 =
  ## Read the last `logs/HEAD` line — pure filesystem, no git process (the
  ## sidebar repaints 30 repos and cannot afford 30 more spawns).
  let gitDir = gitDirOf(repoPath)
  if gitDir.len == 0:
    return 0
  let logPath = gitDir / "logs" / "HEAD"
  if not fileExists(logPath):
    return 0
  try:
    let text = readFile(logPath)
    var last = ""
    for line in text.splitLines():
      if line.len > 0:
        last = line
    # <old> <new> author <name> <email> <ts> <tz>\t<message>
    let tab = last.rfind('\t')
    let head = if tab >= 0: last[0 ..< tab] else: last
    let parts = head.splitWhitespace()
    if parts.len >= 5:
      let ts = parseInt(parts[^2])
      return ts.int64 * 1000
  except CatchableError:
    discard
  return 0

proc statusOfCli*(repoPath: string): Repo =
  result.path = normalizePath(repoPath)
  result.name = repoPath.lastPathPart
  result.id = repoId(repoPath)
  result.lang = langOf(result.name)
  result.ahead = -1
  result.behind = -1
  let res = runGit(repoPath, ["status", "--porcelain=v2", "--branch", "-z"])
  if res.code != 0:
    result.error = res.error.strip()
    return
  let parsed = parseStatusV2(res.output)
  result.branch = parsed.branch
  result.detached = parsed.detached
  result.head = if parsed.head.len >= 7: parsed.head[0 ..< 7] else: parsed.head
  result.ahead = parsed.ahead
  result.behind = parsed.behind
  result.dirty = parsed.dirty
  result.lastCommitAt = lastCommitAtOf(repoPath)

proc statusOf*(repoPath: string): Repo =
  ## Read repository status (in-process libgit2 when linked, CLI fallback).
  when defined(knitLibgit2):
    statusOfLib(repoPath)
  else:
    statusOfCli(repoPath)

# --- log ------------------------------------------------------------------

proc parseLog*(raw: string): seq[Commit] =
  ## `git log -z --format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b`
  for record in raw.split('\0'):
    if record.len == 0:
      continue
    let f = record.split('\x1f')
    if f.len < 7:
      continue
    var c = Commit(hash: f[0], shortHash: f[0][0 ..< 7], subject: f[5])
    c.parents = if f[1].len > 0: f[1].splitWhitespace() else: @[]
    c.authorName = f[2]
    c.authorEmail = f[3]
    try:
      c.committedAt = parseInt(f[4]).int64 * 1000
    except ValueError:
      c.committedAt = 0
    c.body = f[6].strip()
    if c.body.len > 600:
      c.body = c.body[0 ..< 600] & "…"
    if c.subject.len > 300:
      c.subject = c.subject[0 ..< 300] & "…"
    result.add c

proc refMap*(repoPath: string): seq[tuple[short, name: string]] =
  let res = runGit(repoPath, ["for-each-ref",
    "--format=%(objectname:short)%1f%(refname)"])
  if res.code != 0:
    return @[]
  for line in res.output.splitLines():
    if line.len == 0:
      continue
    let parts = line.split('\x1f')
    if parts.len == 2:
      result.add (parts[0], parts[1])

proc attachRefs*(commits: var seq[Commit], refs: seq[tuple[short, name: string]]) =
  for entry in refs:
    for commit in commits.mitems:
      if commit.shortHash == entry.short:
        var name = entry.name
        if name.startsWith("refs/heads/"):
          name = name["refs/heads/".len .. ^1]
        elif name.startsWith("refs/remotes/"):
          name = name["refs/remotes/".len .. ^1]
        elif name.startsWith("refs/tags/"):
          name = "tag: " & name["refs/tags/".len .. ^1]
        commit.refs.add name
        break

proc logOfCli*(repoPath: string, limit: int, branch = "", allBranches = false,
               path = "", cursor = ""): seq[Commit] =
  var args = @["-c", "i18n.logOutputEncoding=UTF-8",
               "log", "-z", "--no-color",
               "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b"]
  if cursor.len == 0:
    args.add "-n"
    args.add $limit
  if path.len > 0:
    args.add "--follow"
  if allBranches:
    args.add "--all"
  elif branch.len > 0:
    args.add branch
  args.add "--"
  if path.len > 0:
    args.add path
  let res = runGit(repoPath, args)
  if res.code != 0:
    return @[]
  var allCommits = parseLog(res.output)
  if cursor.len > 0:
    var startIdx = -1
    for i, c in allCommits:
      if c.hash == cursor or c.hash.startsWith(cursor):
        startIdx = i + 1
        break
    if startIdx < 0 or startIdx >= allCommits.len:
      return @[]
    let stopIdx = min(allCommits.len, startIdx + max(1, limit))
    result = allCommits[startIdx ..< stopIdx]
  else:
    result = allCommits
  let refs = refMap(repoPath)
  attachRefs(result, refs)
  if result.len > 0:
    var headHash = ""
    let headOidRes = runGit(repoPath, ["rev-parse", "HEAD"], okCodes = @[0, 128])
    if headOidRes.code == 0:
      headHash = headOidRes.output.strip()
    var headName = "HEAD"
    let headRes = runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"], okCodes = @[0, 128])
    if headRes.code == 0:
      let name = headRes.output.strip()
      if name.len > 0 and name != "HEAD":
        headName = "HEAD -> " & name
    for commit in result.mitems:
      if headHash.len > 0 and commit.hash == headHash:
        if headName notin commit.refs:
          commit.refs.insert(headName, 0)
        if headName.startsWith("HEAD -> "):
          let branchName = headName["HEAD -> ".len .. ^1]
          var kept: seq[string]
          for refName in commit.refs:
            if refName != branchName:
              kept.add refName
          commit.refs = kept
      commit.refs.sort(proc(a, b: string): int =
        proc rank(name: string): int =
          if name.startsWith("HEAD"): 0
          elif name.startsWith("tag:"): 2
          elif '/' in name: 1
          else: 3
        cmp(rank(a), rank(b)))

proc logPage*(repoPath: string, limit: int, branch = "", allBranches = false,
              path = "", cursor = ""): tuple[commits: seq[Commit],
              hasMore: bool, nextCursor: string] =
  ## Paginated log: libgit2 in-process for normal/branch/all logs, CLI for --follow path filter.
  when defined(knitLibgit2):
    if path.len == 0:
      return logOfLib(repoPath, limit, branch, allBranches, cursor)
  let fetched = logOfCli(repoPath, limit + 1, branch, allBranches, path, cursor)
  if fetched.len > limit:
    result.commits = fetched[0 ..< limit]
    result.hasMore = true
    result.nextCursor = result.commits[^1].hash
  else:
    result.commits = fetched
    result.hasMore = false

proc logOf*(repoPath: string, limit: int, branch = "", allBranches = false,
            path = "", cursor = ""): seq[Commit] =
  logPage(repoPath, limit, branch, allBranches, path, cursor).commits

# --- file lists -----------------------------------------------------------

type
  NumStat* = object
    additions*: int
    deletions*: int
    binary*: bool
    oldPath*: string

proc parseNumStatZ(raw: string): seq[tuple[path, oldPath: string, s: NumStat]] =
  ## `git diff --numstat -z -M`: each record is `add\tdel\tpath\0`; for
  ## renames the path is empty and two NUL-separated paths follow.
  var parts = raw.split('\0')
  var i = 0
  while i < parts.len:
    let rec = parts[i]
    inc i
    if rec.len == 0:
      continue
    let fields = rec.split('\t')
    if fields.len < 3:
      continue
    var stat = NumStat(additions: -1, deletions: -1)
    if fields[0] == "-" or fields[1] == "-":
      stat.binary = true
      stat.additions = 0
      stat.deletions = 0
    else:
      try:
        stat.additions = parseInt(fields[0])
        stat.deletions = parseInt(fields[1])
      except ValueError:
        stat.additions = 0
        stat.deletions = 0
    var p = fields[2]
    if p.len == 0 and i + 1 < parts.len:
      # rename record: old path then new path
      stat.oldPath = parts[i]
      p = parts[i + 1]
      i += 2
    result.add (p, stat.oldPath, stat)

proc parseNumStatPlain(raw: string): seq[tuple[path, oldPath: string, s: NumStat]] =
  for line in raw.splitLines():
    if line.len == 0:
      continue
    let fields = line.split('\t')
    if fields.len < 3:
      continue
    var stat = NumStat(additions: -1, deletions: -1)
    if fields[0] == "-":
      stat.binary = true
      stat.additions = 0
      stat.deletions = 0
    else:
      try:
        stat.additions = parseInt(fields[0])
        stat.deletions = parseInt(fields[1])
      except ValueError:
        discard
    var p = fields[2]
    var oldPath = ""
    if " => " in p:
      let at = p.find(" => ")
      let before = p[0 ..< at]
      let after = p[at + 4 .. ^1]
      let slash = before.rfind('/')
      let base = if slash >= 0: before[0 .. slash] else: ""
      oldPath = before
      p = base & after
    result.add (p, oldPath, stat)

proc parseNumStat*(raw: string): seq[tuple[path, oldPath: string, s: NumStat]] =
  if raw.contains('\0'):
    parseNumStatZ(raw)
  else:
    parseNumStatPlain(raw)

proc readUntrackedCount(repoPath, path: string): NumStat =
  ## Untracked files have no diff; count lines unless it looks binary.
  let full = repoPath / path
  if not fileExists(full):
    return NumStat(additions: 0, deletions: 0)
  try:
    let data = readFile(full)
    if data.len > 0 and '\0' in data:
      return NumStat(additions: 0, deletions: 0, binary: true)
    var lines = data.count('\n')
    if data.len > 0 and not data.endsWith("\n"):
      inc lines
    result = NumStat(additions: lines, deletions: 0)
  except CatchableError:
    result = NumStat(additions: 0, deletions: 0)

proc unresolvedConflict*(repoPath, path: string): bool =
  ## `git ls-files -u -- <path>` is non-empty while stages 1/2/3 exist.
  let res = runGit(repoPath, ["ls-files", "-u", "--", path])
  res.code == 0 and res.output.strip().len > 0

proc normalizeStatus*(ch: string): string =
  case ch
  of "A": "A"
  of "D": "D"
  of "R": "R"
  of "C": "C"
  of "U": "U"
  of "T": "M"          # type change shows as modified
  else: "M"

proc statusEntriesCli*(repoPath: string): seq[FileEntry] =
  ## One entry per (file, group). A file with both staged and unstaged
  ## changes appears twice, matching the two sections in the changes tab.
  let res = runGit(repoPath, ["status", "--porcelain=v2", "-z",
                              "--untracked-files=all"])
  if res.code != 0:
    return @[]
  let stagedStats = block:
    let s = runGit(repoPath, ["diff", "--cached", "--numstat", "-z", "-M"])
    s.output.parseNumStat()
  let unstagedStats = block:
    let s = runGit(repoPath, ["diff", "--numstat", "-z", "-M"])
    s.output.parseNumStat()
  var stagedMap: Table[string, NumStat]
  var unstagedMap: Table[string, NumStat]
  for (path, _, stat) in stagedStats:
    stagedMap[path] = stat
  for (path, _, stat) in unstagedStats:
    unstagedMap[path] = stat

  let records = res.output.split('\0')
  var i = 0
  while i < records.len:
    let rec = records[i]
    inc i
    if rec.len == 0:
      continue
    if rec[0] == '#' or rec[0] == '!':
      continue
    if rec[0] == '?':
      let path = rec[2 .. ^1]
      let count = readUntrackedCount(repoPath, path)
      var entry = FileEntry(path: path, status: "A", group: "unstaged",
                            additions: count.additions,
                            deletions: 0, untracked: true,
                            binary: count.binary)
      result.add entry
      continue
    if rec[0] == 'u':
      # "u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
      # maxsplit keeps spaces inside the path intact.
      let fields = rec.split(' ', maxsplit = 10)
      if fields.len >= 11:
        let path = fields[10]
        var entry = FileEntry(path: path, status: "U", group: "unstaged",
                              conflict: true)
        if unresolvedConflict(repoPath, path):
          result.add entry
        continue
    if rec[0] in {'1', '2'}:
      let fields = rec.split(' ', maxsplit = (if rec[0] == '2': 9 else: 8))
      if fields.len < (if rec[0] == '2': 10 else: 9):
        continue
      let xy = fields[1]
      var path = fields[fields.len - 1]
      var oldPath = ""
      if rec[0] == '2':
        # For -z, the original path follows as the next record.
        if i < records.len:
          oldPath = records[i]
        inc i
      let x = if xy.len > 0: $xy[0] else: "."
      let y = if xy.len > 1: $xy[1] else: "."
      if x != "." and x != " ":
        var entry = FileEntry(path: path, oldPath: oldPath,
                              status: normalizeStatus(x), group: "staged")
        if stagedMap.hasKey(path):
          entry.additions = stagedMap[path].additions
          entry.deletions = stagedMap[path].deletions
          entry.binary = stagedMap[path].binary
        result.add entry
      if y != "." and y != " ":
        var entry = FileEntry(path: path, oldPath: oldPath,
                              status: normalizeStatus(y), group: "unstaged")
        if unstagedMap.hasKey(path):
          entry.additions = unstagedMap[path].additions
          entry.deletions = unstagedMap[path].deletions
          entry.binary = unstagedMap[path].binary
        result.add entry
      continue
  # Stable order: staged first, then path.
  result.sort(proc(a, b: FileEntry): int =
    let ga = if a.group == "staged": 0 else: 1
    let gb = if b.group == "staged": 0 else: 1
    if ga != gb: cmp(ga, gb) else: cmp(a.path, b.path))

proc statusEntries*(repoPath: string): seq[FileEntry] =
  when defined(knitLibgit2):
    statusEntriesLib(repoPath)
  else:
    statusEntriesCli(repoPath)

proc parentsOf*(repoPath, hash: string): seq[string] =
  let res = runGit(repoPath, ["rev-list", "--parents", "-n", "1", hash])
  if res.code != 0:
    return @[]
  let parts = res.output.strip().splitWhitespace()
  for i in 1 ..< parts.len:
    result.add parts[i]

proc parseNameStatusZ(raw: string): seq[tuple[path, oldPath, status: string]] =
  ## `git show --name-status -z`: `M\0path\0`, `R100\0old\0new\0`.
  var parts = raw.split('\0')
  var i = 0
  while i < parts.len:
    let status = parts[i]
    inc i
    if status.len == 0 or i >= parts.len:
      continue
    let code = status[0]
    let letter = normalizeStatus($code)
    if code == 'R' or code == 'C':
      if i + 1 >= parts.len:
        break
      let oldPath = parts[i]
      let newPath = parts[i + 1]
      i += 2
      result.add (newPath, oldPath, letter)
    else:
      let path = parts[i]
      inc i
      result.add (path, "", letter)

proc commitFilesCli*(repoPath, hash: string): seq[FileEntry] =
  ## Files changed by a commit. For merges this is the first-parent diff,
  ## which is what IDEA/Fork show in the details pane.
  let parents = parentsOf(repoPath, hash)
  var baseArgs: seq[string]
  if parents.len > 1:
    baseArgs = @["diff-tree", "--no-commit-id", "-r", "-M"]
  else:
    baseArgs = @["diff-tree", "--root", "--no-commit-id", "-r", "-M"]
  var nameArgs = baseArgs & @["--name-status", "-z"]
  var numArgs = baseArgs & @["--numstat", "-z"]
  if parents.len > 1:
    nameArgs.add parents[0]
    nameArgs.add hash
    numArgs.add parents[0]
    numArgs.add hash
  else:
    nameArgs.add hash
    numArgs.add hash
  let nameRes = runGit(repoPath, nameArgs)
  if nameRes.code != 0:
    return @[]
  var entries = nameRes.output.parseNameStatusZ()
  let numRes = runGit(repoPath, numArgs)
  var stats: Table[string, NumStat]
  if numRes.code == 0:
    for (path, _, stat) in numRes.output.parseNumStat():
      stats[path] = stat
  for (path, oldPath, letter) in entries:
    var entry = FileEntry(path: path, oldPath: oldPath, status: letter,
                          group: "commit")
    if stats.hasKey(path):
      entry.additions = stats[path].additions
      entry.deletions = stats[path].deletions
      entry.binary = stats[path].binary
    result.add entry

proc commitFiles*(repoPath, hash: string): seq[FileEntry] =
  when defined(knitLibgit2):
    commitFilesLib(repoPath, hash)
  else:
    commitFilesCli(repoPath, hash)

proc refsOf*(repoPath: string): seq[tuple[name, typ, target: string]] =
  when defined(knitLibgit2):
    refsOfLib(repoPath)
  else:
    let res = runGit(repoPath, ["for-each-ref",
      "--format=%(refname)%1f%(objectname)"])
    if res.code != 0:
      return @[]
    for line in res.output.splitLines():
      let parts = line.split('\x1f')
      if parts.len != 2:
        continue
      let name = parts[0]
      var typ = "branch"
      var display = name
      if name.startsWith("refs/heads/"):
        display = name["refs/heads/".len .. ^1]
      elif name.startsWith("refs/remotes/"):
        typ = "remote"
        display = name["refs/remotes/".len .. ^1]
      elif name.startsWith("refs/tags/"):
        typ = "tag"
        display = name["refs/tags/".len .. ^1]
      else:
        continue
      result.add (display, typ, parts[1])

proc blameOfCli*(repoPath, filePath: string, hash = "",
                 minLine = 0, maxLine = 0): seq[BlameLine] =
  var args = @["blame", "--line-porcelain", "-M", "-C"]
  if minLine > 0 and maxLine >= minLine:
    args.add "-L"
    args.add($minLine & "," & $maxLine)
  if hash.len > 0:
    args.add hash
  args.add "--"
  args.add filePath
  let res = runGit(repoPath, args, timeoutMs = 30_000)
  if res.code != 0:
    return @[]
  var curHash = ""
  var curAuthor = ""
  var curTime = 0'i64
  var curSummary = ""
  var curLine = 0
  for line in res.output.splitLines():
    if line.len == 0:
      continue
    if line[0] == '\t':
      result.add BlameLine(
        line: curLine,
        hash: curHash,
        shortHash: if curHash.len >= 7: curHash[0 ..< 7] else: curHash,
        author: curAuthor,
        time: curTime,
        summary: curSummary,
        text: line[1 .. ^1],
      )
    elif line.startsWith("author "):
      curAuthor = line["author ".len .. ^1]
    elif line.startsWith("author-time "):
      try:
        curTime = parseInt(line["author-time ".len .. ^1]).int64 * 1000
      except ValueError:
        curTime = 0
    elif line.startsWith("summary "):
      curSummary = line["summary ".len .. ^1]
    else:
      let parts = line.splitWhitespace()
      if parts.len >= 3 and parts[0].len == 40 and
          parts[0].allCharsInSet({'0'..'9', 'a'..'f'}):
        curHash = parts[0]
        try:
          curLine = parseInt(parts[2])
        except ValueError:
          inc curLine

proc blameOf*(repoPath, filePath: string, hash = "",
              minLine = 0, maxLine = 0): seq[BlameLine] =
  when defined(knitLibgit2):
    blameOfLib(repoPath, filePath, hash, minLine, maxLine)
  else:
    blameOfCli(repoPath, filePath, hash, minLine, maxLine)

# --- write path -----------------------------------------------------------

proc stageFiles*(repoPath: string, paths: seq[string], staged: bool): GitResult =
  if paths.len == 0:
    return GitResult(code: 0)
  if staged:
    var args = @["add", "-A", "--"]
    args.add paths
    result = runGit(repoPath, args, timeoutMs = 120_000)
  else:
    var args = @["restore", "--staged", "--"]
    args.add paths
    result = runGit(repoPath, args, timeoutMs = 120_000)
    if result.code != 0 and "unknown option" in result.error:
      var fallback = @["reset", "HEAD", "--"]
      fallback.add paths
      result = runGit(repoPath, fallback, timeoutMs = 120_000)

proc applyCachedPatch*(repoPath, patch: string, reverse: bool): GitResult =
  if patch.strip().len == 0:
    return GitResult(code: 0)
  var args = @["apply", "--cached", "--whitespace=nowarn"]
  if reverse:
    args.add "--reverse"
  args.add "-"
  result = runGit(repoPath, args, stdin = patch, timeoutMs = 120_000)

proc createStashSnapshot*(repoPath, label: string): string

proc discardFiles*(repoPath: string, paths: seq[string]): GitResult =
  ## Guarded by the UI: snapshots tracked changes before restoring, and removes
  ## selected untracked / newly-staged files safely within the repository root.
  if paths.len == 0:
    return GitResult(code: 0)
  discard createStashSnapshot(repoPath, "knit:discard-snapshot")
  var lsArgs = @["ls-files", "-z", "--"]
  lsArgs.add paths
  let tRes = runGit(repoPath, lsArgs, okCodes = @[0, 1])
  var trackedSet: Table[string, bool]
  if tRes.code == 0:
    for p in tRes.output.split('\0'):
      if p.len > 0:
        trackedSet[p] = true
  var tracked: seq[string]
  var untracked: seq[string]
  for p in paths:
    if trackedSet.hasKey(p):
      tracked.add p
    else:
      untracked.add p
  result = GitResult(code: 0)
  if tracked.len > 0:
    # Unstage if staged, then check which files remain tracked in HEAD/index.
    var unstageArgs = @["restore", "--staged", "--"]
    unstageArgs.add tracked
    discard runGit(repoPath, unstageArgs, timeoutMs = 60_000, okCodes = @[0, 1, 128])
    var afterArgs = @["ls-files", "-z", "--"]
    afterArgs.add tracked
    let afterRes = runGit(repoPath, afterArgs, okCodes = @[0, 1])
    var stillTrackedSet: Table[string, bool]
    if afterRes.code == 0:
      for p in afterRes.output.split('\0'):
        if p.len > 0:
          stillTrackedSet[p] = true
    var stillTracked: seq[string]
    for p in tracked:
      if stillTrackedSet.hasKey(p):
        stillTracked.add p
      else:
        untracked.add p
    if stillTracked.len > 0:
      var args = @["restore", "--worktree", "--"]
      args.add stillTracked
      result = runGit(repoPath, args, timeoutMs = 120_000, retryLock = true)
      if result.code != 0:
        return
  let rootNorm = normalizedPath(repoPath)
  for p in untracked:
    if p.len == 0 or p.isAbsolute or ".." in p.replace('\\', '/').split('/'):
      continue
    let full = normalizedPath(repoPath / p)
    if full.startsWith(rootNorm & $DirSep):
      try:
        if fileExists(full):
          removeFile(full)
        elif dirExists(full):
          removeDir(full)
      except CatchableError as e:
        return GitResult(code: -1, error: e.msg)

proc commitStaged*(repoPath, message: string, amend: bool): GitResult =
  ## Message goes over stdin (docs/04 §4); hooks run normally.
  var args = @["commit", "-F", "-", "--cleanup=strip"]
  if amend:
    args.add "--amend"
  result = runGit(repoPath, args, stdin = message, timeoutMs = 120_000)

proc pushCurrent*(repoPath: string): GitResult =
  let branchRes = runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])
  if branchRes.code != 0:
    return branchRes
  let branch = branchRes.output.strip()
  if branch.len == 0 or branch == "HEAD":
    return GitResult(code: -1, error: "detached HEAD，无法推送")
  let upstream = runGit(repoPath, ["rev-parse", "--abbrev-ref",
                                  "--symbolic-full-name", "@{u}"],
                        okCodes = @[0, 128])
  if upstream.code == 0 and upstream.output.strip().len > 0:
    result = runGit(repoPath, ["push"], timeoutMs = 300_000)
  else:
    let remotes = runGit(repoPath, ["remote"])
    let remote = if remotes.code == 0 and remotes.output.strip().len > 0:
                   remotes.output.strip().splitLines()[0]
                 else: "origin"
    result = runGit(repoPath, ["push", "--set-upstream", remote, branch],
                    timeoutMs = 300_000)

proc bookmarkBefore*(repoPath, op: string) =
  ## docs/04 §8: a durable pointer to the pre-operation HEAD.
  let head = runGit(repoPath, ["rev-parse", "HEAD"])
  if head.code == 0 and head.output.strip().len > 0:
    discard runGit(repoPath, ["update-ref",
      "refs/knit/before-" & op & "-" & $getTime().toUnix, head.output.strip()],
      timeoutMs = 30_000)

proc createStashSnapshot*(repoPath, label: string): string =
  ## Create a detached stash commit without modifying working tree (docs/04 §8).
  let snapshot = runGit(repoPath, ["stash", "create", label], timeoutMs = 30_000)
  let sha = snapshot.output.strip()
  if snapshot.code == 0 and sha.len > 0:
    let refName = "refs/knit/snapshots/" & $getTime().toUnix & "-" & $getMonoTime().ticks
    discard runGit(repoPath, ["update-ref", refName, sha], timeoutMs = 30_000)
    return sha
  ""

proc resetTo*(repoPath, rev, mode: string): GitResult =
  ## Reset HEAD to `rev` with mode `soft | mixed | hard`.
  ## Hard reset always snapshots dirty state first (docs/04 §8).
  if mode notin ["soft", "mixed", "hard"]:
    return GitResult(code: -1, error: "不支持的 reset 模式：" & mode)
  bookmarkBefore(repoPath, "reset-" & mode)
  if mode == "hard":
    discard createStashSnapshot(repoPath, "knit:before-reset-hard")
  runGit(repoPath, ["reset", "--" & mode, rev], timeoutMs = 120_000, retryLock = true)

proc pushForceWithLease*(repoPath: string, protectedBranches: seq[string]): GitResult =
  ## Force push using --force-with-lease; refuses protected branches (docs/04 §8).
  let branchRes = runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])
  if branchRes.code != 0:
    return branchRes
  let branch = branchRes.output.strip()
  if branch.len == 0 or branch == "HEAD":
    return GitResult(code: -1, error: "detached HEAD，无法推送")
  for pb in protectedBranches:
    if pb == branch:
      return GitResult(code: -1, error: "受保护分支 " & branch & " 禁止 force push")
  runGit(repoPath, ["push", "--force-with-lease"], timeoutMs = 300_000)

proc pruneWorktrees*(repoPath: string): GitResult =
  runGit(repoPath, ["worktree", "prune"], timeoutMs = 30_000)

# --- daily branch & remote operations --------------------------------------

proc fetchAll*(repoPath: string): GitResult =
  ## Fetch all remotes and prune stale remote-tracking refs (docs/04 §4).
  runGit(repoPath, ["fetch", "--all", "--prune"], timeoutMs = 300_000)

proc pullCurrent*(repoPath: string, rebase = false): GitResult =
  ## Pull current branch from upstream (optional --rebase).
  var args = @["pull"]
  if rebase:
    args.add "--rebase"
  runGit(repoPath, args, timeoutMs = 300_000, retryLock = true)

proc checkoutBranch*(repoPath, target: string): GitResult =
  ## Checkout a local branch, tag, commit, or remote-tracking branch.
  if target.strip().len == 0:
    return GitResult(code: -1, error: "分支名不能为空")
  # If target looks like `origin/feat` and no local `feat` exists, track it.
  if '/' in target:
    let checkLocal = runGit(repoPath, ["show-ref", "--verify", "--quiet",
                                       "refs/heads/" & target], okCodes = @[0, 1])
    if checkLocal.code != 0:
      let checkRemote = runGit(repoPath, ["show-ref", "--verify", "--quiet",
                                          "refs/remotes/" & target], okCodes = @[0, 1])
      if checkRemote.code == 0:
        return runGit(repoPath, ["checkout", "--track", target],
                      timeoutMs = 120_000, retryLock = true)
  runGit(repoPath, ["checkout", target], timeoutMs = 120_000, retryLock = true)

proc createBranch*(repoPath, name, startPoint: string, checkout = true): GitResult =
  ## Create a new branch from `startPoint` (default HEAD) and optionally check it out.
  let clean = name.strip()
  if clean.len == 0:
    return GitResult(code: -1, error: "新分支名不能为空")
  let base = if startPoint.strip().len > 0: startPoint.strip() else: "HEAD"
  if checkout:
    runGit(repoPath, ["checkout", "-b", clean, base], timeoutMs = 120_000, retryLock = true)
  else:
    runGit(repoPath, ["branch", clean, base], timeoutMs = 60_000, retryLock = true)

proc deleteBranch*(repoPath, name: string, force = false,
                   protectedBranches: seq[string] = @["main", "master"]): GitResult =
  ## Delete a local branch; refuses current branch and protected branches.
  let clean = name.strip()
  if clean.len == 0:
    return GitResult(code: -1, error: "分支名不能为空")
  if clean in protectedBranches:
    return GitResult(code: -1, error: "受保护分支 " & clean & " 禁止删除")
  let cur = runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])
  if cur.code == 0 and cur.output.strip() == clean:
    return GitResult(code: -1, error: "无法删除当前检出的分支：" & clean)
  let flag = if force: "-D" else: "-d"
  runGit(repoPath, ["branch", flag, clean], timeoutMs = 60_000, retryLock = true)

proc mergeBranch*(repoPath, branch: string): GitResult =
  ## Merge `branch` into current HEAD; records pre-merge bookmark first.
  let clean = branch.strip()
  if clean.len == 0:
    return GitResult(code: -1, error: "缺少要合并的分支名")
  bookmarkBefore(repoPath, "merge")
  runGit(repoPath, ["merge", "--no-edit", clean], timeoutMs = 120_000, retryLock = true)

proc mergeAbort*(repoPath: string): GitResult =
  runGit(repoPath, ["merge", "--abort"], timeoutMs = 120_000, retryLock = true)

proc mergeInProgress*(repoPath: string): bool =
  let gd = gitDirOf(repoPath)
  gd.len > 0 and fileExists(gd / "MERGE_HEAD")

# --- interactive rebase (docs/04 §4, docs/07 M5.1) -------------------------

type
  RebaseTodoItem* = object
    action*: string        ## pick | reword | edit | squash | fixup | drop
    hash*: string
    shortHash*: string
    subject*: string
    author*: string
    message*: string       ## custom commit message for reword / squash

  RebaseStateInfo* = object
    inProgress*: bool
    headName*: string
    msgNum*: int
    endNum*: int
    onto*: string
    conflicts*: seq[string]

proc rebasePlan*(repoPath, onto: string): seq[RebaseTodoItem] =
  ## List commits in oldest-first order (the exact order git rebase -i uses).
  var args = @["-c", "i18n.logOutputEncoding=UTF-8",
               "log", "--reverse", "-z", "--no-color",
               "--format=%H%x1f%an%x1f%s"]
  if onto.len > 0 and onto != "--root":
    args.add(onto & "..HEAD")
  let res = runGit(repoPath, args, timeoutMs = 30_000)
  if res.code != 0:
    return @[]
  for rec in res.output.split('\0'):
    if rec.len == 0:
      continue
    let f = rec.split('\x1f')
    if f.len < 3:
      continue
    let h = f[0].strip()
    if h.len < 7:
      continue
    result.add RebaseTodoItem(
      action: "pick",
      hash: h,
      shortHash: h[0 ..< 7],
      author: f[1],
      subject: f[2],
    )

proc mergeConflicts*(repoPath: string): seq[string]

proc rebaseState*(repoPath: string): RebaseStateInfo =
  ## Inspect `.git/rebase-merge` / `.git/rebase-apply` (docs/04 §4).
  let gd = gitDirOf(repoPath)
  if gd.len == 0:
    return
  let mergeDir = gd / "rebase-merge"
  let applyDir = gd / "rebase-apply"
  let activeDir = if dirExists(mergeDir): mergeDir
                  elif dirExists(applyDir): applyDir
                  else: ""
  if activeDir.len == 0:
    return
  result.inProgress = true
  proc readField(name: string): string =
    let p = activeDir / name
    if fileExists(p):
      try: return readFile(p).strip()
      except CatchableError: return ""
  result.headName = readField("head-name")
  if result.headName.startsWith("refs/heads/"):
    result.headName = result.headName["refs/heads/".len .. ^1]
  result.onto = readField("onto")
  if result.onto.len >= 7:
    result.onto = result.onto[0 ..< 7]
  try: result.msgNum = parseInt(readField("msgnum"))
  except ValueError: discard
  try: result.endNum = parseInt(readField("end"))
  except ValueError: discard
  result.conflicts = mergeConflicts(repoPath)

proc makeEditorScript(dir, name, body: string): string =
  when defined(windows):
    result = dir / (name & ".cmd")
    writeFile(result, body)
  else:
    result = dir / (name & ".sh")
    writeFile(result, body)
    setFilePermissions(result, {fpUserExec, fpUserRead, fpUserWrite})

proc rebaseStart*(repoPath, onto: string, todo: seq[RebaseTodoItem]): GitResult =
  ## Run `git rebase -i` driven by generated sequence & message editor scripts.
  if todo.len == 0:
    return GitResult(code: -1, error: "rebase todo 列表为空")
  bookmarkBefore(repoPath, "rebase")
  let gd = gitDirOf(repoPath)
  let workDir = (if gd.len > 0: gd else: repoPath / ".git") / "knit" / "rebase"
  createDir(workDir)

  var todoLines: seq[string]
  var msgFiles: seq[string]
  for idx, item in todo:
    let act = if item.action in ["pick", "reword", "edit", "squash", "fixup", "drop"]:
                item.action
              else: "pick"
    let hash = item.hash.strip()
    if hash.len == 0:
      continue
    todoLines.add(act & " " & hash & " " & item.subject.replace('\n', ' '))
    if act in ["reword", "squash"]:
      let msgPath = workDir / ("msg-" & $msgFiles.len & ".txt")
      writeFile(msgPath, item.message)
      msgFiles.add msgPath

  let todoPath = workDir / "todo.txt"
  writeFile(todoPath, todoLines.join("\n") & "\n")
  let counterPath = workDir / "msg-counter.txt"
  writeFile(counterPath, "0")

  let seqEditor = when defined(windows):
    makeEditorScript(workDir, "seq-editor",
      "@echo off\r\ncopy /Y \"" & todoPath & "\" \"%~1\" >NUL\r\n")
  else:
    makeEditorScript(workDir, "seq-editor",
      "#!/bin/sh\ncp '" & todoPath.replace("'", "'\\''") & "' \"$1\"\n")

  let msgEditor = when defined(windows):
    if msgFiles.len == 0:
      makeEditorScript(workDir, "msg-editor", "@echo off\r\nexit /b 0\r\n")
    else:
      var script = "@echo off\r\nset /p IDX=<\"" & counterPath & "\"\r\n"
      for i, mp in msgFiles:
        let nonEmpty = readFile(mp).strip().len > 0
        if nonEmpty:
          script.add "if \"%IDX%\"==\"" & $i & "\" copy /Y \"" & mp & "\" \"%~1\" >NUL\r\n"
      script.add "set /a NEXT=IDX+1\r\necho %NEXT%>\"" & counterPath & "\"\r\nexit /b 0\r\n"
      makeEditorScript(workDir, "msg-editor", script)
  else:
    if msgFiles.len == 0:
      makeEditorScript(workDir, "msg-editor", "#!/bin/sh\nexit 0\n")
    else:
      let qCount = counterPath.replace("'", "'\\''")
      var script = "#!/bin/sh\nIDX=$(cat '" & qCount & "')\n"
      for i, mp in msgFiles:
        let nonEmpty = readFile(mp).strip().len > 0
        if nonEmpty:
          let qmp = mp.replace("'", "'\\''")
          script.add "if [ \"$IDX\" = \"" & $i & "\" ]; then cp '" & qmp & "' \"$1\"; fi\n"
      script.add "echo $((IDX + 1)) > '" & qCount & "'\nexit 0\n"
      makeEditorScript(workDir, "msg-editor", script)

  var args = @["rebase", "-i"]
  if onto.len == 0 or onto == "--root":
    args.add "--root"
  else:
    args.add onto
  let env = @[
    ("GIT_SEQUENCE_EDITOR", seqEditor),
    ("GIT_EDITOR", msgEditor),
  ]
  runGit(repoPath, args, timeoutMs = 120_000, extraEnv = env, retryLock = true)

proc rebaseContinue*(repoPath: string): GitResult =
  let editor = when defined(windows): "cmd /c exit 0" else: "true"
  runGit(repoPath, ["rebase", "--continue"], timeoutMs = 120_000,
         extraEnv = @[("GIT_EDITOR", editor)], retryLock = true)

proc rebaseAbort*(repoPath: string): GitResult =
  runGit(repoPath, ["rebase", "--abort"], timeoutMs = 120_000, retryLock = true)

proc rebaseSkip*(repoPath: string): GitResult =
  runGit(repoPath, ["rebase", "--skip"], timeoutMs = 120_000, retryLock = true)

proc cherryPick*(repoPath, hash: string): GitResult =
  bookmarkBefore(repoPath, "cherry-pick")
  runGit(repoPath, ["cherry-pick", hash], timeoutMs = 120_000)

proc revertCommit*(repoPath, hash: string): GitResult =
  bookmarkBefore(repoPath, "revert")
  runGit(repoPath, ["revert", "--no-commit", hash], timeoutMs = 120_000)

proc createPatch*(repoPath, hash, outDir: string): GitResult =
  runGit(repoPath, ["format-patch", "-1", hash, "-o", outDir],
         timeoutMs = 30_000)

proc stashPush*(repoPath, message: string): GitResult =
  runGit(repoPath, ["stash", "push", "--include-untracked", "-m", message],
         timeoutMs = 120_000)

proc stashList*(repoPath: string): GitResult =
  runGit(repoPath, ["stash", "list", "--format=%gd%x1f%gs%x1f%ct"])

proc stashApply*(repoPath, refName: string): GitResult =
  runGit(repoPath, ["stash", "apply", refName], timeoutMs = 120_000)

proc applyPatchFile*(repoPath, path: string): GitResult =
  ## Shelf patches made by `git format-patch` start with `From `; working-tree
  ## diffs do not. Choose the matching apply mode (docs/04 §4).
  var head = ""
  try:
    let f = open(path, fmRead)
    defer: f.close()
    head = f.readLine()
  except CatchableError:
    return GitResult(code: -1, error: "无法读取 patch：" & path)
  if head.startsWith("From "):
    result = runGit(repoPath, ["am", "--3way", path], timeoutMs = 120_000)
  else:
    result = runGit(repoPath, ["apply", "--3way", path], timeoutMs = 120_000)

proc writeWorkdirPatch*(repoPath, path: string): GitResult =
  ## Snapshot current changes (staged + unstaged + untracked) as a patch that
  ## `git apply --3way` can consume later.
  let tracked = runGit(repoPath, ["diff", "HEAD", "--binary"])
  var text = tracked.output
  let untracked = runGit(repoPath, ["ls-files", "--others", "--exclude-standard", "-z"])
  if untracked.code == 0:
    for p in untracked.output.split('\0'):
      if p.len == 0:
        continue
      let single = runGit(repoPath, ["diff", "--no-index", "--binary", "--",
                                     "/dev/null", p], okCodes = @[0, 1])
      if single.output.len > 0:
        text.add single.output
  result = GitResult(code: 0, output: text)
  try:
    let parent = path.parentDir
    if parent.len > 0:
      createDir(parent)
    writeFile(path, text)
  except CatchableError as e:
    result = GitResult(code: -1, error: e.msg)
  if result.code == 0 and text.strip().len == 0:
    result = GitResult(code: -1, error: "没有可保存的改动")

proc showFileAt*(repoPath, hash, path: string): GitResult =
  runGit(repoPath, ["show", hash & ":" & path], timeoutMs = 30_000)

proc mergeStageContent*(repoPath, path: string, stage: int): GitResult =
  ## stage 1 = base, 2 = ours, 3 = theirs. A missing stage (add/add) is
  ## expected, not a console error.
  runGit(repoPath, ["show", ":" & $stage & ":" & path], timeoutMs = 30_000,
         okCodes = @[0, 128])

proc mergeConflicts*(repoPath: string): seq[string] =
  let res = runGit(repoPath, ["diff", "--name-only", "--diff-filter=U", "-z"])
  if res.code != 0:
    return @[]
  for p in res.output.split('\0'):
    if p.len > 0:
      result.add p

proc addFile*(repoPath, path: string): GitResult =
  runGit(repoPath, ["add", "--", path], timeoutMs = 120_000)

proc listWorktrees*(repoPath: string): GitResult =
  runGit(repoPath, ["worktree", "list", "--porcelain"])

proc addWorktree*(repoPath, dir, branch, startPoint: string): GitResult =
  runGit(repoPath, ["worktree", "add", dir, "-b", branch, startPoint],
         timeoutMs = 120_000)

proc removeWorktree*(repoPath, dir: string): GitResult =
  runGit(repoPath, ["worktree", "remove", dir], timeoutMs = 120_000)

proc gitVersion*(repoPath: string): GitResult =
  runGit(repoPath, ["--version"])

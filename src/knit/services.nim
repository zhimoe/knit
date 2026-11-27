## IPC surface (docs/03 §3.1). Everything here runs in nimi's background pool:
## arguments and results are JSON strings, no UI state is touched, and long
## loops check `context.isCancelled`.
##
## Writes are serialised through one global lock. That is stricter than the
## per-repo FIFO in docs/03 §2 (and safe for a single user); reads stay parallel.

import std/[algorithm, json, locks, monotimes, os, sha1, strutils, times]

import nimi

import ./[agent, diff, gitops, index, merge, store, types]

# --- argument helpers ------------------------------------------------------

proc payload(args: string): JsonNode =
  let raw = parseJson(args)
  var inner: JsonNode
  if raw.kind == JArray:
    if raw.len == 0:
      return newJObject()
    inner = raw[0]
  else:
    inner = raw
  if inner.kind == JString:
    inner = parseJson(inner.getStr())
  if inner.kind != JObject:
    return newJObject()
  inner

proc optStr(node: JsonNode, key: string, dflt = ""): string =
  if node.hasKey(key) and node[key].kind == JString:
    node[key].getStr(dflt)
  else:
    dflt

proc optInt(node: JsonNode, key: string, dflt: int): int =
  if node.hasKey(key) and node[key].kind == JInt:
    node[key].getInt(dflt)
  else:
    dflt

proc optBool(node: JsonNode, key: string, dflt = false): bool =
  if node.hasKey(key) and node[key].kind == JBool:
    node[key].getBool(dflt)
  else:
    dflt

proc strListArg(node: JsonNode, key: string): seq[string] =
  result = @[]
  if node.hasKey(key) and node[key].kind == JArray:
    for item in node[key]:
      result.add item.getStr("")

proc limited(text, what: string): string =
  ## Hard ceiling from AGENTS.md #3; the page must never receive one huge JSON
  ## blob through the bridge.
  if text.len <= 250_000:
    text
  else:
    errEnvelope("internal", what & "结果过大（>250 KB），请缩小范围")

proc requirePath(node: JsonNode): string =
  result = optStr(node, "path")
  if result.len == 0:
    result = optStr(node, "repoPath")

# --- error mapping ---------------------------------------------------------

proc gitError(kind: string, res: GitResult): string =
  ## docs/04 §7: map stderr to a stable kind and a Chinese message.
  if res.timedOut:
    return errEnvelope("timeout", "操作超时，已中止")
  let raw = if res.error.strip().len > 0: res.error.strip() else: res.output.strip()
  let low = raw.toLowerAscii
  var mapped = kind
  var message = raw
  var hint = ""
  if "not a git repository" in low:
    mapped = "notRepo"
    message = "这个目录不是 git 仓库"
  elif "index.lock" in low or "unable to create" in low or "lock file" in low:
    mapped = "busy"
    message = "另一个 git 进程正在操作，稍后重试"
  elif "authentication failed" in low or "terminal prompts disabled" in low or
      "permission denied (publickey)" in low:
    mapped = "auth"
    message = "凭据失效，请在终端执行一次 git fetch 重新登录"
  elif "conflict" in low or "unmerged" in low:
    mapped = "conflict"
    message = "存在冲突，先解决后再操作"
  elif "permission denied" in low or "eacces" in low:
    mapped = "internal"
    message = "没有权限访问该文件"
  elif raw.len == 0:
    message = "git 失败（退出码 " & $res.code & "）"
  if mapped == "git" and raw.len > 0:
    message = raw.splitLines()[^1]
    if message.len > 300:
      message = message[0 ..< 300]
    hint = "详情见 Console"
  if message.len == 0:
    message = "git 失败（退出码 " & $res.code & "）"
  errEnvelope(mapped, message, hint)

proc writeOk(res: GitResult, extra: JsonNode = nil): string =
  if res.code != 0:
    return gitError("git", res)
  if extra == nil:
    okEnvelope(%*{"ok": true})
  else:
    okEnvelope(extra)

# --- per-repo write serialisation (docs/03 §2) -----------------------------
# Striped static lock array: zero GC allocations across threads (--mm:refc safe).

const RepoLockStripes = 64
var repoLocks: array[RepoLockStripes, Lock]
for i in 0 ..< RepoLockStripes:
  initLock(repoLocks[i])

proc lockIndexForRepo(repoPath: string): int =
  let key = when defined(windows): normalizePath(repoPath).toLowerAscii()
            else: normalizePath(repoPath)
  var h: uint64 = 14695981039346656037'u64
  for ch in key:
    h = (h xor uint64(ord(ch))) * 1099511628211'u64
  int(h mod uint64(RepoLockStripes))

template withWrite(repoPath: string, body: untyped): untyped =
  block:
    let stripe = lockIndexForRepo(repoPath)
    acquire(repoLocks[stripe])
    try:
      body
    finally:
      release(repoLocks[stripe])

proc readRepo(path: string): string =
  if path.len == 0:
    return errEnvelope("internal", "缺少 path 参数")
  if not dirExists(path):
    return errEnvelope("notFound", "仓库路径不存在：" & path)
  if gitDirOf(path).len == 0:
    return errEnvelope("notRepo", "这个目录不是 git 仓库")
  ""

# --- Repo.scan -------------------------------------------------------------

proc scanWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let root = optStr(node, "root")
      if root.len == 0:
        return errEnvelope("internal", "缺少 root 参数")
      let globs = strListArg(node, "excludeGlobs")
      let depth = optInt(node, "scanDepth", 4)
      let started = getMonoTime()
      let prev = loadIndexFull(root)
      let res = scanIncremental(root, globs, depth, prev)
      saveIndex(root, res.repos, res.dirMtimes, res.dirSubdirs, globs, depth)
      var data = newJObject()
      data["repos"] = toJson(res.repos)
      data["scanned"] = %res.scanned
      data["skipped"] = %res.skipped
      data["reusedDirs"] = %res.reusedDirs
      data["ms"] = %((getMonoTime() - started).inMilliseconds)
      result = limited(okEnvelope(data), "仓库扫描")
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

# --- Repo.status (8-way concurrent pool) / changes -------------------------

type
  StatusSlot = object
    pathPtr: cstring
    pathLen: int
    jsonPtr: ptr UncheckedArray[char]
    jsonLen: int

  StatusPoolCtx = object
    lock: Lock
    nextIdx: int
    count: int
    cancelled: ptr bool
    slots: ptr UncheckedArray[StatusSlot]

proc statusPoolWorker(ctx: ptr StatusPoolCtx) {.thread.} =
  while true:
    if ctx.cancelled[]:
      return
    acquire(ctx.lock)
    let idx = ctx.nextIdx
    if idx >= ctx.count:
      release(ctx.lock)
      return
    ctx.nextIdx = idx + 1
    release(ctx.lock)

    let slot = addr ctx.slots[idx]
    var repoPath = newString(slot.pathLen)
    if slot.pathLen > 0:
      copyMem(addr repoPath[0], slot.pathPtr, slot.pathLen)
    {.cast(gcsafe).}:
      let stripe = lockIndexForRepo(repoPath)
      acquire(repoLocks[stripe])
      var repo: Repo
      try:
        repo = statusOf(repoPath)
      except CatchableError:
        repo = Repo(id: repoId(repoPath), name: repoPath.lastPathPart,
                    path: normalizePath(repoPath), ahead: -1, behind: -1,
                    lang: langOf(repoPath.lastPathPart))
      finally:
        release(repoLocks[stripe])
      let encoded = $toJson(repo)
      if encoded.len > 0:
        let buf = cast[ptr UncheckedArray[char]](allocShared(encoded.len))
        copyMem(buf, unsafeAddr encoded[0], encoded.len)
        slot.jsonPtr = buf
        slot.jsonLen = encoded.len

proc statusBatch*(paths: seq[string], cancelled: ptr bool = nil): seq[JsonNode] =
  ## Run `statusOf` across up to 8 worker threads (docs/01 §4, docs/03 §2).
  if paths.len == 0:
    return @[]
  if paths.len == 1:
    let stripe = lockIndexForRepo(paths[0])
    acquire(repoLocks[stripe])
    try:
      return @[toJson(statusOf(paths[0]))]
    finally:
      release(repoLocks[stripe])

  var localCancel = false
  let cancelPtr = if cancelled != nil: cancelled else: addr localCancel
  var slots = newSeq[StatusSlot](paths.len)
  for i in 0 ..< paths.len:
    slots[i].pathPtr = paths[i].cstring
    slots[i].pathLen = paths[i].len

  var ctx = StatusPoolCtx(
    nextIdx: 0,
    count: paths.len,
    cancelled: cancelPtr,
    slots: cast[ptr UncheckedArray[StatusSlot]](addr slots[0]),
  )
  initLock(ctx.lock)

  let workers = min(8, paths.len)
  var threads = newSeq[Thread[ptr StatusPoolCtx]](workers)
  for i in 0 ..< workers:
    createThread(threads[i], statusPoolWorker, addr ctx)
  for i in 0 ..< workers:
    joinThread(threads[i])
  deinitLock(ctx.lock)

  result = newSeqOfCap[JsonNode](paths.len)
  for i in 0 ..< slots.len:
    if slots[i].jsonPtr != nil and slots[i].jsonLen > 0:
      var s = newString(slots[i].jsonLen)
      copyMem(addr s[0], slots[i].jsonPtr, slots[i].jsonLen)
      deallocShared(slots[i].jsonPtr)
      try:
        result.add parseJson(s)
      except CatchableError:
        discard

proc statusWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let paths = strListArg(node, "paths")
      let started = getMonoTime()
      if context.isCancelled:
        return errEnvelope("timeout", "状态刷新已取消")
      var cancelFlag = false
      let nodes = statusBatch(paths, addr cancelFlag)
      if context.isCancelled:
        return errEnvelope("timeout", "状态刷新已取消")
      var outRepos = newJArray()
      var updated: seq[Repo]
      for rnode in nodes:
        outRepos.add rnode
        var r = Repo(
          id: rnode{"id"}.getStr(""),
          name: rnode{"name"}.getStr(""),
          path: rnode{"path"}.getStr(""),
          detached: rnode{"detached"}.getBool(false),
          head: rnode{"head"}.getStr(""),
          ahead: (if rnode.hasKey("ahead") and rnode["ahead"].kind == JInt: rnode["ahead"].getInt(-1) else: -1),
          behind: (if rnode.hasKey("behind") and rnode["behind"].kind == JInt: rnode["behind"].getInt(-1) else: -1),
          lastCommitAt: rnode{"lastCommitAt"}.getBiggestInt(0).int64,
          lang: rnode{"lang"}.getStr("—"),
        )
        if rnode.hasKey("branch") and rnode["branch"].kind == JString:
          r.branch = rnode["branch"].getStr("")
        if rnode.hasKey("dirty") and rnode["dirty"].kind == JObject:
          r.dirty = Dirty(
            staged: rnode["dirty"]{"staged"}.getInt(0),
            unstaged: rnode["dirty"]{"unstaged"}.getInt(0),
            untracked: rnode["dirty"]{"untracked"}.getInt(0),
            conflicted: rnode["dirty"]{"conflicted"}.getInt(0),
          )
        updated.add r
      updateIndexRepos(updated)
      var data = newJObject()
      data["repos"] = outRepos
      data["ms"] = %((getMonoTime() - started).inMilliseconds)
      result = limited(okEnvelope(data), "仓库状态")
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc cachedWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let root = optStr(node, "root")
      discard context.isCancelled
      result = okEnvelope(toJson(loadIndex(root)))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc changesWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      if context.isCancelled:
        return errEnvelope("timeout", "已取消")
      let started = getMonoTime()
      let entries = statusEntries(path)
      var data = newJObject()
      data["files"] = toJson(entries)
      data["ms"] = %((getMonoTime() - started).inMilliseconds)
      result = limited(okEnvelope(data), "文件列表")
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

# --- Log.list / files / refs ----------------------------------------------

proc logWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let limit = optInt(node, "limit", 200)
      let branch = optStr(node, "branch")
      let allBranches = optBool(node, "all")
      let filterPath = optStr(node, "filterPath")
      let cursor = optStr(node, "cursor")
      if context.isCancelled:
        return errEnvelope("timeout", "已取消")
      let started = getMonoTime()
      let page = logPage(path, limit, branch, allBranches, filterPath, cursor)
      var data = newJObject()
      data["commits"] = toJson(page.commits)
      data["hasMore"] = %page.hasMore
      if page.nextCursor.len > 0:
        data["nextCursor"] = %page.nextCursor
      data["ms"] = %((getMonoTime() - started).inMilliseconds)
      result = limited(okEnvelope(data), "提交列表")
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc filesWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let hash = optStr(node, "hash")
      if hash.len == 0:
        return errEnvelope("internal", "缺少 hash")
      if context.isCancelled:
        return errEnvelope("timeout", "已取消")
      let entries = commitFiles(path, hash)
      result = limited(okEnvelope(toJson(entries)), "提交文件列表")
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc refsWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      discard context.isCancelled
      var refs = newJArray()
      for (display, typ, target) in refsOf(path):
        refs.add %*{"name": display, "type": typ, "target": target}
      result = limited(okEnvelope(%*{"refs": refs}), "refs")
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

# --- diff + chunked blobs --------------------------------------------------

const
  InlineLimit = 240 * 1024
  ChunkSize = 180 * 1024

var tokenCounter: int

proc blobsDir(): string =
  dataDir() / "blobs"

proc newBlobToken(): string =
  inc tokenCounter
  let seed = $getTime().toUnix & ":" & $getMonoTime().ticks & ":" & $tokenCounter
  var hash = $secureHash(seed)
  "b" & hash[0 ..< 8].toLowerAscii()

proc cleanOldBlobs() =
  let dir = blobsDir()
  if not dirExists(dir):
    return
  let cutoff = getTime() - initDuration(minutes = 10)
  for kind, path in walkDir(dir):
    if kind == pcFile:
      try:
        if getLastModificationTime(path) < cutoff:
          removeFile(path)
      except CatchableError:
        discard

proc diffData(d: DiffFile): string =
  ## Inline small diffs; large ones live in blobs/<token>.json and are pulled
  ## by Diff.chunk (docs/03 §3.2). The preview keeps the first 200 rows.
  let fullNode = toJson(d)
  let text = $fullNode
  if text.len <= InlineLimit:
    return text
  createDir(blobsDir())
  cleanOldBlobs()
  let token = newBlobToken()
  writeFile(blobsDir() / (token & ".json"), text)
  let chunks = max(1, (text.len + ChunkSize - 1) div ChunkSize)
  var preview: seq[Hunk]
  var budget = 200
  for h in d.hunks:
    if budget <= 0:
      break
    var copy = h
    copy.rows = h.rows[0 ..< min(budget, h.rows.len)]
    preview.add copy
    budget -= copy.rows.len
  var trimmed = d
  trimmed.hunks = @[]
  trimmed.truncated = true
  trimmed.token = token
  trimmed.chunks = chunks
  trimmed.previewHunks = preview
  $toJson(trimmed)

proc diffWork(args: string, context: IpcCallContext): string =
  ## Shared by Diff.commit / Diff.workdir / Diff.context. A present `hash`
  ## selects the commit reader; otherwise it is the index/workdir reader.
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      if context.isCancelled:
        return errEnvelope("timeout", "已取消")
      let file = optStr(node, "file")
      if file.len == 0:
        return errEnvelope("internal", "缺少 file")
      let ignoreWs = optBool(node, "ignoreWhitespace")
      let contextLines = optInt(node, "contextLines", 3)
      let hash = optStr(node, "hash")
      var d: DiffFile
      if hash.len > 0:
        d = diffOfCommit(path, hash, file, ignoreWs, contextLines)
      else:
        d = diffOfWorkdir(path, file, optBool(node, "staged"),
                          optBool(node, "untracked"), ignoreWs, contextLines)
      if d.path.len == 0:
        d.path = file
      result = okEnvelope(%*{"diff": parseJson(diffData(d))})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc chunkWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let token = optStr(node, "token")
      let index = optInt(node, "index", 0)
      if token.len != 9 or token[0] != 'b' or
          not token.allCharsInSet({'a'..'z', '0'..'9'}):
        return errEnvelope("notFound", "无效的 diff token")
      let path = blobsDir() / (token & ".json")
      if not fileExists(path):
        return errEnvelope("notFound", "diff 分块已过期，请重新打开")
      discard context.isCancelled
      let text = readFile(path)
      let count = max(1, (text.len + ChunkSize - 1) div ChunkSize)
      if index < 0 or index >= count:
        return errEnvelope("notFound", "分块序号越界")
      let start = index * ChunkSize
      let stop = min(text.len, start + ChunkSize)
      var data = newJObject()
      data["index"] = %index
      data["count"] = %count
      data["chunk"] = %text[start ..< stop]
      result = okEnvelope(data)
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

# --- stage / commit --------------------------------------------------------

proc stageHunkWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let patch = optStr(node, "patch")
      if patch.len == 0:
        return errEnvelope("internal", "缺少 patch")
      discard context.isCancelled
      withWrite(path):
        result = writeOk(applyCachedPatch(path, patch,
                                          optBool(node, "reverse")))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc stageFilesWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let files = strListArg(node, "files")
      discard context.isCancelled
      withWrite(path):
        result = writeOk(stageFiles(path, files, optBool(node, "staged")))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc discardWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let files = strListArg(node, "files")
      discard context.isCancelled
      withWrite(path):
        result = writeOk(discardFiles(path, files))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc commitWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let message = optStr(node, "message")
      if message.strip().len == 0:
        return errEnvelope("internal", "提交信息不能为空")
      discard context.isCancelled
      var res: GitResult
      withWrite(path):
        res = commitStaged(path, message, optBool(node, "amend"))
      if res.code != 0:
        return gitError("git", res)
      var pushError = ""
      if optBool(node, "push"):
        var pushed: GitResult
        withWrite(path):
          pushed = pushCurrent(path)
        if pushed.code != 0:
          let raw = if pushed.error.strip().len > 0: pushed.error.strip()
                    else: pushed.output.strip()
          pushError = if raw.len > 0: raw.splitLines()[^1] else: "推送失败"
      let head = runGit(path, ["rev-parse", "HEAD"])
      let hash = if head.code == 0: head.output.strip() else: ""
      var output = res.output
      if output.len > 8000:
        output = output[0 ..< 8000] & "…"
      result = okEnvelope(%*{"hash": hash, "output": output,
                             "pushError": pushError})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc resetWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let rev = optStr(node, "rev", "HEAD")
      let mode = optStr(node, "mode", "mixed")
      discard context.isCancelled
      withWrite(path):
        result = writeOk(resetTo(path, rev, mode))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc pushForceWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let settings = loadSettings()
      discard context.isCancelled
      withWrite(path):
        result = writeOk(pushForceWithLease(path, settings.protectedBranches))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc cherryPickWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let hash = optStr(node, "hash")
      discard context.isCancelled
      withWrite(path):
        result = writeOk(cherryPick(path, hash))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc revertWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let hash = optStr(node, "hash")
      discard context.isCancelled
      withWrite(path):
        result = writeOk(revertCommit(path, hash))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc patchWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let hash = optStr(node, "hash")
      var outDir = optStr(node, "outDir")
      if outDir.len == 0:
        outDir = dataDir() / "patches"
      createDir(outDir)
      discard context.isCancelled
      var res: GitResult
      withWrite(path):
        res = createPatch(path, hash, outDir)
      if res.code != 0:
        return gitError("git", res)
      let produced = res.output.strip().splitLines()
      let file = if produced.len > 0: produced[^1] else: ""
      result = okEnvelope(%*{"ok": true, "file": file})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

# --- merge -----------------------------------------------------------------

proc mergeStateWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let file = optStr(node, "file")
      if file.len == 0:
        return errEnvelope("internal", "缺少 file")
      discard context.isCancelled
      result = limited(okEnvelope(toJson(mergeStateOf(path, file))), "合并文件")
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc mergeResolveWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let file = optStr(node, "file")
      let resolved = optStr(node, "resolved")
      discard context.isCancelled
      withWrite(path):
        result = writeOk(writeResolution(path, file, resolved))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

# --- shelf -----------------------------------------------------------------

proc shelfDir(repoPath: string): string =
  let gitDir = gitDirOf(repoPath)
  let base = if gitDir.len > 0: gitDir else: repoPath / ".git"
  base / "knit" / "shelf"

proc shelfListWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      discard context.isCancelled
      var items: seq[ShelfItem]
      let dir = shelfDir(path)
      if dirExists(dir):
        for kind, file in walkDir(dir):
          if kind != pcFile or not file.endsWith(".patch"):
            continue
          var files = 0
          var text = ""
          try:
            text = readFile(file)
          except CatchableError:
            discard
          for line in text.splitLines():
            if line.startsWith("diff --git "):
              inc files
          let mtime = getLastModificationTime(file)
          let stamp = mtime.toUnix * 1000
          items.add ShelfItem(
            id: file, kind: "patch", name: file.lastPathPart,
            subtitle: $files & " 个文件 · " & mtime.format("MM-dd HH:mm"),
            path: file, epochMs: stamp)
      let stashes = stashList(path)
      if stashes.code == 0:
        for line in stashes.output.splitLines():
          let parts = line.split('\x1f')
          if parts.len < 3:
            continue
          var stamp: int64 = 0
          try:
            stamp = parseInt(parts[2]).int64 * 1000
          except ValueError:
            stamp = 0
          items.add ShelfItem(id: parts[0], kind: "stash", name: parts[1],
                              subtitle: "stash · " & parts[0], path: "",
                              epochMs: stamp)
      items.sort(proc(a, b: ShelfItem): int = cmp(b.epochMs, a.epochMs))
      result = limited(okEnvelope(toJson(items)), "Shelf 列表")
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc shelfSaveWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      discard context.isCancelled
      let dir = shelfDir(path)
      createDir(dir)
      let file = dir / ($getTime().toUnix & "-" & $getMonoTime().ticks & ".patch")
      withWrite(path):
        result = writeOk(writeWorkdirPatch(path, file), %*{"file": file})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc shelfApplyWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let id = optStr(node, "id")
      discard context.isCancelled
      if id.startsWith("stash@{"):
        withWrite(path):
          result = writeOk(stashApply(path, id))
      else:
        let dir = normalizedPath(shelfDir(path))
        let target = normalizedPath(id)
        if normalizedPath(target.parentDir()) != dir:
          return errEnvelope("internal", "拒绝应用 shelf 之外的 patch")
        withWrite(path):
          result = writeOk(applyPatchFile(path, target))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc shelfDropWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let id = optStr(node, "id")
      discard context.isCancelled
      if id.startsWith("stash@{"):
        withWrite(path):
          result = writeOk(runGit(path, ["stash", "drop", id]))
      else:
        try:
          removeFile(id)
          result = okEnvelope(%*{"ok": true})
        except CatchableError as e:
          result = errEnvelope("internal", e.msg)
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc shelfImportWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let source = optStr(node, "source")
      if not fileExists(source):
        return errEnvelope("notFound", "patch 文件不存在")
      discard context.isCancelled
      let dir = shelfDir(path)
      createDir(dir)
      var name = source.lastPathPart
      if not (name.endsWith(".patch") or name.endsWith(".diff")):
        name.add ".patch"
      var target = dir / name
      var suffix = 1
      while fileExists(target):
        target = dir / (name & "." & $suffix)
        inc suffix
      copyFile(source, target)
      result = okEnvelope(%*{"file": target})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc shelfStatWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let id = optStr(node, "id")
      discard context.isCancelled
      let res = if id.startsWith("stash@{"):
                  runGit(path, ["stash", "show", "--stat", id])
                else:
                  runGit(path, ["apply", "--stat", id])
      var text = res.output & res.error
      if text.len > 20_000:
        text = text[0 ..< 20_000] & "…"
      result = okEnvelope(%*{"text": text})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

# --- daily branch & remote operations --------------------------------------

proc branchFetchWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0: return bad
      discard context.isCancelled
      withWrite(path):
        result = writeOk(fetchAll(path))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc branchPullWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0: return bad
      let rebase = optBool(node, "rebase")
      discard context.isCancelled
      var res: GitResult
      withWrite(path):
        res = pullCurrent(path, rebase)
      let conflicts = mergeConflicts(path)
      if res.code != 0 and conflicts.len > 0:
        return okEnvelope(%*{"ok": true, "conflict": true, "conflicts": strArr(conflicts)})
      result = writeOk(res, %*{"ok": true, "conflict": false, "output": res.output.strip()})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc branchCheckoutWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0: return bad
      let target = optStr(node, "target")
      discard context.isCancelled
      withWrite(path):
        result = writeOk(checkoutBranch(path, target))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc branchCreateWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0: return bad
      let name = optStr(node, "name")
      let startPoint = optStr(node, "startPoint", "HEAD")
      let checkout = optBool(node, "checkout", true)
      discard context.isCancelled
      withWrite(path):
        result = writeOk(createBranch(path, name, startPoint, checkout))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc branchDeleteWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0: return bad
      let name = optStr(node, "name")
      let force = optBool(node, "force")
      let settings = loadSettings()
      discard context.isCancelled
      withWrite(path):
        result = writeOk(deleteBranch(path, name, force, settings.protectedBranches))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc branchMergeWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0: return bad
      let branch = optStr(node, "branch")
      discard context.isCancelled
      var res: GitResult
      withWrite(path):
        res = mergeBranch(path, branch)
      let conflicts = mergeConflicts(path)
      if res.code != 0 and (conflicts.len > 0 or mergeInProgress(path)):
        return okEnvelope(%*{"ok": true, "conflict": true, "conflicts": strArr(conflicts)})
      result = writeOk(res, %*{"ok": true, "conflict": false, "output": res.output.strip()})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc branchMergeAbortWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0: return bad
      discard context.isCancelled
      withWrite(path):
        result = writeOk(mergeAbort(path))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

# --- interactive rebase (docs/07 M5.1) -------------------------------------

proc rebaseStateJson(st: RebaseStateInfo): JsonNode =
  %*{
    "inProgress": st.inProgress,
    "headName": st.headName,
    "msgNum": st.msgNum,
    "end": st.endNum,
    "onto": st.onto,
    "conflicts": strArr(st.conflicts),
  }

proc rebasePlanWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let onto = optStr(node, "onto")
      discard context.isCancelled
      let items = rebasePlan(path, onto)
      var arr = newJArray()
      for item in items:
        arr.add %*{
          "hash": item.hash,
          "shortHash": item.shortHash,
          "subject": item.subject,
          "author": item.author,
          "action": item.action,
        }
      result = limited(okEnvelope(%*{"commits": arr, "onto": onto}), "rebase 计划")
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc rebaseStateWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      discard context.isCancelled
      result = okEnvelope(rebaseStateJson(rebaseState(path)))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc rebaseStartWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let onto = optStr(node, "onto")
      var todo: seq[RebaseTodoItem]
      if node.hasKey("todo") and node["todo"].kind == JArray:
        for item in node["todo"]:
          todo.add RebaseTodoItem(
            action: item{"action"}.getStr("pick"),
            hash: item{"hash"}.getStr(""),
            shortHash: item{"shortHash"}.getStr(""),
            subject: item{"subject"}.getStr(""),
            author: item{"author"}.getStr(""),
            message: item{"message"}.getStr(""),
          )
      discard context.isCancelled
      var res: GitResult
      withWrite(path):
        res = rebaseStart(path, onto, todo)
      let st = rebaseState(path)
      if res.code != 0 and st.inProgress:
        return okEnvelope(%*{"ok": true, "conflict": true, "state": rebaseStateJson(st)})
      result = writeOk(res, %*{"ok": true, "conflict": false, "state": rebaseStateJson(st)})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc rebaseActionWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let op = optStr(node, "op")
      discard context.isCancelled
      var res: GitResult
      withWrite(path):
        case op
        of "continue": res = rebaseContinue(path)
        of "abort": res = rebaseAbort(path)
        of "skip": res = rebaseSkip(path)
        else: return errEnvelope("internal", "未知 rebase 操作：" & op)
      let st = rebaseState(path)
      if res.code != 0 and st.inProgress:
        return okEnvelope(%*{"ok": true, "conflict": true, "state": rebaseStateJson(st)})
      result = writeOk(res, %*{"ok": true, "conflict": false, "state": rebaseStateJson(st)})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

# --- misc host actions -----------------------------------------------------

proc openTempWork(args: string, context: IpcCallContext): string =
  ## `git show <hash>:<path>` → temp file; the page then calls Shell.openFile.
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let hash = optStr(node, "hash")
      let file = optStr(node, "file")
      if hash.len == 0 or file.len == 0:
        return errEnvelope("internal", "缺少 hash / file")
      discard context.isCancelled
      let res = showFileAt(path, hash, file)
      if res.code != 0:
        return gitError("git", res)
      let dir = getTempDir() / "knit-open"
      createDir(dir)
      let safeName = file.replace('/', '_').replace('\\', '_')
                       .replace(':', '_').replace('*', '_').replace('?', '_')
      let target = dir / (hash[0 ..< min(7, hash.len)] & "-" & safeName)
      writeFile(target, res.output)
      result = okEnvelope(%*{"path": target})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc agentConfigWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      discard args
      discard context.isCancelled
      let path = agent.ensureDefaultConfig()
      var data = agent.configJson()
      data["configPath"] = %path
      result = okEnvelope(data)
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc consoleWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      discard args
      discard context.isCancelled
      var arr = newJArray()
      for entry in consoleEntries():
        var detail = entry.detail
        if detail.len > 300:
          detail = detail[0 ..< 300]
        arr.add %*{"cmd": entry.cmd, "ms": entry.ms, "ok": entry.ok,
                   "detail": detail}
      result = limited(okEnvelope(%*{"commands": arr}), "Console")
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc readHandId(wtPath: string): string =
  let gd = gitDirOf(wtPath)
  if gd.len == 0:
    return ""
  let p = gd / "knit" / "hand.json"
  if not fileExists(p):
    return ""
  try:
    let node = parseFile(p)
    result = node{"handId"}.getStr("")
  except CatchableError:
    result = ""

proc newHandId(): string =
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz"
  inc tokenCounter
  let seed = $getTime().toUnix & ":" & $getMonoTime().ticks & ":" & $tokenCounter
  let h = $secureHash(seed)
  result = "h"
  for i in 0 ..< 6:
    let v = (ord(h[i * 2]) * 16 + ord(h[i * 2 + 1])) mod chars.len
    result.add chars[v]

proc worktreeListWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      discard context.isCancelled
      let res = listWorktrees(path)
      if res.code != 0:
        return gitError("git", res)
      var items = newJArray()
      var current: JsonNode
      var idx = 0
      for line in res.output.splitLines():
        if line.startsWith("worktree "):
          if current != nil:
            items.add current
          let wtPath = types.normalizePath(line["worktree ".len .. ^1])
          let hid = readHandId(wtPath)
          current = %*{"path": wtPath,
                       "branch": newJNull(), "head": "", "locked": false,
                       "handId": (if hid.len > 0: %hid else: newJNull()),
                       "isMain": (idx == 0)}
          inc idx
        elif current != nil and line.startsWith("HEAD "):
          current["head"] = %line["HEAD ".len .. ^1]
        elif current != nil and line.startsWith("branch "):
          var b = line["branch ".len .. ^1]
          if b.startsWith("refs/heads/"):
            b = b["refs/heads/".len .. ^1]
          current["branch"] = %b
        elif current != nil and line.startsWith("locked"):
          current["locked"] = %true
      if current != nil:
        items.add current
      result = okEnvelope(%*{"worktrees": items})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc worktreeAddWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let branch = optStr(node, "branch").strip()
      if branch.len == 0:
        return errEnvelope("internal", "分支名不能为空")
      let startPoint = optStr(node, "startPoint", "HEAD").strip()
      var dir = optStr(node, "dir").strip()
      let handId = newHandId()
      if dir.len == 0:
        # docs/05 §1: <root>/.knit/hands/<repo>-<handId>/
        let settings = loadSettings()
        let baseRoot = if settings.root.len > 0 and dirExists(settings.root):
                         settings.root
                       else:
                         path.parentDir
        let repoName = path.lastPathPart
        dir = types.normalizePath(baseRoot / ".knit" / "hands" / (repoName & "-" & handId))
      else:
        dir = types.normalizePath(dir)
      createDir(dir.parentDir)
      discard context.isCancelled
      var res: GitResult
      withWrite(path):
        res = addWorktree(path, dir, branch, if startPoint.len > 0: startPoint else: "HEAD")
      if res.code != 0:
        return gitError("git", res)
      let gd = gitDirOf(dir)
      if gd.len > 0:
        try:
          createDir(gd / "knit")
          writeJsonAtomic(gd / "knit" / "hand.json", %*{
            "handId": handId,
            "branch": branch,
            "createdAt": getTime().toUnix * 1000,
            "worktreePath": dir,
          })
        except CatchableError:
          discard
      result = okEnvelope(%*{"ok": true, "path": dir, "branch": branch, "handId": handId})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc worktreeRemoveWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let wtPath = optStr(node, "worktreePath").strip()
      if wtPath.len == 0:
        return errEnvelope("internal", "缺少 worktreePath")
      discard context.isCancelled
      withWrite(path):
        result = writeOk(removeWorktree(path, wtPath))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc worktreePruneWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      discard context.isCancelled
      withWrite(path):
        result = writeOk(pruneWorktrees(path))
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc blameWork(args: string, context: IpcCallContext): string =
  ## Docs/04 §3.5, docs/07 M5.3: segmented blame (<= 2000 lines per call, <= 240 KB).
  {.cast(gcsafe).}:
    try:
      let node = payload(args)
      let path = requirePath(node)
      let bad = readRepo(path)
      if bad.len > 0:
        return bad
      let file = optStr(node, "file")
      if file.len == 0:
        return errEnvelope("internal", "缺少 file")
      let hash = optStr(node, "hash")
      let minLine = max(1, optInt(node, "minLine", 1))
      let segLen = min(2000, max(100, optInt(node, "limit", 2000)))
      let maxLine = minLine + segLen - 1
      if context.isCancelled:
        return errEnvelope("timeout", "已取消")
      let started = getMonoTime()
      let allLines = blameOf(path, file, hash, minLine, maxLine + 1)
      var hasMore = false
      var lines = allLines
      if lines.len > segLen:
        hasMore = true
        lines.setLen(segLen)
      # Enforce 240 KB IPC cap even if lines are very long.
      var arr = newJArray()
      var bytes = 256
      for bl in lines:
        let item = toJson(bl)
        let s = $item
        if bytes + s.len > 235_000 and arr.len > 0:
          hasMore = true
          break
        arr.add item
        bytes += s.len + 1
      let lastLine = if arr.len > 0: arr[^1]{"line"}.getInt(minLine) else: minLine
      result = okEnvelope(%*{
        "lines": arr,
        "minLine": minLine,
        "nextLine": lastLine + 1,
        "hasMore": hasMore,
        "ms": (getMonoTime() - started).inMilliseconds,
      })
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

# --- registration ----------------------------------------------------------

proc registerKnitServices*() =
  bindBackgroundService("Repo", [
    backgroundMethod("scan", scanWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 60_000),
    backgroundMethod("status", statusWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 30_000),
    backgroundMethod("cached", cachedWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 5_000),
    backgroundMethod("changes", changesWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 30_000),
    backgroundMethod("reset", resetWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
  ])
  bindBackgroundService("Log", [
    backgroundMethod("list", logWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
    backgroundMethod("files", filesWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
    backgroundMethod("refs", refsWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 10_000),
  ])
  bindBackgroundService("Diff", [
    backgroundMethod("commit", diffWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
    backgroundMethod("workdir", diffWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
    backgroundMethod("context", diffWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
    backgroundMethod("chunk", chunkWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
  ])
  bindBackgroundService("Stage", [
    backgroundMethod("hunk", stageHunkWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
    backgroundMethod("files", stageFilesWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
    backgroundMethod("discard", discardWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
  ])
  bindBackgroundService("Commit", [
    backgroundMethod("create", commitWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
    backgroundMethod("cherryPick", cherryPickWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
    backgroundMethod("revert", revertWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
    backgroundMethod("patch", patchWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 30_000),
    backgroundMethod("pushForce", pushForceWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 300_000),
  ])
  bindBackgroundService("Merge", [
    backgroundMethod("state", mergeStateWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
    backgroundMethod("resolve", mergeResolveWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
  ])
  bindBackgroundService("Shelf", [
    backgroundMethod("list", shelfListWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
    backgroundMethod("save", shelfSaveWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 30_000),
    backgroundMethod("apply", shelfApplyWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
    backgroundMethod("drop", shelfDropWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
    backgroundMethod("import", shelfImportWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
    backgroundMethod("stat", shelfStatWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
  ])
  bindBackgroundService("Git", [
    backgroundMethod("console", consoleWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 5_000),
  ])
  bindBackgroundService("Agent", [
    backgroundMethod("config", agentConfigWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 5_000),
    backgroundMethod("start", agent.startWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 0),
    backgroundMethod("write", agent.writeWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 5_000),
    backgroundMethod("stop", agent.stopWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 5_000),
    backgroundMethod("restore", agent.restoreWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 60_000),
  ])
  bindBackgroundService("External", [
    backgroundMethod("openTemp", openTempWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
  ])
  bindBackgroundService("Worktree", [
    backgroundMethod("list", worktreeListWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 10_000),
    backgroundMethod("add", worktreeAddWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
    backgroundMethod("remove", worktreeRemoveWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
    backgroundMethod("prune", worktreePruneWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 30_000),
  ])
  bindBackgroundService("Blame", [
    backgroundMethod("file", blameWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 30_000),
  ])
  bindBackgroundService("Branch", [
    backgroundMethod("fetch", branchFetchWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 300_000),
    backgroundMethod("pull", branchPullWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 300_000),
    backgroundMethod("checkout", branchCheckoutWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
    backgroundMethod("create", branchCreateWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
    backgroundMethod("delete", branchDeleteWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 60_000),
    backgroundMethod("merge", branchMergeWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
    backgroundMethod("mergeAbort", branchMergeAbortWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
  ])
  bindBackgroundService("Rebase", [
    backgroundMethod("plan", rebasePlanWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 20_000),
    backgroundMethod("state", rebaseStateWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 10_000),
    backgroundMethod("start", rebaseStartWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
    backgroundMethod("action", rebaseActionWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 120_000),
  ])

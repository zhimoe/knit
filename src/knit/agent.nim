## Agent / terminal sessions (docs/05).
##
## Design constraint: nimi's only streaming channel is `window.eval`. A session
## therefore runs inside one background worker, reads stdout line by line and
## pushes `agent:output` events. `Agent.write`/`Agent.stop` reach the same
## process through a small locked registry.
##
## The prompt is assembled and written to `.git/knit/session/<id>/prompt.md`
## by the host, exactly as docs/05 §3 describes. Skills are inlined (bounded)
## so agents without file tools still receive them.

import std/[json, locks, os, osproc, streams, strutils, strtabs, tables, times]

import nimi

import ./[events, gitops, store, types]

type
  AgentEntry = object
    id*: string
    label*: string
    command*: string
    promptArg*: seq[string]
    stdinFirstLine*: string
    env*: seq[(string, string)]
    cwd*: string

  SkillEntry = object
    id*: string
    label*: string
    path*: string

  AgentsConfig = object
    defaultAgent: string
    concurrency: int
    agents: seq[AgentEntry]
    skills: seq[SkillEntry]
    modes: Table[string, seq[string]]

  LiveSession = object
    process: Process
    stopped: bool

const DefaultAgentsJson = """
{
  "schemaVersion": 1,
  "defaultAgent": "pi",
  "concurrency": 2,
  "agents": [
    {
      "id": "pi",
      "label": "Pi",
      "command": "pi",
      "promptArg": ["-p", "@{promptFile}", "--no-session"],
      "env": {},
      "cwd": "{repo}"
    },
    {
      "id": "codex",
      "label": "Codex",
      "command": "codex",
      "promptArg": ["exec", "--skip-git-repo-check", "-"],
      "stdinFirstLine": null,
      "env": {},
      "cwd": "{repo}"
    }
  ],
  "skills": [
    { "id": "understanding-anything", "label": "读代码", "path": "~/skills/understanding-anything/SKILL.md" },
    { "id": "commit-msg", "label": "提交信息", "path": "~/skills/commit-msg/SKILL.md" },
    { "id": "repo-map", "label": "仓库地图", "path": "~/skills/repo-map/SKILL.md" },
    { "id": "changelog", "label": "变更日志", "path": "~/skills/changelog/SKILL.md" }
  ],
  "modes": {
    "read": ["understanding-anything"],
    "commit": ["commit-msg"],
    "review": ["understanding-anything", "repo-map"]
  }
}
"""

var
  sessionLock: Lock
  liveSessions: Table[string, LiveSession]
  cancelledQueued: Table[string, bool]
  activeAgentCount = 0
  queuedOrder: seq[string]

initLock(sessionLock)

proc configPath(): string = dataDir() / "agents.json"

proc readConfig*(): AgentsConfig =
  let path = configPath()
  var node: JsonNode
  try:
    node = if fileExists(path): parseFile(path) else: parseJson(DefaultAgentsJson)
  except CatchableError:
    node = parseJson(DefaultAgentsJson)
  result.concurrency = 2
  result.defaultAgent = "pi"
  if node.hasKey("defaultAgent"):
    result.defaultAgent = node["defaultAgent"].getStr("pi")
  if node.hasKey("concurrency"):
    result.concurrency = node["concurrency"].getInt(2)
  if node.hasKey("agents"):
    for a in node["agents"]:
      var entry = AgentEntry(
        id: a{"id"}.getStr(""), label: a{"label"}.getStr(""),
        command: a{"command"}.getStr(""), stdinFirstLine: "",
        cwd: a{"cwd"}.getStr("{repo}"))
      if a.hasKey("promptArg"):
        for arg in a["promptArg"]:
          entry.promptArg.add arg.getStr("")
      if a.hasKey("stdinFirstLine") and a["stdinFirstLine"].kind == JString:
        entry.stdinFirstLine = a["stdinFirstLine"].getStr("")
      if a.hasKey("env"):
        for key, value in a["env"].pairs:
          entry.env.add (key, value.getStr(""))
      if entry.id.len > 0:
        result.agents.add entry
  if node.hasKey("skills"):
    for s in node["skills"]:
      result.skills.add SkillEntry(id: s{"id"}.getStr(""),
        label: s{"label"}.getStr(""), path: s{"path"}.getStr(""))
  if node.hasKey("modes") and node["modes"].kind == JObject:
    for mode, skills in node["modes"].pairs:
      var list: seq[string]
      for s in skills:
        list.add s.getStr("")
      result.modes[mode] = list

proc agentJson(entry: AgentEntry): JsonNode =
  %*{"id": entry.id, "label": entry.label, "command": entry.command}

proc skillsJson(config: AgentsConfig): JsonNode =
  result = newJArray()
  for skill in config.skills:
    result.add %*{"id": skill.id, "label": skill.label, "path": skill.path}

proc configJson*(): JsonNode =
  let config = readConfig()
  var agents = newJArray()
  for entry in config.agents:
    agents.add agentJson(entry)
  result = %*{
    "defaultAgent": config.defaultAgent,
    "concurrency": config.concurrency,
    "skills": skillsJson(config),
    "modes": newJObject(),
    "agents": agents
  }
  for mode, list in config.modes:
    var arr = newJArray()
    for s in list:
      arr.add %s
    result["modes"][mode] = arr

proc ensureDefaultConfig*(): string =
  ## First run gets a working pi/codex config on disk (docs/05 §2).
  let dir = dataDir()
  createDir(dir)
  let path = configPath()
  if not fileExists(path):
    try:
      writeFile(path, DefaultAgentsJson)
    except CatchableError:
      discard
  path

# --- prompt ---------------------------------------------------------------

proc expandPath(path: string): string =
  if path.startsWith("~/"):
    getHomeDir() / path[2 .. ^1]
  else:
    path

proc readLimited(path: string, limit = 32_000): string =
  try:
    let text = readFile(path)
    if text.len > limit:
      text[0 ..< limit] & "\n…（skill 已截断）"
    else:
      text
  except CatchableError:
    ""

proc runCapture(repoPath: string, args: openArray[string]): string =
  let res = runGit(repoPath, args, timeoutMs = 30_000)
  if res.code == 0: res.output else: ""

proc buildPrompt(config: AgentsConfig, repoPath, sessionId, mode, rev: string,
                 selectedSkills: seq[string]): tuple[prompt, dir, patch: string] =
  let gitDir = gitDirOf(repoPath)
  let base = if gitDir.len > 0: gitDir else: repoPath / ".git"
  let dir = base / "knit" / "session" / sessionId
  createDir(dir)
  let branchRes = runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])
  let branch = if branchRes.code == 0: branchRes.output.strip() else: "HEAD"
  var stagedPatch = ""
  var commitPatch = ""
  var patch = ""
  if mode == "commit":
    stagedPatch = runCapture(repoPath, ["diff", "--cached", "--binary"])
    writeFile(dir / "staged.patch", stagedPatch)
    patch = dir / "staged.patch"
  elif rev.len > 0:
    commitPatch = runCapture(repoPath, ["diff-tree", "-p", "--root",
      "--no-commit-id", "-r", "--first-parent", rev])
    writeFile(dir / "commit.patch", commitPatch)
    patch = dir / "commit.patch"
  let style = runCapture(repoPath, ["log", "-n", "10", "--format=%s"])
  writeFile(dir / "style.txt", style)

  var role: string
  case mode
  of "commit":
    role = "你在写提交信息。读 staged.patch 与最近 10 条提交信息（style.txt），" &
           "输出 <type>(<scope>): <subject> + 空行 + 2–4 行 body。只输出提交信息，不要解释。"
  of "review":
    role = "你在做提交前审查。找出行为变更、潜在 bug、缺失测试；按严重度排序，" &
           "最多 5 条；不要提风格偏好。引用用 path:line。"
  else:
    role = "你在帮我读代码。先读 README/架构文档确认模块边界，再按调用链读实现；" &
           "结论用 3–6 条要点，每条带 path:line。"

  var skillSection = ""
  var index = 0
  for skill in config.skills:
    if skill.id notin selectedSkills:
      continue
    inc index
    let path = expandPath(skill.path)
    let body = readLimited(path)
    skillSection.add "\n### " & skill.id & "\n路径：" & path & "\n"
    if body.len > 0:
      skillSection.add "```\n" & body & "\n```\n"
  if index == 0:
    skillSection = "（未选择 skill）\n"

  var input = ""
  if mode == "commit":
    input = "见 git diff --cached（已由宿主导出到 " & (dir / "staged.patch") & "）"
  elif mode == "review":
    input = "待审查补丁：" & (if rev.len > 0: rev else: "工作区") &
            "（" & (dir / "commit.patch") & "）"
  else:
    input = if rev.len > 0:
              "目标提交：" & rev & "（补丁在 " & (dir / "commit.patch") & "）"
            else:
              "目标：仓库 " & repoPath & "（当前分支）"

  let prompt = """<!-- knit session -->
repo: """ & repoPath & """
branch: """ & branch & """
mode: """ & mode & """
rev: """ & (if rev.len > 0: rev else: "—") & """
generated: """ & $now().utc & """

## 你的角色
""" & role & """

## Skills（按顺序逐个读取并遵守）
""" & skillSection & """
## 约束
- 只读模式：不要修改任何文件；不要执行 git 写命令。
- 提交模式：只输出一条符合 Conventional Commits 的提交信息，不要输出解释。
- 不要输出 diff 全文；引用请用 `path:line`。
- 若信息不足，先问一个最小的问题，不要猜。

## 本次任务的输入
""" & input & "\n"
  writeFile(dir / "prompt.md", prompt)
  writeFile(dir / "meta.json", $ %*{
    "sessionId": sessionId, "mode": mode, "rev": rev,
    "repo": repoPath, "skills": selectedSkills})
  (prompt, dir, patch)

# --- session runner -------------------------------------------------------

proc sessionEnv(entry: AgentEntry, repoPath: string): StringTableRef =
  result = newStringTable(modeCaseSensitive)
  for pair in envPairs():
    if pair.key.toUpperAscii() in ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX"]:
      continue
    result[pair.key] = pair.value
  result["GIT_OPTIONAL_LOCKS"] = "0"
  result["GIT_TERMINAL_PROMPT"] = "1"
  result["KNIT_REPO"] = repoPath
  result["KNIT_ROOT"] = loadSettings().root
  for (key, value) in entry.env:
    result[key] = value

proc substitute(arg, promptFile, repoPath, hand: string): string =
  result = arg
  result = result.replace("{promptFile}", promptFile)
  result = result.replace("{repo}", repoPath)
  result = result.replace("{hand}", hand)

proc cleanOldSessions*(repoPath: string, maxAgeDays = 7) =
  ## Docs/05 §7: prune session directories older than 7 days.
  let gitDir = gitDirOf(repoPath)
  if gitDir.len == 0:
    return
  let dir = gitDir / "knit" / "session"
  if not dirExists(dir):
    return
  let cutoff = getTime() - initDuration(days = maxAgeDays)
  for kind, path in walkDir(dir):
    if kind == pcDir:
      try:
        if getLastModificationTime(path) < cutoff:
          removeDir(path)
      except CatchableError:
        discard

proc stopAll*(): int =
  ## Window close: every agent/terminal process must go with it.
  var ids: seq[string]
  acquire(sessionLock)
  for id in queuedOrder:
    cancelledQueued[id] = true
  for id in liveSessions.keys:
    ids.add id
  for id in ids:
    var entry = liveSessions[id]
    entry.stopped = true
    liveSessions[id] = entry
  release(sessionLock)
  for id in ids:
    acquire(sessionLock)
    let process = if liveSessions.hasKey(id): liveSessions[id].process else: nil
    release(sessionLock)
    if process != nil:
      try:
        process.inputStream.close()
      except CatchableError:
        discard
      killProcessTree(process, graceMs = 1500)
    result += 1

proc stopSession*(sessionId: string): bool =
  acquire(sessionLock)
  if sessionId in queuedOrder:
    cancelledQueued[sessionId] = true
  var entry: LiveSession
  var found = false
  if liveSessions.hasKey(sessionId):
    entry = liveSessions[sessionId]
    entry.stopped = true
    liveSessions[sessionId] = entry
    found = true
  release(sessionLock)
  if not found:
    return false
  try:
    entry.process.inputStream.close()
  except CatchableError:
    discard
  killProcessTree(entry.process, graceMs = 1500)
  result = true

proc waitConcurrencySlot(sessionId: string, limit: int): bool =
  ## Block until activeAgentCount < limit or this session is cancelled (docs/05 §4).
  let maxActive = max(1, limit)
  var emittedQueued = false
  acquire(sessionLock)
  queuedOrder.add sessionId
  release(sessionLock)
  defer:
    acquire(sessionLock)
    let pos = queuedOrder.find(sessionId)
    if pos >= 0:
      queuedOrder.delete(pos)
    cancelledQueued.del(sessionId)
    release(sessionLock)
  while true:
    acquire(sessionLock)
    if cancelledQueued.getOrDefault(sessionId, false):
      release(sessionLock)
      return false
    let myPos = queuedOrder.find(sessionId)
    if activeAgentCount < maxActive and myPos == 0:
      inc activeAgentCount
      release(sessionLock)
      return true
    release(sessionLock)
    if not emittedQueued:
      emittedQueued = true
      emitEvent("agent:queued", %*{"sessionId": sessionId, "position": max(1, myPos)})
    sleep(80)

proc releaseConcurrencySlot() =
  acquire(sessionLock)
  if activeAgentCount > 0:
    dec activeAgentCount
  release(sessionLock)

proc restoreAfterReadOnly*(repoPath, snapshotSha: string,
                           preUntracked: seq[string]): GitResult =
  ## Docs/05 §7 / M4.8: restore worktree to pre-session state after a read-only
  ## agent accidentally modified or created files.
  result = runGit(repoPath, ["checkout", "--", "."], timeoutMs = 60_000, retryLock = true)
  if snapshotSha.len > 0:
    discard runGit(repoPath, ["stash", "apply", snapshotSha], timeoutMs = 60_000)
  # Remove only untracked files that were NOT present before the session started.
  let nowUntracked = runGit(repoPath, ["ls-files", "--others", "--exclude-standard", "-z"])
  if nowUntracked.code == 0:
    for p in nowUntracked.output.split('\0'):
      if p.len == 0 or p in preUntracked:
        continue
      let full = normalizedPath(repoPath / p)
      let root = normalizedPath(repoPath)
      if full.startsWith(root & $DirSep) and fileExists(full):
        try:
          removeFile(full)
        except CatchableError:
          discard

proc writeSession*(sessionId, chunk: string): bool =
  acquire(sessionLock)
  var entry: LiveSession
  var found = false
  if liveSessions.hasKey(sessionId):
    entry = liveSessions[sessionId]
    found = not entry.stopped
  release(sessionLock)
  if not found:
    return false
  try:
    let input = entry.process.inputStream
    input.write(chunk)
    if not chunk.endsWith("\n"):
      input.write("\n")
    input.flush()
    result = true
  except CatchableError:
    result = false

proc startSession*(repoPath, sessionId, mode, rev: string,
                   selectedSkills: seq[string], agentId: string,
                   cols, rows: int): JsonNode =
  ## Runs to completion (the page does not await it); output is pushed through
  ## `agent:output` events and a final `agent:exit`.
  let config = readConfig()
  var entry: AgentEntry
  var found = false
  if mode == "term":
    let shell = when defined(windows): getEnv("COMSPEC", "cmd.exe")
                else: getEnv("SHELL", "/bin/sh")
    entry = AgentEntry(id: "term", label: "终端", command: shell,
                       promptArg: @[], cwd: "{repo}")
    found = true
  else:
    for candidate in config.agents:
      if candidate.id == agentId:
        entry = candidate
        found = true
        break
    if not found and config.agents.len > 0:
      entry = config.agents[0]
      found = true
  if not found:
    emitEvent("agent:exit", %*{"sessionId": sessionId, "code": -1,
      "error": "没有可用的 agent 配置，见 " & configPath()})
    return %*{"code": -1, "error": "没有可用的 agent 配置"}
  if mode != "term":
    discard ensureDefaultConfig()
    cleanOldSessions(repoPath)
    if not waitConcurrencySlot(sessionId, config.concurrency):
      emitEvent("agent:exit", %*{"sessionId": sessionId, "code": -1,
        "error": "排队中的会话已取消", "mode": mode})
      return %*{"code": -1, "error": "已取消"}
  defer:
    if mode != "term":
      releaseConcurrencySlot()

  var preSnapshot = ""
  var preUntracked: seq[string]
  if mode in ["read", "review"]:
    preSnapshot = createStashSnapshot(repoPath, "knit:before-agent-" & sessionId)
    let u = runGit(repoPath, ["ls-files", "--others", "--exclude-standard", "-z"])
    if u.code == 0:
      for p in u.output.split('\0'):
        if p.len > 0:
          preUntracked.add p

  var promptFile = ""
  var dir = ""
  if mode != "term":
    let built = buildPrompt(config, repoPath, sessionId, mode, rev, selectedSkills)
    promptFile = built.dir / "prompt.md"
    dir = built.dir

  var args: seq[string]
  var stdinPrompt = ""
  if mode == "term":
    args = @[]
  else:
    var usesPromptFile = false
    for arg in entry.promptArg:
      let resolved = substitute(arg, promptFile, repoPath, repoPath)
      if promptFile in resolved:
        usesPromptFile = true
      args.add resolved
    if args.len == 0 or not usesPromptFile:
      if entry.stdinFirstLine.len > 0:
        stdinPrompt = entry.stdinFirstLine.replace("{promptFile}", promptFile)
                         .replace("{repo}", repoPath) & "\n"
      else:
        try:
          stdinPrompt = readFile(promptFile)
        except CatchableError:
          stdinPrompt = ""

  var process: Process
  try:
    const procOpts = when defined(windows): {poUsePath, poStdErrToStdOut, poDaemon}
                     else: {poUsePath, poStdErrToStdOut}
    process = startProcess(entry.command, args = args, workingDir = repoPath,
                           env = sessionEnv(entry, repoPath),
                           options = procOpts)
  except OSError as e:
    emitEvent("agent:exit", %*{"sessionId": sessionId, "code": -1,
      "error": e.msg})
    return %*{"code": -1, "error": e.msg}

  acquire(sessionLock)
  liveSessions[sessionId] = LiveSession(process: process)
  release(sessionLock)

  emitEvent("agent:started", %*{"sessionId": sessionId, "agent": entry.id,
    "dir": dir, "command": entry.command, "args": args})

  try:
    if stdinPrompt.len > 0:
      let input = process.inputStream
      input.write(stdinPrompt)
      input.flush()
      if mode != "term":
        input.close()
  except CatchableError:
    discard

  var collected = ""
  var pending = ""
  var lastFlush = epochTime()
  proc flush() =
    if pending.len > 0:
      emitEvent("agent:output", %*{"sessionId": sessionId, "chunk": pending,
                                   "stream": "out"})
      pending = ""
      lastFlush = epochTime()

  try:
    let output = process.outputStream
    var line = ""
    while output.readLine(line):
      collected.add line
      collected.add '\n'
      if collected.len > 64_000:
        collected.setLen(64_000)
      pending.add line
      pending.add '\n'
      if epochTime() - lastFlush >= 0.1 or pending.len > 8192:
        flush()
  except CatchableError:
    discard
  flush()

  var code = -1
  try:
    code = process.waitForExit()
  except CatchableError:
    discard
  try:
    process.close()
  except CatchableError:
    discard

  acquire(sessionLock)
  liveSessions.del(sessionId)
  release(sessionLock)

  emitEvent("agent:exit", %*{"sessionId": sessionId, "code": code,
                             "output": collected,
                             "mode": mode, "dir": dir,
                             "snapshotSha": preSnapshot,
                             "preUntracked": strArr(preUntracked)})
  result = %*{"code": code, "output": collected}

# --- session management (Agent.*) ----------------------------------------

proc startWork*(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = parseJson(args)
      let inner = if node.kind == JArray and node.len > 0: node[0] else: node
      var obj = inner
      if obj.kind == JString:
        obj = parseJson(obj.getStr())
      proc s(key: string, dflt = ""): string =
        if obj.hasKey(key) and obj[key].kind == JString: obj[key].getStr()
        else: dflt
      let repoPath = s("path")
      let sessionId = s("sessionId")
      if repoPath.len == 0 or sessionId.len == 0:
        return errEnvelope("internal", "缺少 path / sessionId")
      if not sessionId.allCharsInSet({'a'..'z', 'A'..'Z', '0'..'9', '-', '_'}):
        return errEnvelope("internal", "非法 sessionId")
      if not dirExists(repoPath):
        return errEnvelope("notFound", "仓库不存在")
      var skills: seq[string]
      if obj.hasKey("skills") and obj["skills"].kind == JArray:
        for item in obj["skills"]:
          skills.add item.getStr("")
      let mode = s("mode", "read")
      let rev = s("rev")
      let agentId = s("agent")
      discard context.isCancelled
      let sessionResult = startSession(repoPath, sessionId, mode, rev, skills,
                                       agentId, obj{"cols"}.getInt(80),
                                       obj{"rows"}.getInt(24))
      result = okEnvelope(%*{"sessionId": sessionId,
        "code": sessionResult{"code"}.getInt(-1)})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc writeWork*(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = parseJson(args)
      let inner = if node.kind == JArray and node.len > 0: node[0] else: node
      var obj = inner
      if obj.kind == JString:
        obj = parseJson(obj.getStr())
      let sessionId = obj{"sessionId"}.getStr("")
      let chunk = obj{"chunk"}.getStr("")
      if sessionId.len == 0:
        return errEnvelope("internal", "缺少 sessionId")
      discard context.isCancelled
      if writeSession(sessionId, chunk):
        result = okEnvelope(%*{"ok": true})
      else:
        result = errEnvelope("notFound", "agent 会话未运行")
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc stopWork*(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = parseJson(args)
      let inner = if node.kind == JArray and node.len > 0: node[0] else: node
      var obj = inner
      if obj.kind == JString:
        obj = parseJson(obj.getStr())
      let sessionId = obj{"sessionId"}.getStr("")
      discard context.isCancelled
      discard stopSession(sessionId)
      result = okEnvelope(%*{"ok": true})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

proc restoreWork*(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    try:
      let node = parseJson(args)
      let inner = if node.kind == JArray and node.len > 0: node[0] else: node
      var obj = inner
      if obj.kind == JString:
        obj = parseJson(obj.getStr())
      let repoPath = obj{"path"}.getStr("")
      let snapshotSha = obj{"snapshotSha"}.getStr("")
      var preUntracked: seq[string]
      if obj.hasKey("preUntracked") and obj["preUntracked"].kind == JArray:
        for item in obj["preUntracked"]:
          preUntracked.add item.getStr("")
      if repoPath.len == 0 or not dirExists(repoPath):
        return errEnvelope("notFound", "仓库不存在")
      discard context.isCancelled
      let res = restoreAfterReadOnly(repoPath, snapshotSha, preUntracked)
      if res.code != 0:
        return errEnvelope("git", res.error)
      result = okEnvelope(%*{"ok": true})
    except CatchableError as e:
      result = errEnvelope("internal", e.msg)

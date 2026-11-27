## Settings / state persistence (docs/06 §4, §5).
##
## Every write goes through a temp file + rename so a kill during save cannot
## truncate the user's config.

import std/[json, locks, monotimes, os, tables, times]

import ./types

type
  Settings* = object
    schemaVersion*: int
    root*: string
    scanDepth*: int
    excludeGlobs*: seq[string]
    excludeRepos*: seq[string]
    selectedRepoId*: string
    diffMode*: string
    commitDraftInHost*: bool
    logLevel*: string
    editorCommand*: string
    editorArgs*: seq[string]
    terminalShell*: string
    terminalArgs*: seq[string]
    protectedBranches*: seq[string]
    confirmDangerous*: bool

  UiState* = object
    windowWidth*: int
    windowHeight*: int
    drawerHeight*: int

  IndexCache* = object
    root*: string
    scanDepth*: int
    excludeGlobs*: seq[string]
    dirMtimes*: Table[string, int64]
    dirSubdirs*: Table[string, seq[string]]
    repos*: seq[Repo]

const DefaultGlobs = @["node_modules", "target", ".venv", "vendor", "dist", "build"]

proc canWriteDir(dir: string): bool =
  try:
    createDir(dir)
    let probe = dir / ".knit-write-test"
    writeFile(probe, "1")
    removeFile(probe)
    true
  except CatchableError:
    false

proc dataDir*(): string =
  let override = getEnv("KNIT_DATA_DIR")
  if override.len > 0:
    return override            # tests / explicit override
  let appDir = getAppDir()
  if fileExists(appDir / "knit.portable") or dirExists(appDir / "data"):
    let portableDir = appDir / "data"
    if canWriteDir(portableDir):
      return portableDir       # portable mode: keep all state beside knit.exe
  when defined(windows):
    let base = getEnv("APPDATA", getHomeDir() / "AppData" / "Roaming")
    result = base / "knit"
  else:
    result = getConfigDir() / "knit"

proc ensureDataDir*(): string =
  result = dataDir()
  createDir(result)

proc defaultRoot*(): string =
  let code = getHomeDir() / "code"
  if dirExists(code): code else: getHomeDir()

proc defaultSettings*(): Settings =
  Settings(schemaVersion: 1,
           root: normalizePath(defaultRoot()),
           scanDepth: 4,
           excludeGlobs: DefaultGlobs,
           excludeRepos: @[],
           selectedRepoId: "",
           diffMode: "split",
           commitDraftInHost: false,
           logLevel: "info",
           editorCommand: "",
           editorArgs: @["-g", "{file}:{line}"],
           terminalShell: "",
           terminalArgs: @[],
           protectedBranches: @["main", "master"],
           confirmDangerous: true)

proc readJson(path: string): JsonNode =
  if not fileExists(path):
    return nil
  try:
    result = parseFile(path)
  except CatchableError:
    result = nil

proc writeJsonAtomic*(path: string, node: JsonNode) =
  createDir(path.parentDir)
  let tmp = path & "." & $getMonoTime().ticks & ".tmp"
  writeFile(tmp, pretty(node, indent = 2))
  for attempt in 0 .. 2:
    try:
      moveFile(tmp, path)
      return
    except OSError:
      if attempt == 2:
        try: removeFile(tmp) except CatchableError: discard
        raise
      sleep(30 * (attempt + 1))

proc strList(node: JsonNode, key: string): seq[string] =
  result = @[]
  if node != nil and node.kind == JObject and node.hasKey(key) and
      node[key].kind == JArray:
    for item in node[key]:
      result.add item.getStr("")

proc loadSettings*(): Settings =
  result = defaultSettings()
  let node = readJson(dataDir() / "settings.json")
  if node == nil or node.kind != JObject:
    return
  if node.hasKey("schemaVersion"):
    result.schemaVersion = node["schemaVersion"].getInt(1)
  if node.hasKey("root"):
    result.root = normalizePath(node["root"].getStr(result.root))
  if node.hasKey("scanDepth"):
    result.scanDepth = node["scanDepth"].getInt(4)
  let globs = strList(node, "excludeGlobs")
  if globs.len > 0:
    result.excludeGlobs = globs
  result.excludeRepos = strList(node, "excludeRepos")
  if node.hasKey("selectedRepoId"):
    result.selectedRepoId = node["selectedRepoId"].getStr("")
  if node.hasKey("diffMode"):
    result.diffMode = node["diffMode"].getStr("split")
  if node.hasKey("commitDraftInHost"):
    result.commitDraftInHost = node["commitDraftInHost"].getBool(false)
  if node.hasKey("logLevel"):
    result.logLevel = node["logLevel"].getStr("info")
  if node.hasKey("editor") and node["editor"].kind == JObject:
    result.editorCommand = node["editor"]{"command"}.getStr("")
    let args = strList(node["editor"], "args")
    if args.len > 0:
      result.editorArgs = args
  if node.hasKey("terminal") and node["terminal"].kind == JObject:
    result.terminalShell = node["terminal"]{"shell"}.getStr("")
    result.terminalArgs = strList(node["terminal"], "args")
  let protected = strList(node, "protectedBranches")
  if protected.len > 0:
    result.protectedBranches = protected
  if node.hasKey("confirmDangerous"):
    result.confirmDangerous = node["confirmDangerous"].getBool(true)

proc toJson*(s: Settings): JsonNode =
  result = newJObject()
  result["schemaVersion"] = %s.schemaVersion
  result["root"] = %s.root
  result["scanDepth"] = %s.scanDepth
  result["excludeGlobs"] = strArr(s.excludeGlobs)
  result["excludeRepos"] = strArr(s.excludeRepos)
  result["selectedRepoId"] = %s.selectedRepoId
  result["diffMode"] = %s.diffMode
  result["commitDraftInHost"] = %s.commitDraftInHost
  result["logLevel"] = %s.logLevel
  result["editor"] = %*{"command": s.editorCommand, "args": strArr(s.editorArgs)}
  result["terminal"] = %*{"shell": s.terminalShell, "args": strArr(s.terminalArgs)}
  result["protectedBranches"] = strArr(s.protectedBranches)
  result["confirmDangerous"] = %s.confirmDangerous

proc saveSettings*(s: Settings) =
  discard ensureDataDir()
  writeJsonAtomic(dataDir() / "settings.json", toJson(s))

proc loadUiState*(): UiState =
  result = UiState(windowWidth: 1440, windowHeight: 900, drawerHeight: 216)
  let node = readJson(dataDir() / "state.json")
  if node == nil or node.kind != JObject:
    return
  if node.hasKey("windowWidth"): result.windowWidth = node["windowWidth"].getInt(1440)
  if node.hasKey("windowHeight"): result.windowHeight = node["windowHeight"].getInt(900)
  if node.hasKey("drawerHeight"): result.drawerHeight = node["drawerHeight"].getInt(216)

proc saveUiState*(s: UiState) =
  discard ensureDataDir()
  var node = newJObject()
  node["windowWidth"] = %s.windowWidth
  node["windowHeight"] = %s.windowHeight
  node["drawerHeight"] = %s.drawerHeight
  writeJsonAtomic(dataDir() / "state.json", node)

# --- repository index cache (docs/06 §5) ----------------------------------

var indexLock: Lock
initLock(indexLock)

proc repoFromJson(node: JsonNode): Repo =
  if node.kind != JObject:
    return
  result.id = node{"id"}.getStr("")
  result.name = node{"name"}.getStr("")
  result.path = normalizePath(node{"path"}.getStr(""))
  if node.hasKey("branch") and node["branch"].kind == JString:
    result.branch = node["branch"].getStr("")
  result.detached = node{"detached"}.getBool(false)
  result.head = node{"head"}.getStr("")
  result.ahead = if node.hasKey("ahead") and node["ahead"].kind == JInt: node["ahead"].getInt(-1) else: -1
  result.behind = if node.hasKey("behind") and node["behind"].kind == JInt: node["behind"].getInt(-1) else: -1
  result.lastCommitAt = node{"lastCommitAt"}.getBiggestInt(0).int64
  result.lang = node{"lang"}.getStr("—")
  if node.hasKey("dirty") and node["dirty"].kind == JObject:
    result.dirty = Dirty(
      staged: node["dirty"]{"staged"}.getInt(0),
      unstaged: node["dirty"]{"unstaged"}.getInt(0),
      untracked: node["dirty"]{"untracked"}.getInt(0),
      conflicted: node["dirty"]{"conflicted"}.getInt(0))

proc loadIndexFull*(root: string): IndexCache =
  ## Load cached repos plus directory mtime tree for incremental scans (docs/06 §5).
  acquire(indexLock)
  let node = readJson(dataDir() / "index.json")
  if node == nil or node.kind != JObject:
    release(indexLock)
    return
  let cachedRoot = normalizePath(node{"root"}.getStr(""))
  if cachedRoot != normalizePath(root):
    release(indexLock)
    return
  result.root = cachedRoot
  result.scanDepth = node{"scanDepth"}.getInt(4)
  result.excludeGlobs = strList(node, "excludeGlobs")
  if node.hasKey("dirMtimes") and node["dirMtimes"].kind == JObject:
    for k, v in node["dirMtimes"].pairs:
      result.dirMtimes[normalizePath(k)] = v.getBiggestInt(0).int64
  if node.hasKey("dirSubdirs") and node["dirSubdirs"].kind == JObject:
    for k, v in node["dirSubdirs"].pairs:
      if v.kind == JArray:
        var list: seq[string]
        for item in v:
          list.add normalizePath(item.getStr(""))
        result.dirSubdirs[normalizePath(k)] = list
  if node.hasKey("repos") and node["repos"].kind == JArray:
    for item in node["repos"]:
      result.repos.add repoFromJson(item)
  release(indexLock)

proc loadIndex*(root: string): seq[Repo] =
  ## Last painted sidebar, used before the first scan/status returns.
  loadIndexFull(root).repos

proc saveIndex*(root: string, repos: seq[Repo],
                dirMtimes: Table[string, int64] = initTable[string, int64](),
                dirSubdirs: Table[string, seq[string]] = initTable[string, seq[string]](),
                excludeGlobs: seq[string] = @[],
                scanDepth = 4) =
  acquire(indexLock)
  var items = newJArray()
  for repo in repos:
    items.add toJson(repo)
  var mtimesNode = newJObject()
  for k, v in dirMtimes.pairs:
    mtimesNode[k] = %v
  var subdirsNode = newJObject()
  for k, list in dirSubdirs.pairs:
    subdirsNode[k] = strArr(list)
  let node = %*{
    "schemaVersion": 1,
    "scannedAt": getTime().toUnix * 1000,
    "root": normalizePath(root),
    "scanDepth": scanDepth,
    "excludeGlobs": strArr(excludeGlobs),
    "dirMtimes": mtimesNode,
    "dirSubdirs": subdirsNode,
    "repos": items
  }
  writeJsonAtomic(dataDir() / "index.json", node)
  release(indexLock)

proc updateIndexRepos*(repos: seq[Repo]) =
  ## Merge fresh statuses into the cache; keeps cold starts honest.
  if repos.len == 0:
    return
  acquire(indexLock)
  let path = dataDir() / "index.json"
  var node = readJson(path)
  if node == nil or node.kind != JObject:
    node = %*{"schemaVersion": 1, "root": "", "repos": newJArray()}
  if node{"root"}.getStr("").len == 0:
    node["root"] = %loadSettings().root
  if not node.hasKey("repos") or node["repos"].kind != JArray:
    node["repos"] = newJArray()
  var list = newJArray()
  for item in node["repos"]:
    let itemPath = normalizePath(item{"path"}.getStr(""))
    var replaced = false
    for repo in repos:
      if repo.path == itemPath:
        list.add toJson(repo)
        replaced = true
        break
    if not replaced:
      list.add item
  for repo in repos:
    var exists = false
    for item in node["repos"]:
      if normalizePath(item{"path"}.getStr("")) == repo.path:
        exists = true
        break
    if not exists:
      list.add toJson(repo)
  node["repos"] = list
  node["scannedAt"] = %(getTime().toUnix * 1000)
  writeJsonAtomic(path, node)
  release(indexLock)

proc clearIndex*() =
  acquire(indexLock)
  let path = dataDir() / "index.json"
  if fileExists(path):
    try:
      removeFile(path)
    except CatchableError:
      discard
  release(indexLock)

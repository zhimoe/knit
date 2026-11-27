## knit — entry point.
##
##   nim c -r --path:../nimi/src src/main.nim
##   KNIT_DEV=1  …             # watch web/dist and reload the page (no HMR yet)
##   … --smoke                # quit as soon as the first paint reports in
##
## Only this file touches the window. Services registered below that are not
## explicitly `bindBackgroundService` run on the UI thread and must stay short.

import std/[json, os, osproc, strutils, times]
when defined(windows):
  import std/widestrs

import nimi

import ./knit/[agent, events, logger, services, store, types]

when defined(windows):
  proc winMessageBoxW(hwnd: pointer, text, caption: WideCString, flags: uint32): int32
    {.stdcall, dynlib: "user32.dll", importc: "MessageBoxW".}

type
  Shell = ref object

var
  window: Window
  quitWhenReady = false
  pageReady = false
  lastReload = 0.0
  repoWatcher: FileWatcher
  watchedRoot = ""
  editorProcs: seq[Process]

proc safeEcho(msg: string) =
  when defined(windows) and defined(guiapp):
    if getEnv("KNIT_DEV") != "1":
      return
  try:
    stdout.writeLine(msg)
    stdout.flushFile()
  except CatchableError:
    discard

proc writeCrashLog(stage, detail: string): string =
  let stamp = now().utc.format("yyyy-MM-dd'T'HH:mm:ss'Z'")
  let body = stamp & " [FATAL] " & stage & "\n" & detail & "\n\n"
  let candidates = [
    (try: ensureDataDir() / "crash.log" except CatchableError: ""),
    getAppDir() / "knit-crash.log",
    getTempDir() / "knit-crash.log",
  ]
  for path in candidates:
    if path.len == 0:
      continue
    try:
      createDir(path.parentDir)
      let f = open(path, fmAppend)
      try:
        f.write(body)
      finally:
        f.close()
      return path
    except CatchableError:
      discard
  ""

proc showFatalError(stage, detail: string) =
  let logFile = writeCrashLog(stage, detail)
  try:
    logError("fatal", stage & ": " & detail)
  except CatchableError:
    discard
  safeEcho("knit FATAL [" & stage & "]: " & detail)
  when defined(windows):
    if not quitWhenReady and getEnv("CI") != "true":
      let text = "Knit 启动或运行异常（" & stage & "）：\n\n" & detail &
                 (if logFile.len > 0: "\n\n日志已写入：\n" & logFile else: "")
      discard winMessageBoxW(nil, newWideCString(text),
                             newWideCString("Knit 启动失败"), 0x00000010'u32)

proc version(self: Shell): string =
  "knit 0.1.0"

proc ready(self: Shell, repos: int, ms: int) =
  ## Called by the page once the sidebar has painted (docs/07 M0 0.1).
  safeEcho("knit: first paint repos=" & $repos & " ms=" & $ms)
  logInfo("app", "first paint repos=" & $repos & " ms=" & $ms)
  pageReady = true
  let smokeOut = getEnv("KNIT_SMOKE_OUT")
  if smokeOut.len > 0:
    try:
      writeFile(smokeOut, "first_paint repos=" & $repos & " ms=" & $ms & "\n")
    except CatchableError:
      discard
  if quitWhenReady:
    discard agent.stopAll()
    discard postMain(proc() = app.quit())

proc pollEvents(self: Shell): string =
  ## UI thread: drain worker-thread events (git:command, agent:*) safely without
  ## sharing GC memory across threads under `--mm:refc`.
  drainEventsJson()

proc getState(self: Shell): string =
  let settings = loadSettings()
  result = $ %*{
    "root": settings.root,
    "scanDepth": settings.scanDepth,
    "excludeGlobs": settings.excludeGlobs,
    "excludeRepos": settings.excludeRepos,
    "selectedRepoId": settings.selectedRepoId,
    "diffMode": settings.diffMode,
    "editor": {"command": settings.editorCommand, "args": settings.editorArgs},
    "terminal": {"shell": settings.terminalShell, "args": settings.terminalArgs},
    "protectedBranches": settings.protectedBranches,
    "confirmDangerous": settings.confirmDangerous
  }

proc restartWatch(root: string) =
  if repoWatcher != nil:
    close(repoWatcher)
    repoWatcher = nil
  watchedRoot = root
  if root.len == 0 or not dirExists(root):
    return
  try:
    repoWatcher = watch(root, proc(e: FileEvent) =
      let p = e.path.replace('\\', '/')
      # docs/03 §6: ignore object/log churn and build trees.
      for ignored in [".git/objects/", ".git/logs/", ".git/knit/", "/node_modules/",
                      "/.venv/", "/target/", "/vendor/", "/dist/", "/build/"]:
        if ignored in p:
          return
      emitEvent("repo:changed", %*{"path": p}))
    safeEcho("knit: watching root#" & repoId(root))
    logInfo("watch", "watching root#" & repoId(root))
  except CatchableError as e:
    safeEcho("knit: watch 启动失败：" & e.msg)
    logWarn("watch", "watch failed: " & e.msg, [root])

proc setRoot(self: Shell, path: string): string =
  var settings = loadSettings()
  settings.root = normalizePath(path)
  settings.selectedRepoId = ""
  saveSettings(settings)
  clearIndex()
  restartWatch(settings.root)
  result = $ %*{"ok": true, "root": settings.root}

proc setSelected(self: Shell, repoId: string): string =
  var settings = loadSettings()
  settings.selectedRepoId = repoId
  saveSettings(settings)
  result = $ %*{"ok": true}

proc setExclusions(self: Shell, argsJson: string): string =
  var settings = loadSettings()
  try:
    let node = parseJson(argsJson)
    if node.hasKey("globs") and node["globs"].kind == JArray:
      settings.excludeGlobs = @[]
      for item in node["globs"]:
        settings.excludeGlobs.add item.getStr("")
    if node.hasKey("repos") and node["repos"].kind == JArray:
      settings.excludeRepos = @[]
      for item in node["repos"]:
        settings.excludeRepos.add item.getStr("")
    saveSettings(settings)
    result = $ %*{"ok": true}
  except CatchableError as e:
    result = $ %*{"ok": false, "error": e.msg}

proc pickRoot(self: Shell): string =
  let picked = dialog.open("选择根目录（knit 会扫描其下所有 git 仓库）",
                           directory = true, defaultPath = loadSettings().root)
  if picked.len > 0:
    result = normalizePath(picked[0])
  else:
    result = ""

proc pickPatch(self: Shell): string =
  let picked = dialog.open("选择 patch 文件", filters = @["*.patch", "*.diff"])
  if picked.len > 0:
    result = normalizePath(picked[0])
  else:
    result = ""

proc openPath(path: string, line: int) =
  ## Configured editor first (docs/06 §4), then the OS association.
  let settings = loadSettings()
  var command = settings.editorCommand
  var args = settings.editorArgs
  if command.len > 0:
    var replaced = false
    for i in 0 ..< args.len:
      if "{file}" in args[i] or "{line}" in args[i] or "{col}" in args[i]:
        args[i] = args[i].replace("{file}", path)
                       .replace("{line}", $line)
                       .replace("{col}", "1")
        replaced = true
    if not replaced:
      args.add path
    try:
      editorProcs.add startProcess(command, args = args, options = {poUsePath})
      return
    except OSError:
      discard
  # Fallback: let the shell pick the default app.
  var fallbackCmd = "open"
  var fallbackArgs = @[path]
  when defined(windows):
    # Avoid `cmd /c start` (cmd metacharacters in file names); rundll32 uses
    # the shell association directly.
    fallbackCmd = "rundll32"
    fallbackArgs = @["url.dll,FileProtocolHandler", path]
  elif defined(linux):
    fallbackCmd = "xdg-open"
  try:
    editorProcs.add startProcess(fallbackCmd, args = fallbackArgs,
                                 options = {poUsePath})
  except OSError as e:
    safeEcho("knit: 打开编辑器失败：" & e.msg)

proc reapEditors() =
  var alive: seq[Process]
  for p in editorProcs:
    try:
      let code = p.peekExitCode()
      if code >= 0:
        p.close()
      else:
        alive.add p
    except CatchableError:
      alive.add p
  editorProcs = alive

proc jsError(self: Shell, message: string): string =
  ## Front-end diagnostics: redacted before writing to knit.log (AGENTS.md §2).
  if message.len > 0:
    logError("web", message)
    if getEnv("KNIT_DEV") == "1":
      safeEcho("knit: js error: " & redact(message, [loadSettings().root]))
  result = $ %*{"ok": true}

proc openFile(self: Shell, path: string, line: int): string =
  reapEditors()
  openPath(path, line)
  result = $ %*{"ok": true}

when defined(knitEmbedWeb):
  const
    EmbeddedIndexHtml = staticRead("../web/dist/index.html")
    EmbeddedMainJs = staticRead("../web/dist/main.js")
    EmbeddedAppCss = staticRead("../web/dist/styles/app.css")
    EmbeddedWebStamp = $EmbeddedIndexHtml.len & "-" & $EmbeddedMainJs.len & "-" &
                       $EmbeddedAppCss.len & "-" &
                       (if EmbeddedMainJs.len > 64: EmbeddedMainJs[^64 .. ^1] else: EmbeddedMainJs)

when defined(windows) and defined(knitEmbedWebView2):
  const EmbeddedWebView2Loader =
    when defined(arm64):
      staticRead("../../nimi/src/nimi/platform/windows/webview2/sdk/arm64/WebView2Loader.dll")
    else:
      staticRead("../../nimi/src/nimi/platform/windows/webview2/sdk/x64/WebView2Loader.dll")

proc ensureWebView2Loader() =
  when defined(windows) and defined(knitEmbedWebView2):
    let dst = getAppDir() / "WebView2Loader.dll"
    if not fileExists(dst):
      try:
        writeFile(dst, EmbeddedWebView2Loader)
      except CatchableError as e:
        logWarn("boot", "cannot extract WebView2Loader.dll: " & e.msg)

proc ensureEmbeddedWebRoot(): string =
  when defined(knitEmbedWeb):
    let dir = ensureDataDir() / "web-bundle"
    let stampFile = dir / ".stamp"
    if fileExists(dir / "index.html") and fileExists(dir / "main.js") and
        fileExists(dir / "styles" / "app.css") and
        fileExists(stampFile) and readFile(stampFile) == EmbeddedWebStamp:
      return dir
    createDir(dir / "styles")
    writeFile(dir / "index.html", EmbeddedIndexHtml)
    writeFile(dir / "main.js", EmbeddedMainJs)
    writeFile(dir / "styles" / "app.css", EmbeddedAppCss)
    writeFile(stampFile, EmbeddedWebStamp)
    return dir
  else:
    ""

proc frontendRoot(): string =
  let override = getEnv("KNIT_WEB")
  if override.len > 0:
    result = override
  else:
    let candidates = [
      getAppDir() / "resources" / "web" / "dist",
      parentDir(getAppDir()) / "Resources" / "web" / "dist",
      getAppDir() / "web" / "dist",
      getAppDir() / "dist",
      getCurrentDir() / "web" / "dist",
      getCurrentDir() / "dist",
    ]
    result = ""
    for candidate in candidates:
      if fileExists(candidate / "index.html"):
        result = candidate
        break
    if result.len == 0:
      let embedded = ensureEmbeddedWebRoot()
      if embedded.len > 0:
        result = embedded
      else:
        result = getCurrentDir() / "web" / "dist"
  if not fileExists(result / "index.html"):
    safeEcho("knit: 找不到前端产物：" & result & "（先 cd web && bun run build）")
  else:
    safeEcho("knit: web root = " & result)

proc devReload() =
  let root = frontendRoot()
  if not dirExists(root):
    safeEcho("knit: 没有 web/dist，先 cd web && bun run build")
    return
  discard watch(root, proc(e: FileEvent) =
    let now = epochTime()
    if now - lastReload < 0.25:
      return
    lastReload = now
    if window != nil:
      window.eval("location.reload()"))

when isMainModule:
  try:
    for arg in commandLineParams():
      if arg == "--smoke":
        quitWhenReady = true

    logInfo("boot", "starting knit 0.1.0")
    registerKnitServices()
    let shell = Shell()
    bindService(shell, version, ready, pollEvents, getState, setRoot, setSelected,
                setExclusions, pickRoot, openFile, pickPatch, jsError)
    try:
      discard agent.ensureDefaultConfig()
    except CatchableError as e:
      logWarn("boot", "ensureDefaultConfig failed: " & e.msg)

    # Direct eval is only called on the main thread (see events.nim).
    setEventSink(proc(name, payload: string) {.closure, gcsafe.} =
      {.cast(gcsafe).}:
        if window != nil and pageReady:
          let js = "window.knitEvent(" & $(%name) & "," & $(%payload) & ")"
          window.eval(js))

    app.name = "knit"
    app.version = "0.1.0"

    app.whenReady(proc() =
      try:
        when defined(windows):
          ensureWebView2Loader()
          let webviewDir = ensureDataDir() / "webview"
          createDir(webviewDir)
          putEnv("WEBVIEW2_USER_DATA_FOLDER", webviewDir)
        let state = loadUiState()
        let settings = loadSettings()
        let webRoot = frontendRoot()
        logInfo("boot", "creating window")
        window = newWindow(WindowOptions(
          title: "knit",
          width: state.windowWidth,
          height: state.windowHeight,
          url: "nimi://app/index.html",
          files: newFileServer(webRoot, "nimi")))
        window.onClose(proc(e: var CloseEvent) =
          pageReady = false
          discard agent.stopAll()
          if window != nil:
            let size = window.getSize()
            if size.width > 0 and size.height > 0:
              try:
                saveUiState(UiState(windowWidth: size.width,
                                    windowHeight: size.height,
                                    drawerHeight: state.drawerHeight))
              except CatchableError:
                discard
          if repoWatcher != nil:
            close(repoWatcher)
            repoWatcher = nil
        )
        restartWatch(settings.root)
        if getEnv("KNIT_DEV") == "1":
          devReload()
      except CatchableError as e:
        showFatalError("whenReady", $e.name & ": " & e.msg & "\n" & e.getStackTrace())
        app.quit()
      except Defect as e:
        showFatalError("whenReady(defect)", $e.name & ": " & e.msg & "\n" & e.getStackTrace())
        app.quit())

    app.run()
  except CatchableError as e:
    showFatalError("main", $e.name & ": " & e.msg & "\n" & e.getStackTrace())
    quit(1)
  except Defect as e:
    showFatalError("main(defect)", $e.name & ": " & e.msg & "\n" & e.getStackTrace())
    quit(1)

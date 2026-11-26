## Rolling redacted file logger (docs/03 §9, docs/07 M5.7, AGENTS.md §2).
##
## Writes to `<dataDir>/logs/knit.log` (5 rotating files × 2 MB).
## Strictly redacts repository paths (replaced with `repo#<id>`), root paths,
## bearer/API tokens, and truncates long lines so diff content or full commit
## messages never hit disk.

import std/[locks, os, strutils, times]

import ./[store, types]

type
  LogLevel* = enum
    llError = 0, llWarn = 1, llInfo = 2, llDebug = 3

const
  MaxLogBytes* = 2 * 1024 * 1024
  MaxLogFiles* = 5

var logLock: Lock
initLock(logLock)

proc parseLogLevel*(name: string): LogLevel =
  case name.toLowerAscii().strip()
  of "error": llError
  of "warn", "warning": llWarn
  of "debug": llDebug
  else: llInfo

proc redactTokens(s: string): string =
  ## Strip common secret/token shapes before anything reaches disk.
  result = s
  for prefix in ["ghp_", "gho_", "github_pat_", "sk-", "xoxb-", "xoxp-", "Bearer "]:
    var pos = result.find(prefix)
    while pos >= 0:
      var stop = pos + prefix.len
      while stop < result.len and result[stop] notin {' ', '\t', '\n', '\r', '"', '\'', '&', ';'}:
        inc stop
      result = result[0 ..< pos] & prefix & "[REDACTED]" & result[stop .. ^1]
      pos = result.find(prefix, pos + prefix.len + 10)

proc redact*(message: string, sensitivePaths: openArray[string] = []): string =
  ## Replace known filesystem paths with stable hashes and redact tokens.
  result = message.replace('\\', '/')
  for p in sensitivePaths:
    let norm = normalizePath(p)
    if norm.len >= 3:
      result = result.replace(norm, "path#" & repoId(norm))
  let home = normalizePath(getHomeDir())
  if home.len >= 3:
    result = result.replace(home, "~")
  result = redactTokens(result)
  if result.len > 400:
    result = result[0 ..< 400] & "…"

proc logPath*(): string =
  dataDir() / "logs" / "knit.log"

proc rotateIfNeeded(path: string, maxBytes: int) =
  if not fileExists(path):
    return
  try:
    if getFileSize(path) < maxBytes:
      return
    for i in countdown(MaxLogFiles - 1, 1):
      let src = if i == 1: path else: path & "." & $(i - 1)
      let dst = path & "." & $i
      if fileExists(src):
        if fileExists(dst):
          removeFile(dst)
        moveFile(src, dst)
  except CatchableError:
    discard

proc writeLog*(level: LogLevel, scope, message: string,
               sensitivePaths: openArray[string] = [],
               maxBytes = MaxLogBytes) =
  let settings = loadSettings()
  let configured = parseLogLevel(settings.logLevel)
  if level > configured:
    return
  var paths = @sensitivePaths
  if settings.root.len > 0:
    paths.add settings.root
  let clean = redact(message, paths)
  let tag = case level
            of llError: "ERROR"
            of llWarn: "WARN"
            of llInfo: "INFO"
            of llDebug: "DEBUG"
  let line = now().utc.format("yyyy-MM-dd'T'HH:mm:ss'Z'") & " [" & tag & "] " &
             scope & ": " & clean & "\n"
  acquire(logLock)
  try:
    let p = logPath()
    createDir(p.parentDir)
    rotateIfNeeded(p, maxBytes)
    let f = open(p, fmAppend)
    try:
      f.write(line)
    finally:
      f.close()
  except CatchableError:
    discard
  finally:
    release(logLock)

proc logInfo*(scope, message: string, sensitivePaths: openArray[string] = []) =
  writeLog(llInfo, scope, message, sensitivePaths)

proc logWarn*(scope, message: string, sensitivePaths: openArray[string] = []) =
  writeLog(llWarn, scope, message, sensitivePaths)

proc logError*(scope, message: string, sensitivePaths: openArray[string] = []) =
  writeLog(llError, scope, message, sensitivePaths)

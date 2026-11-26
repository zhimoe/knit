## Conflict parsing for the three-pane merge view (docs/02 §3.7, docs/07 M4.1).
##
## We never implement merge semantics: ours/theirs/base come from the index
## (git show :2:/:3:/:1:), and conflict markers are only used to locate the
## blocks that the page offers to accept.

import std/[os, strutils]

import ./[gitops, types]

const
  MarkerOurs = "<<<<<<<"
  MarkerBase = "|||||||"
  MarkerSep = "======="
  MarkerTheirs = ">>>>>>>"

proc isMarker(line, prefix: string): bool =
  line.startsWith(prefix)

proc parseConflictMarkers*(content: string): tuple[lines: seq[string],
    blocks: seq[ConflictBlock]] =
  if content.len == 0:
    return
  result.lines = content.splitLines()
  var i = 0
  while i < result.lines.len:
    if not isMarker(result.lines[i], MarkerOurs):
      inc i
      continue
    let blockStart = i + 1                  # 1-based marker line
    inc i
    var ours: seq[string]
    while i < result.lines.len and
        not isMarker(result.lines[i], MarkerBase) and
        not isMarker(result.lines[i], MarkerSep):
      ours.add result.lines[i]
      inc i
    var base: seq[string]
    if i < result.lines.len and isMarker(result.lines[i], MarkerBase):
      inc i
      while i < result.lines.len and not isMarker(result.lines[i], MarkerSep):
        base.add result.lines[i]
        inc i
    var theirs: seq[string]
    if i < result.lines.len and isMarker(result.lines[i], MarkerSep):
      inc i
      while i < result.lines.len and not isMarker(result.lines[i], MarkerTheirs):
        theirs.add result.lines[i]
        inc i
    if i < result.lines.len and isMarker(result.lines[i], MarkerTheirs):
      inc i
    result.blocks.add ConflictBlock(
      index: result.blocks.len,
      start: blockStart,
      ours: ConflictSide(start: blockStart + 1, lines: ours),
      base: ConflictSide(start: blockStart + 1, lines: base),
      theirs: ConflictSide(start: blockStart + 1, lines: theirs),
      hasBase: base.len > 0)

proc linesOf(gitRes: GitResult): seq[string] =
  if gitRes.code != 0:
    return @[]
  var text = gitRes.output
  if text.endsWith("\n"):
    text.setLen(text.len - 1)
  if text.len == 0:
    return @[]
  text.splitLines()

proc mergeStateOf*(repoPath, path: string): MergeState =
  ## Current working file plus the three index stages. A missing stage (e.g.
  ## add/add conflict) is an empty string, not an error.
  result.path = path
  let full = repoPath / path
  if fileExists(full):
    try:
      let content = sanitizeUtf8(readFile(full))
      result.binary = '\0' in content
      let parsed = parseConflictMarkers(content)
      result.lines = parsed.lines
      result.blocks = parsed.blocks
    except CatchableError:
      discard
  let ours = mergeStageContent(repoPath, path, 2)
  if ours.code == 0:
    result.ours = ours.output
  let theirs = mergeStageContent(repoPath, path, 3)
  if theirs.code == 0:
    result.theirs = theirs.output
  let base = mergeStageContent(repoPath, path, 1)
  if base.code == 0:
    result.base = base.output
  if not result.binary:
    result.binary = '\0' in result.ours or '\0' in result.theirs

proc safeRelativePath(path: string): bool =
  if path.len == 0 or path.isAbsolute:
    return false
  for part in path.replace('\\', '/').split('/'):
    if part == "..":
      return false
  true

proc writeResolution*(repoPath, path, resolved: string): GitResult =
  ## Write the result column back and stage it (docs/07 M4.3). Refuses paths
  ## escaping the repository root.
  if not safeRelativePath(path):
    return GitResult(code: -1, error: "拒绝写入仓库之外的路径")
  let full = normalizedPath(repoPath / path)
  let root = normalizedPath(repoPath)
  if not (full == root or full.startsWith(root & $DirSep)):
    return GitResult(code: -1, error: "拒绝写入仓库之外的路径")
  try:
    writeFile(full, resolved)
  except CatchableError as e:
    return GitResult(code: -1, error: e.msg)
  result = addFile(repoPath, path)

proc simpleResolve*(state: MergeState, index: int): string =
  ## Returns "ours" | "theirs" | "both" | "" for one block.
  if index < 0 or index >= state.blocks.len:
    return ""
  let item = state.blocks[index]
  let ours = item.ours.lines.join("\n").strip()
  let theirs = item.theirs.lines.join("\n").strip()
  if ours == theirs:
    return "ours"
  if ours.len == 0:
    return "theirs"
  if theirs.len == 0:
    return "ours"
  ""

## Structured diffs (docs/02 §3.5, docs/04 §3.4).
##
## The host owns hunk splitting, line alignment and word-level highlighting;
## the page only renders rows and wraps `hl` ranges in <span>. The CLI is the
## M1 source (M1.1 swaps to libgit2 but the wire shape stays put).

import std/[base64, json, os, osproc, streams, strutils]

import ./[gitlib, gitops, types]

# --- hunk parsing ----------------------------------------------------------

proc parseIntField(s: string, dflt = 0): int =
  try:
    result = parseInt(s)
  except ValueError:
    result = dflt

proc splitRange(text: string): tuple[start, count: int] =
  ## "38,9" | "38" → (38, 9) | (38, 1)
  result.count = 1
  let comma = text.find(',')
  if comma >= 0:
    result.start = parseIntField(text[0 ..< comma])
    result.count = parseIntField(text[comma + 1 .. ^1], 1)
  else:
    result.start = parseIntField(text)

proc parseHunkHeader(line: string): tuple[ok: bool, oldStart, oldLines,
    newStart, newLines: int] =
  # @@ -38,9 +38,11 @@ optional context
  if not line.startsWith("@@"):
    return
  let close = line.find("@@", 2)
  if close < 0:
    return
  let body = line[2 ..< close].strip()
  let parts = body.splitWhitespace()
  if parts.len < 2 or not parts[0].startsWith("-") or
      not parts[1].startsWith("+"):
    return
  let old = splitRange(parts[0][1 .. ^1])
  let new = splitRange(parts[1][1 .. ^1])
  result = (true, old.start, old.count, new.start, new.count)

proc newDiffFile(): DiffFile =
  DiffFile(size: -1)

proc computeWordHighlights*(hunks: var seq[Hunk])

proc parseUnifiedDiff*(raw: string): seq[DiffFile] =
  ## Parses `git diff` / `git diff-tree -p` output. Multi-file output is
  ## supported (the services slice to one path in practice).
  var current: DiffFile
  var hasFile = false
  var hunk: Hunk
  var inHunk = false
  var oldLine = 0
  var newLine = 0
  var sawBinary = false

  template flushFile() =
    if hasFile:
      if sawBinary or current.binary:
        current.binary = true
      result.add current
      hasFile = false
      sawBinary = false
    inHunk = false

  for rawLine in raw.splitLines():
    var line = rawLine
    if line.startsWith("diff --git "):
      if inHunk:
        current.hunks.add hunk
        inHunk = false
      flushFile()
      current = newDiffFile()
      hasFile = true
      # Fallback path from the `a/<p> b/<p>` pair; ---/+++ normally wins.
      let rest = line["diff --git ".len .. ^1]
      let sep = rest.find(" b/")
      if sep > 2 and rest.startsWith("a/"):
        current.oldPath = rest[2 ..< sep]
        current.path = rest[sep + 3 .. ^1]
      continue
    if not hasFile:
      continue
    if inHunk:
      if line.len > 0 and line[0] in {'+', '-', ' '}:
        var row = DiffRow(t: (
          if line[0] == '+': "add" elif line[0] == '-': "del" else: "ctx"),
          text: line[1 .. ^1])
        case line[0]
        of '+':
          row.newNo = newLine
          inc newLine
          inc current.additions
        of '-':
          row.oldNo = oldLine
          inc oldLine
          inc current.deletions
        of ' ':
          row.oldNo = oldLine
          row.newNo = newLine
          inc oldLine
          inc newLine
        else:
          discard
        hunk.rows.add row
        continue
      elif line.startsWith("\\"):
        continue               # "\ No newline at end of file"
      else:
        # End of hunk (next file / header). Fall through to header handling
        # after committing the hunk.
        current.hunks.add hunk
        inHunk = false
    if line.startsWith("new file mode"):
      current.status = "A"
    elif line.startsWith("deleted file mode"):
      current.status = "D"
    elif line.startsWith("rename from "):
      current.status = "R"
      current.oldPath = line["rename from ".len .. ^1]
    elif line.startsWith("rename to "):
      current.path = line["rename to ".len .. ^1]
    elif line.startsWith("copy from "):
      current.status = "C"
      current.oldPath = line["copy from ".len .. ^1]
    elif line.startsWith("copy to "):
      current.path = line["copy to ".len .. ^1]
    elif line.startsWith("Binary files ") or line.startsWith("GIT binary patch"):
      current.binary = true
      sawBinary = true
      if line.startsWith("Binary files "):
        let body = line["Binary files ".len .. ^1]
        let marker = body.rfind(" differ")
        let pair = if marker >= 0: body[0 ..< marker] else: body
        let sep = pair.find(" and ")
        if sep > 0:
          let oldPart = stripDiffPrefix(pair[0 ..< sep])
          let newPart = stripDiffPrefix(pair[sep + 5 .. ^1])
          if oldPart != "/dev/null":
            current.oldPath = oldPart
          if newPart != "/dev/null":
            current.path = newPart
    elif line.startsWith("--- "):
      let p = stripDiffPrefix(line["--- ".len .. ^1])
      if p != "/dev/null" and current.oldPath.len == 0 and current.path.len == 0:
        current.oldPath = p
    elif line.startsWith("+++ "):
      let p = stripDiffPrefix(line["+++ ".len .. ^1])
      if p != "/dev/null":
        current.path = p
    elif line.startsWith("@@"):
      let parsed = parseHunkHeader(line)
      if parsed.ok:
        hunk = Hunk(header: line, oldStart: parsed.oldStart,
                    oldLines: parsed.oldLines, newStart: parsed.newStart,
                    newLines: parsed.newLines)
        oldLine = if parsed.oldLines == 0: parsed.oldStart + 1
                  else: parsed.oldStart
        newLine = if parsed.newLines == 0: parsed.newStart + 1
                  else: parsed.newStart
        inHunk = true
      continue

  if inHunk:
    current.hunks.add hunk
  flushFile()

  for f in result.mitems:
    if f.path.len == 0 and f.oldPath.len > 0:
      f.path = f.oldPath
    if f.oldPath.len == 0:
      f.oldPath = f.path
    if f.status.len == 0:
      f.status = "M"
    computeWordHighlights(f.hunks)

# --- word-level highlighting ----------------------------------------------

type Token = object
  text: string
  start: int        ## byte offset in the row
  stop: int
  word: bool

proc isWordByte(b: char): bool =
  b in {'a'..'z', 'A'..'Z', '0'..'9', '_'} or ord(b) >= 128

proc tokenize(text: string): seq[Token] =
  var i = 0
  while i < text.len:
    let start = i
    if text[i] in {' ', '\t'}:
      while i < text.len and text[i] in {' ', '\t'}:
        inc i
      result.add Token(text: text[start ..< i], start: start, stop: i, word: false)
    elif isWordByte(text[i]):
      while i < text.len and isWordByte(text[i]):
        inc i
      result.add Token(text: text[start ..< i], start: start, stop: i, word: true)
    else:
      inc i
      result.add Token(text: text[start ..< i], start: start, stop: i, word: false)

proc utf16Index(text: string, bytePos: int): int =
  ## Byte offsets become UTF-16 code-unit offsets because that is what JS
  ## strings index by (docs/06 §2 `hl`).
  var i = 0
  while i < text.len and i < bytePos:
    let b = ord(text[i])
    var step = 1
    var code = b
    if b < 0x80:
      step = 1
    elif (b shr 5) == 0b110:
      step = 2
      if i + 1 < text.len:
        code = ((b and 0x1F) shl 6) or (ord(text[i + 1]) and 0x3F)
    elif b shr 4 == 0b1110:
      step = 3
    elif b shr 3 == 0b11110:
      step = 4
      if i + 3 < text.len:
        code = ((b and 0x07) shl 18) or
               ((ord(text[i + 1]) and 0x3F) shl 12) or
               ((ord(text[i + 2]) and 0x3F) shl 6) or
               (ord(text[i + 3]) and 0x3F)
    else:
      step = 1
    result += (if code > 0xFFFF: 2 else: 1)
    i += step

proc changedRange(tokens: seq[Token], matched: seq[bool],
                  text: string): HlRange =
  ## First contiguous group of unmatched word tokens (docs/02 §3.5: one
  ## highlight per row, like JetBrains).
  var first = -1
  var last = -1
  for i in 0 ..< tokens.len:
    if matched[i] or not tokens[i].word:
      if first >= 0 and not tokens[i].word and matched[i]:
        break
      continue
    if first < 0:
      first = i
    last = i
  if first < 0:
    return (-1, 0)
  var byteStart = tokens[first].start
  var byteStop = tokens[last].stop
  while byteStop > byteStart and text[byteStop - 1] in {' ', '\t'}:
    dec byteStop
  if byteStop <= byteStart:
    return (-1, 0)
  let u16Start = utf16Index(text, byteStart)
  let u16Stop = utf16Index(text, byteStop)
  (u16Start, u16Stop - u16Start)

proc lcsMatched(a, b: seq[Token]): tuple[ma, mb: seq[bool]] =
  let n = a.len
  let m = b.len
  result.ma = newSeq[bool](n)
  result.mb = newSeq[bool](m)
  if n == 0 or m == 0 or n * m > 160_000:
    return
  var dp = newSeq[int]((n + 1) * (m + 1))
  proc at(i, j: int): int = dp[i * (m + 1) + j]
  for i in countdown(n - 1, 0):
    for j in countdown(m - 1, 0):
      if a[i].text == b[j].text:
        dp[i * (m + 1) + j] = at(i + 1, j + 1) + 1
      else:
        dp[i * (m + 1) + j] = max(at(i + 1, j), at(i, j + 1))
  var i = 0
  var j = 0
  while i < n and j < m:
    if a[i].text == b[j].text:
      result.ma[i] = true
      result.mb[j] = true
      inc i
      inc j
    elif at(i + 1, j) >= at(i, j + 1):
      inc i
    else:
      inc j

proc highlightPair(delRow, addRow: var DiffRow) =
  if delRow.text == addRow.text:
    return
  let a = tokenize(delRow.text)
  let b = tokenize(addRow.text)
  if a.len == 0 or b.len == 0:
    return
  let matched = lcsMatched(a, b)
  let rangeA = changedRange(a, matched.ma, delRow.text)
  let rangeB = changedRange(b, matched.mb, addRow.text)
  if rangeA.length > 0:
    delRow.hl = @[rangeA]
  if rangeB.length > 0:
    addRow.hl = @[rangeB]

proc computeWordHighlights*(hunks: var seq[Hunk]) =
  for hunk in hunks.mitems:
    var i = 0
    while i < hunk.rows.len:
      if hunk.rows[i].t == "del":
        let delStart = i
        while i < hunk.rows.len and hunk.rows[i].t == "del":
          inc i
        let addStart = i
        while i < hunk.rows.len and hunk.rows[i].t == "add":
          inc i
        let pairs = min(addStart - delStart, i - addStart)
        for k in 0 ..< pairs:
          highlightPair(hunk.rows[delStart + k], hunk.rows[addStart + k])
      elif hunk.rows[i].t == "add":
        # add-before-del is unusual but legal in hand-made patches.
        let addStart = i
        while i < hunk.rows.len and hunk.rows[i].t == "add":
          inc i
        let delStart = i
        while i < hunk.rows.len and hunk.rows[i].t == "del":
          inc i
        let pairs = min(delStart - addStart, i - delStart)
        for k in 0 ..< pairs:
          highlightPair(hunk.rows[delStart + k], hunk.rows[addStart + k])
      else:
        inc i

# --- diff commands --------------------------------------------------------

proc diffArgs(ignoreWhitespace: bool, contextLines: int): seq[string] =
  result = @["--no-color", "-M", "--src-prefix=a/", "--dst-prefix=b/",
             "--unified=" & $max(0, contextLines)]
  if ignoreWhitespace:
    result.add "-w"

proc diffOfCommitCli*(repoPath, hash, path: string, ignoreWhitespace = false,
                      contextLines = 3): DiffFile =
  ## Merge commits are compared against their first parent (two-commit form);
  ## a plain diff-tree on a merge prints nothing.
  let parents = parentsOf(repoPath, hash)
  var args: seq[string]
  if parents.len > 1:
    args = @["diff"]
    args.add diffArgs(ignoreWhitespace, contextLines)
    args.add parents[0]
    args.add hash
    args.add "--"
    if path.len > 0:
      args.add path
  else:
    args = @["diff-tree", "-p", "--root", "--no-commit-id", "-r"]
    args.add diffArgs(ignoreWhitespace, contextLines)
    args.add hash
    args.add "--"
    if path.len > 0:
      args.add path
  let res = runGit(repoPath, args, timeoutMs = 30_000)
  result = newDiffFile()
  result.path = path
  if res.code != 0:
    return
  let files = parseUnifiedDiff(res.output)
  if files.len > 0:
    result = files[0]

proc diffOfCommit*(repoPath, hash, path: string, ignoreWhitespace = false,
                   contextLines = 3): DiffFile =
  when defined(knitLibgit2):
    result = diffOfCommitLib(repoPath, hash, path, ignoreWhitespace, contextLines)
    computeWordHighlights(result.hunks)
  else:
    result = diffOfCommitCli(repoPath, hash, path, ignoreWhitespace, contextLines)

proc diffOfWorkdirCli*(repoPath, path: string, staged: bool, untracked: bool,
                       ignoreWhitespace = false, contextLines = 3): DiffFile =
  result = newDiffFile()
  result.path = path
  var args: seq[string]
  if untracked:
    args = @["diff", "--no-index"] &
           diffArgs(ignoreWhitespace, contextLines) &
           @["--", "/dev/null", path]
  else:
    args = @["diff"]
    if staged:
      args.add "--cached"
    args.add diffArgs(ignoreWhitespace, contextLines)
    args.add "--"
    args.add path
  let res = runGit(repoPath, args, timeoutMs = 30_000,
                   okCodes = (if untracked: @[0, 1] else: @[0]))
  # `git diff --no-index` exits 1 when there is a difference, which is normal.
  if res.code != 0 and not untracked:
    return
  let files = parseUnifiedDiff(res.output)
  if files.len > 0:
    result = files[0]
  if untracked:
    result.status = "A"
    result.path = path
    result.oldPath = path
  if result.path.len == 0:
    result.path = path

proc diffOfWorkdir*(repoPath, path: string, staged: bool, untracked: bool,
                    ignoreWhitespace = false, contextLines = 3): DiffFile =
  when defined(knitLibgit2):
    result = diffOfWorkdirLib(repoPath, path, staged, untracked,
                              ignoreWhitespace, contextLines)
    computeWordHighlights(result.hunks)
  else:
    result = diffOfWorkdirCli(repoPath, path, staged, untracked,
                              ignoreWhitespace, contextLines)


proc diffOfRange*(repoPath, baseRev, headRev, path: string,
                  ignoreWhitespace = false, contextLines = 3): DiffFile =
  ## Diff one file between two arbitrary revisions (`baseRev` -> `headRev`).
  var args = @["diff"]
  args.add diffArgs(ignoreWhitespace, contextLines)
  args.add baseRev
  args.add headRev
  args.add "--"
  if path.len > 0:
    args.add path
  let res = runGit(repoPath, args, timeoutMs = 30_000)
  result = newDiffFile()
  result.path = path
  if res.code != 0:
    return
  let files = parseUnifiedDiff(res.output)
  if files.len > 0:
    result = files[0]

proc imageMime*(path: string): string =
  let ext = splitFile(path).ext.toLowerAscii()
  case ext
  of ".png": "image/png"
  of ".jpg", ".jpeg": "image/jpeg"
  of ".gif": "image/gif"
  of ".webp": "image/webp"
  of ".svg": "image/svg+xml"
  of ".ico": "image/x-icon"
  of ".bmp": "image/bmp"
  else: ""

const MaxImagePreviewBytes = 150 * 1024  # Keeps combined base64 safely <= 240 KB IPC cap

proc rawGitBlob(repoPath, spec: string): tuple[ok: bool, data: string, tooLarge: bool] =
  ## Read exact raw bytes from `git cat-file -p <spec>` without UTF-8 sanitising.
  const procOpts = when defined(windows): {poUsePath, poDaemon} else: {poUsePath}
  var p: Process
  try:
    p = startProcess(gitBin(), args = @["-C", repoPath, "cat-file", "-p", spec],
                     options = procOpts)
  except OSError:
    return (false, "", false)
  defer:
    try: p.close() except CatchableError: discard
  var buf = newStringOfCap(4096)
  var chunk: array[8192, char]
  var tooLarge = false
  let s = p.outputStream
  while true:
    let n = s.readData(addr chunk[0], chunk.len)
    if n <= 0:
      break
    if buf.len + n > MaxImagePreviewBytes + 1:
      tooLarge = true
      continue
    let oldLen = buf.len
    buf.setLen(oldLen + n)
    copyMem(addr buf[oldLen], addr chunk[0], n)
  let code = try: waitForExit(p, 15_000) except CatchableError: -1
  if code != 0:
    return (false, "", false)
  if tooLarge:
    return (true, "", true)
  (true, buf, false)

proc encodeImageDataUrl(mime, raw: string): tuple[url: string, size: int, tooLarge: bool] =
  if raw.len == 0:
    return ("", 0, false)
  if raw.len > MaxImagePreviewBytes:
    return ("", raw.len, true)
  ("data:" & mime & ";base64," & encode(raw), raw.len, false)

proc imagePreviewOf*(repoPath, filePath: string, hash = "", staged = false,
                     untracked = false, baseRev = "", headRev = ""): JsonNode =
  ## Return base64 data URLs for before/after versions of an image file.
  let mime = imageMime(filePath)
  if mime.len == 0:
    return %*{"supported": false}
  var oldRaw = ""
  var newRaw = ""
  var anyTooLarge = false
  if baseRev.len > 0 and headRev.len > 0:
    let a = rawGitBlob(repoPath, baseRev & ":" & filePath)
    let b = rawGitBlob(repoPath, headRev & ":" & filePath)
    if a.tooLarge or b.tooLarge: anyTooLarge = true
    if a.ok: oldRaw = a.data
    if b.ok: newRaw = b.data
  elif hash.len > 0:
    let parents = parentsOf(repoPath, hash)
    if parents.len > 0:
      let a = rawGitBlob(repoPath, parents[0] & ":" & filePath)
      if a.tooLarge: anyTooLarge = true
      if a.ok: oldRaw = a.data
    let b = rawGitBlob(repoPath, hash & ":" & filePath)
    if b.tooLarge: anyTooLarge = true
    if b.ok: newRaw = b.data
  else:
    if not untracked:
      let a = rawGitBlob(repoPath, "HEAD:" & filePath)
      if a.tooLarge: anyTooLarge = true
      if a.ok: oldRaw = a.data
    if staged:
      let b = rawGitBlob(repoPath, ":" & filePath)
      if b.tooLarge: anyTooLarge = true
      if b.ok: newRaw = b.data
    else:
      let full = repoPath / filePath
      if fileExists(full):
        try:
          let sz = getFileSize(full)
          if sz <= MaxImagePreviewBytes:
            newRaw = readFile(full)
          else:
            anyTooLarge = true
        except CatchableError:
          discard
  if anyTooLarge:
    return %*{
      "supported": true,
      "mime": mime,
      "tooLarge": true,
      "beforeDataUrl": "",
      "afterDataUrl": "",
      "beforeBytes": oldRaw.len,
      "afterBytes": newRaw.len,
    }
  let oldEnc = encodeImageDataUrl(mime, oldRaw)
  let newEnc = encodeImageDataUrl(mime, newRaw)
  # Ensure total payload fits comfortably under 240 KB IPC ceiling.
  if oldEnc.tooLarge or newEnc.tooLarge or (oldEnc.url.len + newEnc.url.len > 220_000):
    return %*{
      "supported": true,
      "mime": mime,
      "tooLarge": true,
      "beforeDataUrl": "",
      "afterDataUrl": "",
      "beforeBytes": oldRaw.len,
      "afterBytes": newRaw.len,
    }
  %*{
    "supported": true,
    "mime": mime,
    "tooLarge": false,
    "beforeDataUrl": oldEnc.url,
    "afterDataUrl": newEnc.url,
    "beforeBytes": oldEnc.size,
    "afterBytes": newEnc.size,
  }

## Wire types shared by the host services. Field names are camelCase on the wire
## (see docs/06-data-model.md); the TypeScript side mirrors these exactly.

import std/[json, strutils, sha1]

type
  Dirty* = object
    staged*: int
    unstaged*: int
    untracked*: int
    conflicted*: int

  Repo* = object
    id*: string
    name*: string
    path*: string
    branch*: string        ## "" when detached or unknown
    detached*: bool
    head*: string
    ahead*: int            ## -1 = no upstream
    behind*: int           ## -1 = no upstream
    dirty*: Dirty
    lastCommitAt*: int64   ## epoch ms, 0 = unknown
    lang*: string
    error*: string

  Commit* = object
    hash*: string
    shortHash*: string
    parents*: seq[string]
    authorName*: string
    authorEmail*: string
    committedAt*: int64
    subject*: string
    body*: string
    refs*: seq[string]

  FileEntry* = object
    path*: string
    oldPath*: string
    status*: string         ## M A D R C U
    group*: string          ## "commit" | "staged" | "unstaged"
    additions*: int
    deletions*: int
    binary*: bool
    untracked*: bool
    conflict*: bool

  HlRange* = tuple[start, length: int]

  DiffRow* = object
    t*: string              ## "ctx" | "add" | "del"
    oldNo*: int             ## 0 = no line on this side
    newNo*: int
    text*: string
    hl*: seq[HlRange]       ## docs/02 §3.5: at most one range per row

  Hunk* = object
    header*: string         ## the original `@@ … @@ context` line
    oldStart*: int
    oldLines*: int
    newStart*: int
    newLines*: int
    rows*: seq[DiffRow]

  DiffFile* = object
    path*: string
    oldPath*: string
    status*: string
    binary*: bool
    size*: int64
    additions*: int
    deletions*: int
    hunks*: seq[Hunk]
    truncated*: bool
    token*: string
    chunks*: int
    previewHunks*: seq[Hunk]

  ConflictSide* = object
    start*: int             ## 1-based line in the file that side came from
    lines*: seq[string]

  ConflictBlock* = object
    index*: int
    start*: int             ## 1-based line in the conflicted working file
    ours*: ConflictSide
    theirs*: ConflictSide
    base*: ConflictSide
    hasBase*: bool

  MergeState* = object
    path*: string
    ours*: string           ## stage 2 (HEAD)
    theirs*: string         ## stage 3 (incoming)
    base*: string           ## stage 1
    lines*: seq[string]     ## current working file with conflict markers
    blocks*: seq[ConflictBlock]
    binary*: bool

  ShelfItem* = object
    id*: string
    kind*: string           ## "patch" | "stash"
    name*: string
    subtitle*: string
    path*: string
    epochMs*: int64

  BlameLine* = object
    line*: int
    hash*: string
    shortHash*: string
    author*: string
    time*: int64            ## epoch ms
    summary*: string
    text*: string

  WorktreeInfo* = object
    path*: string
    branch*: string
    head*: string
    handId*: string
    locked*: bool
    isMain*: bool

# --- helpers ---------------------------------------------------------------

proc strArr*(items: seq[string]): JsonNode =
  result = newJArray()
  for item in items:
    result.add %item

proc normalizePath*(path: string): string =
  ## Stable form used for ids and comparisons: '/' separators, no trailing '/'.
  result = path.replace('\\', '/')
  while result.len > 1 and result[^1] == '/':
    result.setLen(result.len - 1)

proc repoId*(path: string): string =
  ## docs/06 §1: sha1 of the normalized path, first 12 hex chars, lowercased.
  ## Windows is case-insensitive, so fold case before hashing.
  let key = when defined(windows): normalizePath(path).toLowerAscii()
            else: normalizePath(path)
  ($secureHash(key))[0 ..< 12].toLowerAscii()

proc langOf*(name: string): string =
  case name
  of "nim", "nimi": "Nim"
  of "knit", "pi", "waku", "fx": "TS"
  of "mygo", "mygo-work", "nsgo", "magpie": "Go"
  of "nsh", "envman", "tau": "Rust"
  else: "—"

# --- JSON encoders ---------------------------------------------------------

proc toJson*(d: Dirty): JsonNode =
  result = newJObject()
  result["staged"] = %d.staged
  result["unstaged"] = %d.unstaged
  result["untracked"] = %d.untracked
  result["conflicted"] = %d.conflicted

proc toJson*(r: Repo): JsonNode =
  result = newJObject()
  result["id"] = %r.id
  result["name"] = %r.name
  result["path"] = %r.path
  result["branch"] = (if r.branch.len > 0: %r.branch else: newJNull())
  result["detached"] = %r.detached
  result["head"] = %r.head
  result["ahead"] = (if r.ahead < 0: newJNull() else: %r.ahead)
  result["behind"] = (if r.behind < 0: newJNull() else: %r.behind)
  result["dirty"] = toJson(r.dirty)
  result["lastCommitAt"] = %r.lastCommitAt
  result["lang"] = %r.lang
  if r.error.len > 0:
    result["error"] = %*{"kind": "git", "message": r.error}

proc toJson*(c: Commit): JsonNode =
  result = newJObject()
  result["hash"] = %c.hash
  result["shortHash"] = %c.shortHash
  result["parents"] = strArr(c.parents)
  result["author"] = %*{"name": c.authorName, "email": c.authorEmail}
  result["committedAt"] = %c.committedAt
  result["subject"] = %c.subject
  result["body"] = %c.body
  result["refs"] = strArr(c.refs)

proc toJson*(f: FileEntry): JsonNode =
  result = newJObject()
  result["path"] = %f.path
  if f.oldPath.len > 0:
    result["oldPath"] = %f.oldPath
  result["status"] = %f.status
  result["group"] = %f.group
  result["additions"] = %f.additions
  result["deletions"] = %f.deletions
  result["binary"] = %f.binary
  if f.untracked:
    result["untracked"] = %true
  if f.conflict:
    result["conflict"] = %true

proc toJson*(row: DiffRow): JsonNode =
  result = newJObject()
  result["t"] = %row.t
  if row.oldNo > 0:
    result["oldNo"] = %row.oldNo
  if row.newNo > 0:
    result["newNo"] = %row.newNo
  result["text"] = %row.text
  if row.hl.len > 0:
    var arr = newJArray()
    for (start, length) in row.hl:
      arr.add %*[start, length]
    result["hl"] = arr

proc toJson*(h: Hunk): JsonNode =
  result = newJObject()
  result["header"] = %h.header
  result["oldStart"] = %h.oldStart
  result["oldLines"] = %h.oldLines
  result["newStart"] = %h.newStart
  result["newLines"] = %h.newLines
  var rows = newJArray()
  for row in h.rows:
    rows.add toJson(row)
  result["rows"] = rows

proc hunksJson(hunks: seq[Hunk]): JsonNode =
  result = newJArray()
  for h in hunks:
    result.add toJson(h)

proc toJson*(d: DiffFile): JsonNode =
  result = newJObject()
  result["path"] = %d.path
  if d.oldPath.len > 0:
    result["oldPath"] = %d.oldPath
  result["status"] = %d.status
  result["binary"] = %d.binary
  result["size"] = %d.size
  result["additions"] = %d.additions
  result["deletions"] = %d.deletions
  result["hunks"] = hunksJson(d.hunks)
  if d.truncated:
    result["truncated"] = %true
    result["token"] = %d.token
    result["chunks"] = %d.chunks
    result["preview"] = %*{"hunks": hunksJson(d.previewHunks)}

proc toJson*(s: ConflictSide): JsonNode =
  result = %*{"start": s.start, "lines": strArr(s.lines)}

proc toJson*(b: ConflictBlock): JsonNode =
  result = newJObject()
  result["index"] = %b.index
  result["start"] = %b.start
  result["ours"] = toJson(b.ours)
  result["theirs"] = toJson(b.theirs)
  if b.hasBase:
    result["base"] = toJson(b.base)

proc toJson*(m: MergeState): JsonNode =
  result = newJObject()
  result["path"] = %m.path
  result["ours"] = %m.ours
  result["theirs"] = %m.theirs
  result["base"] = %m.base
  result["lines"] = strArr(m.lines)
  result["binary"] = %m.binary
  var blocks = newJArray()
  for b in m.blocks:
    blocks.add toJson(b)
  result["blocks"] = blocks

proc toJson*(s: ShelfItem): JsonNode =
  result = %*{
    "id": s.id, "kind": s.kind, "name": s.name, "subtitle": s.subtitle,
    "path": s.path, "epochMs": s.epochMs
  }

proc toJson*(b: BlameLine): JsonNode =
  result = %*{
    "line": b.line, "hash": b.hash, "shortHash": b.shortHash,
    "author": b.author, "time": b.time, "summary": b.summary,
    "text": b.text
  }

proc toJson*(w: WorktreeInfo): JsonNode =
  result = newJObject()
  result["path"] = %w.path
  result["branch"] = (if w.branch.len > 0: %w.branch else: newJNull())
  result["head"] = %w.head
  result["handId"] = (if w.handId.len > 0: %w.handId else: newJNull())
  result["locked"] = %w.locked
  result["isMain"] = %w.isMain

proc toJson*(items: seq[BlameLine]): JsonNode =
  result = newJArray()
  for item in items:
    result.add toJson(item)

proc toJson*(items: seq[WorktreeInfo]): JsonNode =
  result = newJArray()
  for item in items:
    result.add toJson(item)

proc toJson*(items: seq[Repo]): JsonNode =
  result = newJArray()
  for item in items:
    result.add toJson(item)

proc toJson*(items: seq[Commit]): JsonNode =
  result = newJArray()
  for item in items:
    result.add toJson(item)

proc toJson*(items: seq[FileEntry]): JsonNode =
  result = newJArray()
  for item in items:
    result.add toJson(item)

proc toJson*(items: seq[ShelfItem]): JsonNode =
  result = newJArray()
  for item in items:
    result.add toJson(item)

# --- envelope (docs/03 §3.1) ----------------------------------------------

proc okEnvelope*(data: JsonNode): string =
  result = $ %*{"ok": true, "data": data}

proc errEnvelope*(kind, message: string, hint = ""): string =
  var err = %*{"kind": kind, "message": message}
  if hint.len > 0:
    err["hint"] = %hint
  result = $ %*{"ok": false, "error": err}

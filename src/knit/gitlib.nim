## libgit2 FFI bindings and in-process read operations (docs/04, docs/07 M1.1).
##
## Hard constraint (AGENTS.md §3): ALL `importc` bindings to libgit2 live in
## this module. Every libgit2 handle is opened and freed within a single call
## via `defer` — handles never cross threads.

import std/[algorithm, locks, os, strutils, tables]

import ./[types]

proc hasLibgit2*(): bool =
  when defined(knitLibgit2): true
  else: false

when defined(knitLibgit2):
  const hdr = "<git2.h>"

  type
    GitRepository = ptr object
    GitStatusList = ptr object
    GitRevwalk = ptr object
    GitCommit = ptr object
    GitReference = ptr object
    GitReferenceIterator = ptr object
    GitObject = ptr object
    GitTree = ptr object
    GitTreeEntry = ptr object
    GitBlob = ptr object
    GitDiff = ptr object
    GitPatch = ptr object
    GitBlame = ptr object
    GitWorktree = ptr object
    GitIndex = ptr object

    GitOid {.importc: "git_oid", header: hdr, bycopy.} = object
      id: array[20, uint8]

    GitTime {.importc: "git_time", header: hdr, bycopy.} = object
      time: int64
      offset: cint
      sign: char

    GitSignature {.importc: "git_signature", header: hdr, bycopy.} = object
      name: cstring
      email: cstring
      `when`: GitTime

    GitStrarray {.importc: "git_strarray", header: hdr, bycopy.} = object
      strings: ptr UncheckedArray[cstring]
      count: csize_t

    GitBuf {.importc: "git_buf", header: hdr, bycopy.} = object
      `ptr`: cstring
      reserved: csize_t
      size: csize_t

    GitDiffFile {.importc: "git_diff_file", header: hdr, bycopy.} = object
      id: GitOid
      path: cstring
      size: uint64
      flags: uint32
      mode: uint16
      id_abbrev: uint16

    GitDiffDelta {.importc: "git_diff_delta", header: hdr, bycopy.} = object
      status: cint
      flags: uint32
      similarity: uint16
      nfiles: uint16
      old_file: GitDiffFile
      new_file: GitDiffFile

    GitStatusEntry {.importc: "git_status_entry", header: hdr, bycopy.} = object
      status: cuint
      head_to_index: ptr GitDiffDelta
      index_to_workdir: ptr GitDiffDelta

    GitStatusOptions {.importc: "git_status_options", header: hdr, bycopy.} = object
      version: cuint
      show: cint
      flags: cuint
      pathspec: GitStrarray
      baseline: GitTree
      rename_threshold: uint16

    GitDiffOptions {.importc: "git_diff_options", header: hdr, bycopy.} = object
      version: cuint
      flags: uint32
      ignore_submodules: cint
      pathspec: GitStrarray
      context_lines: uint32
      interhunk_lines: uint32

    GitDiffFindOptions {.importc: "git_diff_find_options", header: hdr, bycopy.} = object
      version: cuint
      flags: uint32
      rename_threshold: uint16

    GitDiffHunk {.importc: "git_diff_hunk", header: hdr, bycopy.} = object
      old_start: cint
      old_lines: cint
      new_start: cint
      new_lines: cint
      header_len: csize_t
      header: array[128, char]

    GitDiffLine {.importc: "git_diff_line", header: hdr, bycopy.} = object
      origin: char
      old_lineno: cint
      new_lineno: cint
      num_lines: cint
      content_len: csize_t
      content_offset: int64
      content: cstring

    GitBlameOptions {.importc: "git_blame_options", header: hdr, bycopy.} = object
      version: cuint
      flags: cuint
      min_match_characters: uint16
      newest_commit: GitOid
      oldest_commit: GitOid
      min_line: csize_t
      max_line: csize_t

    GitBlameHunk {.importc: "git_blame_hunk", header: hdr, bycopy.} = object
      lines_in_hunk: csize_t
      final_commit_id: GitOid
      final_start_line_number: csize_t
      final_signature: ptr GitSignature
      orig_commit_id: GitOid
      orig_path: cstring
      orig_start_line_number: csize_t
      orig_signature: ptr GitSignature
      boundary: char

    GitError {.importc: "git_error", header: hdr, bycopy.} = object
      message: cstring
      klass: cint

  const
    GIT_REPOSITORY_OPEN_NO_SEARCH = 1'u32
    GIT_STATUS_OPTIONS_VERSION = 1'u32
    GIT_STATUS_SHOW_INDEX_AND_WORKDIR = 0'i32
    GIT_STATUS_OPT_INCLUDE_UNTRACKED = (1'u32 shl 0)
    GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS = (1'u32 shl 4)
    GIT_STATUS_OPT_RENAMES_HEAD_TO_INDEX = (1'u32 shl 7)
    GIT_STATUS_OPT_RENAMES_INDEX_TO_WORKDIR = (1'u32 shl 8)

    GIT_STATUS_INDEX_NEW = (1'u32 shl 0)
    GIT_STATUS_INDEX_MODIFIED = (1'u32 shl 1)
    GIT_STATUS_INDEX_DELETED = (1'u32 shl 2)
    GIT_STATUS_INDEX_RENAMED = (1'u32 shl 3)
    GIT_STATUS_INDEX_TYPECHANGE = (1'u32 shl 4)
    GIT_STATUS_WT_NEW = (1'u32 shl 7)
    GIT_STATUS_WT_MODIFIED = (1'u32 shl 8)
    GIT_STATUS_WT_DELETED = (1'u32 shl 9)
    GIT_STATUS_WT_TYPECHANGE = (1'u32 shl 10)
    GIT_STATUS_WT_RENAMED = (1'u32 shl 11)
    GIT_STATUS_CONFLICTED = (1'u32 shl 15)

    GIT_SORT_TOPOLOGICAL = (1'u32 shl 0)
    GIT_SORT_TIME = (1'u32 shl 1)

    GIT_OBJECT_COMMIT = 1'i32
    GIT_OBJECT_TREE = 2'i32
    GIT_OBJECT_BLOB = 3'i32

    GIT_DIFF_OPTIONS_VERSION = 1'u32
    GIT_DIFF_FIND_OPTIONS_VERSION = 1'u32
    GIT_DIFF_INCLUDE_UNTRACKED = (1'u32 shl 3)
    GIT_DIFF_RECURSE_UNTRACKED_DIRS = (1'u32 shl 4)
    GIT_DIFF_INCLUDE_TYPECHANGE = (1'u32 shl 6)
    GIT_DIFF_DISABLE_PATHSPEC_MATCH = (1'u32 shl 12)
    GIT_DIFF_IGNORE_WHITESPACE = (1'u32 shl 22)
    GIT_DIFF_SHOW_UNTRACKED_CONTENT = (1'u32 shl 25)
    GIT_DIFF_FIND_RENAMES = (1'u32 shl 0)
    GIT_DIFF_FLAG_BINARY = (1'u32 shl 0)

    GIT_DELTA_ADDED = 1'i32
    GIT_DELTA_DELETED = 2'i32
    GIT_DELTA_MODIFIED = 3'i32
    GIT_DELTA_RENAMED = 4'i32
    GIT_DELTA_COPIED = 5'i32
    GIT_DELTA_UNTRACKED = 7'i32
    GIT_DELTA_TYPECHANGE = 8'i32
    GIT_DELTA_CONFLICTED = 10'i32

    GIT_BLAME_OPTIONS_VERSION = 1'u32
    GIT_BLAME_TRACK_COPIES_SAME_FILE = (1'u32 shl 0)
    GIT_BLAME_TRACK_COPIES_SAME_COMMIT_MOVES = (1'u32 shl 1)

    GIT_ITEROVER = -31'i32

  proc git_libgit2_init(): cint {.importc, header: hdr.}
  proc git_error_last(): ptr GitError {.importc, header: hdr.}
  proc git_oid_tostr(outBuf: cstring, n: csize_t, id: ptr GitOid): cstring {.importc, header: hdr.}
  proc git_oid_fromstrp(outId: ptr GitOid, str: cstring): cint {.importc, header: hdr.}
  proc git_strarray_dispose(arr: ptr GitStrarray) {.importc, header: hdr.}
  proc git_buf_dispose(buf: ptr GitBuf) {.importc, header: hdr.}

  proc git_repository_open_ext(outRepo: ptr GitRepository, path: cstring,
      flags: cuint, ceilingDirs: cstring): cint {.importc, header: hdr.}
  proc git_repository_free(repo: GitRepository) {.importc, header: hdr.}
  proc git_repository_head(outRef: ptr GitReference, repo: GitRepository): cint {.importc, header: hdr.}
  proc git_repository_head_detached(repo: GitRepository): cint {.importc, header: hdr.}
  proc git_repository_head_unborn(repo: GitRepository): cint {.importc, header: hdr.}
  proc git_repository_workdir(repo: GitRepository): cstring {.importc, header: hdr.}
  proc git_repository_index(outIdx: ptr GitIndex, repo: GitRepository): cint {.importc, header: hdr.}
  proc git_index_free(idx: GitIndex) {.importc, header: hdr.}

  proc git_reference_lookup(outRef: ptr GitReference, repo: GitRepository,
      name: cstring): cint {.importc, header: hdr.}
  proc git_reference_free(r: GitReference) {.importc, header: hdr.}
  proc git_reference_name(r: GitReference): cstring {.importc, header: hdr.}
  proc git_reference_shorthand(r: GitReference): cstring {.importc, header: hdr.}
  proc git_reference_target(r: GitReference): ptr GitOid {.importc, header: hdr.}
  proc git_reference_symbolic_target(r: GitReference): cstring {.importc, header: hdr.}
  proc git_reference_resolve(outRef: ptr GitReference, r: GitReference): cint {.importc, header: hdr.}
  proc git_reference_peel(outObj: ptr GitObject, r: GitReference, objType: cint): cint {.importc, header: hdr.}
  proc git_reference_iterator_new(outIter: ptr GitReferenceIterator,
      repo: GitRepository): cint {.importc, header: hdr.}
  proc git_reference_next(outRef: ptr GitReference,
      iter: GitReferenceIterator): cint {.importc, header: hdr.}
  proc git_reference_iterator_free(iter: GitReferenceIterator) {.importc, header: hdr.}

  proc git_branch_upstream(outRef: ptr GitReference,
      branch: GitReference): cint {.importc, header: hdr.}
  proc git_graph_ahead_behind(ahead, behind: ptr csize_t, repo: GitRepository,
      local, upstream: ptr GitOid): cint {.importc, header: hdr.}

  proc git_status_options_init(opts: ptr GitStatusOptions,
      version: cuint): cint {.importc, header: hdr.}
  proc git_status_list_new(outList: ptr GitStatusList, repo: GitRepository,
      opts: ptr GitStatusOptions): cint {.importc, header: hdr.}
  proc git_status_list_entrycount(list: GitStatusList): csize_t {.importc, header: hdr.}
  proc git_status_byindex(list: GitStatusList,
      idx: csize_t): ptr GitStatusEntry {.importc, header: hdr.}
  proc git_status_list_free(list: GitStatusList) {.importc, header: hdr.}

  proc git_revwalk_new(outWalk: ptr GitRevwalk, repo: GitRepository): cint {.importc, header: hdr.}
  proc git_revwalk_sorting(walk: GitRevwalk, sortMode: cuint): cint {.importc, header: hdr.}
  proc git_revwalk_push(walk: GitRevwalk, id: ptr GitOid): cint {.importc, header: hdr.}
  proc git_revwalk_push_head(walk: GitRevwalk): cint {.importc, header: hdr.}
  proc git_revwalk_next(outId: ptr GitOid, walk: GitRevwalk): cint {.importc, header: hdr.}
  proc git_revwalk_free(walk: GitRevwalk) {.importc, header: hdr.}

  proc git_revparse_single(outObj: ptr GitObject, repo: GitRepository,
      spec: cstring): cint {.importc, header: hdr.}
  proc git_object_peel(peeled: ptr GitObject, obj: GitObject,
      targetType: cint): cint {.importc, header: hdr.}
  proc git_object_id(obj: GitObject): ptr GitOid {.importc, header: hdr.}
  proc git_object_free(obj: GitObject) {.importc, header: hdr.}

  proc git_commit_lookup(outCommit: ptr GitCommit, repo: GitRepository,
      id: ptr GitOid): cint {.importc, header: hdr.}
  proc git_commit_free(commit: GitCommit) {.importc, header: hdr.}
  proc git_commit_id(commit: GitCommit): ptr GitOid {.importc, header: hdr.}
  proc git_commit_parentcount(commit: GitCommit): cuint {.importc, header: hdr.}
  proc git_commit_parent_id(commit: GitCommit, n: cuint): ptr GitOid {.importc, header: hdr.}
  proc git_commit_parent(outParent: ptr GitCommit, commit: GitCommit,
      n: cuint): cint {.importc, header: hdr.}
  proc git_commit_author(commit: GitCommit): ptr GitSignature {.importc, header: hdr.}
  proc git_commit_time(commit: GitCommit): int64 {.importc, header: hdr.}
  proc git_commit_message(commit: GitCommit): cstring {.importc, header: hdr.}
  proc git_commit_summary(commit: GitCommit): cstring {.importc, header: hdr.}
  proc git_commit_tree(outTree: ptr GitTree, commit: GitCommit): cint {.importc, header: hdr.}

  proc git_tree_free(tree: GitTree) {.importc, header: hdr.}
  proc git_tree_entry_bypath(outEntry: ptr GitTreeEntry, root: GitTree,
      path: cstring): cint {.importc, header: hdr.}
  proc git_tree_entry_id(entry: GitTreeEntry): ptr GitOid {.importc, header: hdr.}
  proc git_tree_entry_free(entry: GitTreeEntry) {.importc, header: hdr.}

  proc git_blob_lookup(outBlob: ptr GitBlob, repo: GitRepository,
      id: ptr GitOid): cint {.importc, header: hdr.}
  proc git_blob_rawcontent(blob: GitBlob): cstring {.importc, header: hdr.}
  proc git_blob_rawsize(blob: GitBlob): int64 {.importc, header: hdr.}
  proc git_blob_is_binary(blob: GitBlob): cint {.importc, header: hdr.}
  proc git_blob_free(blob: GitBlob) {.importc, header: hdr.}

  proc git_diff_options_init(opts: ptr GitDiffOptions,
      version: cuint): cint {.importc, header: hdr.}
  proc git_diff_find_options_init(opts: ptr GitDiffFindOptions,
      version: cuint): cint {.importc, header: hdr.}
  proc git_diff_tree_to_tree(outDiff: ptr GitDiff, repo: GitRepository,
      oldTree, newTree: GitTree, opts: ptr GitDiffOptions): cint {.importc, header: hdr.}
  proc git_diff_tree_to_index(outDiff: ptr GitDiff, repo: GitRepository,
      oldTree: GitTree, index: GitIndex, opts: ptr GitDiffOptions): cint {.importc, header: hdr.}
  proc git_diff_index_to_workdir(outDiff: ptr GitDiff, repo: GitRepository,
      index: GitIndex, opts: ptr GitDiffOptions): cint {.importc, header: hdr.}
  proc git_diff_find_similar(diff: GitDiff,
      opts: ptr GitDiffFindOptions): cint {.importc, header: hdr.}
  proc git_diff_num_deltas(diff: GitDiff): csize_t {.importc, header: hdr.}
  proc git_diff_get_delta(diff: GitDiff, idx: csize_t): ptr GitDiffDelta {.importc, header: hdr.}
  proc git_diff_free(diff: GitDiff) {.importc, header: hdr.}

  proc git_patch_from_diff(outPatch: ptr GitPatch, diff: GitDiff,
      idx: csize_t): cint {.importc, header: hdr.}
  proc git_patch_free(patch: GitPatch) {.importc, header: hdr.}
  proc git_patch_get_delta(patch: GitPatch): ptr GitDiffDelta {.importc, header: hdr.}
  proc git_patch_num_hunks(patch: GitPatch): csize_t {.importc, header: hdr.}
  proc git_patch_line_stats(totalContext, totalAdditions, totalDeletions: ptr csize_t,
      patch: GitPatch): cint {.importc, header: hdr.}
  proc git_patch_get_hunk(outHunk: ptr ptr GitDiffHunk, linesInHunk: ptr csize_t,
      patch: GitPatch, hunkIdx: csize_t): cint {.importc, header: hdr.}
  proc git_patch_get_line_in_hunk(outLine: ptr ptr GitDiffLine, patch: GitPatch,
      hunkIdx, lineIdx: csize_t): cint {.importc, header: hdr.}

  proc git_blame_options_init(opts: ptr GitBlameOptions,
      version: cuint): cint {.importc, header: hdr.}
  proc git_blame_file(outBlame: ptr GitBlame, repo: GitRepository,
      path: cstring, opts: ptr GitBlameOptions): cint {.importc, header: hdr.}
  proc git_blame_hunkcount(blame: GitBlame): csize_t {.importc, header: hdr.}
  proc git_blame_hunk_byindex(blame: GitBlame,
      index: csize_t): ptr GitBlameHunk {.importc, header: hdr.}
  proc git_blame_free(blame: GitBlame) {.importc, header: hdr.}

  proc git_worktree_list(outArr: ptr GitStrarray,
      repo: GitRepository): cint {.importc, header: hdr.}
  proc git_worktree_lookup(outWt: ptr GitWorktree, repo: GitRepository,
      name: cstring): cint {.importc, header: hdr.}
  proc git_worktree_path(wt: GitWorktree): cstring {.importc, header: hdr.}
  proc git_worktree_is_locked(reason: ptr GitBuf,
      wt: GitWorktree): cint {.importc, header: hdr.}
  proc git_worktree_free(wt: GitWorktree) {.importc, header: hdr.}

  # --- initialisation & helpers --------------------------------------------

  var
    initLockObj: Lock
    initialized = false

  initLock(initLockObj)

  proc ensureInit*() =
    acquire(initLockObj)
    if not initialized:
      discard git_libgit2_init()
      initialized = true
    release(initLockObj)

  proc lastGitErr(): string =
    let err = git_error_last()
    if err != nil and err.message != nil:
      $err.message
    else:
      "libgit2 error"

  proc oidHex(id: ptr GitOid): string =
    if id == nil:
      return ""
    var buf: array[41, char]
    discard git_oid_tostr(cast[cstring](addr buf[0]), 41, id)
    $cast[cstring](addr buf[0])

  proc oidHex(id: GitOid): string =
    var copy = id
    oidHex(addr copy)

  proc safeStr(p: cstring): string =
    if p == nil: "" else: $p

  proc sanitizeUtf8Local(s: string): string =
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

  proc deltaStatusChar(status: cint): string =
    case status
    of GIT_DELTA_ADDED, GIT_DELTA_UNTRACKED: "A"
    of GIT_DELTA_DELETED: "D"
    of GIT_DELTA_RENAMED: "R"
    of GIT_DELTA_COPIED: "C"
    of GIT_DELTA_CONFLICTED: "U"
    else: "M"

  proc openRepo(repoPath: string): tuple[repo: GitRepository, err: string] =
    ensureInit()
    var r: GitRepository = nil
    let rc = git_repository_open_ext(addr r, repoPath.cstring,
                                     GIT_REPOSITORY_OPEN_NO_SEARCH, nil)
    if rc != 0 or r == nil:
      return (nil, lastGitErr())
    (r, "")

  proc headTreeOf(repo: GitRepository): GitTree =
    var headRef: GitReference = nil
    if git_repository_head(addr headRef, repo) != 0 or headRef == nil:
      return nil
    defer: git_reference_free(headRef)
    var obj: GitObject = nil
    if git_reference_peel(addr obj, headRef, GIT_OBJECT_TREE) != 0 or obj == nil:
      return nil
    cast[GitTree](obj)

  proc stripTrailingNewline(s: string): string =
    result = s
    if result.len > 0 and result[^1] == '\n':
      result.setLen(result.len - 1)
    if result.len > 0 and result[^1] == '\r':
      result.setLen(result.len - 1)

  # --- status --------------------------------------------------------------

  proc statusOfLib*(repoPath: string): Repo =
    ## In-process repository status via libgit2 (docs/04 §3.2).
    result.path = normalizePath(repoPath)
    result.name = repoPath.lastPathPart
    result.id = repoId(repoPath)
    result.lang = langOf(result.name)
    result.ahead = -1
    result.behind = -1

    let opened = openRepo(repoPath)
    if opened.repo == nil:
      result.error = opened.err
      return
    let repo = opened.repo
    defer: git_repository_free(repo)

    let detached = git_repository_head_detached(repo) == 1
    let unborn = git_repository_head_unborn(repo) == 1
    result.detached = detached

    if unborn:
      var rawHead: GitReference = nil
      if git_reference_lookup(addr rawHead, repo, "HEAD") == 0 and rawHead != nil:
        defer: git_reference_free(rawHead)
        let target = safeStr(git_reference_symbolic_target(rawHead))
        if target.startsWith("refs/heads/"):
          result.branch = target["refs/heads/".len .. ^1]
    else:
      var headRef: GitReference = nil
      if git_repository_head(addr headRef, repo) == 0 and headRef != nil:
        defer: git_reference_free(headRef)
        let oid = git_reference_target(headRef)
        if oid != nil:
          let fullHex = oidHex(oid)
          result.head = if fullHex.len >= 7: fullHex[0 ..< 7] else: fullHex
          var commit: GitCommit = nil
          if git_commit_lookup(addr commit, repo, oid) == 0 and commit != nil:
            result.lastCommitAt = git_commit_time(commit) * 1000
            git_commit_free(commit)
        if not detached:
          result.branch = safeStr(git_reference_shorthand(headRef))
          var upRef: GitReference = nil
          if git_branch_upstream(addr upRef, headRef) == 0 and upRef != nil:
            defer: git_reference_free(upRef)
            let upOid = git_reference_target(upRef)
            if oid != nil and upOid != nil:
              var ahead, behind: csize_t = 0
              if git_graph_ahead_behind(addr ahead, addr behind, repo,
                                        oid, upOid) == 0:
                result.ahead = ahead.int
                result.behind = behind.int

    var opts: GitStatusOptions
    discard git_status_options_init(addr opts, GIT_STATUS_OPTIONS_VERSION)
    opts.show = GIT_STATUS_SHOW_INDEX_AND_WORKDIR
    opts.flags = GIT_STATUS_OPT_INCLUDE_UNTRACKED or
                 GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS or
                 GIT_STATUS_OPT_RENAMES_HEAD_TO_INDEX

    var list: GitStatusList = nil
    if git_status_list_new(addr list, repo, addr opts) != 0 or list == nil:
      result.error = lastGitErr()
      return
    defer: git_status_list_free(list)

    let count = git_status_list_entrycount(list)
    for idx in 0'u ..< count:
      let entry = git_status_byindex(list, idx)
      if entry == nil:
        continue
      let st = entry.status
      if (st and GIT_STATUS_CONFLICTED) != 0:
        inc result.dirty.conflicted
        continue
      if (st and (GIT_STATUS_INDEX_NEW or GIT_STATUS_INDEX_MODIFIED or
                  GIT_STATUS_INDEX_DELETED or GIT_STATUS_INDEX_RENAMED or
                  GIT_STATUS_INDEX_TYPECHANGE)) != 0:
        inc result.dirty.staged
      if (st and (GIT_STATUS_WT_MODIFIED or GIT_STATUS_WT_DELETED or
                  GIT_STATUS_WT_TYPECHANGE or GIT_STATUS_WT_RENAMED)) != 0:
        inc result.dirty.unstaged
      if (st and GIT_STATUS_WT_NEW) != 0:
        inc result.dirty.untracked

  # --- statusEntries -------------------------------------------------------

  type LineStats = tuple[additions, deletions: int, binary: bool]

  proc collectDiffStats(diff: GitDiff): Table[string, LineStats] =
    if diff == nil:
      return
    let n = git_diff_num_deltas(diff)
    for i in 0'u ..< n:
      let delta = git_diff_get_delta(diff, i)
      if delta == nil:
        continue
      let p = safeStr(delta.new_file.path)
      let key = if p.len > 0: p else: safeStr(delta.old_file.path)
      if (delta.flags and GIT_DIFF_FLAG_BINARY) != 0:
        result[key] = (0, 0, true)
        continue
      var patch: GitPatch = nil
      if git_patch_from_diff(addr patch, diff, i) == 0 and patch != nil:
        defer: git_patch_free(patch)
        let pDelta = git_patch_get_delta(patch)
        if pDelta != nil and (pDelta.flags and GIT_DIFF_FLAG_BINARY) != 0:
          result[key] = (0, 0, true)
        else:
          var ctx, adds, dels: csize_t = 0
          discard git_patch_line_stats(addr ctx, addr adds, addr dels, patch)
          result[key] = (adds.int, dels.int, false)

  proc countUntrackedFile(repoPath, relPath: string): LineStats =
    let full = repoPath / relPath
    if not fileExists(full):
      return (0, 0, false)
    try:
      let data = readFile(full)
      if data.len > 0 and '\0' in data:
        return (0, 0, true)
      var lines = data.count('\n')
      if data.len > 0 and not data.endsWith("\n"):
        inc lines
      (lines, 0, false)
    except CatchableError:
      (0, 0, false)

  proc statusEntriesLib*(repoPath: string): seq[FileEntry] =
    ## Detailed staged/unstaged/untracked/conflicted entries with +/- stats.
    let opened = openRepo(repoPath)
    if opened.repo == nil:
      return @[]
    let repo = opened.repo
    defer: git_repository_free(repo)

    var opts: GitStatusOptions
    discard git_status_options_init(addr opts, GIT_STATUS_OPTIONS_VERSION)
    opts.show = GIT_STATUS_SHOW_INDEX_AND_WORKDIR
    opts.flags = GIT_STATUS_OPT_INCLUDE_UNTRACKED or
                 GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS or
                 GIT_STATUS_OPT_RENAMES_HEAD_TO_INDEX

    var list: GitStatusList = nil
    if git_status_list_new(addr list, repo, addr opts) != 0 or list == nil:
      return @[]
    defer: git_status_list_free(list)

    # Staged & unstaged numstat via in-process libgit2 diffs.
    var stagedMap: Table[string, LineStats]
    var unstagedMap: Table[string, LineStats]
    var diffOpts: GitDiffOptions
    discard git_diff_options_init(addr diffOpts, GIT_DIFF_OPTIONS_VERSION)
    var findOpts: GitDiffFindOptions
    discard git_diff_find_options_init(addr findOpts, GIT_DIFF_FIND_OPTIONS_VERSION)
    findOpts.flags = GIT_DIFF_FIND_RENAMES

    let headTree = headTreeOf(repo)
    defer:
      if headTree != nil: git_tree_free(headTree)
    var stagedDiff: GitDiff = nil
    if git_diff_tree_to_index(addr stagedDiff, repo, headTree, nil, addr diffOpts) == 0 and
        stagedDiff != nil:
      defer: git_diff_free(stagedDiff)
      discard git_diff_find_similar(stagedDiff, addr findOpts)
      stagedMap = collectDiffStats(stagedDiff)

    var unstagedDiff: GitDiff = nil
    if git_diff_index_to_workdir(addr unstagedDiff, repo, nil, addr diffOpts) == 0 and
        unstagedDiff != nil:
      defer: git_diff_free(unstagedDiff)
      discard git_diff_find_similar(unstagedDiff, addr findOpts)
      unstagedMap = collectDiffStats(unstagedDiff)

    let count = git_status_list_entrycount(list)
    for idx in 0'u ..< count:
      let entry = git_status_byindex(list, idx)
      if entry == nil:
        continue
      let st = entry.status
      if (st and GIT_STATUS_CONFLICTED) != 0:
        let delta = if entry.index_to_workdir != nil: entry.index_to_workdir
                    else: entry.head_to_index
        if delta != nil:
          let p = safeStr(delta.new_file.path)
          let path = if p.len > 0: p else: safeStr(delta.old_file.path)
          result.add FileEntry(path: path, status: "U", group: "unstaged",
                               conflict: true)
        continue

      if (st and GIT_STATUS_WT_NEW) != 0 and entry.index_to_workdir != nil:
        let path = safeStr(entry.index_to_workdir.new_file.path)
        let stats = countUntrackedFile(repoPath, path)
        result.add FileEntry(path: path, status: "A", group: "unstaged",
                             additions: stats.additions, deletions: 0,
                             binary: stats.binary, untracked: true)
        continue

      if (st and (GIT_STATUS_INDEX_NEW or GIT_STATUS_INDEX_MODIFIED or
                  GIT_STATUS_INDEX_DELETED or GIT_STATUS_INDEX_RENAMED or
                  GIT_STATUS_INDEX_TYPECHANGE)) != 0 and entry.head_to_index != nil:
        let d = entry.head_to_index
        let path = if safeStr(d.new_file.path).len > 0: safeStr(d.new_file.path)
                   else: safeStr(d.old_file.path)
        let oldPath = if d.status == GIT_DELTA_RENAMED or d.status == GIT_DELTA_COPIED:
                        safeStr(d.old_file.path)
                      else: ""
        var fe = FileEntry(path: path, oldPath: oldPath,
                           status: deltaStatusChar(d.status), group: "staged")
        if stagedMap.hasKey(path):
          fe.additions = stagedMap[path].additions
          fe.deletions = stagedMap[path].deletions
          fe.binary = stagedMap[path].binary
        result.add fe

      if (st and (GIT_STATUS_WT_MODIFIED or GIT_STATUS_WT_DELETED or
                  GIT_STATUS_WT_TYPECHANGE or GIT_STATUS_WT_RENAMED)) != 0 and
          entry.index_to_workdir != nil:
        let d = entry.index_to_workdir
        let path = if safeStr(d.new_file.path).len > 0: safeStr(d.new_file.path)
                   else: safeStr(d.old_file.path)
        let oldPath = if d.status == GIT_DELTA_RENAMED or d.status == GIT_DELTA_COPIED:
                        safeStr(d.old_file.path)
                      else: ""
        var fe = FileEntry(path: path, oldPath: oldPath,
                           status: deltaStatusChar(d.status), group: "unstaged")
        if unstagedMap.hasKey(path):
          fe.additions = unstagedMap[path].additions
          fe.deletions = unstagedMap[path].deletions
          fe.binary = unstagedMap[path].binary
        result.add fe

    result.sort(proc(a, b: FileEntry): int =
      let ga = if a.group == "staged": 0 else: 1
      let gb = if b.group == "staged": 0 else: 1
      if ga != gb: cmp(ga, gb) else: cmp(a.path, b.path))

  # --- refs ----------------------------------------------------------------

  proc refsOfLib*(repoPath: string): seq[tuple[name, typ, target: string]] =
    ## List local branches, remotes and tags in-process.
    let opened = openRepo(repoPath)
    if opened.repo == nil:
      return @[]
    let repo = opened.repo
    defer: git_repository_free(repo)

    var iter: GitReferenceIterator = nil
    if git_reference_iterator_new(addr iter, repo) != 0 or iter == nil:
      return @[]
    defer: git_reference_iterator_free(iter)

    var refObj: GitReference = nil
    while git_reference_next(addr refObj, iter) == 0:
      if refObj == nil:
        continue
      let fullName = safeStr(git_reference_name(refObj))
      var resolved: GitReference = nil
      var targetHex = ""
      if git_reference_resolve(addr resolved, refObj) == 0 and resolved != nil:
        let oid = git_reference_target(resolved)
        targetHex = oidHex(oid)
        git_reference_free(resolved)
      git_reference_free(refObj)
      refObj = nil

      var typ = ""
      var display = fullName
      if fullName.startsWith("refs/heads/"):
        typ = "branch"
        display = fullName["refs/heads/".len .. ^1]
      elif fullName.startsWith("refs/remotes/"):
        typ = "remote"
        display = fullName["refs/remotes/".len .. ^1]
      elif fullName.startsWith("refs/tags/"):
        typ = "tag"
        display = fullName["refs/tags/".len .. ^1]
      else:
        continue
      result.add (display, typ, targetHex)

  # --- log / revwalk -------------------------------------------------------

  proc buildRefLookup(repo: GitRepository): Table[string, seq[string]] =
    var iter: GitReferenceIterator = nil
    if git_reference_iterator_new(addr iter, repo) != 0 or iter == nil:
      return
    defer: git_reference_iterator_free(iter)
    var refObj: GitReference = nil
    while git_reference_next(addr refObj, iter) == 0:
      if refObj == nil:
        continue
      let fullName = safeStr(git_reference_name(refObj))
      var targetHex = ""
      var peeled: GitObject = nil
      if git_reference_peel(addr peeled, refObj, GIT_OBJECT_COMMIT) == 0 and peeled != nil:
        targetHex = oidHex(git_object_id(peeled))
        git_object_free(peeled)
      else:
        var resolved: GitReference = nil
        if git_reference_resolve(addr resolved, refObj) == 0 and resolved != nil:
          targetHex = oidHex(git_reference_target(resolved))
          git_reference_free(resolved)
      git_reference_free(refObj)
      refObj = nil
      if targetHex.len == 0:
        continue
      var display = ""
      if fullName.startsWith("refs/heads/"):
        display = fullName["refs/heads/".len .. ^1]
      elif fullName.startsWith("refs/remotes/"):
        display = fullName["refs/remotes/".len .. ^1]
      elif fullName.startsWith("refs/tags/"):
        display = "tag: " & fullName["refs/tags/".len .. ^1]
      else:
        continue
      result.mgetOrPut(targetHex, @[]).add display

  proc rankRef(name: string): int =
    if name.startsWith("HEAD"): 0
    elif name.startsWith("tag:"): 2
    elif '/' in name: 1
    else: 3

  proc logOfLib*(repoPath: string, limit: int, branch = "",
                 allBranches = false, cursor = ""): tuple[commits: seq[Commit],
                 hasMore: bool, nextCursor: string] =
    ## In-process revwalk with topological+time ordering and cursor pagination.
    let opened = openRepo(repoPath)
    if opened.repo == nil:
      return
    let repo = opened.repo
    defer: git_repository_free(repo)

    var walk: GitRevwalk = nil
    if git_revwalk_new(addr walk, repo) != 0 or walk == nil:
      return
    defer: git_revwalk_free(walk)

    discard git_revwalk_sorting(walk, GIT_SORT_TOPOLOGICAL or GIT_SORT_TIME)

    var pushed = false
    if allBranches:
      var iter: GitReferenceIterator = nil
      if git_reference_iterator_new(addr iter, repo) == 0 and iter != nil:
        defer: git_reference_iterator_free(iter)
        var refObj: GitReference = nil
        while git_reference_next(addr refObj, iter) == 0:
          if refObj == nil:
            continue
          var peeled: GitObject = nil
          if git_reference_peel(addr peeled, refObj, GIT_OBJECT_COMMIT) == 0 and peeled != nil:
            if git_revwalk_push(walk, git_object_id(peeled)) == 0:
              pushed = true
            git_object_free(peeled)
          git_reference_free(refObj)
          refObj = nil
    elif branch.len > 0:
      var obj: GitObject = nil
      if git_revparse_single(addr obj, repo, branch.cstring) == 0 and obj != nil:
        defer: git_object_free(obj)
        var peeled: GitObject = nil
        if git_object_peel(addr peeled, obj, GIT_OBJECT_COMMIT) == 0 and peeled != nil:
          defer: git_object_free(peeled)
          if git_revwalk_push(walk, git_object_id(peeled)) == 0:
            pushed = true
    else:
      if git_revwalk_push_head(walk) == 0:
        pushed = true

    if not pushed:
      return

    let refLookup = buildRefLookup(repo)
    var headHex = ""
    var headName = ""
    if git_repository_head_unborn(repo) != 1:
      var headRef: GitReference = nil
      if git_repository_head(addr headRef, repo) == 0 and headRef != nil:
        defer: git_reference_free(headRef)
        headHex = oidHex(git_reference_target(headRef))
        if git_repository_head_detached(repo) == 1:
          headName = "HEAD"
        else:
          let shortName = safeStr(git_reference_shorthand(headRef))
          headName = if shortName.len > 0: "HEAD -> " & shortName else: "HEAD"

    var skipping = cursor.len > 0
    var oid: GitOid
    let targetLimit = max(1, limit)
    while git_revwalk_next(addr oid, walk) == 0:
      let hex = oidHex(addr oid)
      if skipping:
        if hex == cursor or hex.startsWith(cursor):
          skipping = false
        continue
      if result.commits.len >= targetLimit:
        result.hasMore = true
        break

      var commit: GitCommit = nil
      if git_commit_lookup(addr commit, repo, addr oid) != 0 or commit == nil:
        continue
      var c = Commit(
        hash: hex,
        shortHash: if hex.len >= 7: hex[0 ..< 7] else: hex,
      )
      let pcount = git_commit_parentcount(commit)
      for pIdx in 0'u32 ..< pcount:
        let pid = git_commit_parent_id(commit, pIdx)
        if pid != nil:
          c.parents.add oidHex(pid)

      let author = git_commit_author(commit)
      if author != nil:
        c.authorName = sanitizeUtf8Local(safeStr(author.name))
        c.authorEmail = sanitizeUtf8Local(safeStr(author.email))
        c.committedAt = author.`when`.time * 1000
      else:
        c.committedAt = git_commit_time(commit) * 1000

      let rawMsg = sanitizeUtf8Local(safeStr(git_commit_message(commit)))
      let nl = rawMsg.find('\n')
      if nl >= 0:
        c.subject = rawMsg[0 ..< nl].strip(leading = false, trailing = true, chars = {'\r'})
        c.body = rawMsg[nl + 1 .. ^1].strip()
      else:
        c.subject = rawMsg.strip(leading = false, trailing = true, chars = {'\r'})
        c.body = ""
      if c.subject.len > 300:
        c.subject = c.subject[0 ..< 300] & "…"
      if c.body.len > 600:
        c.body = c.body[0 ..< 600] & "…"

      if refLookup.hasKey(hex):
        c.refs = refLookup[hex]
      if headHex.len > 0 and hex == headHex and headName.len > 0:
        if headName notin c.refs:
          c.refs.insert(headName, 0)
        if headName.startsWith("HEAD -> "):
          let bName = headName["HEAD -> ".len .. ^1]
          var kept: seq[string]
          for r in c.refs:
            if r != bName:
              kept.add r
          c.refs = kept
      if c.refs.len > 1:
        c.refs.sort(proc(a, b: string): int = cmp(rankRef(a), rankRef(b)))

      git_commit_free(commit)
      result.commits.add c

    if result.hasMore and result.commits.len > 0:
      result.nextCursor = result.commits[^1].hash

  # --- commitFiles ---------------------------------------------------------

  proc commitFilesLib*(repoPath, hash: string): seq[FileEntry] =
    ## Files changed by a commit (first-parent diff for merge commits).
    let opened = openRepo(repoPath)
    if opened.repo == nil:
      return @[]
    let repo = opened.repo
    defer: git_repository_free(repo)

    var obj: GitObject = nil
    if git_revparse_single(addr obj, repo, hash.cstring) != 0 or obj == nil:
      return @[]
    defer: git_object_free(obj)
    var peeled: GitObject = nil
    if git_object_peel(addr peeled, obj, GIT_OBJECT_COMMIT) != 0 or peeled == nil:
      return @[]
    let commit = cast[GitCommit](peeled)
    defer: git_commit_free(commit)

    var newTree: GitTree = nil
    if git_commit_tree(addr newTree, commit) != 0 or newTree == nil:
      return @[]
    defer: git_tree_free(newTree)

    var oldTree: GitTree = nil
    if git_commit_parentcount(commit) > 0:
      var parent: GitCommit = nil
      if git_commit_parent(addr parent, commit, 0) == 0 and parent != nil:
        discard git_commit_tree(addr oldTree, parent)
        git_commit_free(parent)
    defer:
      if oldTree != nil: git_tree_free(oldTree)

    var opts: GitDiffOptions
    discard git_diff_options_init(addr opts, GIT_DIFF_OPTIONS_VERSION)
    var diff: GitDiff = nil
    if git_diff_tree_to_tree(addr diff, repo, oldTree, newTree, addr opts) != 0 or diff == nil:
      return @[]
    defer: git_diff_free(diff)

    var findOpts: GitDiffFindOptions
    discard git_diff_find_options_init(addr findOpts, GIT_DIFF_FIND_OPTIONS_VERSION)
    findOpts.flags = GIT_DIFF_FIND_RENAMES
    discard git_diff_find_similar(diff, addr findOpts)

    let stats = collectDiffStats(diff)
    let n = git_diff_num_deltas(diff)
    for i in 0'u ..< n:
      let d = git_diff_get_delta(diff, i)
      if d == nil:
        continue
      let path = if safeStr(d.new_file.path).len > 0: safeStr(d.new_file.path)
                 else: safeStr(d.old_file.path)
      let oldPath = if d.status == GIT_DELTA_RENAMED or d.status == GIT_DELTA_COPIED:
                      safeStr(d.old_file.path)
                    else: ""
      var fe = FileEntry(path: path, oldPath: oldPath,
                         status: deltaStatusChar(d.status), group: "commit")
      if stats.hasKey(path):
        fe.additions = stats[path].additions
        fe.deletions = stats[path].deletions
        fe.binary = stats[path].binary
      elif (d.flags and GIT_DIFF_FLAG_BINARY) != 0:
        fe.binary = true
      result.add fe

  # --- diff ----------------------------------------------------------------

  proc patchToDiffFile(patch: GitPatch, fallbackPath: string): DiffFile =
    result = DiffFile(size: -1, path: fallbackPath, oldPath: fallbackPath, status: "M")
    let delta = git_patch_get_delta(patch)
    if delta != nil:
      let np = safeStr(delta.new_file.path)
      let op = safeStr(delta.old_file.path)
      result.path = if np.len > 0: np else: (if op.len > 0: op else: fallbackPath)
      result.oldPath = if op.len > 0: op else: result.path
      result.status = deltaStatusChar(delta.status)
      if (delta.flags and GIT_DIFF_FLAG_BINARY) != 0:
        result.binary = true
        result.size = int64(max(delta.new_file.size, delta.old_file.size))
        return
    let nHunks = git_patch_num_hunks(patch)
    for hi in 0'u ..< nHunks:
      var hunkPtr: ptr GitDiffHunk = nil
      var lineCount: csize_t = 0
      if git_patch_get_hunk(addr hunkPtr, addr lineCount, patch, hi) != 0 or hunkPtr == nil:
        continue
      var headerStr = newString(hunkPtr.header_len.int)
      if hunkPtr.header_len > 0:
        copyMem(addr headerStr[0], addr hunkPtr.header[0], hunkPtr.header_len.int)
      headerStr = sanitizeUtf8Local(stripTrailingNewline(headerStr))
      var h = Hunk(
        header: headerStr,
        oldStart: hunkPtr.old_start.int,
        oldLines: hunkPtr.old_lines.int,
        newStart: hunkPtr.new_start.int,
        newLines: hunkPtr.new_lines.int,
      )
      for li in 0'u ..< lineCount:
        var linePtr: ptr GitDiffLine = nil
        if git_patch_get_line_in_hunk(addr linePtr, patch, hi, li) != 0 or linePtr == nil:
          continue
        let origin = linePtr.origin
        if origin notin {' ', '+', '-'}:
          continue   # skip EOFNL markers ('>', '<', '=')
        var text = newString(linePtr.content_len.int)
        if linePtr.content_len > 0 and linePtr.content != nil:
          copyMem(addr text[0], linePtr.content, linePtr.content_len.int)
        text = sanitizeUtf8Local(stripTrailingNewline(text))
        var row = DiffRow(
          t: (if origin == '+': "add" elif origin == '-': "del" else: "ctx"),
          oldNo: (if linePtr.old_lineno > 0: linePtr.old_lineno.int else: 0),
          newNo: (if linePtr.new_lineno > 0: linePtr.new_lineno.int else: 0),
          text: text,
        )
        if origin == '+':
          inc result.additions
        elif origin == '-':
          inc result.deletions
        h.rows.add row
      result.hunks.add h

  proc diffOfCommitLib*(repoPath, hash, filePath: string,
                        ignoreWhitespace = false,
                        contextLines = 3): DiffFile =
    ## In-process commit diff for one file (caller applies word highlights).
    result = DiffFile(size: -1, path: filePath, oldPath: filePath, status: "M")
    let opened = openRepo(repoPath)
    if opened.repo == nil:
      return
    let repo = opened.repo
    defer: git_repository_free(repo)

    var obj: GitObject = nil
    if git_revparse_single(addr obj, repo, hash.cstring) != 0 or obj == nil:
      return
    defer: git_object_free(obj)
    var peeled: GitObject = nil
    if git_object_peel(addr peeled, obj, GIT_OBJECT_COMMIT) != 0 or peeled == nil:
      return
    let commit = cast[GitCommit](peeled)
    defer: git_commit_free(commit)

    var newTree: GitTree = nil
    if git_commit_tree(addr newTree, commit) != 0 or newTree == nil:
      return
    defer: git_tree_free(newTree)

    var oldTree: GitTree = nil
    if git_commit_parentcount(commit) > 0:
      var parent: GitCommit = nil
      if git_commit_parent(addr parent, commit, 0) == 0 and parent != nil:
        discard git_commit_tree(addr oldTree, parent)
        git_commit_free(parent)
    defer:
      if oldTree != nil: git_tree_free(oldTree)

    var opts: GitDiffOptions
    discard git_diff_options_init(addr opts, GIT_DIFF_OPTIONS_VERSION)
    opts.context_lines = uint32(max(0, contextLines))
    opts.interhunk_lines = 0
    if ignoreWhitespace:
      opts.flags = opts.flags or GIT_DIFF_IGNORE_WHITESPACE

    # Do full tree-to-tree first only if we need rename detection, otherwise pathspec filter.
    # Tree diffs in-process are sub-millisecond so running find_similar accurately catches renames.
    var diff: GitDiff = nil
    if git_diff_tree_to_tree(addr diff, repo, oldTree, newTree, addr opts) != 0 or diff == nil:
      return
    defer: git_diff_free(diff)

    var findOpts: GitDiffFindOptions
    discard git_diff_find_options_init(addr findOpts, GIT_DIFF_FIND_OPTIONS_VERSION)
    findOpts.flags = GIT_DIFF_FIND_RENAMES
    discard git_diff_find_similar(diff, addr findOpts)

    let n = git_diff_num_deltas(diff)
    for i in 0'u ..< n:
      let d = git_diff_get_delta(diff, i)
      if d == nil:
        continue
      let np = safeStr(d.new_file.path)
      let op = safeStr(d.old_file.path)
      if filePath.len == 0 or np == filePath or op == filePath:
        var patch: GitPatch = nil
        if git_patch_from_diff(addr patch, diff, i) == 0 and patch != nil:
          defer: git_patch_free(patch)
          return patchToDiffFile(patch, filePath)
        break

  proc diffOfUntrackedLib(repoPath, filePath: string): DiffFile =
    result = DiffFile(size: -1, path: filePath, oldPath: filePath, status: "A")
    let full = repoPath / filePath
    if not fileExists(full):
      return
    try:
      let raw = readFile(full)
      result.size = raw.len.int64
      if raw.len > 0 and '\0' in raw:
        result.binary = true
        return
      if raw.len == 0:
        return
      var text = raw
      if text.endsWith("\n"):
        text.setLen(text.len - 1)
      let lines = text.split('\n')
      var h = Hunk(
        header: "@@ -0,0 +1," & $lines.len & " @@",
        oldStart: 0, oldLines: 0,
        newStart: 1, newLines: lines.len,
      )
      for idx, rawLine in lines:
        var line = rawLine
        if line.len > 0 and line[^1] == '\r':
          line.setLen(line.len - 1)
        h.rows.add DiffRow(t: "add", newNo: idx + 1,
                           text: sanitizeUtf8Local(line))
      result.additions = lines.len
      result.hunks.add h
    except CatchableError:
      discard

  proc diffOfWorkdirLib*(repoPath, filePath: string, staged, untracked: bool,
                         ignoreWhitespace = false,
                         contextLines = 3): DiffFile =
    ## In-process staged / unstaged / untracked diff for one file.
    if untracked:
      return diffOfUntrackedLib(repoPath, filePath)

    result = DiffFile(size: -1, path: filePath, oldPath: filePath, status: "M")
    let opened = openRepo(repoPath)
    if opened.repo == nil:
      return
    let repo = opened.repo
    defer: git_repository_free(repo)

    var opts: GitDiffOptions
    discard git_diff_options_init(addr opts, GIT_DIFF_OPTIONS_VERSION)
    opts.context_lines = uint32(max(0, contextLines))
    opts.interhunk_lines = 0
    opts.flags = GIT_DIFF_INCLUDE_TYPECHANGE
    if ignoreWhitespace:
      opts.flags = opts.flags or GIT_DIFF_IGNORE_WHITESPACE

    var pathCstr = filePath.cstring
    var pathArr = [pathCstr]
    if filePath.len > 0 and not staged:
      opts.pathspec.strings = cast[ptr UncheckedArray[cstring]](addr pathArr[0])
      opts.pathspec.count = 1
      opts.flags = opts.flags or GIT_DIFF_DISABLE_PATHSPEC_MATCH

    var diff: GitDiff = nil
    if staged:
      let headTree = headTreeOf(repo)
      defer:
        if headTree != nil: git_tree_free(headTree)
      if git_diff_tree_to_index(addr diff, repo, headTree, nil, addr opts) != 0 or diff == nil:
        return
    else:
      if git_diff_index_to_workdir(addr diff, repo, nil, addr opts) != 0 or diff == nil:
        return
    defer: git_diff_free(diff)

    if staged:
      var findOpts: GitDiffFindOptions
      discard git_diff_find_options_init(addr findOpts, GIT_DIFF_FIND_OPTIONS_VERSION)
      findOpts.flags = GIT_DIFF_FIND_RENAMES
      discard git_diff_find_similar(diff, addr findOpts)

    let n = git_diff_num_deltas(diff)
    for i in 0'u ..< n:
      let d = git_diff_get_delta(diff, i)
      if d == nil:
        continue
      let np = safeStr(d.new_file.path)
      let op = safeStr(d.old_file.path)
      if filePath.len == 0 or np == filePath or op == filePath:
        var patch: GitPatch = nil
        if git_patch_from_diff(addr patch, diff, i) == 0 and patch != nil:
          defer: git_patch_free(patch)
          return patchToDiffFile(patch, filePath)
        break

  # --- blame ---------------------------------------------------------------

  proc readFileLinesAt(repo: GitRepository, repoPath, filePath, hash: string): seq[string] =
    var raw = ""
    if hash.len > 0:
      var obj: GitObject = nil
      if git_revparse_single(addr obj, repo, hash.cstring) == 0 and obj != nil:
        defer: git_object_free(obj)
        var peeled: GitObject = nil
        if git_object_peel(addr peeled, obj, GIT_OBJECT_TREE) == 0 and peeled != nil:
          let tree = cast[GitTree](peeled)
          defer: git_tree_free(tree)
          var entry: GitTreeEntry = nil
          if git_tree_entry_bypath(addr entry, tree, filePath.cstring) == 0 and entry != nil:
            defer: git_tree_entry_free(entry)
            var blob: GitBlob = nil
            if git_blob_lookup(addr blob, repo, git_tree_entry_id(entry)) == 0 and blob != nil:
              defer: git_blob_free(blob)
              if git_blob_is_binary(blob) == 0:
                let sz = git_blob_rawsize(blob).int
                let content = git_blob_rawcontent(blob)
                if sz > 0 and content != nil:
                  raw = newString(sz)
                  copyMem(addr raw[0], content, sz)
    else:
      let full = repoPath / filePath
      if fileExists(full):
        try:
          let data = readFile(full)
          if not (data.len > 0 and '\0' in data):
            raw = data
        except CatchableError:
          discard
    if raw.len == 0:
      return @[]
    if raw.endsWith("\n"):
      raw.setLen(raw.len - 1)
    for line in raw.split('\n'):
      var clean = line
      if clean.len > 0 and clean[^1] == '\r':
        clean.setLen(clean.len - 1)
      result.add sanitizeUtf8Local(clean)

  proc blameOfLib*(repoPath, filePath: string, hash = "",
                   minLine = 0, maxLine = 0): seq[BlameLine] =
    ## In-process blame with intra-file move/copy tracking (-M -C equivalent).
    let opened = openRepo(repoPath)
    if opened.repo == nil:
      return @[]
    let repo = opened.repo
    defer: git_repository_free(repo)

    let textLines = readFileLinesAt(repo, repoPath, filePath, hash)
    if textLines.len == 0:
      return @[]
    if minLine > textLines.len:
      return @[]

    var opts: GitBlameOptions
    discard git_blame_options_init(addr opts, GIT_BLAME_OPTIONS_VERSION)
    opts.flags = GIT_BLAME_TRACK_COPIES_SAME_FILE or
                 GIT_BLAME_TRACK_COPIES_SAME_COMMIT_MOVES
    if minLine > 1:
      opts.min_line = minLine.csize_t
    if maxLine > 0 and maxLine < textLines.len:
      opts.max_line = maxLine.csize_t
    if hash.len > 0:
      var obj: GitObject = nil
      if git_revparse_single(addr obj, repo, hash.cstring) == 0 and obj != nil:
        var peeled: GitObject = nil
        if git_object_peel(addr peeled, obj, GIT_OBJECT_COMMIT) == 0 and peeled != nil:
          let oid = git_object_id(peeled)
          if oid != nil:
            opts.newest_commit = oid[]
          git_object_free(peeled)
        git_object_free(obj)

    var blame: GitBlame = nil
    if git_blame_file(addr blame, repo, filePath.cstring, addr opts) != 0 or blame == nil:
      return @[]
    defer: git_blame_free(blame)

    var summaryCache: Table[string, string]
    let hCount = git_blame_hunkcount(blame)
    for hi in 0'u ..< hCount:
      let hunk = git_blame_hunk_byindex(blame, hi)
      if hunk == nil:
        continue
      let hex = oidHex(hunk.final_commit_id)
      let shortHex = if hex.len >= 7: hex[0 ..< 7] else: hex
      let author = if hunk.final_signature != nil:
                     sanitizeUtf8Local(safeStr(hunk.final_signature.name))
                   else: ""
      let ts = if hunk.final_signature != nil:
                 hunk.final_signature.`when`.time * 1000
               else: 0'i64
      var summary = ""
      if summaryCache.hasKey(hex):
        summary = summaryCache[hex]
      elif hex.len > 0 and hex != "0000000000000000000000000000000000000000":
        var commit: GitCommit = nil
        var cid = hunk.final_commit_id
        if git_commit_lookup(addr commit, repo, addr cid) == 0 and commit != nil:
          summary = sanitizeUtf8Local(safeStr(git_commit_summary(commit)))
          git_commit_free(commit)
        summaryCache[hex] = summary

      let startLine = hunk.final_start_line_number.int
      let nLines = hunk.lines_in_hunk.int
      for offset in 0 ..< nLines:
        let lineNo = startLine + offset
        let txt = if lineNo >= 1 and lineNo <= textLines.len: textLines[lineNo - 1] else: ""
        result.add BlameLine(
          line: lineNo,
          hash: hex,
          shortHash: shortHex,
          author: author,
          time: ts,
          summary: summary,
          text: txt,
        )

  # --- worktrees -----------------------------------------------------------

  proc worktreesOfLib*(repoPath: string): seq[WorktreeInfo] =
    ## List main + linked worktrees in-process via libgit2.
    let opened = openRepo(repoPath)
    if opened.repo == nil:
      return @[]
    let repo = opened.repo
    defer: git_repository_free(repo)

    # Main worktree entry
    let mainWd = normalizePath(safeStr(git_repository_workdir(repo)))
    var mainBranch = ""
    var mainHead = ""
    if git_repository_head_unborn(repo) != 1:
      var headRef: GitReference = nil
      if git_repository_head(addr headRef, repo) == 0 and headRef != nil:
        defer: git_reference_free(headRef)
        mainHead = oidHex(git_reference_target(headRef))
        if git_repository_head_detached(repo) != 1:
          mainBranch = safeStr(git_reference_shorthand(headRef))
    result.add WorktreeInfo(
      path: if mainWd.len > 0: mainWd else: normalizePath(repoPath),
      branch: mainBranch,
      head: mainHead,
      locked: false,
      isMain: true,
    )

    var names: GitStrarray
    if git_worktree_list(addr names, repo) == 0:
      defer: git_strarray_dispose(addr names)
      for i in 0'u ..< names.count:
        let wname = safeStr(names.strings[i])
        var wt: GitWorktree = nil
        if git_worktree_lookup(addr wt, repo, wname.cstring) != 0 or wt == nil:
          continue
        let wtPath = normalizePath(safeStr(git_worktree_path(wt)))
        var reason: GitBuf
        let locked = git_worktree_is_locked(addr reason, wt) > 0
        git_buf_dispose(addr reason)
        git_worktree_free(wt)

        var wtBranch = ""
        var wtHead = ""
        let wtOpen = openRepo(wtPath)
        if wtOpen.repo != nil:
          var wHead: GitReference = nil
          if git_repository_head(addr wHead, wtOpen.repo) == 0 and wHead != nil:
            wtHead = oidHex(git_reference_target(wHead))
            if git_repository_head_detached(wtOpen.repo) != 1:
              wtBranch = safeStr(git_reference_shorthand(wHead))
            git_reference_free(wHead)
          git_repository_free(wtOpen.repo)
        result.add WorktreeInfo(
          path: wtPath,
          branch: wtBranch,
          head: wtHead,
          locked: locked,
          isMain: false,
        )

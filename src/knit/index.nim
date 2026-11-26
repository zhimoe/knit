## Repo discovery with dirMtimes incremental cache (docs/04 §3.1, docs/07 M1.3).
##
## Deliberately filesystem-only: `git` is never spawned to decide "is this a
## repo". Status is a separate concurrent call so the sidebar can paint before
## any git work runs.

import std/[algorithm, monotimes, os, strutils, tables, times]

import ./[gitops, store, types]

type
  ScanResult* = object
    repos*: seq[Repo]
    scanned*: int
    skipped*: int
    reusedDirs*: int
    ms*: int64
    dirMtimes*: Table[string, int64]
    dirSubdirs*: Table[string, seq[string]]

proc isRepoDir*(dir: string): bool =
  ## A repo has `.git` as a directory (normal) or a file (worktree/submodule).
  dirExists(dir / ".git") or fileExists(dir / ".git")

proc skippedName(name: string, globs: seq[string]): bool =
  if name.len == 0:
    return true
  if name == ".git":
    return true
  if name.startsWith("."):
    return true            # hidden dirs are skipped by default (docs/04 §3.1)
  for glob in globs:
    if name == glob:
      return true
  false

proc dirMtimeMs(dir: string): int64 =
  try:
    let t = getLastModificationTime(dir)
    result = t.toUnix * 1000 + (t.nanosecond div 1_000_000).int64
  except OSError:
    result = 0

proc scanInto(dir: string, depth: int, globs: seq[string],
              prevMtimes: Table[string, int64],
              prevSubdirs: Table[string, seq[string]],
              prevReposByParent: Table[string, seq[Repo]],
              useCache: bool,
              res: var ScanResult) =
  if depth < 0 or not dirExists(dir):
    return
  let normDir = normalizePath(dir)
  let mtime = dirMtimeMs(dir)
  res.dirMtimes[normDir] = mtime

  # Incremental shortcut: when a directory's mtime is unchanged, its immediate
  # entries are unchanged — skip `walkDir`, keep its direct repos (verifying
  # `.git` still exists), and only recurse into its previously known non-repo
  # subdirectories (whose own mtimes may have changed).
  if useCache and mtime > 0 and prevMtimes.hasKey(normDir) and
      prevMtimes[normDir] == mtime and prevSubdirs.hasKey(normDir):
    inc res.reusedDirs
    let directRepos = prevReposByParent.getOrDefault(normDir)
    var stillValid = true
    for r in directRepos:
      if not isRepoDir(r.path):
        stillValid = false
        break
    if stillValid:
      for r in directRepos:
        res.repos.add r
      let subdirs = prevSubdirs[normDir]
      res.dirSubdirs[normDir] = subdirs
      for sub in subdirs:
        scanInto(sub, depth - 1, globs, prevMtimes, prevSubdirs,
                 prevReposByParent, useCache, res)
      return

  inc res.scanned
  var names: seq[string]
  try:
    for kind, path in walkDir(dir, relative = false, checkDir = true):
      if kind == pcDir:
        names.add path
  except OSError:
    inc res.skipped
    return
  names.sort()
  var subdirs: seq[string]
  for child in names:
    let name = child.lastPathPart
    if skippedName(name, globs):
      inc res.skipped
      continue
    if isRepoDir(child):
      inc res.scanned          # visited, but we stop here: no descent into repos
      var repo = Repo(
        id: repoId(child),
        name: name,
        path: normalizePath(child),
        ahead: -1,
        behind: -1,
        lang: langOf(name))
      res.repos.add repo
      # Found a repo: do not descend (nested repos stay invisible on purpose).
      continue
    let normChild = normalizePath(child)
    subdirs.add normChild
    scanInto(child, depth - 1, globs, prevMtimes, prevSubdirs,
             prevReposByParent, useCache, res)
  res.dirSubdirs[normDir] = subdirs

proc scanIncremental*(root: string, excludeGlobs: seq[string], depth: int,
                      prev: IndexCache): ScanResult =
  ## Scan `root`, skipping `walkDir` on directories whose mtime matches `prev`.
  let start = getMonoTime()
  if not dirExists(root):
    result.ms = 0
    return
  let normRoot = normalizePath(root)
  let cacheUsable = prev.root == normRoot and
                    prev.scanDepth == depth and
                    prev.excludeGlobs == excludeGlobs and
                    prev.dirMtimes.len > 0
  var reposByParent: Table[string, seq[Repo]]
  if cacheUsable:
    for r in prev.repos:
      let p = normalizePath(r.path.parentDir)
      reposByParent.mgetOrPut(p, @[]).add r
  scanInto(root, depth, excludeGlobs, prev.dirMtimes, prev.dirSubdirs,
           reposByParent, cacheUsable, result)
  result.repos.sort(proc(a, b: Repo): int = cmp(a.path, b.path))
  result.ms = (getMonoTime() - start).inMilliseconds

proc scan*(root: string, excludeGlobs: seq[string], depth = 4): ScanResult =
  let empty = IndexCache()
  scanIncremental(root, excludeGlobs, depth, empty)

proc withStatus*(repos: seq[Repo]): seq[Repo] =
  ## Fill branch/head/dirty for each repo (in-process via libgit2 when linked).
  result = @[]
  for repo in repos:
    var filled = statusOf(repo.path)
    if filled.id.len == 0:
      filled.id = repo.id
    if filled.name.len == 0:
      filled.name = repo.name
    result.add filled

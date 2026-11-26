## Native in-process libgit2 benchmark vs docs/01 §4 performance budget.
##
## Usage:
##   nim c -r -d:release --hints:off --path:../nimi/src scripts/bench_libgit2.nim [root]

import std/[algorithm, monotimes, os, strformat, strutils, times]

import ../src/knit/[gitlib, gitops, index, services, store, types]

proc quantile(vals: seq[float], q: float): float =
  if vals.len == 0: return 0.0
  var s = vals
  s.sort()
  let idx = min(s.len - 1, int(q * float(s.len)))
  s[idx]

when isMainModule:
  let root = if paramCount() >= 1: paramStr(1) else: getHomeDir() / "code"
  let globs = @["node_modules", "target", ".venv", "vendor", "dist", "build"]

  echo fmt"knit native benchmark (libgit2={hasLibgit2()})"
  echo fmt"root: {root}"

  let scan1 = scan(root, globs, depth = 4)
  let cache = IndexCache(
    root: normalizePath(root),
    scanDepth: 4,
    excludeGlobs: globs,
    dirMtimes: scan1.dirMtimes,
    dirSubdirs: scan1.dirSubdirs,
    repos: scan1.repos,
  )
  let scan2 = scanIncremental(root, globs, depth = 4, cache)
  echo fmt"scan cold : {scan1.ms} ms ({scan1.repos.len} repos, {scan1.scanned} dirs)"
  echo fmt"scan warm : {scan2.ms} ms (reused {scan2.reusedDirs} dirs)"

  var paths: seq[string]
  for r in scan1.repos:
    if paths.len < 30:
      paths.add r.path

  if paths.len == 0:
    echo "No repos found."
    quit(0)

  # 8-way concurrent status across up to 30 repos (budget <= 400 ms)
  var batchTimes: seq[float]
  for run in 0 ..< 3:
    let t0 = getMonoTime()
    discard statusBatch(paths)
    let ms = float((getMonoTime() - t0).inMicroseconds) / 1000.0
    batchTimes.add ms

  # Single-repo incremental status (budget <= 80 ms)
  var singleStatus: seq[float]
  var logTimes: seq[float]
  for p in paths:
    let t0 = getMonoTime()
    discard statusOf(p)
    singleStatus.add float((getMonoTime() - t0).inMicroseconds) / 1000.0

    let t1 = getMonoTime()
    discard logPage(p, 200)
    logTimes.add float((getMonoTime() - t1).inMicroseconds) / 1000.0

  echo ""
  echo fmt"Batch status ({paths.len} repos, 8-way): p50={quantile(batchTimes, 0.5):.1f} ms  p95={quantile(batchTimes, 0.95):.1f} ms  (budget <= 400 ms)"
  echo fmt"Single repo status                : p50={quantile(singleStatus, 0.5):.1f} ms  p95={quantile(singleStatus, 0.95):.1f} ms  (budget <= 80 ms)"
  echo fmt"Single repo log(200)              : p50={quantile(logTimes, 0.5):.1f} ms  p95={quantile(logTimes, 0.95):.1f} ms  (budget <= 60 ms)"

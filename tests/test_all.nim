import std/[unittest, json, os, strutils, algorithm, tables]

import ../src/knit/[types, gitops, index, logger, store, services]
import ./fixtures
import ./test_diff
import ./test_merge
import ./test_write
import ./test_ipc
import ./test_gitlib
import ./test_rebase

suite "status --porcelain=v2 -z":
  test "parses branch header, counts and flags":
    let raw = "# branch.oid 0123456789abcdef\0# branch.head main\0" &
              "# branch.ab +2 -1\0" &
              "1 .M N... 100644 100644 100644 aaa bbb src/a.ts\0" &
              "1 M. N... 100644 100644 100644 aaa bbb src/b.ts\0" &
              "? untracked.txt\0" &
              "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts\0"
    let st = parseStatusV2(raw)
    check st.branch == "main"
    check not st.detached
    check st.head == "0123456789abcdef"
    check st.ahead == 2
    check st.behind == 1
    check st.dirty.unstaged == 1
    check st.dirty.staged == 1
    check st.dirty.untracked == 1
    check st.dirty.conflicted == 1

  test "rename records consume their original path":
    let raw = "2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\0old.ts\0? extra.txt\0"
    let st = parseStatusV2(raw)
    check st.dirty.staged == 1
    check st.dirty.untracked == 1

  test "detached head has no branch":
    let raw = "# branch.oid deadbeef\0# branch.head (detached)\0"
    let st = parseStatusV2(raw)
    check st.detached
    check st.branch.len == 0

  test "initial repository":
    let raw = "# branch.oid (initial)\0# branch.head main\0"
    let st = parseStatusV2(raw)
    check st.head.len == 0
    check st.branch == "main"

suite "log parsing":
  test "fields, parents and body":
    let raw = "9f3c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f\x1f7d21ab0\x1fzhimoe\x1fme@x.dev\x1f1700000000\x1fgit: 并行扫描\x1fbody line 1\nbody line 2\0"
    let commits = parseLog(raw)
    check commits.len == 1
    check commits[0].shortHash == "9f3c1a2"
    check commits[0].parents.len == 1
    check commits[0].authorName == "zhimoe"
    check commits[0].committedAt == 1700000000000'i64
    check commits[0].subject == "git: 并行扫描"
    check "body line 2" in commits[0].body

  test "refs are attached and names cleaned":
    var commits = parseLog("aaaaaaa1f\x1f\x1fzhimoe\x1fe@x\x1f1700000000\x1fsubject\x1f\0")
    attachRefs(commits, @[("aaaaaaa", "refs/heads/main"),
                          ("aaaaaaa", "refs/remotes/origin/main"),
                          ("aaaaaaa", "refs/tags/v1.0")])
    check commits[0].refs == @["main", "origin/main", "tag: v1.0"]

suite "identity":
  test "repoId is stable across separators and trailing slashes":
    check repoId("C:\\Users\\zhimoe\\code\\nimi") == repoId("C:/Users/zhimoe/code/nimi")
    check repoId("/tmp/knit-a/") == repoId("/tmp/knit-a")
    check repoId("/tmp/knit-a").len == 12
    check repoId("/tmp/knit-a") == repoId("/tmp/knit-a").toLowerAscii()

suite "scan":
  test "finds repos, skips globs, hidden dirs and nested repos":
    let root = getTempDir() / "knit-scan-test"
    removeDir(root)
    createDir(root)
    for repo in ["alpha", "beta"]:
      createDir(root / repo / ".git")
    createDir(root / "node_modules" / ".git")
    createDir(root / ".hidden" / ".git")
    createDir(root / "notarepo")
    createDir(root / "beta" / "nested" / ".git")   # nested repo stays invisible

    let res = scan(root, @["node_modules"], depth = 4)
    var names: seq[string]
    for repo in res.repos:
      names.add repo.name
    names.sort()
    check names == @["alpha", "beta"]
    check res.scanned >= 3
    check res.skipped >= 2
    removeDir(root)

  test "incremental scan reuses unchanged directories via dirMtimes":
    let root = getTempDir() / "knit-inc-scan-test"
    removeDir(root)
    createDir(root / "a" / ".git")
    createDir(root / "group" / "b" / ".git")
    let globs = @["node_modules"]
    let first = scan(root, globs, depth = 4)
    check first.repos.len == 2
    check first.reusedDirs == 0
    check first.dirMtimes.len >= 2

    let cache = IndexCache(
      root: normalizePath(root),
      scanDepth: 4,
      excludeGlobs: globs,
      dirMtimes: first.dirMtimes,
      dirSubdirs: first.dirSubdirs,
      repos: first.repos,
    )
    let second = scanIncremental(root, globs, depth = 4, cache)
    check second.repos.len == 2
    check second.reusedDirs >= 2

    # Adding a new repo changes parent mtime and gets discovered.
    sleep(15)
    createDir(root / "group" / "c" / ".git")
    let third = scanIncremental(root, globs, depth = 4, cache)
    check third.repos.len == 3
    removeDir(root)

suite "concurrent status pool":
  test "8-way statusBatch returns every repo in order":
    var paths: seq[string]
    for i in 0 ..< 10:
      let r = makeRepo("pool-" & $i)
      discard writeAndCommit(r, "a.txt", "hello " & $i & "\n", "init " & $i)
      paths.add r
    let results = statusBatch(paths)
    check results.len == 10
    for i in 0 ..< 10:
      check results[i]{"name"}.getStr("") == "pool-" & $i
      check results[i]{"head"}.getStr("").len == 7

suite "settings":
  test "defaults include the exclusion rules from the spec":
    let s = defaultSettings()
    check "node_modules" in s.excludeGlobs
    check s.scanDepth == 4
    check s.schemaVersion == 1

suite "logger redaction & rotation":
  test "redacts repo paths and tokens and rotates files":
    let dir = getTempDir() / "knit-log-test"
    removeDir(dir)
    createDir(dir)
    putEnv("KNIT_DATA_DIR", dir)
    let secretPath = "/Users/secret/private-repo"
    writeLog(llError, "test", "failed on " & secretPath & " with ghp_superSecretToken123",
             [secretPath], maxBytes = 120)
    let text = readFile(logPath())
    check secretPath notin text
    check "ghp_superSecretToken123" notin text
    check "ghp_[REDACTED]" in text
    check "path#" in text
    # Trigger rotation
    writeLog(llError, "test", "second entry to rotate log file cleanly", maxBytes = 60)
    writeLog(llError, "test", "third entry after rotation", maxBytes = 60)
    check fileExists(logPath() & ".1")
    removeDir(dir)

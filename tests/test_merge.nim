## Conflict parsing and three-stage reads.

import std/[os, strutils, unittest]

import ../src/knit/[gitops, merge]
import ./fixtures

suite "conflict markers":
  test "parses ours / base / theirs with line positions":
    let text = """line 1
<<<<<<< HEAD
ours a
ours b
||||||| base
base a
=======
theirs a
>>>>>>> feature
line 9
"""
    let parsed = parseConflictMarkers(text)
    check parsed.blocks.len == 1
    let b = parsed.blocks[0]
    check b.index == 0
    check b.start == 2
    check b.ours.lines == @["ours a", "ours b"]
    check b.hasBase
    check b.base.lines == @["base a"]
    check b.theirs.lines == @["theirs a"]

  test "missing base (diff3 disabled) still parses":
    let text = "<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> side\n"
    let parsed = parseConflictMarkers(text)
    check parsed.blocks.len == 1
    check not parsed.blocks[0].hasBase
    check parsed.blocks[0].ours.lines == @["x"]
    check parsed.blocks[0].theirs.lines == @["y"]

suite "merge state from a real conflict":
  test "stage 2/3 content and a resolvable block":
    let repo = makeRepo("merge-state")
    discard writeAndCommit(repo, "cfg.txt", "retries: 3\nbranch: main\n", "init")
    discard runGit(repo, ["checkout", "-q", "-b", "side"])
    writeFile(repo / "cfg.txt", "retries: 5\nbranch: side\n")
    discard commitAll(repo, "side")
    discard runGit(repo, ["checkout", "-q", "-"])
    writeFile(repo / "cfg.txt", "retries: 9\nbranch: main\n")
    discard commitAll(repo, "main edit")
    let mergeRes = runGit(repo, ["merge", "side"])
    check mergeRes.code != 0
    let state = mergeStateOf(repo, "cfg.txt")
    check state.path == "cfg.txt"
    check "retries: 9" in state.ours
    check "retries: 5" in state.theirs
    check state.blocks.len >= 1
    let applied = writeResolution(repo, "cfg.txt", "retries: 5\nbranch: side\n")
    check applied.code == 0
    let unmerged = runGit(repo, ["diff", "--name-only", "--diff-filter=U"])
    check unmerged.output.strip().len == 0

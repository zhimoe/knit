## Interactive rebase tests (docs/04 §9 #4, docs/07 M5.1).

import std/[os, strutils, unittest]

import ../src/knit/[gitops]
import ./fixtures

suite "interactive rebase":
  test "reorder, squash, fixup, reword and drop produce expected history":
    let repo = makeRepo("rebase-ops")
    let base = writeAndCommit(repo, "base.txt", "base\n", "base commit")
    let c1 = writeAndCommit(repo, "a.txt", "a1\n", "first")
    let c2 = writeAndCommit(repo, "a.txt", "a1\na2\n", "fixup into first")
    let c3 = writeAndCommit(repo, "b.txt", "b1\n", "second")
    let c4 = writeAndCommit(repo, "c.txt", "c1\n", "drop me")
    let c5 = writeAndCommit(repo, "d.txt", "d1\n", "squash target")
    let c6 = writeAndCommit(repo, "d.txt", "d1\nd2\n", "squash into d")

    let plan = rebasePlan(repo, base)
    check plan.len == 6
    check plan[0].hash == c1
    check plan[5].hash == c6

    # Reorder (put b before a), fixup c2 into c1, reword c3, drop c4, squash c6 into c5
    var todo = @[
      RebaseTodoItem(action: "reword", hash: c3, subject: "second", message: "feat(b): reworded second"),
      RebaseTodoItem(action: "pick", hash: c1, subject: "first"),
      RebaseTodoItem(action: "fixup", hash: c2, subject: "fixup into first"),
      RebaseTodoItem(action: "drop", hash: c4, subject: "drop me"),
      RebaseTodoItem(action: "pick", hash: c5, subject: "squash target"),
      RebaseTodoItem(action: "squash", hash: c6, subject: "squash into d", message: "feat(d): squashed d"),
    ]
    let res = rebaseStart(repo, base, todo)
    check res.code == 0
    check not rebaseState(repo).inProgress

    let commits = logOf(repo, 10)
    # base + 3 remaining commits = 4
    check commits.len == 4
    check commits[0].subject == "feat(d): squashed d"
    check commits[1].subject == "first"
    check commits[2].subject == "feat(b): reworded second"
    check commits[3].hash == base
    check readFile(repo / "a.txt") == "a1\na2\n"
    check readFile(repo / "d.txt") == "d1\nd2\n"
    check not fileExists(repo / "c.txt")

    # Bookmark ref was recorded
    let refs = runGit(repo, ["for-each-ref", "refs/knit/before-rebase-*"]).output.strip()
    check refs.len > 0

  test "conflict pauses rebase and abort cleanly restores HEAD":
    let repo = makeRepo("rebase-conflict")
    let base = writeAndCommit(repo, "x.txt", "line0\n", "base")
    let c1 = writeAndCommit(repo, "x.txt", "line1\n", "c1")
    let c2 = writeAndCommit(repo, "x.txt", "line2\n", "c2")
    let beforeHead = headOf(repo)

    # Dropping c1 makes c2 conflict against base
    let todo = @[
      RebaseTodoItem(action: "drop", hash: c1, subject: "c1"),
      RebaseTodoItem(action: "pick", hash: c2, subject: "c2"),
    ]
    let res = rebaseStart(repo, base, todo)
    check res.code != 0
    let st = rebaseState(repo)
    check st.inProgress
    check "x.txt" in st.conflicts

    let aborted = rebaseAbort(repo)
    check aborted.code == 0
    check not rebaseState(repo).inProgress
    check headOf(repo) == beforeHead

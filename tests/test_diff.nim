## Structured diff parsing + word highlight + staging round-trip.

import std/[os, strutils, unittest]

import ../src/knit/[diff, gitops, types]
import ./fixtures

suite "UTF-8 sanitising":
  test "invalid bytes become U+FFFD":
    check sanitizeUtf8("a\xFFb") == "a\xEF\xBF\xBDb"
    check sanitizeUtf8("中文") == "中文"
    check sanitizeUtf8("ok") == "ok"

suite "unified diff parsing":
  test "line numbers, kinds and word highlight":
    let raw = """diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@ export function f
 context
-const repos = await walk(root)
+const shards = await Promise.all(
+  split(root, 8)
 end
"""
    let files = parseUnifiedDiff(raw)
    check files.len == 1
    let f = files[0]
    check f.path == "src/a.ts"
    check f.additions == 2
    check f.deletions == 1
    check f.hunks.len == 1
    let rows = f.hunks[0].rows
    check rows.len == 5
    check rows[0].t == "ctx"
    check rows[0].oldNo == 1
    check rows[0].newNo == 1
    check rows[1].t == "del"
    check rows[1].oldNo == 2
    check rows[2].t == "add"
    check rows[2].newNo == 2
    check rows[3].newNo == 3
    check rows[4].oldNo == 3
    check rows[4].newNo == 4
    # `repos` / `shards` are the changed word on each side.
    check rows[1].hl.len == 1
    check rows[2].hl.len == 1
    let (start, length) = rows[1].hl[0]
    check rows[1].text[start ..< start + length] == "repos"
    let (s2, l2) = rows[2].hl[0]
    check rows[2].text[s2 ..< s2 + l2] == "shards"

  test "renames, new files and binary markers":
    let raw = """diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
diff --git a/img.png b/img.png
new file mode 100644
index 0000000..3333333
Binary files /dev/null and b/img.png differ
"""
    let files = parseUnifiedDiff(raw)
    check files.len == 2
    check files[0].status == "R"
    check files[0].oldPath == "old.txt"
    check files[0].path == "new.txt"
    check files[1].binary
    check files[1].status == "A"
    check files[1].path == "img.png"

  test "CRLF content and no trailing newline marker":
    let raw = "diff --git a/x b/x\n--- a/x\n+++ b/x\n" &
              "@@ -1 +1 @@\r\n-a\r\n+b\r\n\\ No newline at end of file\n"
    let files = parseUnifiedDiff(raw)
    check files.len == 1
    check files[0].hunks[0].rows.len == 2
    check files[0].hunks[0].rows[1].text == "b"

suite "UTF-16 highlight offsets":
  test "CJK characters occupy one JS code unit each":
    var hunks = @[Hunk(oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
      rows: @[
        DiffRow(t: "del", oldNo: 1, text: "root/旧版本"),
        DiffRow(t: "add", newNo: 1, text: "root/新版本")])]
    computeWordHighlights(hunks)
    let (start, length) = hunks[0].rows[1].hl[0]
    # "root/" is 5 UTF-16 units; each CJK char is one unit (3 UTF-8 bytes).
    check start == 5
    check length == 3

suite "diff against a real repository":
  test "commit diff and workdir diff agree with git":
    let repo = makeRepo("diff-commit")
    let first = writeAndCommit(repo, "a.txt", "one\ntwo\nthree\n", "init")
    writeFile(repo / "a.txt", "one\nTWO\nthree\nfour\n")
    let hash = commitAll(repo, "edit")
    let commitDiff = diffOfCommit(repo, hash, "a.txt")
    check commitDiff.path == "a.txt"
    check commitDiff.additions == 2
    check commitDiff.deletions == 1
    check commitDiff.hunks.len == 1

    writeFile(repo / "a.txt", "one\nTWO\nthree\nfour\nfive\n")
    let work = diffOfWorkdir(repo, "a.txt", staged = false, untracked = false)
    check work.additions == 1
    check work.deletions == 0
    check first.len == 40

  test "untracked file renders as an addition diff":
    let repo = makeRepo("diff-untracked")
    discard writeAndCommit(repo, "keep.txt", "x\n", "init")
    writeFile(repo / "new.txt", "alpha\nbeta\n")
    let d = diffOfWorkdir(repo, "new.txt", staged = false, untracked = true)
    check d.status == "A"
    check d.additions == 2
    check not d.binary

suite "file lists":
  test "status entries split staged and unstaged with stats":
    let repo = makeRepo("status-entries")
    discard writeAndCommit(repo, "a.txt", "a\nb\n", "init")
    writeFile(repo / "a.txt", "a\nB\n")
    writeFile(repo / "untracked.txt", "u1\nu2\n")
    var entries = statusEntries(repo)
    var unstaged = 0
    var untracked = 0
    for e in entries:
      if e.group == "unstaged":
        inc unstaged
        if e.untracked:
          inc untracked
          check e.additions == 2
    check unstaged == 2
    check untracked == 1

    discard stageFiles(repo, @["a.txt"], true)
    entries = statusEntries(repo)
    var staged = 0
    for e in entries:
      if e.group == "staged":
        inc staged
    check staged == 1

  test "paths containing spaces survive porcelain v2 parsing":
    let repo = makeRepo("status-spaces")
    discard writeAndCommit(repo, "with space.txt", "a\n", "init")
    writeFile(repo / "with space.txt", "b\n")
    let entries = statusEntries(repo)
    check entries.len == 1
    check entries[0].path == "with space.txt"

  test "commit file list has +/- stats":
    let repo = makeRepo("commit-files")
    discard writeAndCommit(repo, "a.txt", "a\n", "init")
    writeFile(repo / "a.txt", "a\nb\nc\n")
    let hash = commitAll(repo, "add lines")
    let files = commitFiles(repo, hash)
    check files.len == 1
    check files[0].path == "a.txt"
    check files[0].additions == 2
    check files[0].deletions == 0

  test "merge commits show the first-parent diff":
    let repo = makeRepo("commit-merge")
    discard writeAndCommit(repo, "a.txt", "base\n", "init")
    discard runGit(repo, ["checkout", "-q", "-b", "side"])
    discard writeAndCommit(repo, "side.txt", "side\n", "side")
    discard runGit(repo, ["checkout", "-q", "-"])
    discard writeAndCommit(repo, "main.txt", "main\n", "main")
    let merge = runGit(repo, ["merge", "--no-ff", "side", "-m", "merge side"])
    check merge.code == 0
    let hash = headOf(repo)
    let files = commitFiles(repo, hash)
    var paths: seq[string]
    for file in files:
      paths.add file.path
    check "side.txt" in paths
    let d = diffOfCommit(repo, hash, "side.txt")
    check d.additions == 1
    check d.hunks.len == 1

suite "hunk staging round-trip":
  test "apply --cached patch matches the selected hunk":
    let repo = makeRepo("hunk-stage")
    discard writeAndCommit(repo, "a.txt", "one\ntwo\nthree\n", "init")
    writeFile(repo / "a.txt", "ONE\ntwo\nthree\nfour\n")
    let d = diffOfWorkdir(repo, "a.txt", staged = false, untracked = false)
    check d.hunks.len >= 1
    var patch = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n"
    patch.add d.hunks[0].header & "\n"
    for row in d.hunks[0].rows:
      case row.t
      of "add": patch.add "+" & row.text & "\n"
      of "del": patch.add "-" & row.text & "\n"
      else: patch.add " " & row.text & "\n"
    let applied = applyCachedPatch(repo, patch, reverse = false)
    check applied.code == 0
    let cached = runGit(repo, ["diff", "--cached", "--name-only"])
    check "a.txt" in cached.output

    # Reverse the same hunk from the staged view (M3.3 unstage path).
    let stagedDiff = diffOfWorkdir(repo, "a.txt", staged = true, untracked = false)
    var reversePatch = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n"
    reversePatch.add stagedDiff.hunks[0].header & "\n"
    for row in stagedDiff.hunks[0].rows:
      case row.t
      of "add": reversePatch.add "+" & row.text & "\n"
      of "del": reversePatch.add "-" & row.text & "\n"
      else: reversePatch.add " " & row.text & "\n"
    let reversed = applyCachedPatch(repo, reversePatch, reverse = true)
    check reversed.code == 0
    let after = runGit(repo, ["diff", "--cached", "--name-only"])
    check after.output.strip().len == 0

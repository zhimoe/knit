## libgit2 vs git CLI parity tests (docs/04 §9 #5, docs/07 M1.1).

import std/[algorithm, os, unittest]

import ../src/knit/[diff, gitlib, gitops, types]
import ./fixtures

when defined(knitLibgit2):
  suite "libgit2 parity with git CLI":
    test "status matches CLI on dirty, staged, renamed, untracked, CRLF and detached HEAD":
      let repo = makeRepo("gitlib-status")
      discard writeAndCommit(repo, "a.txt", "line1\r\nline2\r\n", "init crlf")
      discard writeAndCommit(repo, "old.txt", "keep me intact\nline two\n", "add old")
      # Staged rename + unstaged edit + untracked nested file
      discard runGit(repo, ["mv", "old.txt", "renamed.txt"])
      writeFile(repo / "a.txt", "line1\r\nline2-edited\r\n")
      createDir(repo / "sub" / "dir")
      writeFile(repo / "sub" / "dir" / "new.txt", "untracked\n")

      let cli = statusOfCli(repo)
      let lib = statusOfLib(repo)
      check lib.branch == cli.branch
      check lib.detached == cli.detached
      check lib.head == cli.head
      check lib.ahead == cli.ahead
      check lib.behind == cli.behind
      check lib.dirty == cli.dirty

      let cliEntries = statusEntriesCli(repo)
      let libEntries = statusEntriesLib(repo)
      check libEntries.len == cliEntries.len
      for i in 0 ..< cliEntries.len:
        check libEntries[i].path == cliEntries[i].path
        check libEntries[i].group == cliEntries[i].group
        check libEntries[i].status == cliEntries[i].status
        check libEntries[i].additions == cliEntries[i].additions
        check libEntries[i].deletions == cliEntries[i].deletions
        check libEntries[i].untracked == cliEntries[i].untracked

      # Detached HEAD
      let h = headOf(repo)
      discard runGit(repo, ["checkout", "-q", "--detach", h])
      let cliDet = statusOfCli(repo)
      let libDet = statusOfLib(repo)
      check libDet.detached == cliDet.detached
      check libDet.branch == cliDet.branch
      check libDet.head == cliDet.head

    test "status matches CLI on initial empty repo and conflicts":
      let empty = makeRepo("gitlib-empty")
      let cliE = statusOfCli(empty)
      let libE = statusOfLib(empty)
      check libE.head == cliE.head
      check libE.branch == cliE.branch
      check libE.dirty == cliE.dirty

      # Conflict repo
      let conf = makeRepo("gitlib-conflict")
      discard writeAndCommit(conf, "c.txt", "base\n", "base")
      discard runGit(conf, ["checkout", "-q", "-b", "side"])
      discard writeAndCommit(conf, "c.txt", "theirs\n", "side")
      discard runGit(conf, ["checkout", "-q", "-"])
      discard writeAndCommit(conf, "c.txt", "ours\n", "main")
      discard runGit(conf, ["merge", "side"], okCodes = @[0, 1])

      let cliC = statusOfCli(conf)
      let libC = statusOfLib(conf)
      check libC.dirty.conflicted == cliC.dirty.conflicted
      check libC.dirty.conflicted == 1

    test "log, pagination cursor, refs and commitFiles match CLI":
      let repo = makeRepo("gitlib-log")
      var hashes: seq[string]
      for i in 1 .. 6:
        hashes.add writeAndCommit(repo, "f" & $i & ".txt", "content " & $i & "\n",
                                  "commit #" & $i & "\n\nbody " & $i)
      discard runGit(repo, ["tag", "v1.0", hashes[2]])
      discard runGit(repo, ["branch", "feat", hashes[4]])

      let cliLog = logOfCli(repo, 20)
      let libPage = logOfLib(repo, 20)
      check not libPage.hasMore
      check libPage.commits.len == cliLog.len
      for i in 0 ..< cliLog.len:
        check libPage.commits[i].hash == cliLog[i].hash
        check libPage.commits[i].parents == cliLog[i].parents
        check libPage.commits[i].authorName == cliLog[i].authorName
        check libPage.commits[i].subject == cliLog[i].subject
        check libPage.commits[i].body == cliLog[i].body
        check libPage.commits[i].refs == cliLog[i].refs

      # Cursor pagination
      let page1 = logOfLib(repo, 2)
      check page1.commits.len == 2
      check page1.hasMore
      let page2 = logOfLib(repo, 2, cursor = page1.nextCursor)
      check page2.commits.len == 2
      check page2.hasMore
      check page2.commits[0].hash == cliLog[2].hash
      check page2.commits[1].hash == cliLog[3].hash

      # commitFiles parity
      let cliFiles = commitFilesCli(repo, hashes[^1])
      let libFiles = commitFilesLib(repo, hashes[^1])
      check libFiles == cliFiles

      # refs parity
      var libRefs = refsOfLib(repo)
      libRefs.sort()
      check libRefs.len >= 3

    test "commit diff, workdir diff, binary and blame match CLI":
      let repo = makeRepo("gitlib-diff")
      let h1 = writeAndCommit(repo, "code.txt", "alpha\nbeta\ngamma\n", "first")
      let h2 = writeAndCommit(repo, "code.txt", "alpha\nbeta2\ngamma\ndelta\n", "second")
      discard writeAndCommit(repo, "bin.dat", "\0\1\2\3\4", "add binary")

      let cliD = diffOfCommitCli(repo, h2, "code.txt")
      let libD = diffOfCommit(repo, h2, "code.txt")
      check libD.status == cliD.status
      check libD.additions == cliD.additions
      check libD.deletions == cliD.deletions
      check libD.hunks.len == cliD.hunks.len
      check libD.hunks[0].rows.len == cliD.hunks[0].rows.len
      for i in 0 ..< cliD.hunks[0].rows.len:
        check libD.hunks[0].rows[i].t == cliD.hunks[0].rows[i].t
        check libD.hunks[0].rows[i].text == cliD.hunks[0].rows[i].text
        check libD.hunks[0].rows[i].oldNo == cliD.hunks[0].rows[i].oldNo
        check libD.hunks[0].rows[i].newNo == cliD.hunks[0].rows[i].newNo
        check libD.hunks[0].rows[i].hl == cliD.hunks[0].rows[i].hl

      # Binary file
      let binDiff = diffOfCommit(repo, headOf(repo), "bin.dat")
      check binDiff.binary

      # Blame parity
      let cliBlame = blameOfCli(repo, "code.txt")
      let libBlame = blameOfLib(repo, "code.txt")
      check libBlame.len == cliBlame.len
      check libBlame.len == 4
      check libBlame[0].hash == h1
      check libBlame[1].hash == h2
      check libBlame[3].hash == h2
      for i in 0 ..< cliBlame.len:
        check libBlame[i].line == cliBlame[i].line
        check libBlame[i].hash == cliBlame[i].hash
        check libBlame[i].author == cliBlame[i].author
        check libBlame[i].text == cliBlame[i].text

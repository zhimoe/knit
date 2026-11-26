## Write path: staging, commit (stdin/hooks/amend), shelf patch round-trip.

import std/[os, strutils, unittest]

import ../src/knit/[agent, gitops]
import ./fixtures

suite "stage / unstage":
  test "git add and restore --staged keep the index in sync":
    let repo = makeRepo("stage-files")
    discard writeAndCommit(repo, "a.txt", "one\n", "init")
    writeFile(repo / "a.txt", "two\n")
    check stageFiles(repo, @["a.txt"], true).code == 0
    var staged = runGit(repo, ["diff", "--cached", "--name-only"]).output.strip()
    check staged == "a.txt"
    check stageFiles(repo, @["a.txt"], false).code == 0
    staged = runGit(repo, ["diff", "--cached", "--name-only"]).output.strip()
    check staged.len == 0

suite "commit":
  test "message goes through stdin and amend replaces the subject":
    let repo = makeRepo("commit-stdin")
    discard writeAndCommit(repo, "a.txt", "one\n", "init")
    writeFile(repo / "a.txt", "two\n")
    check stageFiles(repo, @["a.txt"], true).code == 0
    let res = commitStaged(repo, "feat(x): subject\n\nbody line\n", false)
    check res.code == 0
    let subject = runGit(repo, ["log", "-1", "--format=%s"]).output.strip()
    check subject == "feat(x): subject"
    let body = runGit(repo, ["log", "-1", "--format=%b"]).output.strip()
    check "body line" in body

    writeFile(repo / "a.txt", "three\n")
    check stageFiles(repo, @["a.txt"], true).code == 0
    let amend = commitStaged(repo, "fix(x): amended\n", true)
    check amend.code == 0
    let amended = runGit(repo, ["log", "-1", "--format=%s"]).output.strip()
    check amended == "fix(x): amended"
    let count = runGit(repo, ["rev-list", "--count", "HEAD"]).output.strip()
    check count == "2"

  test "hook failure keeps the index and returns stderr":
    when defined(windows):
      skip()
    else:
      let repo = makeRepo("commit-hook")
      discard writeAndCommit(repo, "a.txt", "one\n", "init")
      let hooks = repo / ".git" / "hooks"
      createDir(hooks)
      writeFile(hooks / "pre-commit", "#!/bin/sh\necho hook says no >&2\nexit 1\n")
      setFilePermissions(hooks / "pre-commit", {fpUserExec, fpUserRead, fpUserWrite})
      writeFile(repo / "a.txt", "two\n")
      check stageFiles(repo, @["a.txt"], true).code == 0
      let res = commitStaged(repo, "feat: blocked\n", false)
      check res.code != 0
      check "hook says no" in res.output or "hook says no" in res.error
      let count = runGit(repo, ["rev-list", "--count", "HEAD"]).output.strip()
      check count == "1"
      let cached = runGit(repo, ["diff", "--cached", "--name-only"]).output.strip()
      check cached == "a.txt"

  test "commit and push sets upstream on a fresh remote":
    let repo = makeRepo("commit-push")
    discard writeAndCommit(repo, "a.txt", "one\n", "init")
    let remote = getTempDir() / "knit-test" / "remote.git"
    removeDir(remote)
    discard runGit(getTempDir(), ["init", "--bare", "-q", remote])
    check runGit(repo, ["remote", "add", "origin", remote]).code == 0
    writeFile(repo / "a.txt", "two\n")
    check stageFiles(repo, @["a.txt"], true).code == 0
    let res = commitStaged(repo, "feat: push\n", false)
    check res.code == 0
    let pushed = pushCurrent(repo)
    check pushed.code == 0
    let upstream = runGit(repo, ["rev-parse", "--abbrev-ref", "@{u}"]).output.strip()
    check upstream.startsWith("origin/")

suite "shelf patch round-trip":
  test "working tree patch applies after a restore":
    let repo = makeRepo("shelf-patch")
    discard writeAndCommit(repo, "a.txt", "one\ntwo\n", "init")
    writeFile(repo / "a.txt", "one\nTWO\n")
    let patchPath = getTempDir() / "knit-test" / "shelf-test.patch"
    createDir(patchPath.parentDir)
    discard writeWorkdirPatch(repo, patchPath)
    check fileExists(patchPath)
    check "diff --git" in readFile(patchPath)
    discard runGit(repo, ["restore", "--worktree", "--", "a.txt"])
    check readFile(repo / "a.txt") == "one\ntwo\n"
    let applied = applyPatchFile(repo, patchPath)
    check applied.code == 0
    check readFile(repo / "a.txt") == "one\nTWO\n"

suite "guardrails":
  test "reset --hard snapshots dirty worktree before resetting":
    let repo = makeRepo("guard-reset")
    let h1 = writeAndCommit(repo, "a.txt", "v1\n", "c1")
    discard writeAndCommit(repo, "a.txt", "v2\n", "c2")
    writeFile(repo / "a.txt", "dirty work\n")
    let res = resetTo(repo, h1, "hard")
    check res.code == 0
    check headOf(repo) == h1
    check readFile(repo / "a.txt") == "v1\n"
    let refs = runGit(repo, ["for-each-ref", "refs/knit/snapshots/"]).output.strip()
    check refs.len > 0

  test "force push with lease refuses protected branches":
    let repo = makeRepo("guard-force")
    discard writeAndCommit(repo, "a.txt", "v1\n", "c1")
    let branch = runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).output.strip()
    let blocked = pushForceWithLease(repo, @[branch])
    check blocked.code != 0
    check "受保护分支" in blocked.error

  test "read-only agent restore removes newly created files and restores edits":
    let repo = makeRepo("guard-agent-restore")
    discard writeAndCommit(repo, "a.txt", "clean\n", "init")
    writeFile(repo / "keep-untracked.txt", "mine\n")
    let snap = createStashSnapshot(repo, "before-agent")
    writeFile(repo / "a.txt", "agent broke this\n")
    writeFile(repo / "agent-junk.txt", "junk\n")
    let res = restoreAfterReadOnly(repo, snap, @["keep-untracked.txt"])
    check res.code == 0
    check readFile(repo / "a.txt") == "clean\n"
    check fileExists(repo / "keep-untracked.txt")
    check not fileExists(repo / "agent-junk.txt")

suite "daily branch & remote operations":
  test "create, checkout, merge (clean & conflict), delete, fetch, pull and discard untracked":
    let repo = makeRepo("branch-ops")
    discard writeAndCommit(repo, "a.txt", "v1\n", "init")
    let mainBranch = runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).output.strip()

    # Create & checkout feature branch
    check createBranch(repo, "feat/x", "HEAD", checkout = true).code == 0
    check runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).output.strip() == "feat/x"
    discard writeAndCommit(repo, "b.txt", "feat\n", "feat commit")

    # Checkout main & clean merge
    check checkoutBranch(repo, mainBranch).code == 0
    check mergeBranch(repo, "feat/x").code == 0
    check fileExists(repo / "b.txt")

    # Delete merged branch succeeds; protected branch refused
    check deleteBranch(repo, "feat/x", false, @[mainBranch]).code == 0
    check deleteBranch(repo, mainBranch, false, @[mainBranch]).code != 0

    # Conflict merge + abort
    check createBranch(repo, "feat/conf", "HEAD", checkout = true).code == 0
    discard writeAndCommit(repo, "a.txt", "theirs\n", "conf theirs")
    check checkoutBranch(repo, mainBranch).code == 0
    discard writeAndCommit(repo, "a.txt", "ours\n", "conf ours")
    let mres = mergeBranch(repo, "feat/conf")
    check mres.code != 0
    check mergeInProgress(repo)
    check mergeAbort(repo).code == 0
    check not mergeInProgress(repo)

    # Fetch + pull from bare remote
    let remote = getTempDir() / "knit-test" / "branch-remote.git"
    removeDir(remote)
    discard runGit(getTempDir(), ["init", "--bare", "-q", remote])
    check runGit(repo, ["remote", "add", "origin", remote]).code == 0
    check pushCurrent(repo).code == 0
    check fetchAll(repo).code == 0
    check pullCurrent(repo, rebase = false).code == 0

    # Discard both tracked and untracked files
    writeFile(repo / "a.txt", "dirty\n")
    writeFile(repo / "untracked.tmp", "temp\n")
    check discardFiles(repo, @["a.txt", "untracked.tmp"]).code == 0
    check readFile(repo / "a.txt") == "ours\n"
    check not fileExists(repo / "untracked.tmp")

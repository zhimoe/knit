## End-to-end IPC work procs: the exact JSON strings the page sends/gets,
## including the large-diff chunk protocol. No window is created.

import std/[atomics, json, os, strutils, unittest]

import nimi

import ../src/knit/[gitops, services]
import ./fixtures

var registered = false

proc setup() =
  if registered:
    return
  registered = true
  putEnv("KNIT_DATA_DIR", getTempDir() / "knit-ipc-data")
  removeDir(getTempDir() / "knit-ipc-data")
  registerKnitServices()

proc call(name: string, args: JsonNode): JsonNode =
  setup()
  let work = backgroundWork(name)
  check work != nil
  let wire = $ %*[ $args ]            # nimi packs the JSON-string argument
  let raw = work(wire, newIpcCallContext(cast[ptr Atomic[bool]](nil)))
  result = parseJson(raw)
  check result{"ok"}.getBool(false)

proc data(name: string, args: JsonNode): JsonNode =
  call(name, args)["data"]

suite "IPC: read path":
  test "scan → cached → status → log → files → diff":
    setup()
    let repo = makeRepo("ipc-read")
    discard writeAndCommit(repo, "a.txt", "one\ntwo\n", "init")
    writeFile(repo / "a.txt", "one\nTWO\nthree\n")
    let hash = commitAll(repo, "second")

    let scan = data("Repo.scan", %*{"root": repo.parentDir,
      "excludeGlobs": @["node_modules"], "scanDepth": 2})
    check scan{"repos"}.len >= 1

    let cached = data("Repo.cached", %*{"root": repo.parentDir})
    check cached.len >= 1

    let status = data("Repo.status", %*{"paths": [repo]})
    check status{"repos"}.len == 1
    check status["repos"][0]{"branch"}.getStr("") == "main"

    let log = data("Log.list", %*{"path": repo, "limit": 50})
    check log{"commits"}.len == 2
    check log["commits"][0]{"hash"}.getStr("") == hash

    let files = data("Log.files", %*{"path": repo, "hash": hash})
    check files.len == 1
    check files[0]{"path"}.getStr("") == "a.txt"
    check files[0]{"additions"}.getInt() == 2

    let d = data("Diff.commit", %*{"path": repo, "hash": hash,
                                   "file": "a.txt", "contextLines": 3})
    check d{"diff"}{"hunks"}.len >= 1
    let row = d["diff"]["hunks"][0]["rows"][1]
    check row{"t"}.getStr("") in ["add", "del", "ctx"]

suite "IPC: write path + cache refresh":
  test "changes → stage → commit → status":
    setup()
    let repo = makeRepo("ipc-write")
    discard writeAndCommit(repo, "a.txt", "one\n", "init")
    writeFile(repo / "a.txt", "two\n")

    let changes = data("Repo.changes", %*{"path": repo})
    var unstaged = 0
    for f in changes{"files"}:
      if f{"group"}.getStr("") == "unstaged":
        inc unstaged
    check unstaged == 1

    discard data("Stage.files", %*{"path": repo, "files": ["a.txt"], "staged": true})
    let after = data("Repo.changes", %*{"path": repo})
    var staged = 0
    for f in after{"files"}:
      if f{"group"}.getStr("") == "staged":
        inc staged
    check staged == 1

    let commit = data("Commit.create", %*{"path": repo, "message": "feat(ipc): test",
                                          "amend": false, "push": false})
    check commit{"hash"}.getStr("").len == 40
    let log = data("Log.list", %*{"path": repo, "limit": 5})
    check log["commits"][0]{"subject"}.getStr("") == "feat(ipc): test"

suite "IPC: large diff chunk protocol":
  test "a diff above 240 KB returns a token and reassembles":
    setup()
    let repo = makeRepo("ipc-large")
    var big = ""
    for i in 0 ..< 4000:
      big.add "line " & $i & " ........................................\n"
    discard writeAndCommit(repo, "big.txt", big, "init")
    var next = ""
    for i in 0 ..< 4000:
      next.add "line " & $i & " ........................................  modified\n"
    writeFile(repo / "big.txt", next)
    discard commitAll(repo, "mass edit")
    let hash = headOf(repo)
    let d = data("Diff.commit", %*{"path": repo, "hash": hash,
                                   "file": "big.txt", "contextLines": 0})
    let diffNode = d["diff"]
    check diffNode{"truncated"}.getBool(false)
    check diffNode{"token"}.getStr("").startsWith("b")
    let chunks = diffNode{"chunks"}.getInt()
    check chunks >= 1
    var text = ""
    for i in 0 ..< chunks:
      let part = data("Diff.chunk", %*{"token": diffNode{"token"}.getStr(""),
                                        "index": i})
      text.add part{"chunk"}.getStr("")
    let full = parseJson(text)
    check full{"hunks"}.len == 1
    check full{"path"}.getStr("") == "big.txt"

suite "IPC: merge":
  test "state exposes stages and resolve clears the index conflict":
    setup()
    let repo = makeRepo("ipc-merge")
    discard writeAndCommit(repo, "cfg.txt", "a\n", "init")
    discard runGit(repo, ["checkout", "-q", "-b", "side"])
    writeFile(repo / "cfg.txt", "theirs\n")
    discard commitAll(repo, "side")
    discard runGit(repo, ["checkout", "-q", "-"])
    writeFile(repo / "cfg.txt", "ours\n")
    discard commitAll(repo, "ours")
    discard runGit(repo, ["merge", "side"])

    let state = data("Merge.state", %*{"path": repo, "file": "cfg.txt"})
    check "ours" in state{"ours"}.getStr("")
    check "theirs" in state{"theirs"}.getStr("")
    check state{"blocks"}.len >= 1
    discard data("Merge.resolve", %*{"path": repo, "file": "cfg.txt",
                                     "resolved": "resolved\n"})
    let unmerged = runGit(repo, ["diff", "--name-only", "--diff-filter=U"])
    check unmerged.output.strip().len == 0

suite "IPC: console + agent config":
  test "console ring returns commands and agents.json is created":
    setup()
    let repo = makeRepo("ipc-console")
    discard writeAndCommit(repo, "a.txt", "x\n", "init")
    discard data("Log.list", %*{"path": repo, "limit": 5})
    let console = data("Git.console", %*{})
    check console{"commands"}.len >= 1
    check console["commands"][0]{"cmd"}.getStr("").startsWith("git ")

    let config = data("Agent.config", %*{})
    check config{"agents"}.len >= 1
    check fileExists(config{"configPath"}.getStr(""))

suite "IPC: worktree + blame":
  test "Worktree.add/list/remove/prune and Blame.file work end-to-end":
    setup()
    let repo = makeRepo("ipc-wt-blame")
    let h1 = writeAndCommit(repo, "app.nim", "echo 1\necho 2\n", "init app")
    let h2 = writeAndCommit(repo, "app.nim", "echo 1\necho 22\necho 3\n", "edit app")

    let blame = data("Blame.file", %*{"path": repo, "file": "app.nim"})
    check blame{"lines"}.len == 3
    check blame["lines"][0]{"hash"}.getStr("") == h1
    check blame["lines"][1]{"hash"}.getStr("") == h2
    check blame["lines"][2]{"hash"}.getStr("") == h2

    let wtDir = getTempDir() / "knit-test" / "wt-hand-1"
    removeDir(wtDir)
    let added = data("Worktree.add", %*{"path": repo, "branch": "hand/test-1",
                                        "startPoint": "HEAD", "dir": wtDir})
    check added{"handId"}.getStr("").startsWith("h")
    check dirExists(wtDir)

    let listed = data("Worktree.list", %*{"path": repo})
    check listed{"worktrees"}.len == 2
    discard data("Worktree.remove", %*{"path": repo, "worktreePath": wtDir})
    discard data("Worktree.prune", %*{"path": repo})
    let after = data("Worktree.list", %*{"path": repo})
    check after{"worktrees"}.len == 1

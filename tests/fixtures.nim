## Real temporary repositories for the git-layer tests (docs/04 §9).

import std/[os, strutils]

import ../src/knit/gitops

proc gitOk(repo: string, args: openArray[string], stdin = "") =
  let res = runGit(repo, args, stdin = stdin)
  if res.code != 0:
    raise newException(IOError, "git " & args.join(" ") & " failed: " &
                       res.error & res.output)

proc makeRepo*(name: string): string =
  result = getTempDir() / "knit-test" / name
  removeDir(result)
  createDir(result)
  gitOk(result, ["init", "-q", "-b", "main"])
  gitOk(result, ["config", "user.name", "knit test"])
  gitOk(result, ["config", "user.email", "test@knit.local"])
  gitOk(result, ["config", "commit.gpgsign", "false"])
  gitOk(result, ["config", "core.autocrlf", "false"])

proc writeAndCommit*(repo, path, content, message: string): string =
  let full = repo / path
  createDir(full.parentDir)
  writeFile(full, content)
  gitOk(repo, ["add", "--", path])
  gitOk(repo, ["commit", "-q", "-m", message])
  let head = runGit(repo, ["rev-parse", "HEAD"])
  head.output.strip()

proc headOf*(repo: string): string =
  runGit(repo, ["rev-parse", "HEAD"]).output.strip()

proc commitAll*(repo, message: string): string =
  gitOk(repo, ["add", "-A"])
  gitOk(repo, ["commit", "-q", "-m", message])
  headOf(repo)

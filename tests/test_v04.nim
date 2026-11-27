## Tests for v0.4.0 Tier-1 & Tier-2 backend git operations and diff helpers.

import std/[unittest, os, strutils, json, base64]

import ../src/knit/[types, gitops, diff]
import ./fixtures

# Minimal valid 1x1 red PNG (67 bytes)
const TinyPngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
# Minimal valid 1x1 blue PNG (67 bytes)
const TinyPng2B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

suite "v0.4.0 git operations":
  test "tags, remotes, clone, init and push":
    # Init a bare remote repo
    let bare = getTempDir() / "knit-test" / "v04-bare.git"
    removeDir(bare)
    createDir(bare)
    check runGit(bare, ["init", "--bare", "-q"]).code == 0

    # initRepo creates a new repo with branch main
    let initDir = getTempDir() / "knit-test" / "v04-init"
    removeDir(initDir)
    let (initRes, dest) = initRepo(initDir, "main")
    check initRes.code == 0
    check dirExists(dest / ".git")
    discard runGit(dest, ["config", "user.name", "knit test"])
    discard runGit(dest, ["config", "user.email", "test@knit.local"])
    discard runGit(dest, ["config", "commit.gpgsign", "false"])
    let c1 = writeAndCommit(dest, "hello.txt", "v1\n", "initial commit")
    check c1.len == 40

    # Remote management: add, list, setUrl, remove
    check addRemote(dest, "origin", bare).code == 0
    check addRemote(dest, "backup", bare).code == 0
    let remotes = listRemotes(dest)
    check remotes.len == 2
    check setRemoteUrl(dest, "backup", bare & "/").code == 0
    check removeRemote(dest, "backup").code == 0
    check listRemotes(dest).len == 1

    # Push branch + tags
    check pushCurrent(dest, includeTags = false).code == 0
    check createTag(dest, "v0.1.0", "HEAD", "Release 0.1").code == 0
    check pushTag(dest, "v0.1.0").code == 0
    check createTag(dest, "v0.1.1", "HEAD", "").code == 0
    check deleteTag(dest, "v0.1.1", false).code == 0

    # Clone from local bare repo
    let cloneParent = getTempDir() / "knit-test" / "v04-clones"
    removeDir(cloneParent)
    createDir(cloneParent)
    let (cloneRes, cloned) = cloneRepo(bare, cloneParent, "cloned-repo")
    check cloneRes.code == 0
    check fileExists(cloned / "hello.txt")

    removeDir(bare)
    removeDir(initDir)
    removeDir(cloneParent)

  test "applyWorkdirPatch discards selected lines cleanly":
    let repo = makeRepo("v04-discard-hunk")
    discard writeAndCommit(repo, "f.txt", "line1\nline2\nline3\n", "init")
    writeFile(repo / "f.txt", "line1\nline2-mod\nline3\nline4-added\n")
    # Discard only line4-added using a sub-hunk patch
    let patch = "diff --git a/f.txt b/f.txt\n" &
                "--- a/f.txt\n" &
                "+++ b/f.txt\n" &
                "@@ -1,3 +1,4 @@\n" &
                " line1\n" &
                " line2-mod\n" &
                " line3\n" &
                "+line4-added\n"
    let res = applyWorkdirPatch(repo, patch, reverse = true)
    check res.code == 0
    check readFile(repo / "f.txt") == "line1\nline2-mod\nline3\n"
    removeDir(repo)

  test "compareFiles, diffOfRange, cherryPickMany, reflog and pickaxe":
    let repo = makeRepo("v04-range-pickaxe")
    let c1 = writeAndCommit(repo, "a.txt", "alpha\n", "c1")
    let c2 = writeAndCommit(repo, "a.txt", "alpha\nMAGIC_TOKEN_XYZ\n", "c2 add token")
    let c3 = writeAndCommit(repo, "b.txt", "beta\n", "c3 add b")

    # Compare range c1..c3
    let files = compareFiles(repo, c1, c3)
    check files.len == 2
    let rd = diffOfRange(repo, c1, c3, "a.txt")
    check rd.hunks.len == 1
    check rd.additions == 1

    # Pickaxe -S and -G
    let (hitsS, _, _) = logPage(repo, 20, pickaxe = "MAGIC_TOKEN_XYZ")
    check hitsS.len == 1
    check hitsS[0].hash == c2
    let (hitsG, _, _) = logPage(repo, 20, pickaxe = "MAGIC_.*XYZ", pickaxeRegex = true)
    check hitsG.len == 1
    check hitsG[0].hash == c2

    # Reflog
    let rl = reflogOf(repo, 20)
    check rl.len >= 3
    check rl[0].hash == c3

    # Batch cherry-pick onto a new branch from c1
    check runGit(repo, ["checkout", "-q", "-b", "target", c1]).code == 0
    let cpRes = cherryPickMany(repo, @[c2, c3])
    check cpRes.code == 0
    check fileExists(repo / "b.txt")
    check "MAGIC_TOKEN_XYZ" in readFile(repo / "a.txt")
    removeDir(repo)

  test "addGitignorePattern appends and deduplicates":
    let repo = makeRepo("v04-gitignore")
    discard writeAndCommit(repo, "readme.md", "hi\n", "init")
    check addGitignorePattern(repo, "dist/").code == 0
    check addGitignorePattern(repo, "dist/").code == 0
    let content = readFile(repo / ".gitignore")
    check content.count("dist/") == 1
    removeDir(repo)

  test "resolveConflictSide and imagePreviewOf":
    let repo = makeRepo("v04-binary-image")
    let png1 = decode(TinyPngB64)
    let png2 = decode(TinyPng2B64)
    let c1 = writeAndCommit(repo, "logo.png", png1, "add red png")
    check runGit(repo, ["checkout", "-q", "-b", "feat"]).code == 0
    let c2 = writeAndCommit(repo, "logo.png", png2, "change to blue png")

    # Image preview for commit c2
    let preview = imagePreviewOf(repo, "logo.png", hash = c2)
    check preview["supported"].getBool()
    check preview["beforeDataUrl"].getStr().startsWith("data:image/png;base64,")
    check preview["afterDataUrl"].getStr().startsWith("data:image/png;base64,")
    check preview["beforeDataUrl"].getStr() != preview["afterDataUrl"].getStr()

    # Create a binary conflict and resolve with theirs
    check runGit(repo, ["checkout", "-q", "main"]).code == 0
    discard writeAndCommit(repo, "logo.png", png1 & "extra", "diverge main")
    discard runGit(repo, ["merge", "feat"])
    let res = resolveConflictSide(repo, "logo.png", "theirs")
    check res.code == 0
    check readFile(repo / "logo.png") == png2
    removeDir(repo)

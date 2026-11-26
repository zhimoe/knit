# 04 · Git 层

> 铁律：**读用 libgit2（in-process），写用 git CLI（子进程）**。
> 任何「省一次进程」而改用 libgit2 写操作的想法，都要先在本文提 issue。

> **当前实现状态（2026-11-26）**：读路径已切换到 libgit2 in-process（`src/knit/gitlib.nim`：
> `statusOfLib` / `statusEntriesLib` / `logOfLib` / `refsOfLib` / `commitFilesLib` / `diffOfCommitLib` /
> `diffOfWorkdirLib` / `blameOfLib` / `worktreesOfLib`），并通过 `tests/test_gitlib.nim` 与 git CLI
> 逐项对拍；`--follow` 路径历史和 `-d:knitNoLibgit2` 回退到 CLI。写路径（commit/stage/rebase/cherry-pick/
> revert/reset/push/worktree/shelf）全部走 git CLI（含进程组终止与 `index.lock` 重试）。

## 1. 分工表

| 操作 | 实现 | 理由 |
|---|---|---|
| 仓库发现 `rev-parse --git-dir` | 纯文件系统判断（`.git` 目录 / `.git` 文件） | 快 100×，避免 spawn |
| `status` | libgit2 `git_status_list_new` | 30 仓库批量、可流式 |
| `log` / `revwalk` | libgit2 | 快，支持 lane 所需的 parent 关系 |
| `refs` / `branch list` / `tag list` | libgit2 reference iterator | 一次取全 |
| `diff`（tree↔tree / index↔workdir） | libgit2 `git_diff_*` | 结构化 hunk，天然适合渲染 |
| `blame` | libgit2 `git_blame_file`（`-M -C` 等价选项） | 同上 |
| `worktree list` | libgit2 `git_worktree_list` | 同上 |
| `merge` 的三方内容（读） | libgit2 `git_merge_trees` + `git_merge_file` | 拿结构化的冲突块 |
| **`worktree add`** | **CLI** | libgit2 有 API 但语义细节（`prune`/锁）以 CLI 为准；P1 再评估 |
| **`commit`** | **CLI** | 必须跑 pre-commit / commit-msg hooks |
| **`stage` / `unstage` / 逐块 stage** | **CLI**（`git apply --cached`） | patch 语义在 CLI |
| **`rebase` / `rebase -i`** | **CLI** | libgit2 无交互式 todo |
| **`cherry-pick` / `revert` / `reset` / `stash`** | **CLI** | 冲突续接状态在 `.git/` 里，CLI 更稳 |
| **`format-patch` / `am --3way`** | **CLI** | 同上 |
| **`fetch` / `pull` / `push`** | **CLI** | 凭据、LFS、progress 都在 CLI |

## 2. 子进程环境（必须显式设置）

所有 CLI 调用统一走 `gitops.exec(repo, argv, opts)`：

```nim
env 清空 GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_PREFIX
保持 GIT_CONFIG_GLOBAL / GIT_SSH_COMMAND（尊重用户配置）
GIT_OPTIONAL_LOCKS=0        # 读操作不抢 index.lock
GIT_TERMINAL_PROMPT=1       # 允许 git 自己弹凭据（GCM）
LC_ALL/LANG 不设置          # 用 git 自己的编码策略
argv 固定前缀：git -C <repo> -c core.quotePath=false <cmd> ...
stdout/stderr 以字节读，自己按 UTF-8 解码（非法字节替换 U+FFFD）
```

- 追加参数 `-c i18n.logOutputEncoding=UTF-8`（log 类命令）。
- 禁止 `sh -c` 拼接；argv 数组直传（Windows 上由 `osproc` 处理引号）。
- 超时：写操作 120 s、`fetch/push` 300 s、其余 30 s；超时先 `SIGTERM` 等 2 s 再强杀。

## 3. 读路径要点

### 3.1 仓库发现（`index.nim`）
- 从根目录递归，深度 ≤ 4（可配），跳过：`node_modules`、`target`、`.venv`、`vendor`、
  `.git` 自身、以及用户配置的目录名规则；**跳过隐藏目录**默认开启。
- 判定：`<dir>/.git` 是目录 → 普通仓库；是文件 → `gitdir: <path>`（worktree/submodule）。
- 命中仓库后**不再向下递归**。
- 并发：`stat` 用线程池（Nim `spawn`），但目录遍历本身是 IO-bound，4 路足够。
- 结果写 `index.json`，同时记录每层目录的 `mtime`，下次扫描只进 mtime 变化的子树。

### 3.2 status（`gitlib.status`）
```
git_status_options:
  show = GIT_STATUS_SHOW_INDEX_AND_WORKDIR
  flags = INCLUDE_UNTRACKED | RECURSE_UNTRACKED_DIRS | INCLUDE_IGNORED(off)
  pathspec = 需要时限定
repo 打开用 git_repository_open_ext(GIT_REPOSITORY_OPEN_NO_SEARCH)
```
输出映射（`RepoStat` 见 06）：
`index_new` → staged.added；`index_modified` → staged.modified；
`wt_modified` → unstaged.modified；`wt_new` → untracked；`conflicted` → conflict=true。
`ahead/behind` 用 `git_graph_ahead_behind(HEAD, upstream)`；无 upstream 时为 `null`。

### 3.3 log（`gitlib.log`）
- `revwalk` + `SORT_TOPOLOGICAL | SORT_TIME`，push HEAD 或 `refs/heads/<b>`。
- 过滤：`path` 用 `git_revwalk` 后逐条 `git_pathspec_match_commit`（P0 全量后再过滤，200 条足够快）。
- 批量取 commit：`git_commit_lookup` → `message/subject/author/time/parents`；
  refs 一次性从 reference iterator 建 `hash → [refName]` 映射（含 remote/tag）。
- 分页：`cursor` = 上一页最后一个 hash，下一页用 `revwalk.hide(cursor)` 之后取。

### 3.4 diff
```
tree↔tree:  git_diff_tree_to_tree(old, new)
index↔wd:   git_diff_index_to_workdir(flags = INCLUDE_UNTRACKED | INCLUDE_TYPECHANGE)
选项：context_lines = 3（折叠展开时用 50）
       interhunk_lines = 0
```
- hunk 头的 `old_start/new_start` 直接给前端（显示 `@@ -a,b +c,d @@` 的原文由宿主拼，便于和 git 一致）。
- 词级高亮：**宿主算**还是前端算？→ **宿主算**：对每条 del/add 成对行做 token 级 diff
  （按 `[\w]+|[^\s\w]+|\s+` 切词，Myers 或 `diff` 库），只返回 `hl` 子串范围数组 `[[start,len],...]`。
  前端只负责套 `<span>`。理由：避免前端重复实现，且能复用 libgit2 的行级结果。
- 二进制：`git_diff_blob_is_binary` → `binary: true` + 大小，不返回行。

### 3.5 blame
`git_blame_options`：`min_line/max_line` 分段（每 2000 行一段），
`flags = GIT_BLAME_TRACK_COPIES_SAME_FILE | GIT_BLAME_USE_MAILMAP(off)`；
返回 `{line, hash, author, time, summary}`。

## 4. 写路径命令清单（精确 argv）

```sh
# 提交（消息走 stdin，避免命令行编码/长度问题）
git -C <repo> commit -F - --cleanup=strip [--amend] [-- <paths...>]
#   stdin = 提交信息；若 Amend 且消息未改：git commit --amend --no-edit
#   hooks 正常执行；用户未显式开启时禁止 --no-verify

# 文件级 stage / unstage
git -C <repo> add -A -- <path...>
git -C <repo> restore --staged -- <path...>      # git < 2.23 时回退 git reset HEAD -- <path>
git -C <repo> restore --worktree -- <path...>    # 丢弃（先二次确认 + 自动 stash 快照）

# 逐块 stage（前端把 hunk 拼成标准 patch，含 diff --git 头与 ---/+++ 行）
git -C <repo> apply --cached --whitespace=nowarn [--reverse] -
#   stdin = patch；失败时映射为 kind=git，附 git 的 stderr 原文到 hint

# 提交并推送
git -C <repo> push [--set-upstream] <remote> <branch>

# rebase（交互式：写 todo，用脚本当编辑器）
git -C <repo> rebase -i <onto>        # env GIT_SEQUENCE_EDITOR=<我们生成的 .cmd/.sh>
git -C <repo> rebase --continue | --abort | --skip
#   状态读 .git/rebase-merge/{git-rebase-todo,done,msgnum,end,head-name}

# 其余
git -C <repo> cherry-pick <hash...> | --continue | --abort
git -C <repo> revert --no-commit <hash>          # UI 里确认后再提交
git -C <repo> reset --soft|--mixed|--hard <rev>  # hard 前自动 git stash create 快照
git -C <repo> stash push -m <msg> ; stash list ; stash pop
git -C <repo> format-patch -1 <hash> -o <dir>
git -C <repo> am --3way <file>
git -C <repo> worktree add <dir> -b <branch> <start-point> ; worktree list ; worktree remove <dir> ; worktree prune
git -C <repo> fetch --all --prune --progress
git -C <repo> pull --rebase|--no-rebase        # 跟随仓库配置
```

`--progress` 的 stderr 按行回收 → 推 `git:command` 事件（前端 Console 显示）。

## 5. 编码与路径

- Windows 路径可能是 UTF-16 surrogate 对或非 UTF-8 字节；libgit2 返回 UTF-8，
  CLI 输出加 `-c core.quotePath=false` 后再按 UTF-8 解码。
- 前端显示路径时统一 `/` 分隔，`direction: rtl` 做左省略。
- 大小写不敏感比较（Windows）：仓库去重用 `toLowerAscii(path)`。

## 6. 并发与锁

| 规则 | 说明 |
|---|---|
| 同仓库写串行 | 每仓库一个 FIFO 队列；写期间 status 延后 |
| 全局并发 8 | 与 IPC 池一致 |
| `index.lock` 冲突 | 重试 3 次（50/150/400 ms），仍失败 → `kind=busy`，提示「另一个 git 进程正在操作」 |
| 大量仓库 | 首轮 8 路并行；后续只重扫脏仓库 |
| 取消 | `IpcCallContext.isCancelled` 检查点：每个仓库、每个 500 ms 循环、每个子进程等待循环 |

## 7. 错误映射

| 来源信号 | kind | 用户提示（中文） |
|---|---|---|
| `fatal: not a git repository` | notRepo | 这个目录不是 git 仓库 |
| `index.lock` 存在 / `Unable to create ... lock` | busy | 另一个 git 进程正在操作，稍后重试 |
| `Permission denied` / `EACCES` | internal | 没有权限访问该文件 |
| `Authentication failed` / `terminal prompts disabled` | auth | 凭据失效，请在终端执行一次 git fetch 重新登录 |
| `CONFLICT` / `unmerged` | conflict | 存在冲突，先解决后再操作 |
| `no upstream branch` | git | 当前分支没有上游，需先 push -u |
| 超时 | timeout | 操作超过 N 秒，已中止 |
| 其余 | git | 原文 stderr 前 300 字符 + 建议 |

所有错误必须同时进 Console（红行），不允许只弹 toast。

## 8. 危险操作护栏

| 操作 | 护栏 |
|---|---|
| `reset --hard` | 先 `git stash create` 建快照（成功才执行），弹确认框显示将丢弃的文件数 |
| `push --force` | 默认 **`--force-with-lease`**，且受保护分支（配置项，默认 `main`,`master`）直接禁用 |
| 丢弃工作区改动 | 二次确认 + 自动快照进 Shelf |
| `rebase`/`cherry-pick` | 开始前记录 `HEAD` 到 `reflog` 书签 `knit:before-<op>` |
| `commit --amend` 已 push 的提交 | 提示「该提交已推送」 |
| hook 执行中 | 显示「正在运行 pre-commit hook…」，允许取消（杀进程组） |

## 9. 测试夹具

```nim
# tests/fixtures.nim
proc makeRepo(tmp: string, commits: int): string =
  # git init -q; 配置 user.name/email;
  # 连续提交，制造 merge / rename / 冲突各一个
```

必须覆盖：
1. porcelain/status：CRLF、rename、untracked 目录递归、conflicted、detached HEAD
2. diff：新增/删除/重命名/二进制/空文件/超长行（>2000 字符）/无换行结尾
3. hunk patch 往返：`git diff` → 前端拼 patch → `git apply --cached` 成功且 index 内容一致
4. rebase -i：todo 重排 + squash + fixup，与直接 `git rebase -i` 结果 hash 一致
5. 与 CLI 对拍：同一仓库用 libgit2 与 `git status --porcelain=v2` 的结果**逐字节等价**（这是回归测试的核心）

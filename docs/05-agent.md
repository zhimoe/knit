# 05 · 终端与 Agent

> 目标：在「某个提交 / 某个工作区」上，一键让 pi / codex 等进入**读代码模式**或**提交模式**，
> 而不是每次都手动贴 diff、敲一段解释性 prompt。

## 1. 概念

| 词 | 含义 |
|---|---|
| **grove** | 一个根目录下的一组仓库（= 侧栏那一列） |
| **hand** | 一个 agent 的独立工作区 = `git worktree`，位于 `<root>/.knit/hands/<repo>-<handId>/` |
| **session** | 一次 agent 会话，绑定 (repo, hand, mode, skills, rev) |
| **mode** | `read` 读代码 / `commit` 写提交信息 / `review` 审改动 |
| **skill** | 一段可复用的 prompt 片段（用户自己的 `SKILL.md`） |

**为什么 hand 必须是 worktree**：agent 并行改同一份工作区会互相踩；
每个 hand 一个 worktree → 天然隔离，织回主线时就是一次干净的 merge/rebase。
worktree 目录放在 grove 根下的 `.knit/hands/`（**在仓库之外**，避免 status 把 worktree 当未跟踪文件）。

## 2. 配置

`%APPDATA%\knit\agents.json`（P0 手写即可，P1 提供 UI）：

```json
{
  "schemaVersion": 1,
  "defaultAgent": "pi",
  "concurrency": 2,
  "agents": [
    {
      "id": "pi",
      "label": "Pi",
      "command": "pi",
      "promptArg": ["-p", "@{promptFile}", "--no-session"],
      "resumeArg": null,
      "env": {},
      "cwd": "{hand}"
    },
    {
      "id": "codex",
      "label": "Codex",
      "command": "codex",
      "promptArg": [],
      "stdinFirstLine": "{promptOneLine}",
      "env": {},
      "cwd": "{hand}"
    }
  ],
  "skills": [
    { "id": "understanding-anything", "label": "读代码", "path": "~/skills/understanding-anything/SKILL.md" },
    { "id": "commit-msg", "label": "提交信息", "path": "~/skills/commit-msg/SKILL.md" },
    { "id": "repo-map", "label": "仓库地图", "path": "~/skills/repo-map/SKILL.md" },
    { "id": "changelog", "label": "变更日志", "path": "~/skills/changelog/SKILL.md" }
  ],
  "modes": {
    "read": ["understanding-anything"],
    "commit": ["commit-msg"],
    "review": ["understanding-anything", "repo-map"]
  }
}
```

注入优先级（按顺序尝试，命中即用）：

1. `promptArg` 里含 `{promptFile}` → 用参数传文件路径
2. `stdinFirstLine` → 把单行化的 prompt 作为 stdin 第一行
3. 都没有 → 把 prompt 写入 stdin（多行），等 agent 自己读

**禁止**假设某个 agent 的具体 flag；一切以配置声明为准。
启动失败（`command` 找不到）时，UI 里灰色禁用该 agent 并给「配置路径」链接（与 mygo-work 一致的做法）。

## 3. Prompt 组装（宿主负责，不让 agent 自己猜）

会话开始时写 `.git/knit/session/<sessionId>/prompt.md`：

```markdown
<!-- knit session -->
repo: <绝对路径>
branch: <branch>            # 或 detached @ <short hash>
hand: <worktree 路径 或 "main worktree">
mode: read|commit|review
rev: <hash>                 # mode=read/review 时
staged: <n> 个文件 (+a -d)  # mode=commit 时
generated: <ISO8601>

## 你的角色
<按 mode 展开>

## Skills（按顺序逐个读取并遵守）
1. ~/skills/understanding-anything/SKILL.md
2. ~/skills/repo-map/SKILL.md

## 约束
- 只读模式：不要修改任何文件；不要执行 git 写命令。
- 提交模式：只输出一条符合 Conventional Commits 的提交信息，不要输出解释。
- 不要输出 diff 全文；引用请用 `path:line`。
- 若信息不足，先问一个最小的问题，不要猜。

## 本次任务的输入
<mode=commit>  见 git diff --cached（已由宿主导出到 .git/knit/session/<id>/staged.patch）
<mode=read>    目标提交：<hash> <subject>（补丁在 <id>/commit.patch）
```

各 mode 的「角色」文本（可直接抄）：

- **read**：`你在帮我读代码。先读 README/架构文档确认模块边界，再按调用链读实现；结论用 3–6 条要点，每条带 path:line。`
- **commit**：`你在写提交信息。读 staged.patch 与最近 10 条提交信息（style.txt），输出 <type>(<scope>): <subject> + 空行 + 2–4 行 body。`
- **review**：`你在做提交前审查。找出行为变更、潜在 bug、缺失测试；按严重度排序，最多 5 条；不要提风格偏好。`

同时导出的文件（都在 session 目录内，便于 agent 直接读）：

```
prompt.md  staged.patch | commit.patch  style.txt（最近 10 条 subject）  meta.json
```

## 4. 进程与流式

```
Agent.start → 选择 agent 配置 → 组 prompt → spawn(command, args, cwd, env)
  stdout(按行) → 合批 100 ms → 事件 agent:output {sessionId, chunk}
  stderr       → 同上，标记 stream:"err"（前端暗红）
  exit         → agent:exit {sessionId, code}
Agent.write  → 写 stdin 一行（提交模式禁用，只读模式禁用）
Agent.stop   → 先 graceful（关 stdin），2 s 后 kill 进程组
```

- 并发上限 `concurrency`（默认 2），超出排队并在 UI 显示「排队中」。
- 每个会话独立进程组；关闭窗口时全部 kill（nimi 的窗口关闭取消约定）。
- 输出缓冲：单会话保留最近 5000 行，超出丢弃最旧并插入 `⋯ 已截断`。

## 5. UI 行为（对齐 02-ui-spec §3.10）

| 动作 | 行为 |
|---|---|
| 切仓库 | 停掉当前会话（若是 read/review），按新仓库重开 |
| 切模式 | 重开会话（清屏 + 新 prompt）；有未完成会话时提示 |
| 切 skill | 重开会话（prompt 变了）；记录到 settings 以便下次默认 |
| `✨ 用 agent 生成`（提交页） | 切到 `commit` 模式，跑一次「一次性会话」：输出 → 提交信息框；不改草稿记忆规则 |
| 「在 Agent 中分析」（提交详情） | `read` 模式 + `--rev=<hash>` |
| 点侧栏仓库的「终端」 | 直接开 `term` 标签（普通 shell，不走 agent） |

## 6. 终端（非 agent）

- P0：`cmd.exe /d /q`（或 `settings.terminal.shell`），管道模式，无 PTY。
  明确在 UI 标注「基础模式：无 TUI 支持」。
- P1：接 ConPTY（Windows）以获得完整 TUI；需要 nimi 的流式 IPC 补丁。
- 终端会话在工作区目录启动，`env` 注入 `KNIT_REPO`、`KNIT_ROOT`。

## 7. 安全

| 风险 | 处理 |
|---|---|
| agent 在只读模式写文件 | 提示词约束 + 会话后检测工作区是否变脏，变了就显示警告与「恢复到打开前」 |
| agent 拿到凭据 | 不清空 `GIT_*`，但**不注入** `GIT_ASKPASS`/token；不把 `settings.json` 暴露 |
| 恶意 skill 注入 | skill 只从配置的绝对路径读；UI 显示实际路径；不允许从仓库内相对路径加载 |
| 命令注入 | `command` + `args` 数组直传，不经过 shell |
| 输出含控制字符 | 前端白名单渲染（只留 ANSI 颜色），其余转义 |
| 崩溃残留 | 会话目录 7 天后清理；进程用 job object 绑定（Windows） |

## 8. 验收（M5）

1. `pi` 与 `codex` 各跑通 `read` 模式：能在 30 s 内给出带 `path:line` 的结论。
2. `commit` 模式产出符合 Conventional Commits 的信息，写入输入框不算「用户已编辑」（不覆盖用户手改）。
3. 只读会话结束后工作区 `status` 为空；若非空，出现警告条。
4. 断网/命令不存在：UI 不崩，给出可操作的错误。
5. 关窗口后 `tasklist` 里没有残留 agent 进程。

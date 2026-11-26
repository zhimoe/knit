# 03 · 架构

## 1. 总体

```
┌─────────────────────────── knit.exe (Nim, ARC) ───────────────────────────┐
│  main.nim                                                                 │
│   ├─ nimi core: 窗口 / WebView2 / nimi:// FileServer / watch / dialog      │
│   ├─ store.nim    设置、排除规则、索引缓存、draft 兜底（JSON / SQLite）    │
│   ├─ index.nim    根目录扫描、仓库发现、增量失效                           │
│   ├─ gitlib.nim   libgit2 FFI（读）：status/log/diff/blame/refs           │
│   ├─ gitops.nim   git CLI（写）：commit/rebase/am/push/worktree + 解析    │
│   └─ agent.nim    spawn pi/codex、注入 prompt/skills、流式回收             │
└───────────────▲───────────────────────────────────┬──────────────────────┘
                │ bindBackgroundService (JSON, ≤256KB)│ push 事件（分块）
┌───────────────┴───────────────────────────────────▼──────────────────────┐
│ WebView2: nimi://app/index.html                                          │
│  TypeScript: 手写 DOM 视图（diff/合并自绘）+ 草稿记忆                      │
└──────────────────────────────────────────────────────────────────────────┘
```

没有本地 HTTP 服务，没有额外进程（除用户配置的 agent 与 git CLI 子进程）。

## 2. 线程模型

| 线程 | 做什么 | 禁止 |
|---|---|---|
| UI 主线程 | nimi 事件循环、`bindService`、窗口操作 | 任何 git 调用、文件大读写 |
| 运行时 | `config.nims`：`--mm:refc --threads:on` | 原因见 §7.1（ARC/ORC 下后台 IPC 不稳） |
| IPC 工作池（nimi 内置，有界） | 所有 `bindBackgroundService` 方法 | 触碰窗口/菜单/控件树 |
| git CLI 子进程 | 写操作 | 并发同仓库写 |

**同仓库串行化**：宿主维护 `Table[repoPath, seq[pending]]`，
写操作与 status 互斥（写期间 status 用陈旧值，写完后立即刷新一次）。
不同仓库并发上限 8（与工作池一致）。

**取消**：每个 `backgroundMethod` 的 `work` 在循环里检查 `context.isCancelled`；
CLI 子进程用 `--` 之外的超时兜底（fetch/push 默认 120 s，其余 30 s）。

## 3. IPC 契约

> nimi 的两种注册方式：
> `bindService`（UI 线程同步，短操作）与
> `bindBackgroundService(service, [backgroundMethod(...)])`（工作池，参数与返回都是 JSON 字符串）。

### 3.1 服务清单

| 服务.方法 | 线程 | 入参 | 返回 | 超时 |
|---|---|---|---|---|
| `Knit.ping` | UI | — | `{version}` | — |
| `Knit.getState` | UI | — | `{root, exclusions, selectedRepoId, lastScanAt}` | — |
| `Knit.setRoot` | UI | `{path}` | `{ok}` | — |
| `Knit.setExclusions` | UI | `{globs[], repos[]}` | `{ok}` | — |
| `Repo.scan` | 池 | `{root, globs[], depth=4}` | `{repos: Repo[], scanned, skipped, ms}` | 60 s |
| `Repo.cached` | 池 | `{root}` | `{repos: Repo[]}`（index.json） | 5 s |
| `Repo.status` | 池 | `{paths?: string[], reason}` | `{repos: RepoStat[], ms}` | 30 s |
| `Repo.changes` | 池 | `{path}` | `{files: FileEntry[], ms}` | 30 s |
| `Log.list` | 池 | `{path, limit=200, branch?, all?, filterPath?}` | `{commits: Commit[], ms}` | 20 s |
| `Log.files` | 池 | `{path, hash}` | `FileEntry[]` | 20 s |
| `Log.refs` | 池 | `{path}` | `{refs: Ref[]}` | 10 s |
| `Diff.commit` | 池 | `{path, hash, file, ignoreWhitespace?, contextLines?}` | `{diff: DiffFile}`（≤240KB，超出走 chunk） | 20 s |
| `Diff.workdir` | 池 | `{path, file, staged?, untracked?, ignoreWhitespace?, contextLines?}` | `{diff: DiffFile}` | 20 s |
| `Diff.context` | 池 | 同 workdir（`contextLines=500`） | `{diff: DiffFile}` | 20 s |
| `Diff.chunk` | 池 | `{token, index}` | `{index, count, chunk}` | 20 s |
| `Blame.file` | 池 | `{repoId, path, hash?}` | `{lines: BlameLine[]}` | 30 s |
| `Stage.hunk` | 池 | `{path, patch, reverse?}` | `{ok}` | 20 s |
| `Stage.files` | 池 | `{path, files[], staged: bool}` | `{ok}` | 20 s |
| `Stage.discard` | 池 | `{path, files[]}`（自动 stash 快照） | `{ok}` | 120 s |
| `Commit.create` | 池 | `{path, message, amend, push}` | `{hash, pushError?}` | 120 s |
| `Commit.cherryPick` / `revert` / `patch` | 池 | `{path, hash}` | `{ok}` / `{file}` | 120 s |
| `Merge.state` | 池 | `{path, file}` | `MergeState` | 20 s |
| `Merge.resolve` | 池 | `{path, file, resolved}` | `{ok}` | 20 s |
| `Shelf.list/save/apply/drop/stat/import` | 池 | `{path, …}` | `ShelfItem[]` / `{ok}` / `{text}` | 20–120 s |
| `Agent.start` | 池（0 超时） | `{path, sessionId, mode, skills[], rev?, agent?}` | `{sessionId, code}`（结束时） | — |
| `Agent.write` | 池 | `{sessionId, chunk}` | `{ok}` | 5 s |
| `Agent.stop` | 池 | `{sessionId}` | `{ok}` | 5 s |
| `Agent.config` | 池 | `{}` | `AgentConfig` | 5 s |
| `Git.console` | 池 | `{}` | `{commands: ConsoleEntry[]}` | 5 s |
| `Worktree.list` | 池 | `{path}` | `{worktrees: …}` | 10 s |
| `Editor.openFile` | UI | `{path, line?}` | `{ok}` | — |
| `External.openTemp` | 池 | `{path, hash, file}` | `{path}`（临时文件） | 20 s |

返回统一外壳：成功 `{ok:true, data}`，失败 `{ok:false, error:{kind, message, hint?}}`
（`kind` ∈ `notRepo | busy | auth | conflict | notFound | timeout | git | internal`）。

### 3.2 大载荷：分块协议

单次 IPC ≤ 256 KB（JSON 字符串实测 > 512 KB 时 UI 帧明显掉）。

```
第一块（内联，小 diff）：{hunks:[...]}                         // size ≤ 256KB
大 diff：
  Diff.commit → {token, size, truncated:true, preview:{hunks 前 40 行}}
  Diff.chunk  → {token, index} → string（≤ 200KB/块）
  前端逐块 append，全部到齐后替换 preview
```

- token 是宿主分配的临时键，指向 `%APPDATA%\knit\blobs\<token>.json`；
  超过 10 分钟或超过 50 个未使用自动清理。
- **禁止**把整份 diff 编码成一个字符串塞进 `data`。
- **禁止**在前端拼 patch 再回传超过 100 KB 的内容（逐块 stage 时按 hunk 传）。

### 3.3 事件推送（宿主 → 前端）

nimi 目前没有流式 Channel（见 `nimi` 文档的 backlog），P0 用**双通道**：

| 事件 | 机制 | 频率 |
|---|---|---|
| `repo:changed` | `window.eval("window.knitEvent(...)")` 单条 JSON | watch 触发，300 ms debounce |
| `git:command` | 同上，用于 Console 面板 | 每命令 1 条 |
| `agent:output` | 同上，行级；100 ms 合批 | 流式 |
| `agent:exit` | 同上 | 一次性 |

前端暴露唯一的全局接收器：

```ts
window.knitEvent = (name: string, payloadJson: string) => { /* 分发 */ };
```

P1：向 nimi 提「流式 Channel」补丁（见 §7）。

## 4. 启动时序（300 ms 预算）

```
0 ms     窗口创建，加载 nimi://app/index.html
20 ms    Knit.getState（UI 线程，读 state.json）
40 ms    store 读 index.json → 立即渲染侧栏（带陈旧徽标：灰点）
60 ms    Repo.scan（后台，深度 4；命中缓存 mtime 的目录跳过）
          → 发现新仓库则逐条推送 repo:found，前端增量插入
150 ms   Repo.status（8 路并行，先跑 selectedRepo，再跑其余）
300 ms   列表全部为实时状态，状态栏更新「最后刷新」
```

要点：
- **先缓存后实时**：不允许「等 git 扫完才画 UI」。
- `index.json` 里存 `{repoPath, gitDirMtime, lastCommitAt, branch, dirtyHint}`，
  打开时先用它渲染，`Repo.status` 回来再覆盖。
- 若 `index.json` 缺失（首次运行）→ 骨架屏 + 进度（状态栏显示已扫目录数）。

## 5. 缓存与失效

| 层 | 内容 | 失效条件 |
|---|---|---|
| L0 内存 | 当前仓库 log 前 200 条、当前文件 diff、refs | 切仓库 / watch 事件 / 显式刷新 |
| L1 磁盘 `index.json` | 仓库列表、每个仓库的 `lastCommitAt`/`branch`/`dirtyHint` | 每次 status 后写（原子替换） |
| L2 磁盘 `logs/<repoId>.json` | 该仓库最近 200 条提交（含 refs） | watcher 命中 `.git/refs/**` 或 HEAD |
| L3 `blobs/` | 分块 diff | TTL 10 min |

写入一律「临时文件 + rename」；不写 `.git` 之外的位置（除 `blobs`、`logs`）。

## 6. 文件监视

- `watch(root, fn)`（nimi 的 `ReadDirectoryChangesW` 封装）**每根目录一个**。
- 过滤：只关心 `HEAD`、`.git/refs/**`、`.git/index`、`.git/MERGE_HEAD`、工作区文件；
  忽略 `.git/objects/**`、`.git/logs/**`、`node_modules`、排除规则。
- 命中后：标记仓库脏 → 300 ms debounce → `Repo.status({paths:[该仓库]})`。
- 单次事件风暴上限：同一仓库 1 s 内最多触发 2 次 status。

## 7. 需要的框架补丁（登记后单独提交到 nimi）

### 7.1 已确认的框架问题与本地兜底

| 问题 | 复现 | 本项目处理 |
|---|---|---|
| 后台 IPC 通道在 `--mm:arc` / `--mm:atomicArc` / `--mm:orc` 下反复调用会堆损坏（SIGSEGV，栈在 `completeIpcCall` 的 JSON 序列化/解析） | `scripts/repro-nimi-ipc.nim`：最小 nimi 窗口 + 一个 `bindBackgroundService` 方法，页面每 300 ms 调一次，几十次内崩溃；同步 `bindService` 不崩；`--mm:refc` 不崩 | `config.nims` 使用 `--mm:refc --threads:on`；不修改 nimi。上游修复后回退到 arc。 |

> 这是运行时选择，不是产品代码分支；服务器/Windows 构建同样使用该 config。
> 事件推送仍然走 `window.eval`，且前端对 `window.knitEvent` 的处理统一 `setTimeout(0)`
> 延后到一次新的宏任务，避免在原生 eval 栈内同步回调 bridge。

### 7.2 计划中的补丁

| 需求 | 现在 | 影响 | 优先级 |
|---|---|---|---|
| 流式 IPC（Channel） | 只有 JSON 往返 | agent 输出 / fetch 进度只能靠 `eval` 推送 | P1 |
| `FileServer` 支持运行时追加根（`blobs/`） | 单根、启动时注册 | 大 diff 只能走分块 IPC | P1 |
| `devCommand`/`devUrl`（vite HMR） | 文档有设计，CLI 未实现 | 前端开发要手动重建 → **已在 `src/main.nim` 用 `KNIT_DEV=1` 内建 reload watcher 兜底** | P0 已兜底，P1 上游 |
| 安装器/签名/自动更新 | 无 | 分发 | P1 |

兜底方案（P0 必须先做，不能等上游）：
- **已实现**：`KNIT_DEV=1` 时 `main.nim` 自己 `watch(web/dist)`，250 ms debounce 后 `window.eval("location.reload()")`。
  配合 `cd web && bun run dev`（bun 侧 watch 重建）即可得到近似 HMR。
- 大 diff 分块：按 §3.2（M2.6 落地）。

## 8. 打包

```
dist/knit.exe                 （Nim 静态链 libgit2）
dist/WebView2Loader.dll
dist/resources/               （web/dist 的构建产物，由 nimi.json resources 复制）
```

- libgit2 用 **MinGW 静态库**（vcpkg triplet `x64-mingw-static`，或 msys2 `mingw-w64-x86_64-libgit2` 的 `.a`），
  依赖链：`libgit2 + libssh2 + mbedtls/zlib + pcre2`。与 nimi 用的同一个 gcc，禁止混 MSVC。
- exe 目标 ≤ 12 MB；超了先查是否误链了动态 CRT 或 debug 符号。
- `nimi.json` 的 `identifier` = `com.zhimoe.knit`，`slug` = `knit`。
- P1 安装器：Inno Setup 或 MSIX（exe + 开始菜单 + 文件关联暂不做）。

## 9. 日志与自诊断

- `%APPDATA%\knit\logs\knit.log`：滚动 5 个 × 2 MB。
- 级别由 `settings.json` 的 `logLevel`（`error|warn|info|debug`）。
- **禁止**记录：文件内容、diff 正文、token、完整 commit message（只记前 40 字符）。
- UI 的 Console 标签读宿主内存环形缓冲（500 条），不走日志文件。

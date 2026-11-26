# 06 · 数据模型与存储

## 1. 标识

| 概念 | 规则 |
|---|---|
| `repoId` | 仓库绝对路径的 **sha1 前 12 位**（小写 hex），例：`a1b2c3d4e5f6`。Windows 路径先 `toLowerAscii` 再规范化（`\` → `/`） |
| `handId` | `h` + 6 位随机 base36 |
| `sessionId` | `<repoId>-<yyyyMMddHHmmss>-<4 位随机>` |
| `blobToken` | `b` + 8 位 base36 |

前端所有 key（localStorage、DOM data 属性、请求参数）统一用 `repoId`，不传绝对路径。

## 2. Wire 类型（TS，前端手写 d.ts，宿主按此序列化）

```ts
type RepoId = string;

interface Repo {
  id: RepoId;
  name: string;            // 目录名
  path: string;            // 绝对路径，/ 分隔
  branch: string | null;   // detached 时为 null
  detached: boolean;
  head: string;            // short hash
  lang: string;            // 依据主要文件后缀猜，未知为 "—"
  ahead: number | null;    // 无 upstream 为 null
  behind: number | null;
  dirty: { staged: number; unstaged: number; untracked: number; conflicted: number };
  lastCommitAt: number;    // epoch ms
  worktrees: Worktree[];   // P1
  error?: { kind: string; message: string };
}

interface Worktree { path: string; branch: string | null; handId: string | null; locked: boolean; }

interface Ref { name: string; type: 'head' | 'branch' | 'remote' | 'tag'; target: string; }

interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: { name: string; email: string };
  committedAt: number;
  subject: string;
  body: string;
  refs: string[];          // ["HEAD -> main", "origin/main", "tag: v0.1.3"]
}

type FileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U';

interface FileEntry {
  path: string;
  oldPath?: string;
  status: FileStatus;
  group: 'commit' | 'staged' | 'unstaged';
  additions: number;
  deletions: number;
  binary?: boolean;
  untracked?: boolean;
  conflict?: boolean;
}

interface DiffFile {
  path: string;
  oldPath?: string;        // R/C 时
  status: FileStatus;
  binary: boolean;
  size?: number;           // binary 时
  additions: number;
  deletions: number;
  hunks: Hunk[];           // truncated 时为空，用 preview
  truncated?: boolean;     // 走分块协议（单块 ≤ 180 KB）
  token?: string;          // blobs/<token>.json
  chunks?: number;
  preview?: { hunks: Hunk[] };  // 首屏 200 行
}

interface Hunk {
  header: string;          // "@@ -38,9 +38,11 @@ export async function scanTree"
  oldStart: number; oldLines: number;
  newStart: number; newLines: number;
  rows: DiffRow[];
}

interface DiffRow {
  t: 'ctx' | 'add' | 'del';
  oldNo?: number;
  newNo?: number;
  text: string;
  hl?: [number, number][]; // 词级高亮：[start, length] 数组
}

interface ConflictBlock {
  index: number;
  start: number;           // 冲突标记在结果文件中的 1-based 行
  ours: { start: number; lines: string[] };
  theirs: { start: number; lines: string[] };
  base?: { start: number; lines: string[] };
}

interface MergeState {
  path: string;
  ours: string;            // index stage 2
  theirs: string;          // index stage 3
  base: string;            // index stage 1
  lines: string[];         // 工作区文件（含冲突标记）
  blocks: ConflictBlock[];
  binary: boolean;         // 二进制冲突不做三栏
}

interface ShelfItem {
  id: string;              // patch 绝对路径 | stash@{n}
  kind: 'patch' | 'stash';
  name: string;
  subtitle: string;
  path: string;
  epochMs: number;
}

interface ConsoleEntry { cmd: string; ms: number; ok: boolean; detail?: string; }
```

## 3. 磁盘布局

```
%APPDATA%\knit\
  settings.json          用户设置（schemaVersion, root, exclusions, editor, terminal, logLevel）
  agents.json            agent/skills 配置（见 05）
  state.json             窗口尺寸、上次选中仓库、drawer 高度
  index.json             仓库索引缓存（见 §5）
  logs\knit.log(.1..4)   滚动日志
  blobs\<token>.json     分块 diff，TTL 10 min
  sessions\<sessionId>\  可选（默认关，用户勾选「保留会话」时把 .git/knit 下的会话复制过来）

<repo>\.git\knit\
  hand.json             {handId, agent, sessionId, createdAt, worktreePath}
  shelf\<id>.patch      待评审快照（标准 git patch，可 git apply）
  session\<id>\         prompt.md / staged.patch / commit.patch / style.txt / meta.json
```

**不要把任何 knit 数据写进工作区**（除用户主动创建的 worktree，且位于 `<root>/.knit/hands/`）。

## 4. settings.json

```json
{
  "schemaVersion": 1,
  "root": "C:/Users/zhimoe/code",
  "scanDepth": 4,
  "excludeGlobs": ["node_modules", "target", ".venv", "vendor", ".git", "dist"],
  "excludeRepos": ["C:/Users/zhimoe/code/bak"],
  "selectedRepoId": "a1b2c3d4e5f6",
  "editor": { "command": "code", "args": ["-g", "{file}:{line}"] },
  "terminal": { "shell": "cmd.exe", "args": ["/d", "/q"] },
  "diff": { "mode": "split", "contextLines": 3, "ignoreWhitespace": false },
  "protectedBranches": ["main", "master"],
  "confirmDangerous": true,
  "logLevel": "info"
}
```

`editor.args` 占位符：`{file}` 绝对路径、`{line}`、`{col}`。命令不存在时回退到系统默认关联（`ShellExecute`）。

## 5. index.json

```json
{
  "schemaVersion": 1,
  "scannedAt": 1700000000000,
  "root": "C:/Users/zhimoe/code",
  "dirMtimes": { "C:/Users/zhimoe/code": 1700000000, "C:/Users/zhimoe/code/nimi": 1699999999 },
  "repos": [
    { "id": "a1b2c3d4e5f6", "name": "nimi", "path": "C:/Users/zhimoe/code/nimi",
      "branch": "main", "head": "9f3c1a2", "lastCommitAt": 1700000000000,
      "dirtyHint": 5, "conflictHint": 1 }
  ]
}
```

用途：冷启动先渲染，不阻塞。`dirMtimes` 让第二次扫描只进变化的子树。
`dirtyHint` 只是提示色，真实值永远来自 `Repo.status`。实现里 `index.json`
同时保存完整 `Repo[]`（状态点/分支/时间），冷启动先渲染它，再由 `Repo.status`
覆盖；`Repo.status` 完成后按仓库合并回写。

## 6. 草稿（提交信息记忆）

- P0：`localStorage`，键 `knit.draft.<repoId>`，值 `{"text": "...", "ts": 1700000000000}`。
- `knit.msgHistory`：全局最近 20 条提交信息（字符串数组，前端 push）。
- `knit.ui.<repoId>`：该仓库的 UI 偏好（diff 模式、折叠状态、上次选中的 tab）。
- WebView2 的 user data dir 由宿主指定为 `%APPDATA%\knit\webview`，保证跨版本保留。
- **P1**：草稿迁到宿主 `%APPDATA%\knit\drafts\<repoId>.json`，
  理由：IPC 触发提交时宿主要能读到草稿；localStorage 只在窗口内可见。迁移时两处都读，以宿主为准。

## 7. 兼容与迁移

- 所有 JSON 顶层 `schemaVersion`。读到更低版本 → 按迁移表逐级升级，写回。
- 读到更高版本 → 只读模式启动，横幅提示「配置来自更新版本」。
- 迁移不得删除用户数据：旧文件改名为 `<name>.v<old>.bak`。

## 8. 一致性规则

| 场景 | 规则 |
|---|---|
| 仓库被删除/移动 | `index.json` 里的条目在下次 status 失败后标 `error.kind=notFound`，侧栏灰显「未找到」，可移除 |
| 同一物理仓库通过不同路径出现（junction/短路径） | 用 `rev-parse --git-common-dir` 归一化后去重 |
| 同一 worktree 出现在多个 grove | 允许；`repoId` 基于 worktree 路径，`hand.json` 记 `commonDir` |
| 时间 | 一律 epoch ms 存，展示用本地时区；相对时间由前端算（<1min 刚刚，<1h N 分钟前，<24h N 小时前，<7d N 天前，否则日期） |

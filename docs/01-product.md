# 01 · 产品需求

## 1. 定位

一句话：**knit 是一个「多仓库 + 多 agent」的 Git 控制台**，把并行 agent 产出的分支/worktree
在一个窗口里看住、评审、织回主线。

- 用户：单人为主（会同时跑 5–30 个仓库/agent 的开发者）
- 形态：Windows 桌面应用（exe ≈ 5–10 MB，系统 WebView2）
- 与竞品的关系：**Log / diff / 合并抄 JetBrains，多仓库看板是差异点**

| | JetBrains IDEA | Fork / Sublime Merge | knit |
|---|---|---|---|
| 仓库数 | 1 个项目 | 1 个窗口 1 个仓库（多窗口） | **N 个仓库，一屏总览** |
| diff 质量 | 行业标杆 | 极快 | 对齐 JetBrains |
| agent 协作 | 无 | 无 | **worktree 即 hand，终端带 skills 注入** |
| 体积 | ~2 GB | ~30 MB | ~10 MB |

## 2. 用户场景（验收时逐条走）

**S1 一次接入**
选 `C:\Users\zhimoe\code` → 自动发现 24 个子仓库 → `bak`（非 git）不出现 →
`node_modules` 等目录被跳过 → 首屏 300 ms 内出列表。

**S2 30 个仓库里找到那一个**
侧栏输入 `nim` → 只剩 nimi/nsgo-mygo… 相关项，输入到出结果 < 50 ms。
`⌘/Ctrl+P` 打开快速跳转，方向键选中回车切过去。

**S3 看一个提交**
选中 nimi → Log 显示分支图 + 提交列表 → 点某个提交 → 右侧详情（message/作者/文件 +\-）→
点文件 → diff（并排、未变区块折叠、词级高亮）→ 上/下一处跳动。

**S4 定位到源文件**
在提交详情的文件行点「历史」→ Log 顶部出现路径过滤 chip，只剩改过该文件的提交。
点「打开此版本」→ 用系统外部编辑器打开该文件在该 revision 的内容（`git show rev:path` 落临时文件）。

**S5 提交，且不想重写消息**
切到「本地改动」→ 输入框里是**上次为这个仓库写的草稿**（重启后仍在）→ 补两句 →
勾掉不该提交的文件 → 提交。下次切回这个仓库，草稿还在。

**S6 agent 读代码 / 写提交信息**
点「✨ 用 agent 生成」→ 底部 Agent 抽屉进入 `--mode=commit`，注入 `commit-msg` skill，
读 staged diff，吐 Conventional Commits 写回输入框。
在某个提交上点「在 Agent 中分析」→ `--mode=read` + `understanding-anything`，agent 先读架构文档再答。

**S7 冲突**
「本地改动」里冲突文件显示「解决冲突」→ 三栏合并（Yours / Result / Theirs）→
逐块接受 → 应用并 `git add`。

## 3. 范围

### P0 必须（M1–M3）
- 根目录选择 + 递归发现 + 排除（目录名规则 / 单仓库）
- 侧栏搜索、⌘P 快速跳转
- Log：分支图、提交列表、提交详情、路径过滤
- diff：并排 / 统一、折叠未变、词级高亮、上下一处、逐块暂存（本地改动内）
- 本地改动：文件勾选、逐块 stage、提交信息草稿记忆、amend、提交、提交并推送
- 打开此版本（外部编辑器）、历史（路径过滤）
- 三栏合并 + 自动解决简单冲突
- Agent 抽屉：模式、skills、注入、spawn、流式输出（分块）

### P1 应该
- rebase -i 对话框（JetBrains 同款表格 + 拖拽重排）
- cherry-pick 多选、revert、reset、stash/shelf、patch 创建与应用（`--3way`）
- blame（按提交着色、`-M -C`）
- worktree 管理（= hand），多 agent 看板
- 安装器、签名、自动更新
- 命令行 `knit`（同一套 core 的薄壳）

### P2 可选
- AI 提交信息历史、PR 描述草稿、冲突语义解释
- CI 状态、commit 图形搜索、大 diff 虚拟化优化
- 多窗口 / 跨仓库批量提交

### 非目标（明确不做）
- ❌ 内置代码编辑器（diff 只读，改代码交给外部 IDE / agent）
- ❌ 内置 merge 算法实现（用 libgit2/CLI 的 3-way）
- ❌ 托管服务端 / 账号体系 / 团队协作后端
- ❌ macOS/Linux 的完整验收（代码可编译，验收只做 Windows）

## 4. 性能预算（硬指标，`scripts/bench.mjs` 输出对比）

| 指标 | 目标 P95 | 说明 |
|---|---|---|
| 冷启动到仓库列表可交互 | ≤ 300 ms | 先读 `index.json` 缓存渲染，再异步刷新 |
| 30 仓库全量 status（首轮） | ≤ 400 ms | libgit2 in-process，8 路并发 |
| 30 仓库增量 status（监视触发） | ≤ 80 ms | 只重扫变更仓库 + 300 ms debounce |
| 单仓库 log 200 条 | ≤ 60 ms | revwalk + refs 一次取 |
| 打开 5 000 行 diff | ≤ 150 ms | 分块加载，先渲染首屏 200 行 |
| diff 滚动 | 60 fps | 虚拟列表，行高固定 20 px |
| 侧栏搜索（24 仓库） | ≤ 16 ms | 子序列匹配，不分词 |
| 常驻内存 | ≤ 180 MB | 含 WebView2 子进程 |
| exe 体积 | ≤ 12 MB | 不含 WebView2 Runtime |

## 5. 数据与隐私

- 全本地，无遥测，无网络请求（除 git 自身的 remote 操作）。
- API key / token 不落 knit 配置；凭据交给 git 的 credential helper（Windows 上是 GCM）。
- Agent 会话内容只存在内存 + `.git/knit/session/<id>/`（用户可关）。

## 6. 验收总则

每个里程碑的验收清单见 [07-roadmap.md](07-roadmap.md)。全局门禁：

1. `tests/test_all.nim` 全绿
2. `tsc --noEmit` 无错误
3. `scripts/shot.mjs` 的截图与原型差异（人眼）< 3 处
4. 性能预算表全部达标（超标需在 PR 里写原因 + 后续处理）
5. S1–S7 场景手测通过（Windows 11 x64 实机）

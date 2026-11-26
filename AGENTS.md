# AGENTS.md — 给实现模型的硬约束

你在实现 `knit`，一个 Windows 优先的 Git 客户端。宿主是 Nim + nimi（WebView2），
前端是 TypeScript + 手写 DOM（diff/合并自绘；CodeMirror 6 可选）。**先读完本文件再动手。**

## 0. 顺序

1. 读 [docs/01-product.md](docs/01-product.md) 明确范围（尤其「非目标」）。
2. 读 `knit-prototype/index.html`，它是 UI 的唯一事实来源。
3. 每个改动结束跑验收清单，全绿后再提交。

## 1. 五条硬约束（违反即返工）

| # | 约束 | 为什么 |
|---|---|---|
| 1 | **UI 以原型为准**。像素级对齐 `knit-prototype/index.html`，包括文案、列宽、间距、颜色 token。新增控件前先改原型。 | 原型已经过评审，实现阶段不做设计决策 |
| 2 | **写 git 操作只能 spawn `git` CLI**（commit/rebase/cherry-pick/am/push/worktree）。读路径的目标实现是 libgit2；**M1.1 之前允许 `src/knit/gitops.nim` 用 CLI 顶替**，替换时函数签名与输出不得变化，并用「与 CLI 对拍」的测试守住。 | libgit2 不执行 hooks、无 rebase -i、凭据需自建 |
| 3 | **单次 IPC 载荷 ≤ 256 KB**。diff/文件内容分块传输。 | nimi 的 IPC 是 JSON 字符串跨线程，大对象会卡 UI |
| 4 | **主线程不碰 git**。所有 git 调用在 `bindBackgroundService` 里。 | nimi 契约：`bindService` 在 UI 线程同步执行 |
| 5 | **不扩 nimi 框架**，除非在 [docs/03-architecture.md](docs/03-architecture.md) 的「需要的框架补丁」一节登记，并单独提交。 | 避免边写产品边改框架导致不可复现 |

## 2. 禁止事项

- ❌ Electron / Tauri / Wails / React 全家桶 / Tailwind。前端只允许：TypeScript + CodeMirror 6 + 一个 ≤5 KB 的视图库（默认 preact，或手写 DOM）。
- ❌ 自己实现 git 语义（解析 pack、算 merge、模拟 rebase）。一律调 CLI 或 libgit2。
- ❌ 在前端做词级 diff 之外的算法工作（hunk 划分、行对齐必须由宿主给）。
- ❌ 用 `--no-verify` 跳过 hooks，除非用户在设置里显式打开。
- ❌ 把仓库路径、diff 内容、token 写进日志明文（`settings.logLevel=debug` 时也只记路径的 hash）。
- ❌ 引入自动轮询代替文件监视（`ReadDirectoryChangesW` 已有封装）。
- ❌ 在没有 `IpcCallContext.cancelled` 检查的情况下写长循环。

## 3. 代码约定

**Nim**
- 运行时按 `config.nims`：当前为 `--mm:refc --threads:on`。原因：nimi 的后台 IPC 通道
  在 ARC/ORC 下反复调用会堆损坏（Nim 2.4.2 上可复现，见 docs/03 §7.1）；框架修复后
  回退到 `--mm:arc`。不引入其它新运行时特性。
- 目录：`src/main.nim`（入口）、`src/knit/{types,store,index,gitops,diff,merge,agent,events,services}.nim`。
  `gitlib.nim`（libgit2）在 M1.1 落地。
- 公开 proc 带 `*` 与简短 `##` 文档注释；错误统一抛 `KnitError(kind, message, hint)`。
- FFI 到 libgit2 的绑定集中在 `src/knit/gitlib.nim`，业务层不允许直接 `importc`。
- 每个模块有 `tests/test_<module>.nim`，用真实临时仓库做夹具（见 04-git-layer 的测试夹具）。

**TypeScript**
- `web/src/`：`main.ts`、`api/`（生成的 nimia 客户端 + 手写包装）、`views/`、`styles/`。
- 不写 CSS-in-JS；样式集中在 `web/src/styles/*.css`，颜色只用 token（见 02-ui-spec 的 token 表）。
- 所有宿主返回类型手写 d.ts（nimi 的 TS 生成只覆盖标量），并用 `zod` 或手写 guard 校验一次。
- 无 `any`（`unknown` + guard）。

**提交规范**：Conventional Commits，scope 用模块名，例：
`feat(log): 分支图 lane 着色`、`fix(gitops): porcelain v2 解析 CRLF 多算一个文件`。

## 4. 验收方式（每个 PR 都要能复现）

```sh
# 单元测试（porcelain v2 / log / repoId / 扫描 / 设置）
nim c -r --hints:off --path:../nimi/src tests/test_all.nim

# 类型检查 + 前端构建
cd web && bun run build && tsc --noEmit

# 端到端冒烟：真实窗口 → 首帧上报 → 自动退出（退出码 0 才算过）
cd .. && KNIT_WEB=$PWD/web/dist ./knit --smoke

# UI 对照（无头截图：原型 / 真实前端夹具）
node scripts/shot.mjs --target knit-prototype/index.html --out shots/proto --hash ""
node scripts/shot.mjs --target web/test/harness.html --out shots/web --hash ""

# 性能基线（对比 docs/01 §4 预算）
node scripts/bench.mjs --root ~/code --repeat 3
```

## 5. 遇到歧义时

按优先级取一个，并在 PR 描述里写「决策 + 理由」：

1. `knit-prototype/index.html` 的实际行为
2. 本仓库 docs 里的表格
3. JetBrains IDEA 的对应交互
4. `git` 自身的默认行为

不要为了「更现代」而偏离以上任意一条。

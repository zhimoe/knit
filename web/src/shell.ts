// App shell markup — strictly aligned with knit-prototype/index.html.
// Kept in TS so web/test/harness.html mounts the exact same DOM.

export const shellHtml = `
  <svg class="svg-sprite" aria-hidden="true" focusable="false">
    <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></symbol>
    <symbol id="i-branch" viewBox="0 0 24 24"><circle cx="6.5" cy="5" r="2.4"/><circle cx="6.5" cy="19" r="2.4"/><circle cx="17.5" cy="7" r="2.4"/><path d="M6.5 7.4v9.2M17.5 9.4c0 3.6-2.9 4.9-6.6 4.9H6.5"/></symbol>
    <symbol id="i-folder" viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z"/></symbol>
    <symbol id="i-chevron-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
    <symbol id="i-chevron-up" viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></symbol>
    <symbol id="i-chevron-left" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></symbol>
    <symbol id="i-chevron-right" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></symbol>
    <symbol id="i-tag" viewBox="0 0 24 24"><path d="M20 13.2 13.2 20a2 2 0 0 1-2.8 0l-7-7V4h9l7.4 7.4a2 2 0 0 1 .2 1.8Z"/><circle cx="8.5" cy="8.5" r="1.4"/></symbol>
    <symbol id="i-terminal" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7 9 3 3-3 3M13.5 15h4"/></symbol>
    <symbol id="i-sparkles" viewBox="0 0 24 24"><path d="M12 3.5l1.6 4.9L18.5 10l-4.9 1.6L12 16.5l-1.6-4.9L5.5 10l4.9-1.6L12 3.5Z"/><path d="M19 15.5l.7 2.1 2.1.7-2.1.7L19 21.1l-.7-2.1-2.1-.7 2.1-.7.7-2.1Z"/><path d="M5 3.5l.5 1.5L7 5.5l-1.5.5L5 7.5l-.5-1.5L3 5.5l1.5-.5L5 3.5Z"/></symbol>
    <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M3.5 3.5l17 17"/><path d="M10.3 5.3A10.8 10.8 0 0 1 12 5c5.5 0 9 6.5 9 6.5a15.4 15.4 0 0 1-3.2 3.8M6.2 7.2C4.3 8.7 3 11.5 3 11.5s3.5 6.5 9 6.5c1.4 0 2.6-.4 3.7-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></symbol>
    <symbol id="i-eye" viewBox="0 0 24 24"><path d="M3 12s3.5-6.5 9-6.5 9 6.5 9 6.5-3.5 6.5-9 6.5S3 12 3 12Z"/><circle cx="12" cy="12" r="2.8"/></symbol>
    <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.1-4.7L3.5 8.5"/><path d="M3.5 4v4.5H8"/><path d="M4 13a8 8 0 0 0 14.1 4.7l2.4-2.2"/><path d="M20.5 20v-4.5H16"/></symbol>
    <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></symbol>
    <symbol id="i-history" viewBox="0 0 24 24"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4.5V9H8"/><path d="M12 8v4.5l3 1.8"/></symbol>
    <symbol id="i-crosshair" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="1.6"/></symbol>
    <symbol id="i-split" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15"/></symbol>
    <symbol id="i-unified" viewBox="0 0 24 24"><path d="M4 6h16M4 10h10M4 14h16M4 18h8"/></symbol>
    <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><path d="m4.5 12.5 5 5 10-11"/></symbol>
    <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></symbol>
    <symbol id="i-merge" viewBox="0 0 24 24"><circle cx="7" cy="5" r="2.4"/><circle cx="7" cy="19" r="2.4"/><circle cx="17" cy="19" r="2.4"/><path d="M7 7.4v9.2M17 16.6v-3a6 6 0 0 0-6-6H7"/></symbol>
    <symbol id="i-arrow-up" viewBox="0 0 24 24"><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/></symbol>
    <symbol id="i-arrow-down" viewBox="0 0 24 24"><path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/></symbol>
    <symbol id="i-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></symbol>
    <symbol id="i-file" viewBox="0 0 24 24"><path d="M6 3.5h7.5l4.5 4.5v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M13.5 3.5V8H18"/></symbol>
    <symbol id="i-send" viewBox="0 0 24 24"><path d="M4 12h15M13 5.5 19.5 12 13 18.5"/></symbol>
    <symbol id="i-undo" viewBox="0 0 24 24"><path d="M9 7 4.5 11.5 9 16"/><path d="M4.5 11.5H14a5.5 5.5 0 0 1 0 11h-3"/></symbol>
    <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></symbol>
    <symbol id="i-file-search" viewBox="0 0 24 24"><path d="M6 3.5h7.5L18 8v12H6Z"/><path d="M13.5 3.5V8H18"/><circle cx="11.2" cy="13.2" r="2.5"/><path d="m13 15 2.2 2.2"/></symbol>
    <symbol id="i-file-plus" viewBox="0 0 24 24"><path d="M6 3.5h7.5L18 8v12H6Z"/><path d="M13.5 3.5V8H18"/><path d="M12 12v5M9.5 14.5h5"/></symbol>
    <symbol id="i-sidebar" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9.5 4.5v15"/></symbol>
    <symbol id="i-expand" viewBox="0 0 24 24"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/><path d="M4 9l5-5M20 9l-5-5M4 15l5 5M20 15l-5 5"/></symbol>
    <symbol id="i-command" viewBox="0 0 24 24"><path d="M9 6.5A2.5 2.5 0 1 0 6.5 9H9m0-2.5V9m0 0h6m-6 0v6m6-6V6.5A2.5 2.5 0 1 1 17.5 9H15m0 0v6m0-6H9m6 6h2.5A2.5 2.5 0 1 1 15 17.5V15m0 0H9m0 0v2.5A2.5 2.5 0 1 1 6.5 15H9"/></symbol>
    <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
    <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4.5 7h15M9.5 7V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M7 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5L17 7"/></symbol>
    <symbol id="i-edit" viewBox="0 0 24 24"><path d="M15.5 4.5 19.5 8.5 8.5 19.5H4.5v-4L15.5 4.5Z"/></symbol>
    <symbol id="i-layers" viewBox="0 0 24 24"><path d="M12 3.5 3.5 8 12 12.5 20.5 8 12 3.5Z"/><path d="M3.5 12.5 12 17l8.5-4.5"/><path d="M3.5 16.5 12 21l8.5-4.5"/></symbol>
  </svg>

  <div class="app" id="app">
    <header class="titlebar">
      <div class="traffic" aria-hidden="true"><span class="tl tl-red"></span><span class="tl tl-yellow"></span><span class="tl tl-green"></span></div>
      <div class="brand" aria-label="Knit">
        <span class="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="7" cy="5.5" r="2.2"/><circle cx="7" cy="18.5" r="2.2"/><circle cx="17" cy="8" r="2.2"/>
            <path d="M7 7.7v8.6M17 10.2c0 3.4-2.7 4.4-6.2 4.4H7"/>
          </svg>
        </span>
        <span class="brand-name">Knit</span>
        <span class="brand-sub">Git 工作台</span>
      </div>
      <button class="cmdbar" id="cmdSearch" type="button" data-action="focus-repo-search" title="搜索仓库（⌘P / ⌘K）">
        <svg class="ic"><use href="#i-search"></use></svg>
        <span class="cmdbar-text">搜索仓库、分支…</span>
        <kbd>⌘P</kbd>
      </button>
      <div class="top-right">
        <button class="top-chip" id="fetchBtn" type="button" data-action="branch-fetch" title="Fetch 全部远端（git fetch --all --prune）">
          <svg class="ic"><use href="#i-refresh"></use></svg><span>Fetch</span>
        </button>
        <button class="top-chip" id="pullBtn" type="button" data-action="branch-pull" title="拉取当前分支（git pull）">
          <svg class="ic"><use href="#i-arrow-down"></use></svg><span>Pull</span>
        </button>
        <button class="top-chip" id="branchMgrBtn" type="button" data-action="open-branches" title="分支管理：切换 / 新建 / 合并 / 删除">
          <svg class="ic"><use href="#i-branch"></use></svg><span>分支</span>
        </button>
        <button class="top-chip" id="cmdPaletteBtn" type="button" data-action="open-commands" data-popover-trigger title="命令面板（⌘K）：Rebase / Reset / Force Push / Worktree">
          <svg class="ic"><use href="#i-command"></use></svg><kbd>⌘K</kbd>
        </button>
        <button class="top-icon" id="rescanBtn" type="button" data-action="rescan" title="重新扫描根目录">
          <svg class="ic"><use href="#i-folder"></use></svg>
        </button>
      </div>
    </header>

    <div class="workspace" id="workspace">
      <aside class="sidebar" aria-label="仓库列表">
        <div class="sidebar-head">
          <div class="eyebrow">工作区</div>
          <button class="root-row" type="button" data-action="change-root" title="更换根目录与排除规则">
            <span class="root-icon"><svg class="ic"><use href="#i-folder"></use></svg></span>
            <span class="root-text">
              <span class="root-name"><span id="rootName">…</span><svg class="ic chev"><use href="#i-chevron-down"></use></svg></span>
              <span class="root-path" id="rootPath">…</span>
            </span>
          </button>
          <div class="search-field" id="repoSearchField">
            <svg class="ic"><use href="#i-search"></use></svg>
            <input id="repoSearch" type="text" placeholder="搜索仓库" autocomplete="off" spellcheck="false" aria-label="搜索仓库">
            <kbd>⌘P</kbd>
            <button class="field-clear" id="repoSearchClear" type="button" data-action="clear-repo-search" title="清除搜索" hidden>
              <svg class="ic"><use href="#i-x"></use></svg>
            </button>
          </div>
          <div class="list-meta" id="repoListMeta"></div>
        </div>
        <div class="repo-scroll" id="repoList" role="list"></div>
        <div class="sidebar-foot" id="sidebarFoot"></div>
      </aside>
      <div class="sidebar-splitter" id="sidebarSplitter" role="separator" aria-orientation="vertical" tabindex="0" title="拖动调整侧栏宽度（双击重置）"></div>

      <div class="main-content" id="mainContent">
        <div class="content-tabbar" id="contentTabbar">
          <button class="sidebar-toggle" id="sidebarToggle" type="button" data-action="toggle-workspace"
            title="收起工作区" aria-label="收起工作区">
            <svg class="ic"><use href="#i-sidebar"></use></svg>
          </button>
          <button class="project-chip" id="projectChip" type="button" data-action="open-branches"
            title="点击打开分支管理（切换 / 新建 / 合并 / 删除）">
            <span class="lang-square project-lang" id="tabProjectIcon">—</span>
            <span class="project-chip-name" id="tabProjectName">knit</span>
            <span class="branch-pill compact" id="tabProjectBranch"><svg class="ic"><use href="#i-branch"></use></svg><span>main</span></span>
          </button>
          <span class="tabbar-divider"></span>
          <div class="view-tabs" role="tablist" aria-label="主视图">
            <button class="view-tab active" id="viewTabLog" type="button" data-view="log" role="tab" aria-selected="true" title="Log（⌘1）">
              <svg class="ic"><use href="#i-history"></use></svg>
              <span>Log: <b id="viewBranchName">main</b></span>
            </button>
            <button class="view-tab" id="viewTabChanges" type="button" data-view="changes" role="tab" aria-selected="false" title="Changes · 工作区更改（⌘2）">
              <svg class="ic"><use href="#i-file"></use></svg>
              <span>Changes</span>
              <span class="vt-badge" id="viewChangesCount">0</span>
            </button>
            <button class="view-tab" id="viewTabConsole" type="button" data-view="console" role="tab" aria-selected="false" title="Console · Git 命令日志（⌘3）">
              <svg class="ic"><use href="#i-terminal"></use></svg>
              <span>Console</span>
            </button>
            <button class="view-tab" id="viewTabShelf" type="button" data-view="shelf" role="tab" aria-selected="false" title="Shelf · 补丁与暂存箱（⌘4）">
              <svg class="ic"><use href="#i-layers"></use></svg>
              <span>Shelf</span>
            </button>
          </div>
          <span class="spacer"></span>
          <div class="viewbar-right" id="viewbarRight"></div>
        </div>
        <div class="content-area" id="contentArea">
          <section class="log-pane" id="logPane" aria-label="提交记录与工作区更改">
            <div class="log-head">
              <div class="log-title-row">
                <div class="log-repo">
                  <span class="lang-badge" id="logRepoIcon">—</span>
                  <div class="log-repo-text">
                    <div class="log-repo-line">
                      <span class="log-repo-name" id="logRepoName">…</span>
                      <button class="branch-pill" id="logBranch" type="button" data-action="open-branches" title="管理分支"><svg class="ic"><use href="#i-branch"></use></svg><span>main</span></button>
                    </div>
                    <div class="log-repo-path" id="logRepoPath">…</div>
                  </div>
                </div>
                <div class="log-tools">
                  <label class="mini-search">
                    <svg class="ic"><use href="#i-search"></use></svg>
                    <input id="commitSearch" type="text" placeholder="筛选提交" autocomplete="off" spellcheck="false" aria-label="筛选提交">
                    <button class="field-clear" id="commitSearchClear" type="button" data-action="clear-commit-search" title="清除筛选" hidden>
                      <svg class="ic"><use href="#i-x"></use></svg>
                    </button>
                  </label>
                  <button class="tool-pill" type="button" data-action="open-worktrees" title="Worktree / Hand 管理">
                    <svg class="ic"><use href="#i-plus"></use></svg><span>worktree</span>
                  </button>
                </div>
              </div>
              <div class="log-filters" id="logFilters"></div>
              <div id="logBanner"></div>
              <div class="log-cols" aria-hidden="true">
                <span class="col-lane"></span>
                <span class="col-subject">提交</span>
                <span class="col-author">作者</span>
                <span class="col-date">日期</span>
              </div>
            </div>
            <div class="commit-list" id="commitList" tabindex="0" aria-label="提交列表"></div>
            <div class="log-foot" id="logFoot"></div>
            <div class="quick-changes" id="quickChanges"></div>
            <div class="changes-view" id="changesView" hidden>
              <div class="changes-view-head" id="changesViewHead"></div>
              <div class="changes-view-body" id="changesViewBody">
                <div class="changes-tree-panel" id="changesTreePanel"></div>
                <div class="changes-splitter" id="changesSplitter" role="separator" aria-orientation="vertical" tabindex="0" title="拖动调整文件树宽度（双击重置）"></div>
                <div class="changes-diff-panel" id="changesDiffPanel"></div>
              </div>
              <div class="composer changes-composer" id="composer"></div>
            </div>
            <div class="aux-view" id="auxView" hidden></div>
          </section>

          <div class="pane-splitter" id="paneSplitter" role="separator" aria-orientation="vertical"
            tabindex="0" title="拖动调整 diff 宽度（双击重置）"></div>

          <aside class="details" id="details" aria-label="提交详情"></aside>
        </div>
        <div class="term-splitter" id="termSplitter" role="separator" aria-orientation="horizontal" tabindex="0" title="拖动调整终端高度（双击重置）"></div>
        <section class="terminal collapsed" id="terminal" aria-label="终端与 Agent 会话"></section>
      </div>
    </div>

    <section class="full-diff-page" id="fullDiffPage" hidden aria-label="全页面 Diff"></section>
  </div>

  <div id="popoverRoot"></div>
  <div id="modalRoot"></div>
  <div id="toastRoot"></div>`;

export function mountShell(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app 不存在');
  root.outerHTML = shellHtml;
}

import type { AgentConfig, Commit, FileEntry, Repo } from '../types';
import { basenameOf, icon, shortPath } from './icons';
import { esc } from './util';

export const renderRootModal = (
  root: string,
  allGlobs: string[],
  activeGlobs: string[],
  excluded: string[],
): string => `
  <div class="modal-backdrop" data-modal-backdrop="1">
    <div class="modal" role="dialog" aria-modal="true" aria-label="工作区根目录与排除规则">
      <div class="modal-head">
        <span class="modal-head-icon">${icon('folder')}</span>
        <span class="modal-head-text">
          <span class="modal-title">工作区根目录与扫描规则</span>
          <span class="modal-sub">自动发现该目录下所有含 .git 的仓库</span>
        </span>
      </div>
      <div class="modal-body">
        <div class="field-group">
          <label class="field-label" for="rootInput">根目录路径</label>
          <div class="field-row">
            <input class="field-input" id="rootInput" value="${esc(root)}" spellcheck="false" autocomplete="off">
            <button class="btn" type="button" data-act="pickroot">浏览…</button>
          </div>
          <div class="field-hint">修改后会自动重新扫描仓库并更新增量索引。</div>
        </div>

        <div class="field-group">
          <span class="field-label">按目录名跳过（扫描排除）</span>
          <div class="exclude-chips">
            ${allGlobs
              .map((glob) => {
                const on = activeGlobs.includes(glob);
                return `<button class="btn ${on ? 'primary' : ''}" type="button" data-toggle-glob="${esc(
                  glob,
                )}" style="height:24px;font-size:10px;padding:0 8px">${on ? '✓ ' : ''}${esc(glob)}/</button>`;
              })
              .join('')}
          </div>
        </div>

        ${
          excluded.length
            ? `<div class="field-group">
                <span class="field-label">已排除的仓库（${excluded.length}）</span>
                <div class="exclude-chips">
                  ${excluded
                    .map(
                      (p) => `<span class="exclude-chip">${esc(basenameOf(p))}
                        <button type="button" data-restore="${esc(p)}" title="恢复">${icon('x')}</button></span>`,
                    )
                    .join('')}
                </div>
              </div>`
            : ''
        }
      </div>
      <div class="modal-foot">
        <span class="modal-tip">当前：${esc(shortPath(root))}</span>
        <span class="spacer"></span>
        <button class="btn" type="button" data-modal-close="1">取消</button>
        <button class="btn primary" type="button" id="applyRootBtn">保存并扫描</button>
      </div>
    </div>
  </div>`;

export const renderBranchFilterPopover = (repo: Repo, branchAll: boolean): string => `
  <div class="pop-head">
    <span class="pop-title">分支范围</span>
    <span class="pop-sub">${esc(repo.name)}</span>
  </div>
  <div class="filter-list">
    <button class="filter-option ${!branchAll ? 'active' : ''}" type="button" data-branchall="0">
      <span class="filter-check">${!branchAll ? icon('check') : ''}</span>
      <span class="branch-ico">${icon('branch')}</span>
      <span class="filter-option-main">
        <span>当前分支 · ${esc(repo.branch ?? 'detached')}</span>
        <span class="filter-option-sub">仅查看当前分支 HEAD 历史</span>
      </span>
    </button>
    <button class="filter-option ${branchAll ? 'active' : ''}" type="button" data-branchall="1">
      <span class="filter-check">${branchAll ? icon('check') : ''}</span>
      <span class="branch-ico">${icon('branch')}</span>
      <span class="filter-option-main">
        <span>全部 refs（--all）</span>
        <span class="filter-option-sub">显示所有本地分支、远端分支与标签</span>
      </span>
    </button>
  </div>
  <div class="pop-foot">${icon('branch')} 点击顶栏「分支」可切换、新建、合并或删除分支</div>`;

export const renderAuthorFilterPopover = (repo: Repo, authors: string[], current: string): string => `
  <div class="pop-head">
    <span class="pop-title">作者筛选</span>
    <span class="pop-sub">${esc(repo.name)}</span>
  </div>
  <div class="filter-list">
    <button class="filter-option ${!current ? 'active' : ''}" type="button" data-author="">
      <span class="filter-check">${!current ? icon('check') : ''}</span>
      <span class="branch-ico">${icon('user')}</span>
      <span class="filter-option-main"><span>全部作者</span><span class="filter-option-sub">不限制提交作者</span></span>
    </button>
    ${authors
      .map(
        (name) => `
      <button class="filter-option ${name === current ? 'active' : ''}" type="button" data-author="${esc(name)}">
        <span class="filter-check">${name === current ? icon('check') : ''}</span>
        <span class="branch-ico">${icon('user')}</span>
        <span class="filter-option-main"><span>${esc(name)}</span></span>
      </button>`,
      )
      .join('')}
  </div>
  <div class="pop-foot">${icon('user')} 按提交作者过滤当前 Log</div>`;

export const renderTimeFilterPopover = (repo: Repo, current: string): string => {
  const options: [string, string, string][] = [
    ['all', '全部时间', '不限制提交时间'],
    ['today', '今天', '最近 24 小时内的提交'],
    ['week', '最近 7 天', '从当前时间向前 7 天'],
    ['month', '最近 30 天', '从当前时间向前 30 天'],
  ];
  return `
    <div class="pop-head">
      <span class="pop-title">时间筛选</span>
      <span class="pop-sub">${esc(repo.name)}</span>
    </div>
    <div class="filter-list">
      ${options
        .map(
          ([key, label, sub]) => `
        <button class="filter-option ${key === current ? 'active' : ''}" type="button" data-time="${key}">
          <span class="filter-check">${key === current ? icon('check') : ''}</span>
          <span class="branch-ico">${icon('clock')}</span>
          <span class="filter-option-main"><span>${label}</span><span class="filter-option-sub">${sub}</span></span>
        </button>`,
        )
        .join('')}
    </div>
    <div class="pop-foot">${icon('clock')} 时间筛选只影响 Log 列表</div>`;
};

export const renderPathFilterPopover = (
  repo: Repo,
  current: string | null,
  changes: FileEntry[],
  commitFiles: FileEntry[],
): string => {
  const seen = new Set<string>();
  const items: { path: string; sub: string }[] = [];
  if (current) {
    seen.add(current);
    items.push({ path: current, sub: current });
  }
  for (const f of changes) {
    if (!seen.has(f.path)) {
      seen.add(f.path);
      items.push({ path: f.path, sub: `未提交更改 · ${f.path}` });
    }
  }
  for (const f of commitFiles) {
    if (!seen.has(f.path)) {
      seen.add(f.path);
      items.push({ path: f.path, sub: f.path });
    }
  }
  return `
    <div class="pop-head">
      <span class="pop-title">路径筛选</span>
      <span class="pop-sub">${esc(repo.name)}</span>
    </div>
    <div class="filter-list">
      <button class="filter-option ${!current ? 'active' : ''}" type="button" data-filterpath="">
        <span class="filter-check">${!current ? icon('check') : ''}</span>
        <span class="branch-ico">${icon('file-search')}</span>
        <span class="filter-option-main"><span>全部路径</span><span class="filter-option-sub">不限制文件</span></span>
      </button>
      ${items
        .slice(0, 12)
        .map(
          (item) => `
        <button class="filter-option ${current === item.path ? 'active' : ''}" type="button" data-filterpath="${esc(
          item.path,
        )}">
          <span class="filter-check">${current === item.path ? icon('check') : ''}</span>
          <span class="branch-ico">${icon('file')}</span>
          <span class="filter-option-main">
            <span>${esc(basenameOf(item.path))}</span>
            <span class="filter-option-sub">${esc(item.sub)}</span>
          </span>
        </button>`,
        )
        .join('')}
    </div>
    <div class="pop-foot">${icon('file-search')} 选择文件后只显示涉及该文件的提交</div>`;
};

export const renderHistoryPopover = (history: string[]): string => `
  <div class="pop-head">
    <span class="pop-title">最近提交信息</span>
    <span class="pop-sub">本地记忆</span>
  </div>
  <div class="history-list">
    ${
      history.length
        ? history
            .slice(0, 10)
            .map(
              (text) => `
            <button class="history-item" type="button" data-usemsg="${esc(text)}">
              <div class="history-item-top"><span class="history-tag">历史</span></div>
              <div class="history-text">${esc(text.split('\n')[0] ?? '')}</div>
            </button>`,
            )
            .join('')
        : `<div class="history-empty">还没有提交历史（提交成功后自动记录）</div>`
    }
  </div>`;

export const renderSkillsPopover = (
  config: AgentConfig | null,
  skills: Record<string, boolean>,
): string => {
  const list = config?.skills.length
    ? config.skills
    : [
        { id: 'understanding-anything', label: '读代码', path: '先读文档再按调用链分析' },
        { id: 'commit-msg', label: '提交信息', path: '按 diff 与 Conventional Commits 生成提交信息' },
        { id: 'repo-map', label: '仓库地图', path: '构建核心模块依赖关系' },
        { id: 'changelog', label: '变更日志', path: '生成版本发布说明' },
      ];
  return `
    <div class="pop-head">
      <span class="pop-title">Agent Skills 配置</span>
      <span class="pop-sub">按需注入</span>
    </div>
    <div class="skills-pop-body">
      <div class="skills-group-title">可用 Skills</div>
      ${list
        .map((s) => {
          const on = Boolean(skills[s.id]);
          return `
            <div class="skill-row" data-skill="${esc(s.id)}">
              <div class="skill-row-main">
                <div class="skill-row-name">${esc(s.id)} <span class="skill-badge">${esc(s.label)}</span></div>
                <div class="skill-row-desc">${esc(s.path)}</div>
              </div>
              <span class="switch ${on ? 'on' : ''}"></span>
            </div>`;
        })
        .join('')}
    </div>`;
};

export const renderCommandPalette = (
  repo: Repo | null,
  isProtected: boolean,
  commit: Commit | null,
): string => `
  <div class="pop-head">
    <span class="pop-title">命令面板</span>
    <span class="pop-sub">${esc(repo?.name ?? 'knit')} · ⌘K</span>
  </div>
  <div class="filter-list">
    <button class="filter-option" type="button" data-cmd="branches">
      <span class="branch-ico">${icon('branch')}</span>
      <span class="filter-option-main"><span>分支管理（切换 / 新建 / 合并 / 删除）…</span><span class="filter-option-sub">branch / checkout / merge</span></span>
    </button>
    <button class="filter-option" type="button" data-cmd="fetch">
      <span class="branch-ico">${icon('refresh')}</span>
      <span class="filter-option-main"><span>Fetch 全部远端</span><span class="filter-option-sub">git fetch --all --prune</span></span>
    </button>
    <button class="filter-option" type="button" data-cmd="pull">
      <span class="branch-ico">${icon('arrow-down')}</span>
      <span class="filter-option-main"><span>Pull 当前分支</span><span class="filter-option-sub">git pull</span></span>
    </button>
    <button class="filter-option" type="button" data-cmd="pull-rebase">
      <span class="branch-ico">${icon('arrow-down')}</span>
      <span class="filter-option-main"><span>Pull --rebase 当前分支</span><span class="filter-option-sub">git pull --rebase</span></span>
    </button>
    <button class="filter-option" type="button" data-cmd="worktree">
      <span class="branch-ico">${icon('folder')}</span>
      <span class="filter-option-main"><span>管理 Worktree / Hand…</span><span class="filter-option-sub">git worktree</span></span>
    </button>
    ${
      commit
        ? `<button class="filter-option" type="button" data-cmd="rebase">
            <span class="branch-ico">${icon('branch')}</span>
            <span class="filter-option-main"><span>交互式变基（Rebase -i onto ${esc(commit.shortHash)}）…</span><span class="filter-option-sub">git rebase -i</span></span>
          </button>
          <button class="filter-option" type="button" data-cmd="reset-soft">
            <span class="branch-ico">${icon('undo')}</span>
            <span class="filter-option-main"><span>Reset --soft 到 ${esc(commit.shortHash)}</span><span class="filter-option-sub">保留暂存区和工作区</span></span>
          </button>
          <button class="filter-option" type="button" data-cmd="reset-mixed">
            <span class="branch-ico">${icon('undo')}</span>
            <span class="filter-option-main"><span>Reset --mixed 到 ${esc(commit.shortHash)}</span><span class="filter-option-sub">重置暂存区，保留工作区</span></span>
          </button>
          <button class="filter-option" type="button" data-cmd="reset-hard">
            <span class="branch-ico" style="color:var(--red)">${icon('undo')}</span>
            <span class="filter-option-main"><span style="color:#f09aa0">Reset --hard 到 ${esc(commit.shortHash)}（自动快照）…</span><span class="filter-option-sub">丢弃工作区改动</span></span>
          </button>`
        : ''
    }
    <button class="filter-option" type="button" data-cmd="${isProtected ? '' : 'push-force'}" ${
      isProtected ? 'disabled style="opacity:.45;cursor:not-allowed"' : ''
    }>
      <span class="branch-ico" style="color:var(--orange)">${icon('arrow-up')}</span>
      <span class="filter-option-main">
        <span style="color:${isProtected ? 'var(--muted)' : '#e6ba7a'}">Push --force-with-lease${
          isProtected ? `（${esc(repo?.branch ?? '')} 受保护已禁用）` : '…'
        }</span>
        <span class="filter-option-sub">安全强推</span>
      </span>
    </button>
  </div>`;

export const renderShelfStatPopover = (text: string): string => `
  <div class="pop-head">
    <span class="pop-title">补丁摘要</span>
    <span class="pop-sub">git apply --stat</span>
  </div>
  <pre class="statpre">${esc(text || '（没有统计）')}</pre>`;

import type { Repo } from '../types';
import { clockTime, highlightMatch, icon, langMeta, shortPath, timeCompact, tint } from './icons';
import { dirtyTotal, esc } from './util';

export interface SidebarOptions {
  repos: Repo[];
  excluded: string[];
  excludedOpen: boolean;
  query: string;
  selectedId: string;
  lastRefresh: number;
}

export interface SidebarRender {
  html: string;
  meta: string;
  foot: string;
  visible: Repo[];
  activeCount: number;
}

const matches = (repo: Repo, query: string): boolean => {
  if (!query.trim()) return true;
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${repo.name} ${repo.branch ?? ''} ${repo.path} ${repo.lang}`.toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
};

export const visibleRepos = (repos: Repo[], excluded: string[], query: string): Repo[] =>
  repos.filter((repo) => !excluded.includes(repo.path) && matches(repo, query));

function renderRepoRow(repo: Repo, excluded: boolean, selectedId: string, query: string): string {
  const lm = langMeta(repo.lang);
  const total = dirtyTotal(repo);
  const conflicted = repo.dirty.conflicted > 0;
  const ahead =
    repo.ahead && repo.ahead > 0
      ? `<span class="sync-badge ahead" title="领先远端 ${repo.ahead} 个提交">${icon('arrow-up')}${repo.ahead}</span>`
      : '';
  const behind =
    repo.behind && repo.behind > 0
      ? `<span class="sync-badge behind" title="落后远端 ${repo.behind} 个提交">${icon('arrow-down')}${repo.behind}</span>`
      : '';
  const dirtyBadge = conflicted
    ? `<span class="dirty-badge conf" title="${repo.dirty.conflicted} 个冲突文件">冲突 ${repo.dirty.conflicted}</span>`
    : total > 0
      ? `<span class="dirty-badge" title="${total} 个未提交更改">${total}</span>`
      : '';
  const branchText = repo.branch ?? (repo.detached ? 'detached' : 'HEAD');
  return `
    <div class="repo-row ${excluded ? 'excluded-row' : ''} ${repo.id === selectedId && !excluded ? 'active' : ''}"
      role="listitem" ${excluded ? '' : `tabindex="0" data-repo="${esc(repo.path)}"`}
      title="${esc(shortPath(repo.path))}">
      <span class="lang-square" style="background:${tint(lm.color, 0.13)};color:${lm.color};border-color:${tint(
        lm.color,
        0.16,
      )}">${esc(lm.short)}</span>
      <span class="repo-info">
        <span class="repo-line1">
          <span class="repo-name">${highlightMatch(repo.name, query)}</span>
          <span class="repo-badges">${ahead}${behind}${dirtyBadge}</span>
        </span>
        <span class="repo-line2">
          ${icon('branch')}
          <span class="repo-branch">${highlightMatch(branchText, query)}</span>
          <span class="dot">·</span>
          <span class="repo-time">${esc(timeCompact(repo.lastCommitAt))}</span>
        </span>
      </span>
      <button class="repo-action" type="button" ${
        excluded
          ? `data-restore="${esc(repo.path)}" title="恢复到仓库列表"`
          : `data-exclude="${esc(repo.path)}" title="从列表排除"`
      }>${icon(excluded ? 'eye' : 'eye-off')}</button>
    </div>`;
}

export const renderSidebar = ({
  repos,
  excluded,
  excludedOpen,
  query,
  selectedId,
  lastRefresh,
}: SidebarOptions): SidebarRender => {
  const activeAll = repos.filter((repo) => !excluded.includes(repo.path));
  const excludedRepos = repos.filter((repo) => excluded.includes(repo.path));
  const visible = activeAll.filter((repo) => matches(repo, query));
  const matchedExcluded = excludedRepos.filter((repo) => matches(repo, query));

  const metaParts = [
    `<span class="meta-strong">${activeAll.length} 个仓库</span>`,
    `<span class="dot">·</span>`,
    `<span>${excluded.length} 已排除</span>`,
  ];
  if (query.trim()) {
    metaParts.push(`<span class="dot">·</span><span>匹配 ${visible.length + matchedExcluded.length}</span>`);
  }
  const meta = metaParts.join('');

  let html = '';
  if (!repos.length) {
    html = `
      <div class="repo-list-empty">
        ${icon('folder')}
        <div>当前根目录还没有发现 Git 仓库</div>
        <button type="button" data-action="change-root">选择根目录</button>
      </div>`;
  } else if (!visible.length && !matchedExcluded.length) {
    html = `
      <div class="repo-list-empty">
        ${icon('search')}
        <div>没有匹配 “${esc(query)}” 的仓库</div>
        <button type="button" data-action="clear-repo-search">清除搜索</button>
      </div>`;
  } else {
    html += visible.map((repo) => renderRepoRow(repo, false, selectedId, query)).join('');
  }

  if (excludedRepos.length || excluded.length) {
    const open = excludedOpen || Boolean(query.trim());
    const excludedRows = matchedExcluded.length
      ? matchedExcluded.map((repo) => renderRepoRow(repo, true, selectedId, query)).join('')
      : excluded
          .filter((p) => !repos.some((r) => r.path === p))
          .map(
            (p) => `
          <div class="repo-row excluded-row" role="listitem" title="${esc(shortPath(p))}">
            <span class="lang-square" style="background:rgba(128,136,154,.12);color:var(--muted);border-color:rgba(128,136,154,.18)">GIT</span>
            <span class="repo-info">
              <span class="repo-line1"><span class="repo-name">${esc(p.split('/').pop() ?? p)}</span></span>
              <span class="repo-line2"><span class="repo-branch">${esc(shortPath(p))}</span></span>
            </span>
            <button class="repo-action" type="button" data-restore="${esc(p)}" title="恢复到仓库列表">${icon('eye')}</button>
          </div>`,
          )
          .join('');
    if (excludedRepos.length || excludedRows) {
      html += `
        <div class="excluded-section">
          <button class="excluded-toggle" type="button" data-toggle-excluded="1" title="${open ? '收起已排除仓库' : '展开已排除仓库'}">
            ${icon(open ? 'chevron-down' : 'chevron-right')}
            <span>已排除</span>
            <span class="excluded-count">${excluded.length}</span>
          </button>
          ${open ? `<div class="excluded-list">${excludedRows}</div>` : ''}
        </div>`;
    }
  }

  const foot = `
    <span class="foot-dot"></span>
    <span>${repos.length} 个仓库已索引</span>
    <span class="sep">·</span>
    <span>${activeAll.length} 启用</span>
    <span class="spacer"></span>
    <span class="kbd-hint">${clockTime(lastRefresh || Date.now())}</span>`;

  return { html, meta, foot, visible, activeCount: activeAll.length };
};

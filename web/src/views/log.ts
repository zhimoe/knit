import { computeGraph, GRAPH_ROW_H, graphSvg, type Graph } from '../graph';
import type { Draft } from '../draft';
import type { Commit, FileEntry, Repo } from '../types';
import { absTime, avatarChip, basenameOf, highlightMatch, icon, langMeta } from './icons';
import { commitDate, esc } from './util';

export const LOG_ROW_HEIGHT = GRAPH_ROW_H;
const VIRTUAL_THRESHOLD = 120;
const OVERSCAN = 14;

export interface ParsedRef {
  name: string;
  type: 'branch' | 'tag' | 'remote';
}

export function parseRef(raw: string): ParsedRef {
  if (raw.startsWith('HEAD -> ')) return { name: raw.slice(8), type: 'branch' };
  if (raw === 'HEAD') return { name: 'HEAD', type: 'branch' };
  if (raw.startsWith('tag: ')) return { name: raw.slice(5), type: 'tag' };
  if (raw.startsWith('tag:')) return { name: raw.slice(4).trim(), type: 'tag' };
  if (raw.startsWith('origin/') || raw.includes('/')) return { name: raw, type: 'remote' };
  return { name: raw, type: 'branch' };
}

export function renderRefPills(refs: string[], max = 2): string {
  const parsed = refs.map(parseRef);
  const shown = parsed.slice(0, max);
  const more = parsed.length - shown.length;
  return (
    shown
      .map(
        (ref) =>
          `<span class="ref-pill ${ref.type}" title="${esc(ref.name)}">${icon(
            ref.type === 'tag' ? 'tag' : 'branch',
          )}<span>${esc(ref.name)}</span></span>`,
      )
      .join('') + (more > 0 ? `<span class="ref-more">+${more}</span>` : '')
  );
}

export interface LogFilterState {
  branchAll: boolean;
  filterPath: string | null;
  author: string;
  time: 'all' | 'today' | 'week' | 'month';
  query: string;
  total: number;
  shown: number;
  ms: number;
  hasMore?: boolean;
  loadingMore?: boolean;
  rebaseInProgress?: boolean;
  rebaseProgress?: string;
  mergeConflictCount?: number;
}

export function hasActiveLogFilters(filter: LogFilterState): boolean {
  return Boolean(
    filter.branchAll || filter.author || filter.time !== 'all' || filter.filterPath || filter.query.trim(),
  );
}

let cachedCommits: Commit[] | null = null;
let cachedGraph: Graph | null = null;

function graphFor(commits: Commit[]): Graph {
  if (cachedCommits === commits && cachedGraph) return cachedGraph;
  cachedCommits = commits;
  cachedGraph = computeGraph(commits);
  return cachedGraph;
}

export function logGraphWidth(commits: Commit[]): number {
  if (!commits.length) return 44;
  return graphFor(commits).width;
}

export function renderLogFilters(repo: Repo, filter: LogFilterState): string {
  const branchValue = filter.branchAll ? '全部分支' : repo.branch ?? 'detached';
  const authorValue = filter.author || '全部作者';
  const timeValue = {
    all: '全部时间',
    today: '今天',
    week: '最近 7 天',
    month: '最近 30 天',
  }[filter.time];
  const pathValue = filter.filterPath ? basenameOf(filter.filterPath) : '全部路径';

  const chips = [
    { type: 'branch', label: '分支', value: branchValue, active: filter.branchAll, ic: 'branch' },
    { type: 'author', label: '作者', value: authorValue, active: Boolean(filter.author), ic: 'user' },
    { type: 'time', label: '时间', value: timeValue, active: filter.time !== 'all', ic: 'clock' },
    { type: 'path', label: '路径', value: pathValue, active: Boolean(filter.filterPath), ic: 'file-search' },
  ];

  return (
    chips
      .map(
        (chip) => `
      <button class="filter-chip ${chip.active ? 'active' : ''}" type="button"
        data-pop="${chip.type}" data-popover-trigger="1"
        title="${esc(chip.label)}筛选${chip.active ? '（已启用）' : ''}">
        ${icon(chip.ic)}
        <span class="filter-label">${chip.label}</span>
        <span class="filter-value">${esc(chip.value)}</span>
        ${icon('chevron-down', 'ic chev')}
      </button>`,
      )
      .join('') +
    (hasActiveLogFilters(filter)
      ? `<button class="filter-reset" type="button" data-action="clear-log-filters">清除筛选</button>`
      : '')
  );
}

export function renderLogBanner(filter: LogFilterState): string {
  if (filter.rebaseInProgress) {
    return `
      <div class="log-banner">
        <span>⚠ 交互式变基进行中${filter.rebaseProgress ? `（${esc(filter.rebaseProgress)}）` : ''}</span>
        <span class="spacer"></span>
        <button class="btn primary" type="button" data-act="rebase-continue">继续</button>
        <button class="btn" type="button" data-act="rebase-skip">跳过</button>
        <button class="btn danger" type="button" data-act="rebase-abort">中止</button>
      </div>`;
  }
  if (filter.mergeConflictCount && filter.mergeConflictCount > 0) {
    return `
      <div class="log-banner">
        <span>⚠ 合并冲突：${filter.mergeConflictCount} 个文件待解决</span>
        <span class="spacer"></span>
        <button class="btn primary" type="button" data-action="open-changes">去解决冲突</button>
        <button class="btn danger" type="button" data-act="merge-abort">中止合并</button>
      </div>`;
  }
  return '';
}

function renderCommitRow(
  commit: Commit,
  index: number,
  selectedIndex: number,
  graph: Graph,
  query: string,
  primaryColor: string,
): string {
  const selected = index === selectedIndex;
  const parsed = commit.refs.map(parseRef);
  const localRefs = commit.refs.filter((_, i) => parsed[i]?.type !== 'remote');
  const displayRefs = localRefs.length ? localRefs : commit.refs.slice(0, 1);
  const refs = renderRefPills(displayRefs, 2);
  const merge = commit.parents.length > 1 ? `<span class="merge-mark" title="merge commit">${icon('merge')}</span>` : '';
  return `
    <div class="commit-row ${selected ? 'selected' : ''}" role="button" tabindex="-1"
      data-commit="${index}" data-hash="${esc(commit.hash)}"
      title="${esc(commit.subject)} · ${esc(commit.shortHash)} — ${esc(absTime(commit.committedAt))}">
      <span class="lane-cell ${graph.clipped ? 'clipped' : ''}">${graphSvg(graph.rows[index], graph.width, selected, primaryColor)}</span>
      <span class="commit-subject-cell">
        ${refs ? `<span class="refs">${refs}</span>` : ''}
        ${merge}
        <span class="commit-subject">${highlightMatch(commit.subject, query)}</span>
        ${refs ? '' : `<span class="commit-hash">${esc(commit.shortHash)}</span>`}
      </span>
      <span class="commit-author-cell">
        ${avatarChip(commit.author.name, 'mini-avatar')}
        <span class="commit-author-name">${highlightMatch(commit.author.name, query)}</span>
      </span>
      <span class="commit-date-cell">${esc(commitDate(commit))}</span>
    </div>`;
}

const loadMoreRow = (hasMore: boolean, loadingMore: boolean): string => {
  if (!hasMore) return '';
  return `<div class="logmore" data-act="loadmorelog">${loadingMore ? '正在加载更多提交…' : '加载更多提交（+200）'}</div>`;
};

export function renderLogRows(
  repo: Repo,
  commits: Commit[],
  selectedIndex: number,
  opts: {
    query?: string;
    filterPath?: string | null;
    filtering?: boolean;
    scrollTop?: number;
    viewportHeight?: number;
    hasMore?: boolean;
    loadingMore?: boolean;
  } = {},
): string {
  if (!commits.length) {
    let title = '没有可显示的提交';
    let desc = '这个仓库还没有提交记录。';
    if (opts.filterPath) {
      title = '这个文件还没有提交历史';
      desc = `没有找到涉及 ${opts.filterPath} 的提交。`;
    } else if (opts.filtering) {
      title = '没有匹配的提交';
      desc = '试试更短的关键词，或清除筛选后再看。';
    }
    return `
      <div class="empty-log">
        <span class="empty-icon">${icon(opts.filterPath ? 'file-search' : 'history')}</span>
        <strong>${esc(title)}</strong>
        <span>${esc(desc)}</span>
        ${opts.filtering ? `<button type="button" data-action="clear-log-filters">清除筛选</button>` : ''}
      </div>`;
  }

  const graph = graphFor(commits);
  const primaryColor = langMeta(repo.lang).color;
  const query = opts.query ?? '';
  const footer = loadMoreRow(Boolean(opts.hasMore), Boolean(opts.loadingMore));

  if (commits.length <= VIRTUAL_THRESHOLD) {
    return (
      commits.map((commit, index) => renderCommitRow(commit, index, selectedIndex, graph, query, primaryColor)).join('') +
      footer
    );
  }

  const scrollTop = Math.max(0, opts.scrollTop ?? 0);
  const viewportHeight = Math.max(400, opts.viewportHeight ?? 600);
  const start = Math.max(0, Math.floor(scrollTop / LOG_ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / LOG_ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(commits.length, start + visibleCount);
  const totalHeight = commits.length * LOG_ROW_HEIGHT + (opts.hasMore ? 30 : 0);

  let slice = '';
  for (let i = start; i < end; i += 1) {
    slice += renderCommitRow(commits[i], i, selectedIndex, graph, query, primaryColor);
  }
  if (end >= commits.length && footer) slice += footer;

  return `<div class="logvirt" style="height:${totalHeight}px;position:relative">
    <div style="position:absolute;left:0;right:0;top:${start * LOG_ROW_HEIGHT}px">${slice}</div>
  </div>`;
}

export function renderLogFooter(filter: LogFilterState): string {
  const filtering = hasActiveLogFilters(filter);
  return `
    <span class="foot-count">${filtering ? `筛选 ${filter.shown} / ${filter.total}` : `${filter.total} 个提交`}</span>
    ${filter.ms > 0 ? `<span class="sep">·</span><span>${filter.ms} ms</span>` : ''}
    <span class="spacer"></span>
    ${filtering ? `<button class="foot-btn" type="button" data-action="clear-log-filters">清除筛选</button>` : ''}
    ${
      filter.hasMore
        ? `<button class="foot-btn" type="button" data-act="loadmorelog">${filter.loadingMore ? '加载中…' : '加载更早的提交'}</button>`
        : ''
    }
    <span class="foot-hint"><kbd>↑</kbd><kbd>↓</kbd> 导航</span>`;
}

export function renderQuickChanges(
  repo: Repo,
  files: FileEntry[],
  draft: Draft | null,
): { className: string; clickable: boolean; html: string } {
  if (!files.length) {
    return {
      className: 'quick-changes clean',
      clickable: false,
      html: `
        <span class="qc-icon clean">${icon('check')}</span>
        <span class="qc-main">
          <strong>工作区干净</strong>
          <span class="qc-clean-text">没有未提交的更改 · ${esc(repo.branch ?? 'detached')}</span>
        </span>
        <span class="spacer"></span>
        <span class="qc-hint">✓ 已同步</span>`,
    };
  }
  const additions = files.reduce((s, f) => s + Math.max(0, f.additions), 0);
  const deletions = files.reduce((s, f) => s + Math.max(0, f.deletions), 0);
  const staged = files.filter((f) => f.group === 'staged').length;
  const conflicts = files.filter((f) => f.conflict).length;
  const firstLine = draft ? draft.text.split('\n')[0] ?? '' : '';
  return {
    className: 'quick-changes',
    clickable: true,
    html: `
      <span class="qc-icon">${icon('file')}</span>
      <span class="qc-main">
        <strong>${files.length} 个未提交更改${conflicts ? `（${conflicts} 冲突）` : ''}</strong>
        <span class="qc-stats"><span class="plus">+${additions}</span><span class="minus">−${deletions}</span></span>
        ${draft ? `<span class="qc-draft" title="${esc(draft.text)}">草稿 · ${esc(firstLine)}</span>` : ''}
      </span>
      <span class="qc-actions">
        <span class="qc-open">${icon('unified')} 查看并提交 <span class="qc-hint">${staged}/${files.length}</span></span>
      </span>`,
  };
}

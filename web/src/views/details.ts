import type { Commit, CompareSelection, DiffFile, FileEntry, ImagePreview, Repo } from '../types';
import { absTime, avatarChip, icon } from './icons';
import { renderRefPills } from './log';
import { renderDiffBlock } from './diff';
import { commitDate, esc, statusClass } from './util';

export interface PathTreeNode<T extends { path: string }> {
  name: string;
  path: string;
  children: Map<string, PathTreeNode<T>>;
  files: (T & { name: string })[];
}

export function countTreeFiles<T extends { path: string }>(node: PathTreeNode<T>): number {
  let count = node.files.length;
  node.children.forEach((child) => {
    count += countTreeFiles(child);
  });
  return count;
}

export function buildPathTree<T extends { path: string }>(entries: T[]): PathTreeNode<T> {
  const root: PathTreeNode<T> = { name: '', path: '', children: new Map(), files: [] };
  for (const entry of entries) {
    const isDirEntry = entry.path.endsWith('/');
    const cleanPath = isDirEntry ? entry.path.replace(/\/+$/, '') : entry.path;
    const parts = cleanPath.split('/').filter(Boolean);
    if (!parts.length) continue;
    let node = root;
    let prefix = '';
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        node.files.push({ ...entry, name: isDirEntry ? `${part}/` : part });
        return;
      }
      prefix = prefix ? `${prefix}/${part}` : part;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path: prefix, children: new Map(), files: [] };
        node.children.set(part, child);
      }
      node = child;
    });
  }
  return root;
}

interface IndexedFile extends FileEntry {
  index: number;
}

function renderCommitTreeRows(
  node: PathTreeNode<IndexedFile>,
  selectedPath: string,
  collapsedSet: Set<string>,
  depth = 0,
): string {
  let html = '';
  const folders = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));

  for (const folder of folders) {
    const collapsed = collapsedSet.has(folder.path);
    const count = countTreeFiles(folder);
    html += `
      <div class="file-folder" data-detail-folder="${esc(folder.path)}" style="padding-left:${depth * 12 + 6}px" title="${esc(folder.path)}">
        ${icon('chevron-right', `ic file-chev ${collapsed ? '' : 'open'}`)}
        ${icon('folder')}
        <span class="file-folder-name">${esc(folder.name)}</span>
        <span class="folder-count">${count}</span>
      </div>`;
    if (!collapsed) html += renderCommitTreeRows(folder, selectedPath, collapsedSet, depth + 1);
  }

  for (const file of files) {
    const active = file.path === selectedPath;
    const st = statusClass(file);
    html += `
      <div class="file-row ${active ? 'active' : ''}" data-file-index="${file.index}" role="button" tabindex="0"
        style="padding-left:${depth * 12 + 6}px" title="${esc(file.path)} · 双击全页查看 diff">
        <span class="fstat ${st}">${st}</span>
        <span class="file-path"><span class="fname">${esc(file.name)}</span></span>
        <span class="file-mini-stats">
          <span class="plus">+${Math.max(0, file.additions)}</span>
          ${file.deletions > 0 ? `<span class="minus">−${file.deletions}</span>` : ''}
        </span>
        <button class="file-history" type="button" data-act="hist" data-file="${file.index}" title="查看此文件的提交历史">
          ${icon('history')}
        </button>
      </div>`;
  }
  return html;
}

export interface DetailsOptions {
  commit: Commit | null;
  compare?: CompareSelection | null;
  repo: Repo;
  allCommits: Commit[];
  files: FileEntry[];
  selectedFile: FileEntry | null;
  collapsedFolders: Set<string>;
  loadingFiles: boolean;
  diff: DiffFile | null;
  diffMode: 'split' | 'unified';
  ignoreWhitespace: boolean;
  expanded: boolean;
  loadingDiff: boolean;
  renderAllRows: boolean;
  blameHtml?: string | null;
  imagePreview?: ImagePreview | null;
  imageMode?: 'side' | 'slider';
  imageSlider?: number;
}

export function renderDetails(opts: DetailsOptions): string {
  const { commit, compare, allCommits, files, selectedFile } = opts;
  if (!commit && !compare) {
    return `
      <div class="empty-details">
        <span class="empty-icon">${icon('branch')}</span>
        <strong>选择一个提交</strong>
        <span>提交信息、变更文件和并排 diff 会显示在这里。按 ↑↓ 可以在提交间移动，按住 ⌘ 点击可对比两个提交。</span>
      </div>`;
  }

  const indexed: IndexedFile[] = files.map((file, index) => ({ ...file, index }));
  const totalAdd = files.reduce((s, f) => s + Math.max(0, f.additions), 0);
  const totalDel = files.reduce((s, f) => s + Math.max(0, f.deletions), 0);

  const fileRows = opts.loadingFiles
    ? `<div class="diff-empty"><span>正在读取变更文件…</span></div>`
    : renderCommitTreeRows(buildPathTree(indexed), selectedFile?.path ?? '', opts.collapsedFolders);

  const selectedIndex = selectedFile ? files.findIndex((f) => f.path === selectedFile.path) : -1;

  const bottomPanel = opts.blameHtml
    ? `<div class="diff-block">${opts.blameHtml}</div>`
    : `<div class="diff-block">${renderDiffBlock({
        file: selectedFile,
        fileIndex: selectedIndex,
        fileCount: files.length,
        diff: opts.diff,
        mode: opts.diffMode,
        ignoreWhitespace: opts.ignoreWhitespace,
        expanded: opts.expanded,
        stageGroup: null,
        loading: opts.loadingDiff,
        renderAllRows: opts.renderAllRows,
        leftLabel: compare ? compare.base.shortHash : '修改前',
        rightLabel: compare ? compare.head.shortHash : '修改后',
        emptyText: files.length ? '点击上方文件查看 diff' : '没有可显示的文件差异。',
        imagePreview: opts.imagePreview,
        imageMode: opts.imageMode,
        imageSlider: opts.imageSlider,
      })}</div>`;

  let headerHtml = '';
  if (compare) {
    headerHtml = `
      <div class="commit-meta compare-meta">
        <div class="compare-pill-row">
          <span class="mbadge ok">范围对比</span>
          <span class="compare-rev"><code>${esc(compare.base.shortHash)}</code></span>
          <span class="compare-arrow">→</span>
          <span class="compare-rev"><code>${esc(compare.head.shortHash)}</code></span>
          <span class="spacer"></span>
          <button class="action-btn" type="button" data-action="swap-compare" title="互换对比基准与目标">${icon('refresh')} 互换方向</button>
          <button class="action-btn" type="button" data-action="clear-multi-select" title="退出对比模式">${icon('x')} 退出对比</button>
        </div>
        <div class="compare-subjects">
          <div><span class="compare-tag">基准</span> ${esc(compare.base.subject)}</div>
          <div><span class="compare-tag">目标</span> ${esc(compare.head.subject)}</div>
        </div>
      </div>`;
  } else if (commit) {
    const refs = commit.refs.length ? `<div class="refs-line">${renderRefPills(commit.refs, 8)}</div>` : '';
    const body = commit.body.trim() ? `<div class="commit-body">${esc(commit.body.trim())}</div>` : '';
    const parentLinks = commit.parents.length
      ? commit.parents
          .map((hash) => {
            const exists = allCommits.some((c) => c.hash === hash);
            return `<button class="parent-link" type="button" ${
              exists ? `data-action="goto-parent" data-hash="${esc(hash)}"` : 'disabled'
            } title="${esc(hash)}">${esc(hash.slice(0, 7))}</button>`;
          })
          .join(' ')
      : `<span>root commit</span>`;

    headerHtml = `
      <div class="commit-meta">
        ${refs}
        <h2 class="commit-title">${esc(commit.subject)}</h2>
        ${body}
        <div class="meta-author-row">
          ${avatarChip(commit.author.name, 'author-avatar')}
          <span class="author-info">
            <span class="author-name">${esc(commit.author.name)}</span>
            <span class="author-email">${esc(commit.author.email)}</span>
          </span>
          <span class="meta-dot">·</span>
          <span class="commit-time" title="${esc(absTime(commit.committedAt))}">${esc(commitDate(commit))}</span>
          <button class="hash-chip" type="button" data-act="copy" title="复制完整哈希">
            ${esc(commit.shortHash)} ${icon('copy')}
          </button>
        </div>
        <div class="meta-actions">
          <button class="action-btn" type="button" data-action="open-terminal-at-commit">
            ${icon('terminal')} 终端
          </button>
          <button class="action-btn soft" type="button" data-act="agent">
            ${icon('sparkles')} AI 分析
          </button>
          <button class="action-btn" type="button" data-action="expand-diff" title="全页面查看当前文件 diff">
            ${icon('expand')} 全页 diff
          </button>
          <button class="action-btn" type="button" data-act="cherry" title="将此提交 cherry-pick 到当前分支">Cherry-pick</button>
          <button class="action-btn" type="button" data-act="revert" title="回滚此提交">Revert</button>
          <button class="action-btn" type="button" data-act="rebase" title="以此提交为基点启动交互式变基">Rebase -i</button>
          <button class="action-btn" type="button" data-act="patch" title="导出 patch 到 Shelf">Patch</button>
          <span class="spacer"></span>
          <span class="parent-line">${icon('branch')} parent ${parentLinks}</span>
        </div>
      </div>`;
  }

  return `
    ${headerHtml}
    <div class="changes-block">
      <div class="section-head">
        ${icon('file')} ${compare ? '范围变更文件' : '变更文件'}
        <span class="count-pill">${files.length}</span>
        <span class="spacer"></span>
        <span class="stats-total">
          <span class="plus">+${totalAdd}</span>
          <span class="minus">−${totalDel}</span>
        </span>
      </div>
      <div class="file-rows">${fileRows}</div>
    </div>
    <div class="details-splitter" id="detailsSplitter" role="separator" aria-orientation="horizontal"
      tabindex="0" title="拖动调整变更文件高度（双击重置）"></div>

    ${bottomPanel}`;
}

import type { DiffFile, DiffRow, FileEntry, Hunk } from '../types';
import { basenameOf, dirnameOf, icon, renderHighlightedLine } from './icons';
import { esc } from './util';

export interface DiffBlockOptions {
  file: FileEntry | null;
  fileIndex: number;
  fileCount: number;
  diff: DiffFile | null;
  mode: 'split' | 'unified';
  ignoreWhitespace: boolean;
  expanded: boolean;
  stageGroup: 'staged' | 'unstaged' | null;
  loading: boolean;
  renderAllRows?: boolean;
  leftLabel: string;
  rightLabel: string;
  emptyText?: string;
  hideToolbar?: boolean;
}

const ROW_CAP = 240;

export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const lineNo = (value: number | undefined): string => (value && value > 0 ? String(value) : '');

interface SplitPair {
  left: DiffRow | null;
  right: DiffRow | null;
  isChange: boolean;
}

function pairSplitRows(rows: DiffRow[]): SplitPair[] {
  const out: SplitPair[] = [];
  let i = 0;
  while (i < rows.length) {
    const cur = rows[i];
    if (cur.t === 'ctx') {
      out.push({ left: cur, right: cur, isChange: false });
      i += 1;
      continue;
    }
    const dels: DiffRow[] = [];
    const adds: DiffRow[] = [];
    while (i < rows.length && rows[i].t === 'del') {
      dels.push(rows[i]);
      i += 1;
    }
    while (i < rows.length && rows[i].t === 'add') {
      adds.push(rows[i]);
      i += 1;
    }
    const count = Math.max(dels.length, adds.length);
    for (let k = 0; k < count; k += 1) {
      out.push({
        left: dels[k] ?? null,
        right: adds[k] ?? null,
        isChange: true,
      });
    }
  }
  return out;
}

function renderHunks(diff: DiffFile, options: DiffBlockOptions): string {
  const hunks = diff.hunks;
  if (!hunks.length) return '';
  const totalRows = hunks.reduce((sum, hunk) => sum + hunk.rows.length, 0);
  const capped = totalRows > 1200 && !options.renderAllRows;
  let budget = capped ? ROW_CAP : Number.POSITIVE_INFINITY;
  let renderedRows = 0;
  let html = '';
  let changeRun = -1;

  for (let h = 0; h < hunks.length; h += 1) {
    const hunk = hunks[h];
    if (budget <= 0) break;
    if (h > 0 && !options.expanded) {
      const prev = hunks[h - 1];
      const gap = hunk.oldStart - (prev.oldStart + prev.oldLines);
      if (gap > 0) {
        html += `<div class="diff-fold" data-fold="${h}">⋯ ${gap} 行未变更（点击展开上下文）</div>`;
      }
    }
    const canStage = options.stageGroup !== null;
    const stageBtn = canStage
      ? `<button class="hunk-stage-btn${options.stageGroup === 'staged' ? ' staged' : ''}" type="button" data-stage-hunk="${h}">${
          options.stageGroup === 'staged' ? '↺ 撤销暂存此块' : '✓ 暂存此块'
        }</button>`
      : '';
    html += `<div class="diff-hunk"><span>${esc(hunk.header)}</span>${stageBtn}</div>`;

    if (options.mode === 'unified') {
      let prevKind = '';
      for (const row of hunk.rows) {
        if (budget <= 0) break;
        budget -= 1;
        renderedRows += 1;
        const isChange = row.t === 'add' || row.t === 'del';
        if (isChange && (prevKind === '' || prevKind === 'ctx')) changeRun += 1;
        const marker = isChange && (prevKind === '' || prevKind === 'ctx') ? ` data-change="${changeRun}"` : '';
        prevKind = row.t;
        const sign = row.t === 'add' ? '+' : row.t === 'del' ? '−' : ' ';
        html += `
          <div class="uni-row ${row.t}"${marker}>
            <span class="diff-ln">${esc(lineNo(row.oldNo))}</span>
            <span class="diff-ln right">${esc(lineNo(row.newNo))}</span>
            <span class="uni-sign ${row.t}">${sign}</span>
            <span class="diff-code">${renderHighlightedLine(row.text, row.hl)}</span>
          </div>`;
      }
    } else {
      const pairs = pairSplitRows(hunk.rows);
      let prevChange = false;
      for (const pair of pairs) {
        if (budget <= 0) break;
        budget -= 1;
        renderedRows += 1;
        if (pair.isChange && !prevChange) changeRun += 1;
        const marker = pair.isChange && !prevChange ? ` data-change="${changeRun}"` : '';
        prevChange = pair.isChange;
        const left = pair.left;
        const right = pair.right;
        const leftDel = left && left.t === 'del';
        const rightAdd = right && right.t === 'add';
        html += `
          <div class="diff-row"${marker}>
            <span class="diff-ln ${leftDel ? 'del' : ''}">${esc(lineNo(left?.oldNo))}</span>
            <span class="diff-code left ${leftDel ? 'del' : ''} ${!left ? 'fill' : ''}">${
              left ? renderHighlightedLine(left.text, left.hl) : ' '
            }</span>
            <span class="diff-ln right ${rightAdd ? 'add' : ''}">${esc(lineNo(right?.newNo))}</span>
            <span class="diff-code right ${rightAdd ? 'add' : ''} ${!right ? 'fill' : ''}">${
              right ? renderHighlightedLine(right.text, right.hl) : ' '
            }</span>
          </div>`;
      }
    }
  }

  if (capped && renderedRows < totalRows) {
    html += `<div class="diff-fold" data-render-all="1">⋯ 其余 ${totalRows - renderedRows} 行已省略（点击加载全部）</div>`;
  }
  return html;
}

export function renderDiffBodyOnly(options: DiffBlockOptions): string {
  if (options.loading) {
    return `<div class="diff-scroll"><div class="diff-empty"><span>正在读取 diff…</span></div></div>`;
  }
  if (!options.file || !options.diff) {
    return `<div class="diff-scroll"><div class="diff-empty">${icon('file')}<span>${esc(
      options.emptyText ?? '没有可显示的差异。',
    )}</span></div></div>`;
  }
  const diff = options.diff;
  if (diff.binary) {
    const size = diff.size > 0 ? ` · ${formatSize(diff.size)}` : '';
    return `
      <div class="diff-scroll">
        <div class="diff-empty">
          ${icon('file')}
          <span>二进制文件，无法显示差异（${esc(diff.path)}${size}）</span>
          <button class="btn" type="button" data-act="locate">在外部程序打开</button>
        </div>
      </div>`;
  }
  if (!diff.hunks.length) {
    if (options.file.path.endsWith('/')) {
      return `
        <div class="diff-scroll">
          <div class="diff-empty">
            ${icon('folder')}
            <strong>${esc(options.file.path)} 是嵌套 Git 仓库</strong>
            <span>该目录包含独立的 <code>.git</code>，外层仓库不会展开其内部文件差异。如需忽略可写入 <code>.gitignore</code>，或将其作为独立仓库管理。</span>
          </div>
        </div>`;
    }
    return `
      <div class="diff-scroll">
        <div class="diff-empty">${icon('file')}<span>两侧内容一致，没有差异。</span></div>
      </div>`;
  }

  const oldCount = diff.hunks.reduce((s, h) => s + h.oldLines, 0);
  const newCount = diff.hunks.reduce((s, h) => s + h.newLines, 0);
  const truncBanner = diff.truncated
    ? `<div class="diff-trunc-bar">
        <span>文件较大${diff.size > 0 ? `（${formatSize(diff.size)}）` : ''}，已按块限制传输</span>
        <span class="spacer"></span>
        <button class="btn" type="button" data-act="loadall">加载全部</button>
      </div>`
    : '';

  return `
    ${truncBanner}
    <div class="diff-scroll" id="diffWrap">
      <div class="diff-head">
        <div class="diff-side">${esc(options.leftLabel)} <span>${oldCount} 行</span></div>
        <div class="diff-side">${esc(options.rightLabel)} <span>${newCount} 行</span></div>
      </div>
      <div class="diff-rows">${renderHunks(diff, options)}</div>
    </div>`;
}

export function renderDiffBlock(options: DiffBlockOptions): string {
  const { file, fileIndex, fileCount, diff, mode } = options;
  const path = file?.path ?? diff?.path ?? '';
  const addCount = diff ? diff.additions : Math.max(0, file?.additions ?? 0);
  const delCount = diff ? diff.deletions : Math.max(0, file?.deletions ?? 0);
  const toolbar = options.hideToolbar
    ? ''
    : `
    <div class="diff-toolbar">
      <button class="diff-nav" type="button" data-action="diff-prev-file" title="上一个文件" ${
        fileCount <= 1 ? 'disabled' : ''
      }>${icon('chevron-left')}</button>
      <button class="diff-nav" type="button" data-action="diff-next-file" title="下一个文件" ${
        fileCount <= 1 ? 'disabled' : ''
      }>${icon('chevron-right')}</button>
      ${
        path
          ? `<span class="diff-file" title="${esc(path)}">
              ${icon(path.endsWith('/') ? 'folder' : 'file')}
              <span class="dfdir">${esc(dirnameOf(path))}</span>
              <span class="dfname">${esc(basenameOf(path))}</span>
            </span>`
          : `<span class="diff-file">没有选中的文件</span>`
      }
      ${
        path
          ? `<span class="diff-file-stats">
              <span class="plus">+${addCount}</span>
              ${delCount > 0 ? `<span class="minus">−${delCount}</span>` : ''}
            </span>`
          : ''
      }
      <button class="diff-tool-btn${options.ignoreWhitespace ? ' active' : ''}" type="button" data-act="ignorews" title="忽略空白变化">空白</button>
      ${
        path && !file?.untracked
          ? `<button class="diff-tool-btn" type="button" data-act="blame" title="查看逐行 Blame">Blame</button>`
          : ''
      }
      ${
        path
          ? `<button class="diff-tool-btn" type="button" data-act="locate" title="在外部编辑器打开">打开</button>`
          : ''
      }
      <span class="diff-mode-seg" role="group" aria-label="Diff 视图">
        <button class="diff-mode-btn ${mode === 'split' ? 'active' : ''}" type="button" data-diffmode="split" title="并排 diff">${icon('split')}</button>
        <button class="diff-mode-btn ${mode === 'unified' ? 'active' : ''}" type="button" data-diffmode="unified" title="统一 diff">${icon('unified')}</button>
      </span>
      ${fileCount > 0 && fileIndex >= 0 ? `<span class="diff-index">${fileIndex + 1} / ${fileCount}</span>` : ''}
      ${
        path
          ? `<button class="diff-nav diff-expand" type="button" data-action="expand-diff" title="全页面查看 diff（双击文件也可）">${icon('expand')}</button>`
          : ''
      }
    </div>`;

  return toolbar + renderDiffBodyOnly(options);
}

export const buildHunkPatch = (file: FileEntry, hunk: Hunk): string => {
  const oldPath = file.oldPath && file.oldPath !== file.path ? file.oldPath : file.path;
  const isNew = file.status === 'A' || file.untracked === true;
  const isDeleted = file.status === 'D';
  let patch = `diff --git a/${oldPath} b/${file.path}\n`;
  if (isNew) patch += 'new file mode 100644\n';
  if (isDeleted) patch += 'deleted file mode 100644\n';
  patch += `--- ${isNew ? '/dev/null' : `a/${oldPath}`}\n`;
  patch += `+++ ${isDeleted ? '/dev/null' : `b/${file.path}`}\n`;
  patch += `${hunk.header}\n`;
  for (const row of hunk.rows) {
    const prefix = row.t === 'add' ? '+' : row.t === 'del' ? '-' : ' ';
    patch += `${prefix}${row.text}\n`;
  }
  return patch;
};

/** First changed row per run, used by ↑/↓ navigation. */
export const changeRowSelector = '[data-change]';

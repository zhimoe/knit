import type { DiffFile, DiffRow, FileEntry, Hunk, ImagePreview } from '../types';
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
  selectedLines?: Set<string>;
  imagePreview?: ImagePreview | null;
  imageMode?: 'side' | 'slider';
  imageSlider?: number;
}

const ROW_CAP = 240;

export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const lineNo = (value: number | undefined): string => (value && value > 0 ? String(value) : '');

export const lineSelectKey = (hunkIndex: number, rowIndex: number): string => `${hunkIndex}:${rowIndex}`;

interface IndexedRow {
  row: DiffRow;
  rowIndex: number;
}

interface SplitPair {
  left: IndexedRow | null;
  right: IndexedRow | null;
  isChange: boolean;
}

function pairSplitRows(rows: DiffRow[]): SplitPair[] {
  const out: SplitPair[] = [];
  let i = 0;
  while (i < rows.length) {
    const cur = rows[i];
    if (cur.t === 'ctx') {
      out.push({ left: { row: cur, rowIndex: i }, right: { row: cur, rowIndex: i }, isChange: false });
      i += 1;
      continue;
    }
    const dels: IndexedRow[] = [];
    const adds: IndexedRow[] = [];
    while (i < rows.length && rows[i].t === 'del') {
      dels.push({ row: rows[i], rowIndex: i });
      i += 1;
    }
    while (i < rows.length && rows[i].t === 'add') {
      adds.push({ row: rows[i], rowIndex: i });
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

function renderImageDiff(preview: ImagePreview, mode: 'side' | 'slider', slider: number): string {
  const hasBefore = Boolean(preview.beforeDataUrl);
  const hasAfter = Boolean(preview.afterDataUrl);
  const canSlider = hasBefore && hasAfter;
  const activeMode = canSlider ? mode : 'side';

  const modeBar = `
    <div class="img-diff-bar">
      <span class="img-diff-meta">
        ${icon('image')}
        <span>图片预览（${esc(preview.mime)}）</span>
        ${preview.beforeBytes ? `<span class="sep">·</span><span>修改前 ${formatSize(preview.beforeBytes)}</span>` : ''}
        ${preview.afterBytes ? `<span class="sep">·</span><span>修改后 ${formatSize(preview.afterBytes)}</span>` : ''}
      </span>
      <span class="spacer"></span>
      ${
        canSlider
          ? `<span class="diff-mode-seg" role="group" aria-label="图片对比模式">
              <button class="diff-mode-btn${activeMode === 'side' ? ' active' : ''}" type="button" data-img-mode="side" title="并排对比">并排</button>
              <button class="diff-mode-btn${activeMode === 'slider' ? ' active' : ''}" type="button" data-img-mode="slider" title="滑块叠层对比">滑块</button>
            </span>`
          : ''
      }
      <button class="btn" type="button" data-act="locate" style="height:24px;font-size:10.5px">外部打开</button>
    </div>`;

  if (activeMode === 'slider' && canSlider) {
    const pct = Math.max(0, Math.min(100, slider));
    return `
      <div class="diff-scroll">
        ${modeBar}
        <div class="img-slider-wrap">
          <div class="img-slider-stage">
            <img class="img-slider-after" src="${preview.afterDataUrl}" alt="修改后">
            <div class="img-slider-before-clip" style="clip-path:inset(0 ${100 - pct}% 0 0)">
              <img class="img-slider-before" src="${preview.beforeDataUrl}" alt="修改前">
            </div>
            <div class="img-slider-divider" style="left:${pct}%"></div>
            <span class="img-tag left">修改前</span>
            <span class="img-tag right">修改后</span>
          </div>
          <div class="img-slider-ctrl">
            <span>修改前</span>
            <input id="imgDiffSlider" type="range" min="0" max="100" value="${pct}" aria-label="图片对比滑块">
            <span>修改后</span>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="diff-scroll">
      ${modeBar}
      <div class="img-side-grid">
        <div class="img-card">
          <div class="img-card-head">修改前 ${preview.beforeBytes ? `<span>${formatSize(preview.beforeBytes)}</span>` : ''}</div>
          <div class="img-card-body">
            ${hasBefore ? `<img src="${preview.beforeDataUrl}" alt="修改前">` : '<span class="img-none">（新增图片）</span>'}
          </div>
        </div>
        <div class="img-card">
          <div class="img-card-head">修改后 ${preview.afterBytes ? `<span>${formatSize(preview.afterBytes)}</span>` : ''}</div>
          <div class="img-card-body">
            ${hasAfter ? `<img src="${preview.afterDataUrl}" alt="修改后">` : '<span class="img-none">（已删除图片）</span>'}
          </div>
        </div>
      </div>
    </div>`;
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
  const selectedLines = options.selectedLines ?? new Set<string>();
  const canStage = options.stageGroup !== null;
  const isStaged = options.stageGroup === 'staged';
  const isUntracked = Boolean(options.file?.untracked);

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

    let selectedInHunk = 0;
    if (canStage && selectedLines.size > 0) {
      for (let r = 0; r < hunk.rows.length; r += 1) {
        if (selectedLines.has(lineSelectKey(h, r))) selectedInHunk += 1;
      }
    }

    const lineBtns =
      canStage && selectedInHunk > 0 && !isUntracked
        ? `<button class="hunk-stage-btn line-act" type="button" data-stage-lines="${h}">${
            isStaged ? `↺ 撤销选中 ${selectedInHunk} 行` : `✓ 暂存选中 ${selectedInHunk} 行`
          }</button>${
            !isStaged
              ? `<button class="hunk-stage-btn danger" type="button" data-discard-lines="${h}" title="丢弃选中的 ${selectedInHunk} 行（先保存快照）">丢弃 ${selectedInHunk} 行</button>`
              : ''
          }`
        : '';

    const stageBtn = canStage
      ? `<span class="hunk-actions">
          ${lineBtns}
          <button class="hunk-stage-btn${isStaged ? ' staged' : ''}" type="button" data-stage-hunk="${h}">${
            isStaged ? '↺ 撤销暂存此块' : '✓ 暂存此块'
          }</button>
          ${
            !isStaged && !isUntracked
              ? `<button class="hunk-stage-btn danger" type="button" data-discard-hunk="${h}" title="丢弃此代码块更改（先保存快照）">丢弃此块</button>`
              : ''
          }
        </span>`
      : '';
    html += `<div class="diff-hunk"><span>${esc(hunk.header)}</span>${stageBtn}</div>`;

    if (options.mode === 'unified') {
      let prevKind = '';
      for (let r = 0; r < hunk.rows.length; r += 1) {
        const row = hunk.rows[r];
        if (budget <= 0) break;
        budget -= 1;
        renderedRows += 1;
        const isChange = row.t === 'add' || row.t === 'del';
        if (isChange && (prevKind === '' || prevKind === 'ctx')) changeRun += 1;
        const marker = isChange && (prevKind === '' || prevKind === 'ctx') ? ` data-change="${changeRun}"` : '';
        prevKind = row.t;
        const sign = row.t === 'add' ? '+' : row.t === 'del' ? '−' : ' ';
        const selectable = canStage && isChange && !isUntracked;
        const selKey = lineSelectKey(h, r);
        const isSel = selectable && selectedLines.has(selKey);
        const selectAttr = selectable ? ` data-line-select="${selKey}" title="点击选中/取消该行（Shift 连选）"` : '';
        html += `
          <div class="uni-row ${row.t}${selectable ? ' selectable' : ''}${isSel ? ' line-selected' : ''}"${marker}>
            <span class="diff-ln"${selectAttr}>${esc(lineNo(row.oldNo))}</span>
            <span class="diff-ln right"${selectAttr}>${esc(lineNo(row.newNo))}</span>
            <span class="uni-sign ${row.t}"${selectAttr}>${isSel ? '✓' : sign}</span>
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
        const leftDel = Boolean(left && left.row.t === 'del');
        const rightAdd = Boolean(right && right.row.t === 'add');

        const leftSelKey = left && leftDel && canStage && !isUntracked ? lineSelectKey(h, left.rowIndex) : '';
        const rightSelKey = right && rightAdd && canStage && !isUntracked ? lineSelectKey(h, right.rowIndex) : '';
        const leftSel = Boolean(leftSelKey && selectedLines.has(leftSelKey));
        const rightSel = Boolean(rightSelKey && selectedLines.has(rightSelKey));

        html += `
          <div class="diff-row"${marker}>
            <span class="diff-ln ${leftDel ? 'del' : ''}${leftSelKey ? ' selectable' : ''}${leftSel ? ' line-selected' : ''}"${
              leftSelKey ? ` data-line-select="${leftSelKey}" title="点击选中/取消该行（Shift 连选）"` : ''
            }>${leftSel ? '✓' : esc(lineNo(left?.row.oldNo))}</span>
            <span class="diff-code left ${leftDel ? 'del' : ''} ${!left ? 'fill' : ''}${leftSel ? ' line-selected' : ''}">${
              left ? renderHighlightedLine(left.row.text, left.row.hl) : ' '
            }</span>
            <span class="diff-ln right ${rightAdd ? 'add' : ''}${rightSelKey ? ' selectable' : ''}${rightSel ? ' line-selected' : ''}"${
              rightSelKey ? ` data-line-select="${rightSelKey}" title="点击选中/取消该行（Shift 连选）"` : ''
            }>${rightSel ? '✓' : esc(lineNo(right?.row.newNo))}</span>
            <span class="diff-code right ${rightAdd ? 'add' : ''} ${!right ? 'fill' : ''}${rightSel ? ' line-selected' : ''}">${
              right ? renderHighlightedLine(right.row.text, right.row.hl) : ' '
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
  if (options.imagePreview?.supported && !options.imagePreview.tooLarge && (options.imagePreview.beforeDataUrl || options.imagePreview.afterDataUrl)) {
    return renderImageDiff(options.imagePreview, options.imageMode ?? 'side', options.imageSlider ?? 50);
  }
  if (diff.binary) {
    const size = diff.size > 0 ? ` · ${formatSize(diff.size)}` : '';
    const extra = options.imagePreview?.tooLarge ? '（图片体积超过 150 KB 预览上限）' : '';
    return `
      <div class="diff-scroll">
        <div class="diff-empty">
          ${icon('file')}
          <span>二进制文件，无法显示差异（${esc(diff.path)}${size}）${extra}</span>
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

/**
 * Build a valid unified diff patch containing only the selected +/- rows inside a hunk.
 * - mode === 'stage': forward apply to index (`git apply --cached`)
 * - mode === 'unstage': reverse apply to index (`git apply --cached --reverse`)
 * - mode === 'discard': reverse apply to working tree (`git apply --reverse`)
 */
export const buildLinesPatch = (
  file: FileEntry,
  hunk: Hunk,
  hunkIndex: number,
  selectedLines: Set<string>,
  mode: 'stage' | 'unstage' | 'discard',
): string => {
  const oldPath = file.oldPath && file.oldPath !== file.path ? file.oldPath : file.path;
  const reverse = mode === 'unstage' || mode === 'discard';
  const outLines: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  let hasChanges = false;

  for (let r = 0; r < hunk.rows.length; r += 1) {
    const row = hunk.rows[r];
    const selected = selectedLines.has(lineSelectKey(hunkIndex, r));
    if (row.t === 'ctx') {
      outLines.push(` ${row.text}`);
      oldCount += 1;
      newCount += 1;
    } else if (row.t === 'add') {
      if (selected) {
        outLines.push(`+${row.text}`);
        newCount += 1;
        hasChanges = true;
      } else if (reverse) {
        // When reversing (unstage/discard), unselected '+' already exists in the target state, so keep as context.
        outLines.push(` ${row.text}`);
        oldCount += 1;
        newCount += 1;
      }
      // When forward staging, unselected '+' is omitted completely.
    } else if (row.t === 'del') {
      if (selected) {
        outLines.push(`-${row.text}`);
        oldCount += 1;
        hasChanges = true;
      } else if (!reverse) {
        // When forward staging, unselected '-' still exists in both index and target, so keep as context.
        outLines.push(` ${row.text}`);
        oldCount += 1;
        newCount += 1;
      }
      // When reversing (unstage/discard), unselected '-' does not exist in target, so omit it.
    }
  }

  if (!hasChanges) return '';
  let patch = `diff --git a/${oldPath} b/${file.path}\n`;
  patch += `--- a/${oldPath}\n`;
  patch += `+++ b/${file.path}\n`;
  patch += `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@\n`;
  patch += `${outLines.join('\n')}\n`;
  return patch;
};

/** First changed row per run, used by ↑/↓ navigation. */
export const changeRowSelector = '[data-change]';

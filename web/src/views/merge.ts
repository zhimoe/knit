import type { MergeState } from '../types';
import { icon } from './icons';
import { esc } from './util';

export type MergeChoice = 'ours' | 'theirs' | 'both' | null;

export interface MergeBlock {
  ours: string[];
  base: string[];
  theirs: string[];
  markerLine: number;
  hasBase: boolean;
}

export interface MergeSegment {
  kind: 'ctx' | 'block';
  lines?: string[];
  block?: MergeBlock;
}

export const parseMergeLines = (lines: string[]): MergeSegment[] => {
  const segments: MergeSegment[] = [];
  let context: string[] = [];
  const pushContext = (): void => {
    if (context.length) {
      segments.push({ kind: 'ctx', lines: context });
      context = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.startsWith('<<<<<<<')) {
      context.push(line);
      i += 1;
      continue;
    }
    pushContext();
    const markerLine = i + 1;
    i += 1;
    const ours: string[] = [];
    while (i < lines.length && !(lines[i] ?? '').startsWith('|||||||') && !(lines[i] ?? '').startsWith('=======')) {
      ours.push(lines[i] ?? '');
      i += 1;
    }
    const base: string[] = [];
    let hasBase = false;
    if (i < lines.length && (lines[i] ?? '').startsWith('|||||||')) {
      hasBase = true;
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').startsWith('=======')) {
        base.push(lines[i] ?? '');
        i += 1;
      }
    }
    const theirs: string[] = [];
    if (i < lines.length && (lines[i] ?? '').startsWith('=======')) {
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').startsWith('>>>>>>>')) {
        theirs.push(lines[i] ?? '');
        i += 1;
      }
    }
    if (i < lines.length && (lines[i] ?? '').startsWith('>>>>>>>')) i += 1;
    segments.push({ kind: 'block', block: { ours, base, theirs, markerLine, hasBase } });
  }
  pushContext();
  return segments;
};

export const blockCount = (segments: MergeSegment[]): number =>
  segments.filter((segment) => segment.kind === 'block').length;

export const unresolvedCount = (segments: MergeSegment[], choices: MergeChoice[]): number => {
  let count = 0;
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i].kind === 'block' && !choices[i]) count += 1;
  }
  return count;
};

export const hasConflictMarkers = (text: string): boolean =>
  /^(<{7}|={7}|>{7})/m.test(text);

export const autoChoice = (block: MergeBlock): MergeChoice => {
  const ours = block.ours.join('\n').trim();
  const theirs = block.theirs.join('\n').trim();
  if (ours === theirs) return 'ours';
  if (!ours) return 'theirs';
  if (!theirs) return 'ours';
  return null;
};

export const chosenLines = (block: MergeBlock, choice: MergeChoice): string[] => {
  if (choice === 'theirs') return block.theirs;
  if (choice === 'both') return [...block.ours, ...block.theirs];
  return block.ours;
};

export const resolvedContent = (
  segments: MergeSegment[],
  choices: MergeChoice[],
  trailingNewline = true,
): string => {
  const out: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment.kind === 'ctx') out.push(...(segment.lines ?? []));
    else if (segment.block) out.push(...chosenLines(segment.block, choices[i] ?? 'ours'));
  }
  return out.join('\n') + (out.length && trailingNewline ? '\n' : '');
};

const paneLines = (lines: string[], confIndexes: Set<number>): string =>
  lines
    .map(
      (line, index) =>
        `<div class="mline${confIndexes.has(index) ? ' conf' : ''}"><span class="no">${index + 1}</span><span class="tx">${esc(
          line || ' ',
        )}</span></div>`,
    )
    .join('');

/** Locate each block's lines inside a side pane (approximate but stable). */
const conflictLineSet = (fullText: string, blocks: MergeBlock[], side: 'ours' | 'theirs'): Set<number> => {
  const result = new Set<number>();
  const lines = fullText.replace(/\n$/, '').split('\n');
  let cursor = 0;
  for (const block of blocks) {
    const target = block[side];
    if (!target.length) continue;
    for (let i = cursor; i <= lines.length - target.length; i += 1) {
      let match = true;
      for (let k = 0; k < target.length; k += 1) {
        if (lines[i + k] !== target[k]) {
          match = false;
          break;
        }
      }
      if (match) {
        for (let k = 0; k < target.length; k += 1) result.add(i + k);
        cursor = i + target.length;
        break;
      }
    }
  }
  return result;
};

export interface MergeModalOptions {
  state: MergeState;
  segments: MergeSegment[];
  choices: MergeChoice[];
  activeBlock: number;
  editMode: boolean;
  customText: string | null;
}

export const renderMergeModal = (opts: MergeModalOptions): string => {
  const { state, segments, choices, activeBlock, editMode, customText } = opts;
  const blocks = segments
    .filter((segment) => segment.kind === 'block' && segment.block)
    .map((segment) => segment.block as MergeBlock);
  const unresolved = unresolvedCount(segments, choices);
  const oursConf = conflictLineSet(state.ours, blocks, 'ours');
  const theirsConf = conflictLineSet(state.theirs, blocks, 'theirs');
  const oursLines = state.ours.replace(/\n$/, '').split('\n');
  const theirsLines = state.theirs.replace(/\n$/, '').split('\n');

  const editedText = customText ?? resolvedContent(segments, choices, true);
  const editorHasMarkers = editMode && hasConflictMarkers(editedText);

  let resultPaneBody = '';
  if (editMode) {
    resultPaneBody = `<textarea class="merge-editor" id="mergeEditor" spellcheck="false" autocomplete="off">${esc(
      editedText,
    )}</textarea>`;
  } else {
    let resultLine = 1;
    let blockIndex = 0;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (segment.kind === 'ctx') {
        for (const line of segment.lines ?? []) {
          resultPaneBody += `<div class="mline"><span class="no">${resultLine}</span><span class="tx">${esc(
            line || ' ',
          )}</span></div>`;
          resultLine += 1;
        }
        continue;
      }
      const block = segment.block;
      if (!block) continue;
      const choice = choices[i] ?? null;
      const lines = chosenLines(block, choice);
      resultPaneBody += `<div class="cblock${choice ? ' resolved' : ''}${blockIndex === activeBlock ? ' active' : ''}" data-block-anchor="${blockIndex}">
        <div class="ch"><span>冲突 ${blockIndex + 1} · 第 ${block.markerLine} 行</span><span class="sp"></span>
          <button type="button" data-accept="ours" data-block="${blockIndex}">← 左边</button>
          <button type="button" data-accept="theirs" data-block="${blockIndex}">右边 →</button>
          <button type="button" data-accept="both" data-block="${blockIndex}">两边都要</button>
        </div>`;
      if (!lines.length) {
        resultPaneBody += `<div class="mline${choice ? '' : ' conf'}"><span class="no">${resultLine}</span><span class="tx">（空）</span></div>`;
        resultLine += 1;
      } else {
        for (const line of lines) {
          resultPaneBody += `<div class="mline${choice ? '' : ' conf'}"><span class="no">${resultLine}</span><span class="tx">${esc(
            line || ' ',
          )}</span></div>`;
          resultLine += 1;
        }
      }
      resultPaneBody += '</div>';
      blockIndex += 1;
    }
  }

  const statusBadge = editMode
    ? editorHasMarkers
      ? '<span class="mbadge warn" id="confCount">包含未清理的冲突标记</span>'
      : '<span class="mbadge ok" id="confCount">自由编辑模式 · 可直接应用</span>'
    : `<span class="mbadge ${unresolved ? 'warn' : 'ok'}" id="confCount">${
        unresolved ? `${unresolved} 处未解决` : '全部已解决'
      }</span>`;

  return `
    <div class="modal-backdrop full-pad" data-modal-backdrop="1">
      <div class="modal wide" role="dialog" aria-modal="true" aria-label="三栏冲突合并">
        <div class="mhead">
          <span class="mhead-title">${icon('merge')} 合并冲突 · ${esc(state.path)}</span>
          ${statusBadge}
          <span class="spacer"></span>
          ${
            editMode
              ? `<button class="btn" type="button" id="mergeToggleEdit">${icon('undo')} 返回块选择</button>`
              : `<button class="btn" type="button" id="autoResolve">自动解决简单冲突</button>
                 <button class="btn" type="button" data-merge-nav="-1">◀ 上一处</button>
                 <button class="btn" type="button" data-merge-nav="1">下一处 ▶</button>
                 <button class="btn" type="button" id="mergeToggleEdit">${icon('edit')} 编辑结果</button>`
          }
          <button class="btn primary" type="button" id="mergeApply">应用并标记已解决</button>
          <button class="btn" type="button" id="mergeClose">取消</button>
        </div>
        <div class="mgrid">
          <div class="mpane"><div class="mh">Yours · HEAD</div><div class="mb">${paneLines(oursLines, oursConf)}</div></div>
          <div class="mpane">
            <div class="mh">
              <span>Result（${editMode ? '直接编辑中' : '点块选择或切换编辑'}）</span>
              <span class="spacer"></span>
              ${
                editMode && customText !== null
                  ? `<button class="diff-tool-btn" type="button" id="mergeResetText" title="按当前块选择重新生成文本">重置文本</button>`
                  : ''
              }
            </div>
            <div class="mb" style="${editMode ? 'padding:0;overflow:hidden;display:flex' : ''}">${resultPaneBody}</div>
          </div>
          <div class="mpane"><div class="mh">Theirs · incoming</div><div class="mb">${paneLines(theirsLines, theirsConf)}</div></div>
        </div>
      </div>
    </div>`;
};

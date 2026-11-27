import type { Draft } from '../draft';
import type { DiffFile, FileEntry, ImagePreview, Repo } from '../types';
import { absTime, icon } from './icons';
import { buildPathTree, countTreeFiles, type PathTreeNode } from './details';
import { renderDiffBlock } from './diff';
import { changeKey, esc, relativeDraftTime, statusClass } from './util';

export const stagedFiles = (files: FileEntry[]): FileEntry[] => files.filter((file) => file.group === 'staged');

export interface ChangesHeadOptions {
  repo: Repo;
  files: FileEntry[];
}

export function renderChangesHead({ repo, files }: ChangesHeadOptions): string {
  const hasChanges = files.length > 0;
  const stagedCount = stagedFiles(files).length;
  const untrackedCount = files.filter((f) => f.untracked).length;
  const conflictCount = files.filter((f) => f.conflict).length;
  const totalAdd = files.reduce((s, f) => s + Math.max(0, f.additions), 0);
  const totalDel = files.reduce((s, f) => s + Math.max(0, f.deletions), 0);

  return `
    <span class="cv-head-icon ${hasChanges ? '' : 'clean'}">${icon(hasChanges ? 'file' : 'check')}</span>
    <div>
      <div class="cv-head-title">Working changes
        <button class="branch-pill" type="button" data-action="open-branches" title="管理分支">${icon('branch')}<span>${esc(
          repo.branch ?? 'detached',
        )}</span></button>
      </div>
      <div class="cv-head-sub">
        ${
          hasChanges
            ? `
          <span>${files.length} 个变更项</span>
          ${untrackedCount ? `<span class="sep">·</span><span class="untracked-meta">${untrackedCount} 未跟踪</span>` : ''}
          ${conflictCount ? `<span class="sep">·</span><span style="color:var(--red);font-weight:550">${conflictCount} 冲突</span>` : ''}
          <span class="sep">·</span>
          <span class="plus">+${totalAdd}</span><span class="minus">−${totalDel}</span><span class="sep">·</span>
          <span><span id="changesCheckedCount">${stagedCount}</span> / ${files.length} 已暂存</span><span class="sep">·</span>
          <span>草稿按仓库记忆</span>`
            : `<span>工作区干净</span><span class="sep">·</span><span>没有未提交的更改</span>`
        }
      </div>
    </div>
    <span class="spacer"></span>
    <div class="cv-head-actions">
      ${
        conflictCount > 0
          ? `<button class="btn danger" type="button" data-act="merge-abort" style="height:26px;font-size:10px">中止合并</button>`
          : ''
      }
      ${
        hasChanges
          ? `<button class="cv-full-btn" type="button" data-action="expand-diff" title="全页面查看当前文件 diff">${icon('expand')} 全页 Diff</button>
             <span class="cv-head-hint">勾选即暂存（git add），右下提交</span>`
          : ''
      }
    </div>`;
}

function renderTreeRows(
  node: PathTreeNode<FileEntry>,
  selectedKey: string,
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
      <div class="tree-folder" data-tree-folder="${esc(folder.path)}" style="padding-left:${depth * 13 + 6}px" title="${esc(folder.path)}">
        ${icon('chevron-right', `ic tree-chev ${collapsed ? '' : 'open'}`)}
        ${icon('folder')}
        <span class="tree-folder-name">${esc(folder.name)}</span>
        <span class="tree-count">${count}</span>
      </div>`;
    if (!collapsed) html += renderTreeRows(folder, selectedKey, collapsedSet, depth + 1);
  }

  for (const file of files) {
    const key = changeKey(file);
    const checked = file.group === 'staged';
    const active = key === selectedKey;
    const isNestedDir = file.path.endsWith('/');
    const st = statusClass(file);
    const statClass = file.conflict ? 'conflict' : st;
    html += `
      <div class="tree-file ${active ? 'active' : ''} ${checked ? '' : 'off'} ${file.untracked ? 'untracked' : ''}"
        data-cfile="${esc(key)}" role="button" tabindex="0"
        style="padding-left:${depth * 13 + 6}px" title="${esc(file.path)}${
          isNestedDir ? ' · 嵌套 Git 仓库 / 未跟踪目录' : file.untracked ? ' · 未跟踪' : ''
        }${
          file.group === 'staged' ? ' · 已暂存' : ' · 未暂存'
        }${isNestedDir ? '' : ' · 双击全页查看 diff'}">
        <label class="check-wrap">
          <input type="checkbox" data-check="${esc(key)}" ${checked ? 'checked' : ''}>
          <span class="check-box">${icon('check')}</span>
        </label>
        <span class="fstat ${statClass}">${file.conflict ? 'U' : st}</span>
        <span class="tree-name">${esc(file.name)}</span>
        ${
          file.conflict
            ? `<button class="conflict-btn" type="button" data-merge="${esc(file.path)}" title="打开三栏冲突编辑器">解决冲突</button>`
            : isNestedDir
              ? `<span class="nested-repo-tag" title="该目录包含独立的 .git 仓库，外层仓库不展开其内部文件">嵌套仓库</span>`
              : `<span class="tree-file-stats">
                  <span class="plus">+${Math.max(0, file.additions)}</span>
                  ${file.deletions > 0 ? `<span class="minus">−${file.deletions}</span>` : ''}
                </span>`
        }
        ${
          file.untracked
            ? ''
            : `<button class="tree-history" type="button" data-action="worktree-history" data-path="${esc(
                file.path,
              )}" title="在 Log 中查看此文件历史">${icon('history')}</button>`
        }
      </div>`;
  }
  return html;
}

export function renderChangesTreePanel(
  files: FileEntry[],
  selectedKey: string,
  collapsedSet: Set<string>,
): string {
  if (!files.length) {
    return `
      <div class="cv-clean-state">
        <span class="clean-icon">${icon('check')}</span>
        <strong>工作区干净</strong>
        <span>没有未提交的更改。可以回到 Log 继续查看提交历史。</span>
      </div>`;
  }

  const staged = stagedFiles(files);
  const allStaged = staged.length === files.length && files.length > 0;
  const totalAdd = files.reduce((s, f) => s + Math.max(0, f.additions), 0);
  const totalDel = files.reduce((s, f) => s + Math.max(0, f.deletions), 0);

  const tracked = files.filter((f) => !f.untracked);
  const untracked = files.filter((f) => f.untracked);

  const trackedHtml = tracked.length ? renderTreeRows(buildPathTree(tracked), selectedKey, collapsedSet, 0) : '';
  const untrackedHtml = untracked.length
    ? `${tracked.length ? '<div class="tree-section-divider"></div>' : ''}
      <div class="tree-section-title">
        ${icon('file-plus')}<span>未跟踪文件</span>
        <span class="tree-section-count">${untracked.length}</span>
        <span class="tree-section-note">未忽略</span>
      </div>
      ${renderTreeRows(buildPathTree(untracked), selectedKey, collapsedSet, 0)}`
    : '';

  return `
    <div class="cv-tree-head">
      <label class="check-wrap">
        <input type="checkbox" id="selectAllChanges" data-select-all="1" ${allStaged ? 'checked' : ''}>
        <span class="check-box">${icon('check')}</span>
        <span>全选</span>
      </label>
      <span class="change-count" id="changeCount">${staged.length} / ${files.length}</span>
      <button class="discard-btn" id="discardChangesBtn" type="button" data-action="discard-changes"
        title="放弃已勾选（或当前选中）文件的更改（会先保存快照）">
        ${icon('undo')}<span>放弃更改</span>
      </button>
      <span class="spacer"></span>
      <span class="change-total">
        <span class="plus">+${totalAdd}</span>
        <span class="minus">−${totalDel}</span>
      </span>
    </div>
    <div class="cv-tree-scroll">${trackedHtml}${untrackedHtml}</div>`;
}

export interface ChangesDiffOptions {
  files: FileEntry[];
  selectedKey: string;
  diff: DiffFile | null;
  diffMode: 'split' | 'unified';
  ignoreWhitespace: boolean;
  expanded: boolean;
  loading: boolean;
  renderAllRows: boolean;
  blameHtml?: string | null;
  selectedLines?: Set<string>;
  imagePreview?: ImagePreview | null;
  imageMode?: 'side' | 'slider';
  imageSlider?: number;
}

export function renderChangesDiffPanel(opts: ChangesDiffOptions): string {
  if (!opts.files.length) {
    return `<div class="cv-clean-state">${icon('file')}<span>工作区没有可预览的 diff。</span></div>`;
  }
  if (opts.blameHtml) {
    return opts.blameHtml;
  }
  const index = opts.files.findIndex((f) => changeKey(f) === opts.selectedKey);
  const selected = index >= 0 ? opts.files[index] : null;
  return renderDiffBlock({
    file: selected,
    fileIndex: index,
    fileCount: opts.files.length,
    diff: opts.diff,
    mode: opts.diffMode,
    ignoreWhitespace: opts.ignoreWhitespace,
    expanded: opts.expanded,
    stageGroup: selected ? (selected.group === 'staged' ? 'staged' : 'unstaged') : null,
    loading: opts.loading,
    renderAllRows: opts.renderAllRows,
    leftLabel: 'HEAD',
    rightLabel: selected?.group === 'staged' ? '暂存区 · staged' : '工作区 · 未暂存',
    emptyText: '选择左侧文件查看工作区 diff。',
    selectedLines: opts.selectedLines,
    imagePreview: opts.imagePreview,
    imageMode: opts.imageMode,
    imageSlider: opts.imageSlider,
  });
}

export interface CommitBoxOptions {
  repo: Repo;
  files: FileEntry[];
  message: string;
  amend: boolean;
  draft: Draft | null;
  busy: boolean;
  aiBusy: boolean;
}

export function renderCommitBox(opts: CommitBoxOptions): string {
  const { repo, files, message, amend, draft, busy, aiBusy } = opts;
  const staged = stagedFiles(files);
  const add = staged.reduce((s, f) => s + Math.max(0, f.additions), 0);
  const del = staged.reduce((s, f) => s + Math.max(0, f.deletions), 0);
  const firstLine = message.split('\n')[0] ?? '';
  const canCommit = !busy && !aiBusy && Boolean(message.trim()) && (staged.length > 0 || amend);

  const targetHtml = staged.length
    ? `提交到 <b>${esc(repo.branch ?? 'detached')}</b><span class="sep">·</span>${staged.length} 个文件<span class="sep">·</span><span class="stats"><span class="plus">+${add}</span> <span class="minus">−${del}</span></span>`
    : amend
      ? `修改上一次提交（<b>${esc(repo.branch ?? 'detached')}</b>）`
      : `提交到 <b>${esc(repo.branch ?? 'detached')}</b><span class="sep">·</span>勾选要暂存的文件`;

  const restoreChip =
    draft && message.trim()
      ? `<span class="restore-chip" id="restoreChip" title="已恢复草稿 · ${esc(absTime(draft.ts))}">${icon('undo')} 已恢复</span>`
      : '';

  const noteHtml =
    draft && message.trim()
      ? `${icon('check')} 草稿已自动保存 · ${esc(relativeDraftTime(draft.ts))}`
      : '输入内容会按仓库自动记忆';

  return `
    <div class="changes-commit">
      <div class="cc-context">
        <div class="cc-eyebrow">${icon('check')} 准备提交</div>
        <div class="commit-target" id="commitTarget">${targetHtml}</div>
        <div class="cc-selected" id="commitSelectionHint">${staged.length} / ${files.length} 个文件已暂存</div>
        <label class="check-wrap">
          <input type="checkbox" id="amend" ${amend ? 'checked' : ''}>
          <span class="check-box">${icon('check')}</span>
          <span>Amend 修改上次提交</span>
        </label>
        <div class="cc-hint">勾选左侧文件即暂存；<kbd>⌘↵</kbd> 提交</div>
      </div>
      <div class="cc-editor">
        <div class="cc-editor-head">
          <span class="message-title">提交信息</span>
          ${restoreChip}
          <span class="spacer"></span>
          ${
            draft
              ? `<button class="msg-icon-btn" type="button" data-cleardraft="1" title="清空当前草稿">${icon('x')}</button>`
              : ''
          }
          <button class="msg-icon-btn" type="button" id="histBtn" data-pop="history" data-popover-trigger="1" title="最近提交信息历史">
            ${icon('history')}
          </button>
          <button class="ai-button ${aiBusy ? 'busy' : ''}" type="button" id="genBtn" data-act="genmsg" title="让 agent 分析暂存 diff 并生成提交信息" ${
            aiBusy ? 'disabled' : ''
          }>
            ${icon('sparkles')} 生成
          </button>
        </div>
        <textarea id="msgBox" class="message-area" spellcheck="false" autocomplete="off"
          placeholder="描述这次更改…（⌘↵ 提交）">${esc(message)}</textarea>
        <div class="cc-editor-foot">
          <span class="draft-note${draft && message.trim() ? ' restored' : ''}" id="draftNote">${noteHtml}</span>
          <span class="spacer"></span>
          <span class="char-count${firstLine.length > 72 ? ' warn' : ''}" id="charCount">${
            message.trim() ? `首行 ${firstLine.length} / 72` : ''
          }</span>
        </div>
      </div>
      <div class="cc-actions">
        <button class="commit-btn" type="button" id="commitBtn" data-commit="normal" ${canCommit ? '' : 'disabled'}>
          ${busy ? '提交中…' : amend ? '修改提交' : '提交'} <kbd>⌘↵</kbd>
        </button>
        <div class="cc-actions-row">
          <button class="btn" type="button" data-commit="push" ${canCommit ? '' : 'disabled'}>提交并推送</button>
        </div>
        <span class="cc-selected" id="commitButtonHint">${staged.length} 个文件 · ${esc(repo.branch ?? 'detached')}</span>
      </div>
    </div>`;
}

export function renderDiscardModal(repo: Repo, targets: FileEntry[]): string {
  const tracked = targets.filter((f) => !f.untracked);
  const untracked = targets.filter((f) => f.untracked);
  const preview = targets.slice(0, 8);
  const extra = targets.length - preview.length;

  return `
    <div class="modal-backdrop" data-modal-backdrop="1">
      <div class="modal" role="dialog" aria-modal="true" aria-label="放弃更改">
        <div class="modal-head">
          <span class="modal-head-icon danger">${icon('undo')}</span>
          <span class="modal-head-text">
            <span class="modal-title">放弃 ${targets.length} 个文件的本地更改？</span>
            <span class="modal-sub">${esc(repo.name)} · ${esc(repo.branch ?? 'detached')}</span>
          </span>
        </div>
        <div class="modal-body">
          <div class="discard-warn">
            ${icon('undo')}
            已跟踪文件会先自动保存 stash 快照再执行 <code>git restore</code>；未跟踪文件将从工作区直接移除。
          </div>
          <div class="discard-list">
            ${preview
              .map(
                (f) => `<div class="discard-item">
                  <span class="fstat ${statusClass(f)}">${statusClass(f)}</span>
                  <span class="di-path">${esc(f.path)}</span>
                  <span style="font-size:9px;color:var(--muted-2)">${f.untracked ? '删除文件' : '还原 HEAD'}</span>
                </div>`,
              )
              .join('')}
            ${extra > 0 ? `<div class="discard-item more">… 还有 ${extra} 个文件</div>` : ''}
          </div>
          <div class="field-hint">
            包含 ${tracked.length} 个已跟踪文件${untracked.length ? `、${untracked.length} 个未跟踪文件` : ''}。
          </div>
        </div>
        <div class="modal-foot">
          <span class="modal-tip">安全保护：自动写入 refs/knit/snapshots</span>
          <span class="spacer"></span>
          <button class="btn" type="button" data-modal-close="1">取消</button>
          <button class="btn danger" type="button" id="confirmDiscardBtn">放弃更改</button>
        </div>
      </div>
    </div>`;
}

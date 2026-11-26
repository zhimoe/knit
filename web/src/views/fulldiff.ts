import type { Commit, DiffFile, FileEntry, Repo } from '../types';
import { basenameOf, dirnameOf, icon } from './icons';
import { renderDiffBodyOnly } from './diff';
import { esc } from './util';

export interface FullDiffOptions {
  repo: Repo;
  source: 'commit' | 'worktree';
  returnTab: 'log' | 'changes';
  commit: Commit | null;
  files: FileEntry[];
  fileIndex: number;
  file: FileEntry | null;
  diff: DiffFile | null;
  mode: 'split' | 'unified';
  ignoreWhitespace: boolean;
  expanded: boolean;
  loading: boolean;
  renderAllRows: boolean;
  blameHtml?: string | null;
}

export function renderFullDiffPage(opts: FullDiffOptions): string {
  const { repo, source, returnTab, commit, files, fileIndex, file, diff, mode } = opts;
  const isWorktree = source === 'worktree';
  const backLabel = returnTab === 'changes' ? '返回 Changes' : '返回 Log';
  const sourceLabel = isWorktree ? 'working tree' : `commit ${commit?.shortHash ?? ''}`;
  const sourceTitle = isWorktree ? `${files.length} 个未提交文件` : commit?.subject ?? '';
  const addCount = diff ? diff.additions : Math.max(0, file?.additions ?? 0);
  const delCount = diff ? diff.deletions : Math.max(0, file?.deletions ?? 0);

  const header = `
    <div class="full-diff-head">
      <button class="fd-back" type="button" data-action="exit-full-diff" title="返回（Esc）">
        ${icon('chevron-left')}<span>${backLabel}</span><kbd>Esc</kbd>
      </button>
      <span class="fd-divider"></span>
      <div class="fd-context">
        <span class="fd-repo">${icon('branch')}${esc(repo.name)}</span>
        <span class="fd-branch">${esc(repo.branch ?? 'detached')}</span>
        <span class="fd-source ${isWorktree ? 'worktree' : ''}" title="${esc(sourceTitle)}">${esc(sourceLabel)}</span>
      </div>
      <div class="fd-file-area">
        <button class="fd-nav" type="button" data-action="diff-prev-file" title="上一个文件（←）" ${
          files.length <= 1 ? 'disabled' : ''
        }>${icon('chevron-left')}</button>
        ${
          file
            ? `<span class="fd-path" title="${esc(file.path)}">
                ${icon('file')}
                <span class="fd-dir">${esc(dirnameOf(file.path))}</span>
                <span class="fd-name">${esc(basenameOf(file.path))}</span>
              </span>`
            : `<span class="fd-path">没有可显示的文件</span>`
        }
        <button class="fd-nav" type="button" data-action="diff-next-file" title="下一个文件（→）" ${
          files.length <= 1 ? 'disabled' : ''
        }>${icon('chevron-right')}</button>
        <span class="fd-index">${files.length && fileIndex >= 0 ? `${fileIndex + 1} / ${files.length}` : '0 / 0'}</span>
      </div>
      ${
        file
          ? `<span class="fd-stats"><span class="plus">+${addCount}</span>${
              delCount > 0 ? `<span class="minus">−${delCount}</span>` : ''
            }</span>`
          : ''
      }
      <div class="fd-actions">
        <button class="diff-tool-btn${opts.ignoreWhitespace ? ' active' : ''}" type="button" data-act="ignorews" title="忽略空白变化">忽略空白</button>
        ${
          file && !file.untracked
            ? `<button class="diff-tool-btn${opts.blameHtml ? ' active' : ''}" type="button" data-act="blame" title="切换 Blame 视图">Blame</button>`
            : ''
        }
        ${
          file
            ? `<button class="diff-tool-btn" type="button" data-act="locate" title="在外部编辑器打开">打开文件</button>`
            : ''
        }
        <span class="diff-mode-seg" role="group" aria-label="Diff 视图">
          <button class="diff-mode-btn ${mode === 'split' ? 'active' : ''}" type="button" data-diffmode="split" title="并排 diff">${icon('split')}</button>
          <button class="diff-mode-btn ${mode === 'unified' ? 'active' : ''}" type="button" data-diffmode="unified" title="统一 diff">${icon('unified')}</button>
        </span>
        <button class="fd-close" type="button" data-action="exit-full-diff" title="关闭全页 Diff">${icon('x')}</button>
      </div>
    </div>`;

  const body = opts.blameHtml
    ? `<div class="full-diff-body"><div class="full-diff-scroll">${opts.blameHtml}</div></div>`
    : `<div class="full-diff-body"><div class="full-diff-scroll">${renderDiffBodyOnly({
        file,
        fileIndex,
        fileCount: files.length,
        diff,
        mode,
        ignoreWhitespace: opts.ignoreWhitespace,
        expanded: opts.expanded,
        stageGroup: isWorktree && file ? (file.group === 'staged' ? 'staged' : 'unstaged') : null,
        loading: opts.loading,
        renderAllRows: opts.renderAllRows,
        leftLabel: isWorktree ? 'HEAD' : '修改前',
        rightLabel: isWorktree ? (file?.group === 'staged' ? '暂存区 · staged' : '工作区 · 未暂存') : '修改后',
        emptyText: '没有可显示的文件 diff。',
        hideToolbar: true,
      })}</div></div>`;

  return header + body;
}

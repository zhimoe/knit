import type { WorktreeInfo } from '../types';
import { icon } from './icons';
import { esc } from './util';

export const renderWorktreeModal = (
  repoName: string,
  items: WorktreeInfo[],
  defaultStart: string,
  busy: boolean,
): string => {
  const rows = items
    .map((wt) => {
      const shortHead = wt.head ? wt.head.slice(0, 7) : '—';
      const badges = [
        wt.isMain ? '<span class="mbadge ok">主工作区</span>' : '',
        wt.handId ? `<span class="mbadge warn">hand:${esc(wt.handId)}</span>` : '',
        wt.locked ? '<span class="mbadge">已锁定</span>' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `
        <div class="bm-row${wt.isMain ? ' current' : ''}">
          <div class="bm-info">
            <div class="bm-name">
              ${icon('branch')} <span>${esc(wt.branch ?? 'detached')}</span>
              <span style="color:var(--yellow);font-size:10px">${esc(shortHead)}</span>
              ${badges}
            </div>
            <div class="bm-sub">${esc(wt.path)}</div>
          </div>
          <div class="bm-acts">
            <button class="btn" type="button" data-wt-open="${esc(wt.path)}">打开目录</button>
            ${wt.isMain ? '' : `<button class="btn danger" type="button" data-wt-remove="${esc(wt.path)}">移除</button>`}
          </div>
        </div>`;
    })
    .join('');

  return `
    <div class="modal-backdrop" data-modal-backdrop="1">
      <div class="modal medium" role="dialog" aria-modal="true" aria-label="Worktree 管理">
        <div class="mhead">
          <span class="mhead-title">${icon('folder')} Worktree / Hand 管理 · ${esc(repoName)}</span>
          <span class="mbadge">${items.length} 个工作区</span>
          <span class="spacer"></span>
          <button class="btn" type="button" id="wtPrune" ${busy ? 'disabled' : ''}>Prune 失效引用</button>
          <button class="btn" type="button" id="wtClose">关闭</button>
        </div>
        <div class="bm-body">
          <div class="bm-form">
            <div style="font-size:10.5px;color:var(--muted)">新建 Hand Worktree（默认创建在 &lt;root&gt;/.knit/hands/，不污染当前仓库）</div>
            <div class="bm-inputs">
              <input id="wtBranch" placeholder="新分支名（例：hand/fix-ipc）" autocomplete="off" spellcheck="false">
              <input id="wtStart" value="${esc(defaultStart)}" placeholder="起点（默认 HEAD）" style="max-width:140px" autocomplete="off" spellcheck="false">
              <input id="wtDir" placeholder="目录路径（留空自动生成）" autocomplete="off" spellcheck="false">
              <button class="btn primary" type="button" id="wtCreate" ${busy ? 'disabled' : ''}>${busy ? '创建中…' : '+ 创建'}</button>
            </div>
          </div>
          <div class="bm-list">
            ${rows || '<div class="cv-clean-state"><strong>没有 worktree</strong></div>'}
          </div>
        </div>
      </div>
    </div>`;
};

import type { ReflogEntry, Repo } from '../types';
import { absTime, icon, timeCompact } from './icons';
import { esc } from './util';

export interface ReflogModalOptions {
  repo: Repo;
  entries: ReflogEntry[];
  loading: boolean;
  busy: boolean;
}

export function renderReflogModal({ repo, entries, loading, busy }: ReflogModalOptions): string {
  const body = loading
    ? `<div class="diff-empty" style="padding:36px 0"><span>正在读取 Reflog 历史…</span></div>`
    : !entries.length
      ? `<div class="diff-empty" style="padding:36px 0">${icon('history')}<span>当前仓库没有 Reflog 记录。</span></div>`
      : entries
          .map(
            (e, idx) => `
          <div class="rf-row${idx === 0 ? ' current' : ''}">
            <span class="rf-sel">${esc(e.selector)}</span>
            <span class="rf-hash" title="${esc(e.hash)}">${esc(e.shortHash)}</span>
            <span class="rf-act" title="${esc(e.action)}">${esc(e.action)}</span>
            <span class="rf-time" title="${esc(absTime(e.epochMs))}">${esc(timeCompact(e.epochMs))}</span>
            <span class="rf-ops">
              <button class="btn" type="button" data-rf-reset="${esc(e.hash)}" data-rf-mode="soft" ${
                busy ? 'disabled' : ''
              } title="git reset --soft（保留暂存区和工作区）">Soft</button>
              <button class="btn" type="button" data-rf-reset="${esc(e.hash)}" data-rf-mode="mixed" ${
                busy ? 'disabled' : ''
              } title="git reset --mixed（重置暂存区，保留工作区）">Mixed</button>
              <button class="btn danger" type="button" data-rf-reset="${esc(e.hash)}" data-rf-mode="hard" ${
                busy ? 'disabled' : ''
              } title="git reset --hard（强制回退到此状态，自动备份快照）">Hard</button>
            </span>
          </div>`,
          )
          .join('');

  return `
    <div class="modal-backdrop" data-modal-backdrop="1">
      <div class="modal wide-md" role="dialog" aria-modal="true" aria-label="Reflog 历史与安全撤销">
        <div class="mhead">
          <span class="mhead-title">${icon('undo')} Reflog 历史 · ${esc(repo.name)}</span>
          <span class="mbadge">${entries.length} 条记录</span>
          <span class="spacer"></span>
          <button class="btn" type="button" id="rfRefreshBtn" ${loading || busy ? 'disabled' : ''}>${icon('refresh')} 刷新</button>
          <button class="btn" type="button" data-modal-close="1">关闭</button>
        </div>

        <div class="modal-body" style="padding:10px 14px">
          <div class="rf-tip">
            ${icon('history')}
            <span>Reflog 记录了本机 HEAD 的每一次移动（commit / checkout / rebase / reset），误操作后可一键回到任意历史状态。</span>
          </div>
          <div class="rf-list">${body}</div>
        </div>
      </div>
    </div>`;
}

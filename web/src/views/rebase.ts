import type { RebaseAction, RebaseCommit } from '../types';
import { icon } from './icons';
import { esc } from './util';

const ACTIONS: { value: RebaseAction; label: string }[] = [
  { value: 'pick', label: 'pick' },
  { value: 'reword', label: 'reword' },
  { value: 'squash', label: 'squash' },
  { value: 'fixup', label: 'fixup' },
  { value: 'edit', label: 'edit' },
  { value: 'drop', label: 'drop' },
];

export const renderRebaseModal = (onto: string, items: RebaseCommit[], busy: boolean): string => {
  const dropped = items.filter((i) => i.action === 'drop').length;
  const squashed = items.filter((i) => i.action === 'squash' || i.action === 'fixup').length;
  const finalCount = Math.max(0, items.length - dropped - squashed);

  const rows = items
    .map((item, idx) => {
      const options = ACTIONS.map(
        (a) => `<option value="${a.value}"${item.action === a.value ? ' selected' : ''}>${a.label}</option>`,
      ).join('');
      const needsMsg = item.action === 'reword' || item.action === 'squash';
      const dim = item.action === 'drop' ? ' dropped' : '';
      return `
        <tr class="rb-row${dim}" draggable="true" data-rb-idx="${idx}">
          <td class="rb-drag" title="拖拽排序">⋮⋮</td>
          <td>
            <select class="rb-sel" data-rb-action="${idx}">${options}</select>
          </td>
          <td class="rb-hash" style="font-family:var(--mono)">${esc(item.shortHash)}</td>
          <td>
            <div>${esc(item.subject)}</div>
            ${
              needsMsg
                ? `<input class="rb-msg" data-rb-msg="${idx}" value="${esc(item.message ?? item.subject)}" placeholder="输入新的提交信息…">`
                : ''
            }
          </td>
          <td class="rb-au">${esc(item.author)}</td>
          <td class="rb-ord">
            <button class="btn" type="button" data-rb-move="${idx}:-1" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn" type="button" data-rb-move="${idx}:1" ${idx === items.length - 1 ? 'disabled' : ''}>↓</button>
          </td>
        </tr>`;
    })
    .join('');

  return `
    <div class="modal-backdrop" data-modal-backdrop="1">
      <div class="modal medium" role="dialog" aria-modal="true" aria-label="交互式变基">
        <div class="mhead">
          <span class="mhead-title">${icon('branch')} 交互式变基 · onto <span style="font-family:var(--mono);color:var(--yellow)">${esc(
            onto.slice(0, 7) || '--root',
          )}</span></span>
          <span class="mbadge">${items.length} → ${finalCount} 个提交</span>
          <span class="spacer"></span>
          <button class="btn primary" type="button" id="rebaseStart" ${busy || !items.length ? 'disabled' : ''}>${
            busy ? '变基中…' : '开始变基'
          }</button>
          <button class="btn" type="button" id="rebaseClose">取消</button>
        </div>
        <div class="rb-body">
          ${
            items.length
              ? `<div class="rb-hint">从上到下按时间先后重放（最旧在顶部）；拖拽行或点 ↑/↓ 调整顺序。变基前会自动保存 reflog 书签。</div>
                 <table class="rb-table">
                   <thead><tr><th></th><th>操作</th><th>Hash</th><th>提交信息</th><th>作者</th><th>排序</th></tr></thead>
                   <tbody>${rows}</tbody>
                 </table>`
              : `<div class="cv-clean-state"><strong>没有可变的提交</strong><span>该提交就是当前 HEAD，请选择更早的基点再试。</span></div>`
          }
        </div>
      </div>
    </div>`;
};

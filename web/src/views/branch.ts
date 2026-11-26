import type { GitRef, Repo } from '../types';
import { icon } from './icons';
import { esc } from './util';

export interface BranchModalOptions {
  repo: Repo;
  refs: GitRef[];
  protectedBranches: string[];
  defaultStart: string;
  busy: boolean;
  filter: string;
}

export function renderBranchModal(opts: BranchModalOptions): string {
  const { repo, refs, protectedBranches, defaultStart, busy, filter } = opts;
  const current = repo.branch ?? '';
  const needle = filter.trim().toLowerCase();

  const locals = refs
    .filter((r) => r.type === 'branch' || r.type === 'head')
    .filter((r) => !needle || r.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (a.name === current) return -1;
      if (b.name === current) return 1;
      return a.name.localeCompare(b.name);
    });

  const remotes = refs
    .filter((r) => r.type === 'remote')
    .filter((r) => !needle || r.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));

  const renderLocalRow = (ref: GitRef): string => {
    const isCurrent = ref.name === current;
    const isProtected = protectedBranches.includes(ref.name);
    return `
      <div class="bm-row${isCurrent ? ' current' : ''}">
        <div class="bm-info">
          <div class="bm-name">
            ${icon('branch')} <span>${esc(ref.name)}</span>
            ${isCurrent ? '<span class="mbadge ok">当前</span>' : ''}
            ${isProtected ? '<span class="mbadge">受保护</span>' : ''}
          </div>
          <div class="bm-sub">${esc(ref.target.slice(0, 7))}</div>
        </div>
        <div class="bm-acts">
          ${
            isCurrent
              ? ''
              : `<button class="btn" type="button" data-bm-checkout="${esc(ref.name)}" ${busy ? 'disabled' : ''}>切换</button>
                 <button class="btn" type="button" data-bm-merge="${esc(ref.name)}" ${busy ? 'disabled' : ''} title="合并 ${esc(
                   ref.name,
                 )} 到 ${esc(current || 'HEAD')}">合并到当前</button>
                 <button class="btn danger" type="button" data-bm-delete="${esc(ref.name)}" ${
                   busy || isProtected ? 'disabled' : ''
                 } title="${isProtected ? '受保护分支不可删除' : '删除本地分支'}">${icon('trash')}</button>`
          }
        </div>
      </div>`;
  };

  const renderRemoteRow = (ref: GitRef): string => `
    <div class="bm-row">
      <div class="bm-info">
        <div class="bm-name" style="color:var(--text-soft)">${icon('branch')} <span>${esc(ref.name)}</span></div>
        <div class="bm-sub">${esc(ref.target.slice(0, 7))}</div>
      </div>
      <div class="bm-acts">
        <button class="btn" type="button" data-bm-checkout="${esc(ref.name)}" ${busy ? 'disabled' : ''}>检出跟踪</button>
        <button class="btn" type="button" data-bm-merge="${esc(ref.name)}" ${busy ? 'disabled' : ''}>合并到当前</button>
      </div>
    </div>`;

  return `
    <div class="modal-backdrop" data-modal-backdrop="1">
      <div class="modal medium" role="dialog" aria-modal="true" aria-label="分支管理">
        <div class="mhead">
          <span class="mhead-title">${icon('branch')} 分支管理 · ${esc(repo.name)}</span>
          <span class="mbadge ok">${esc(current || 'detached')}</span>
          ${
            repo.ahead || repo.behind
              ? `<span class="mbadge">${repo.ahead ? `↑${repo.ahead}` : ''} ${repo.behind ? `↓${repo.behind}` : ''}</span>`
              : ''
          }
          <span class="spacer"></span>
          <button class="btn" type="button" data-bm-op="fetch" ${busy ? 'disabled' : ''} title="git fetch --all --prune">
            ${icon('refresh')} Fetch
          </button>
          <button class="btn" type="button" data-bm-op="pull" ${busy ? 'disabled' : ''} title="git pull">
            ${icon('arrow-down')} Pull
          </button>
          <button class="btn" type="button" data-bm-op="pull-rebase" ${busy ? 'disabled' : ''} title="git pull --rebase">
            Pull --rebase
          </button>
          <button class="btn" type="button" data-modal-close="1">关闭</button>
        </div>

        <div class="bm-body">
          <div class="bm-form">
            <div style="font-size:10.5px;color:var(--muted)">新建分支（支持指定起点提交或分支）</div>
            <div class="bm-inputs">
              <input id="bmNewName" placeholder="新分支名（例：feat/branch-ops）" autocomplete="off" spellcheck="false">
              <input id="bmNewStart" value="${esc(defaultStart)}" placeholder="起点（默认 HEAD）" style="max-width:150px" autocomplete="off" spellcheck="false">
              <label class="check-wrap">
                <input type="checkbox" id="bmNewCheckout" checked>
                <span class="check-box">${icon('check')}</span>
                <span>创建后切换</span>
              </label>
              <button class="btn primary" type="button" id="bmCreateBtn" ${busy ? 'disabled' : ''}>${
                busy ? '处理中…' : '+ 新建分支'
              }</button>
            </div>
          </div>

          <div class="search-field">
            ${icon('search')}
            <input id="bmSearch" type="text" value="${esc(filter)}" placeholder="过滤本地与远端分支…" autocomplete="off" spellcheck="false">
          </div>

          <div class="bm-sec-title">本地分支 · ${locals.length}</div>
          <div class="bm-list">
            ${
              locals.length
                ? locals.map(renderLocalRow).join('')
                : '<div style="padding:12px;text-align:center;color:var(--muted-2);font-size:10.5px">没有匹配的本地分支</div>'
            }
          </div>

          <div class="bm-sec-title">远端分支 · ${remotes.length}</div>
          <div class="bm-list">
            ${
              remotes.length
                ? remotes.map(renderRemoteRow).join('')
                : '<div style="padding:12px;text-align:center;color:var(--muted-2);font-size:10.5px">没有远端分支（可先点击上方 Fetch）</div>'
            }
          </div>
        </div>
      </div>
    </div>`;
}

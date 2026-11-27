import type { GitRef, RemoteInfo, Repo } from '../types';
import { icon } from './icons';
import { esc } from './util';

export type BranchModalTab = 'branches' | 'tags' | 'remotes';

export interface BranchModalOptions {
  repo: Repo;
  tab: BranchModalTab;
  refs: GitRef[];
  remotes: RemoteInfo[];
  protectedBranches: string[];
  defaultStart: string;
  busy: boolean;
  filter: string;
  editingRemote: string | null;
}

export function renderBranchModal(opts: BranchModalOptions): string {
  const { repo, tab, refs, remotes, protectedBranches, defaultStart, busy, filter, editingRemote } = opts;
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

  const remoteRefs = refs
    .filter((r) => r.type === 'remote')
    .filter((r) => !needle || r.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tags = refs
    .filter((r) => r.type === 'tag')
    .filter((r) => !needle || r.name.toLowerCase().includes(needle))
    .sort((a, b) => b.name.localeCompare(a.name));

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

  const renderRemoteRefRow = (ref: GitRef): string => `
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

  const renderTagRow = (ref: GitRef): string => `
    <div class="bm-row">
      <div class="bm-info">
        <div class="bm-name">${icon('tag')} <span>${esc(ref.name)}</span></div>
        <div class="bm-sub">${esc(ref.target.slice(0, 7))}</div>
      </div>
      <div class="bm-acts">
        <button class="btn" type="button" data-tag-push="${esc(ref.name)}" ${busy ? 'disabled' : ''} title="推送标签到 origin">${icon('arrow-up')} 推送</button>
        <button class="btn danger" type="button" data-tag-delete="${esc(ref.name)}" ${busy ? 'disabled' : ''} title="删除本地标签">${icon('trash')}</button>
      </div>
    </div>`;

  const renderRemoteItem = (r: RemoteInfo): string => {
    const isEditing = editingRemote === r.name;
    return `
      <div class="bm-row">
        <div class="bm-info" style="flex:1;min-width:0">
          <div class="bm-name">${icon('globe')} <span>${esc(r.name)}</span></div>
          ${
            isEditing
              ? `<div class="bm-inputs" style="margin-top:6px">
                  <input id="rmEditUrl" value="${esc(r.fetchUrl)}" spellcheck="false" autocomplete="off">
                  <button class="btn primary" type="button" data-rm-save="${esc(r.name)}" ${busy ? 'disabled' : ''}>保存</button>
                  <button class="btn" type="button" data-rm-cancel="1">取消</button>
                </div>`
              : `<div class="bm-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.fetchUrl)}">${esc(r.fetchUrl)}</div>`
          }
        </div>
        ${
          isEditing
            ? ''
            : `<div class="bm-acts">
                <button class="btn" type="button" data-rm-edit="${esc(r.name)}" ${busy ? 'disabled' : ''}>${icon('edit')} 编辑 URL</button>
                <button class="btn danger" type="button" data-rm-remove="${esc(r.name)}" ${busy ? 'disabled' : ''} title="删除远端">${icon('trash')}</button>
              </div>`
        }
      </div>`;
  };

  let bodyHtml = '';
  if (tab === 'branches') {
    bodyHtml = `
      <div class="bm-form">
        <div style="font-size:10.5px;color:var(--muted)">新建分支（支持指定起点提交或分支）</div>
        <div class="bm-inputs">
          <input id="bmNewName" placeholder="新分支名（例：feat/branch-ops）" autocomplete="off" spellcheck="false">
          <input id="bmNewStart" value="${esc(defaultStart)}" placeholder="起点（默认 HEAD）" style="max-width:140px" autocomplete="off" spellcheck="false">
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

      <div class="bm-sec-title">远端分支 · ${remoteRefs.length}</div>
      <div class="bm-list">
        ${
          remoteRefs.length
            ? remoteRefs.map(renderRemoteRefRow).join('')
            : '<div style="padding:12px;text-align:center;color:var(--muted-2);font-size:10.5px">没有远端分支（可先点击上方 Fetch）</div>'
        }
      </div>`;
  } else if (tab === 'tags') {
    bodyHtml = `
      <div class="bm-form">
        <div style="font-size:10.5px;color:var(--muted)">新建标签（填写附注即创建 Annotated Tag，留空创建轻量标签）</div>
        <div class="bm-inputs">
          <input id="tagNewName" placeholder="标签名（例：v0.4.0）" autocomplete="off" spellcheck="false" style="max-width:160px">
          <input id="tagNewTarget" value="${esc(defaultStart)}" placeholder="目标（默认 HEAD）" style="max-width:120px" autocomplete="off" spellcheck="false">
          <input id="tagNewMsg" placeholder="附注信息（可选）" autocomplete="off" spellcheck="false">
          <button class="btn primary" type="button" id="tagCreateBtn" ${busy ? 'disabled' : ''}>${
            busy ? '处理中…' : '+ 新建标签'
          }</button>
        </div>
      </div>

      <div class="search-field">
        ${icon('search')}
        <input id="bmSearch" type="text" value="${esc(filter)}" placeholder="过滤标签…" autocomplete="off" spellcheck="false">
      </div>

      <div class="bm-sec-title">全部标签 · ${tags.length}</div>
      <div class="bm-list">
        ${
          tags.length
            ? tags.map(renderTagRow).join('')
            : '<div style="padding:14px;text-align:center;color:var(--muted-2);font-size:10.5px">当前仓库还没有标签</div>'
        }
      </div>`;
  } else {
    bodyHtml = `
      <div class="bm-form">
        <div style="font-size:10.5px;color:var(--muted)">添加远端仓库（git remote add）</div>
        <div class="bm-inputs">
          <input id="rmNewName" placeholder="名称（例：upstream）" style="max-width:140px" autocomplete="off" spellcheck="false">
          <input id="rmNewUrl" placeholder="远端 URL（https:// 或 git@）" autocomplete="off" spellcheck="false">
          <button class="btn primary" type="button" id="rmAddBtn" ${busy ? 'disabled' : ''}>${
            busy ? '处理中…' : '+ 添加远端'
          }</button>
        </div>
      </div>

      <div class="bm-sec-title">已配置的远端 · ${remotes.length}</div>
      <div class="bm-list">
        ${
          remotes.length
            ? remotes.map(renderRemoteItem).join('')
            : '<div style="padding:14px;text-align:center;color:var(--muted-2);font-size:10.5px">尚未配置任何远端仓库</div>'
        }
      </div>`;
  }

  return `
    <div class="modal-backdrop" data-modal-backdrop="1">
      <div class="modal medium" role="dialog" aria-modal="true" aria-label="分支、标签与远端管理">
        <div class="mhead">
          <span class="mhead-title">${icon('branch')} 仓库管理 · ${esc(repo.name)}</span>
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
          <button class="btn" type="button" data-bm-op="push" ${busy ? 'disabled' : ''} title="git push">
            ${icon('arrow-up')} Push
          </button>
          <button class="btn" type="button" data-modal-close="1">关闭</button>
        </div>

        <div class="modal-tabs">
          <button class="modal-tab${tab === 'branches' ? ' active' : ''}" type="button" data-bm-tab="branches">
            ${icon('branch')} 分支 <span class="tab-cnt">${locals.length + remoteRefs.length}</span>
          </button>
          <button class="modal-tab${tab === 'tags' ? ' active' : ''}" type="button" data-bm-tab="tags">
            ${icon('tag')} Tags <span class="tab-cnt">${tags.length}</span>
          </button>
          <button class="modal-tab${tab === 'remotes' ? ' active' : ''}" type="button" data-bm-tab="remotes">
            ${icon('globe')} Remotes <span class="tab-cnt">${remotes.length}</span>
          </button>
        </div>

        <div class="bm-body">${bodyHtml}</div>
      </div>
    </div>`;
}

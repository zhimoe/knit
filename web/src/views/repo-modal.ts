import { icon } from './icons';
import { esc } from './util';

export interface RepoModalOptions {
  tab: 'clone' | 'init';
  defaultParentDir: string;
  busy: boolean;
}

export function renderRepoModal({ tab, defaultParentDir, busy }: RepoModalOptions): string {
  const cloneForm = `
    <div class="field-group">
      <label class="field-label" for="cloneUrl">仓库地址（HTTPS 或 SSH）</label>
      <input class="field-input" id="cloneUrl" placeholder="https://github.com/user/repo.git 或 git@github.com:user/repo.git" spellcheck="false" autocomplete="off">
    </div>
    <div class="field-group">
      <label class="field-label" for="cloneParentDir">存放父目录</label>
      <div class="field-row">
        <input class="field-input" id="cloneParentDir" value="${esc(defaultParentDir)}" spellcheck="false" autocomplete="off">
        <button class="btn" type="button" data-act="pickclonedir">浏览…</button>
      </div>
    </div>
    <div class="field-group">
      <label class="field-label" for="cloneFolderName">目标文件夹名（留空自动取仓库名）</label>
      <input class="field-input" id="cloneFolderName" placeholder="留空按 URL 自动推导" spellcheck="false" autocomplete="off">
    </div>`;

  const initForm = `
    <div class="field-group">
      <label class="field-label" for="initParentDir">父目录路径</label>
      <div class="field-row">
        <input class="field-input" id="initParentDir" value="${esc(defaultParentDir)}" spellcheck="false" autocomplete="off">
        <button class="btn" type="button" data-act="pickinitdir">浏览…</button>
      </div>
    </div>
    <div class="field-row-2">
      <div class="field-group">
        <label class="field-label" for="initName">仓库文件夹名（可留空直接初始化父目录）</label>
        <input class="field-input" id="initName" placeholder="例：my-project" spellcheck="false" autocomplete="off">
      </div>
      <div class="field-group">
        <label class="field-label" for="initBranch">初始分支名</label>
        <input class="field-input" id="initBranch" value="main" placeholder="main" spellcheck="false" autocomplete="off">
      </div>
    </div>`;

  return `
    <div class="modal-backdrop" data-modal-backdrop="1">
      <div class="modal" role="dialog" aria-modal="true" aria-label="克隆或初始化仓库">
        <div class="mhead">
          <span class="mhead-title">${icon('plus')} 克隆 / 初始化仓库</span>
          <span class="spacer"></span>
          <button class="btn" type="button" data-modal-close="1">关闭</button>
        </div>

        <div class="modal-tabs">
          <button class="modal-tab${tab === 'clone' ? ' active' : ''}" type="button" data-repomodal-tab="clone">
            ${icon('globe')} 克隆远端仓库（Clone）
          </button>
          <button class="modal-tab${tab === 'init' ? ' active' : ''}" type="button" data-repomodal-tab="init">
            ${icon('folder')} 初始化新仓库（git init）
          </button>
        </div>

        <div class="modal-body">
          ${tab === 'clone' ? cloneForm : initForm}
        </div>

        <div class="modal-foot">
          <span class="modal-tip">${
            tab === 'clone' ? '克隆完成后会自动扫描并切换到该仓库' : '将在目标路径执行 git init 并立即选中'
          }</span>
          <span class="spacer"></span>
          <button class="btn" type="button" data-modal-close="1" ${busy ? 'disabled' : ''}>取消</button>
          <button class="btn primary" type="button" id="${tab === 'clone' ? 'doCloneBtn' : 'doInitBtn'}" ${
            busy ? 'disabled' : ''
          }>${busy ? (tab === 'clone' ? '克隆中…' : '初始化中…') : tab === 'clone' ? '开始克隆' : '初始化仓库'}</button>
        </div>
      </div>
    </div>`;
}

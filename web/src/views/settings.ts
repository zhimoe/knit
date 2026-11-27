import type { HostState } from '../types';
import { icon } from './icons';
import { esc } from './util';

export interface SettingsModalOptions {
  host: HostState;
  theme: 'light' | 'dark';
  saving: boolean;
}

export function renderSettingsModal({ host, theme, saving }: SettingsModalOptions): string {
  const globsText = host.excludeGlobs.join(', ');
  const protectedText = host.protectedBranches.join(', ');
  const editorArgs = host.editor.args.join(' ');
  const termArgs = host.terminal.args.join(' ');

  return `
    <div class="modal-backdrop" data-modal-backdrop="1">
      <div class="modal medium" role="dialog" aria-modal="true" aria-label="应用设置">
        <div class="mhead">
          <span class="mhead-title">${icon('gear')} 应用设置</span>
          <span class="mbadge">实时持久化到 settings.json</span>
          <span class="spacer"></span>
          <button class="btn" type="button" data-modal-close="1">关闭</button>
        </div>

        <div class="modal-body settings-body">
          <div class="settings-grid">
            <div class="settings-section">
              <div class="settings-sec-title">工作区与扫描</div>
              <div class="field-group">
                <label class="field-label" for="setRoot">工作区根目录</label>
                <div class="field-row">
                  <input class="field-input" id="setRoot" value="${esc(host.root)}" spellcheck="false" autocomplete="off">
                  <button class="btn" type="button" data-act="picksettingsroot">浏览…</button>
                </div>
              </div>
              <div class="field-row-2">
                <div class="field-group">
                  <label class="field-label" for="setDepth">扫描深度（1-8）</label>
                  <input class="field-input" id="setDepth" type="number" min="1" max="8" value="${host.scanDepth}">
                </div>
                <div class="field-group">
                  <label class="field-label" for="setGlobs">排除目录（逗号分隔）</label>
                  <input class="field-input" id="setGlobs" value="${esc(globsText)}" placeholder="node_modules, target, dist" spellcheck="false">
                </div>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-sec-title">外观与默认 Diff</div>
              <div class="field-row-2">
                <div class="field-group">
                  <label class="field-label" for="setTheme">界面主题</label>
                  <select class="field-input" id="setTheme">
                    <option value="light" ${theme === 'light' ? 'selected' : ''}>Porcelain 浅色（默认）</option>
                    <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Slate 深色</option>
                  </select>
                </div>
                <div class="field-group">
                  <label class="field-label" for="setDiffMode">默认 Diff 视图</label>
                  <select class="field-input" id="setDiffMode">
                    <option value="split" ${host.diffMode === 'split' ? 'selected' : ''}>并排对比（Split）</option>
                    <option value="unified" ${host.diffMode === 'unified' ? 'selected' : ''}>统一视图（Unified）</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-sec-title">外部编辑器与终端</div>
              <div class="field-row-2">
                <div class="field-group">
                  <label class="field-label" for="setEditorCmd">编辑器命令（留空使用系统默认）</label>
                  <input class="field-input" id="setEditorCmd" value="${esc(host.editor.command)}" placeholder="例：code / cursor / zed" spellcheck="false">
                </div>
                <div class="field-group">
                  <label class="field-label" for="setEditorArgs">编辑器参数</label>
                  <input class="field-input" id="setEditorArgs" value="${esc(editorArgs)}" placeholder="例：-g" spellcheck="false">
                </div>
              </div>
              <div class="field-row-2">
                <div class="field-group">
                  <label class="field-label" for="setTermShell">终端 Shell（留空自动检测）</label>
                  <input class="field-input" id="setTermShell" value="${esc(host.terminal.shell)}" placeholder="例：/bin/zsh 或 pwsh.exe" spellcheck="false">
                </div>
                <div class="field-group">
                  <label class="field-label" for="setTermArgs">终端启动参数</label>
                  <input class="field-input" id="setTermArgs" value="${esc(termArgs)}" placeholder="例：-l" spellcheck="false">
                </div>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-sec-title">安全护栏</div>
              <div class="field-group">
                <label class="field-label" for="setProtected">受保护分支（禁止强推与误删，逗号分隔）</label>
                <input class="field-input" id="setProtected" value="${esc(protectedText)}" placeholder="main, master, release" spellcheck="false">
              </div>
              <label class="check-wrap" style="margin-top:6px">
                <input type="checkbox" id="setConfirmDangerous" ${host.confirmDangerous ? 'checked' : ''}>
                <span class="check-box">${icon('check')}</span>
                <span>危险操作前二次确认（Reset --hard / Force Push / 丢弃更改）</span>
              </label>
            </div>
          </div>
        </div>

        <div class="modal-foot">
          <span class="modal-tip">修改根目录后会自动触发重新扫描</span>
          <span class="spacer"></span>
          <button class="btn" type="button" data-modal-close="1">取消</button>
          <button class="btn primary" type="button" id="saveSettingsBtn" ${saving ? 'disabled' : ''}>${
            saving ? '保存中…' : '保存设置'
          }</button>
        </div>
      </div>
    </div>`;
}

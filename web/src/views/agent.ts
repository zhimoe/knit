import type { AgentConfig, Commit, Mode, Repo } from '../types';
import { icon, shortPath } from './icons';
import { esc } from './util';

export interface AgentLine {
  cls: '' | 'p' | 'ok' | 'dim' | 'warn' | 'ai' | 'err';
  text: string;
  applyCommit?: string;
}

export interface TerminalDrawerState {
  open: boolean;
  repo: Repo | null;
  commit: Commit | null;
  changesCount: number;
  termTab: 'term' | 'pi' | 'codex';
  mode: Mode;
  skills: Record<string, boolean>;
  config: AgentConfig | null;
  running: boolean;
  busy: boolean;
  queuedPos: number;
  dirtyWarning: boolean;
  lines: AgentLine[];
}

const MODE_LABELS: Record<Mode, string> = {
  read: '读代码',
  commit: '提交',
  review: '审查',
};

function renderTab(tab: 'term' | 'pi' | 'codex', activeTab: string): string {
  const active = tab === activeTab;
  const label = tab === 'term' ? '终端' : tab === 'pi' ? 'Pi' : 'Codex';
  const glyph = tab === 'pi' ? '<span class="pi-glyph">π</span>' : icon(tab === 'term' ? 'terminal' : 'sparkles');
  return `<button class="term-tab ${active ? 'active' : ''}" type="button" data-termtab="${tab}" title="${label}">
    ${glyph}<span>${label}</span>
  </button>`;
}

function renderMessage(line: AgentLine): string {
  let cls = 't-out';
  let prefix = '';
  if (line.cls === 'p') {
    cls = 't-cmd';
    prefix = '❯';
  } else if (line.cls === 'ai') {
    cls = 't-agent';
    prefix = '▸';
  } else if (line.cls === 'ok' || line.cls === 'dim' || line.cls === 'warn') {
    cls = 't-system';
    prefix = '▍';
  } else if (line.cls === 'err') {
    cls = 't-system';
    prefix = '✕';
  }
  const style = line.cls === 'err' ? ' style="color:var(--red)"' : line.cls === 'warn' ? ' style="color:var(--orange)"' : '';
  const actions = line.applyCommit
    ? `<div class="term-actions-row">
        <button class="term-action" type="button" data-apply-commit="${esc(encodeURIComponent(line.applyCommit))}">
          ${icon('check')}填入提交框
        </button>
      </div>`
    : '';
  return `<div class="t-message"><div class="t-line ${cls}"${style}><span class="t-prefix">${prefix}</span><span>${esc(
    line.text,
  )}</span></div>${actions}</div>`;
}

export function renderTerminalPanel(state: TerminalDrawerState): { className: string; html: string } {
  const { repo, commit, open, termTab, mode, skills, config, running, queuedPos, dirtyWarning, lines } = state;
  if (!repo) {
    return {
      className: 'terminal collapsed',
      html: `<div class="term-head"><div class="term-tabs">${renderTab('term', termTab)}</div><span class="term-collapsed-hint">没有选中的仓库</span></div>`,
    };
  }

  const isAgent = termTab !== 'term';
  const agentLabel = termTab === 'pi' ? 'Pi' : 'Codex';
  const isWorktreeCtx = mode === 'commit';
  const ctxLabel = isWorktreeCtx
    ? `worktree · ${state.changesCount} files`
    : commit
      ? `@ ${commit.shortHash} · ${repo.branch ?? 'detached'}`
      : `${repo.name} · ${repo.branch ?? 'detached'}`;

  const availableSkills = config?.skills.length
    ? config.skills.map((s) => s.id)
    : ['understanding-anything', 'commit-msg', 'repo-map', 'changelog'];
  const activeSkills = availableSkills.filter((id) => skills[id]);

  const headerActions = isAgent
    ? `
      <div class="mode-seg" role="group" aria-label="Agent 模式">
        ${(['read', 'commit', 'review'] as Mode[])
          .map(
            (m) =>
              `<button class="mode-btn ${mode === m ? 'active' : ''}" type="button" data-mode="${m}" title="${MODE_LABELS[m]}模式">${MODE_LABELS[m]}</button>`,
          )
          .join('')}
      </div>
      <span class="term-ctx ${isWorktreeCtx ? 'worktree' : ''}" title="${esc(ctxLabel)}">
        ${icon(isWorktreeCtx ? 'file' : 'crosshair')}<span>${esc(ctxLabel)}</span>
      </span>
      <button class="term-icon-btn" type="button" data-pop="skills" data-popover-trigger="1" title="配置固定 skills">
        ${icon('gear')}
      </button>`
    : `
      <span class="term-ctx" title="${esc(shortPath(repo.path))}">
        ${icon('terminal')}<span>${esc(repo.name)} · ${esc(repo.branch ?? 'detached')}</span>
      </span>`;

  const statusChips =
    (queuedPos ? `<span class="skill-chip" style="color:var(--orange)">排队中 #${queuedPos}</span>` : '') +
    (dirtyWarning
      ? `<span class="skill-chip" style="color:var(--red)">⚠ 工作区已变脏</span>
         <button class="diff-tool-btn" type="button" data-act="agent-restore">恢复到打开前</button>`
      : '');

  const banner = isAgent
    ? `
    <div class="agent-banner">
      <span class="ab-agent">${icon('sparkles')}${agentLabel}</span>
      <span class="ab-mode">${MODE_LABELS[mode]}模式</span>
      <span class="ab-skills-label">skills</span>
      ${
        activeSkills.length
          ? activeSkills.map((id) => `<span class="skill-chip" title="${esc(id)}">${esc(id)}</span>`).join('')
          : `<span class="skill-chip none">未启用 skill</span>`
      }
      ${statusChips}
      <span class="ab-context">${esc(ctxLabel)}</span>
    </div>`
    : '';

  const placeholder =
    termTab === 'term'
      ? running
        ? '输入命令回车执行…'
        : '输入命令回车自动启动终端…'
      : mode === 'commit'
        ? '提交模式：点击 Changes 页「✨ 生成」或输入补充要求回车'
        : mode === 'read'
          ? '读代码模式只读；点击模式切换为「审查」可交互对话'
          : '输入问题回车发送给 agent…';

  const inputDisabled = isAgent && mode === 'read';

  const body = open
    ? `
    <div class="term-body">
      ${banner}
      <div class="term-scroll" id="termBody">
        ${
          lines.length
            ? lines.map(renderMessage).join('')
            : `<div class="t-line t-out"><span class="t-prefix"></span><span>${
                isAgent ? `${agentLabel} 已就绪 · 点击上方模式胶囊启动会话，或点提交详情里的「AI 分析」。` : '终端已就绪 · 输入命令回车执行。'
              }</span></div>`
        }
        ${
          running
            ? `<div class="t-line t-agent"><span class="t-prefix">▸</span><span class="typing"><i></i><i></i><i></i></span></div>`
            : ''
        }
      </div>
      <div class="term-input-row">
        <span class="term-prompt">${icon('chevron-right')}</span>
        <input class="term-input" id="termInput" type="text" autocomplete="off" spellcheck="false"
          placeholder="${esc(placeholder)}" ${inputDisabled ? 'disabled' : ''}>
        <span class="term-hint">${termTab === 'term' ? '↵ 执行' : '↵ 发送'}</span>
        <button class="term-send" type="button" data-action="term-send" title="发送" ${inputDisabled ? 'disabled' : ''}>${icon('send')}</button>
      </div>
    </div>`
    : `
    <div class="term-body">
      <div class="term-collapsed-hint">${esc(ctxLabel)}</div>
    </div>`;

  const html = `
    <div class="term-head">
      <div class="term-tabs">
        ${renderTab('term', termTab)}
        ${renderTab('codex', termTab)}
        ${renderTab('pi', termTab)}
      </div>
      <div class="term-actions">
        ${headerActions}
        <button class="term-icon-btn" type="button" id="termClear" title="清屏 / 重置当前会话">${icon('refresh')}</button>
        <button class="term-icon-btn" type="button" data-action="toggle-terminal" title="${open ? '收起终端（⌃J）' : '展开终端（⌃J）'}">
          ${icon(open ? 'chevron-down' : 'chevron-up')}
        </button>
      </div>
    </div>
    ${body}`;

  return { className: `terminal ${open ? 'open' : 'collapsed'}`, html };
}

export const agentPromptLine = (repoName: string, mode: Mode, skills: Record<string, boolean>, rev: string): string => {
  const enabled = Object.keys(skills)
    .filter((key) => skills[key])
    .join(',');
  const target = mode === 'commit' ? '--staged' : `--rev=${rev || 'HEAD'}`;
  return `agent --repo=${repoName} --mode=${mode} --skills=${enabled || 'none'} ${target}`;
};

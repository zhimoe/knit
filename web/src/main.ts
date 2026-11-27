// knit front-end controller — hand-written DOM, strictly aligned with knit-prototype/index.html.
//
// Boot flow: Shell.getState → Agent.config → Repo.cached (instant paint + Shell.ready)
// → Repo.scan → Repo.status → Log.list + Log.files + Repo.changes.

import { api, installEventBridge, IpcError, onEvent } from './api';
import type {
  AgentConfig,
  AgentExitEvent,
  AgentOutputEvent,
  AgentQueuedEvent,
  AgentStartedEvent,
  BlameLine,
  Commit,
  ConsoleEntry,
  DiffFile,
  FileEntry,
  GitCommandEvent,
  GitRef,
  HostState,
  MergeState,
  Mode,
  RebaseAction,
  RebaseCommit,
  RebaseState,
  Repo,
  RepoChangedEvent,
  ShelfItem,
  Tab,
  WorktreeInfo,
} from './types';
import { clearDraft, loadDraft, loadUi, messageHistory, pushMessageHistory, saveDraft, saveUi } from './draft';
import { mountShell } from './shell';
import { agentPromptLine, renderTerminalPanel, type AgentLine } from './views/agent';
import { renderBlamePanel } from './views/blame';
import { renderBranchModal } from './views/branch';
import {
  renderChangesDiffPanel,
  renderChangesHead,
  renderChangesTreePanel,
  renderCommitBox,
  renderDiscardModal,
  stagedFiles,
} from './views/changes';
import { renderConsole, renderConsoleRows } from './views/console';
import { renderDetails } from './views/details';
import { buildHunkPatch } from './views/diff';
import { renderFullDiffPage } from './views/fulldiff';
import { basenameOf, icon, langMeta, shortPath, tint } from './views/icons';
import {
  hasActiveLogFilters,
  logGraphWidth,
  renderLogBanner,
  renderLogFilters,
  renderLogFooter,
  renderLogRows,
  renderQuickChanges,
  type LogFilterState,
} from './views/log';
import {
  autoChoice,
  blockCount,
  hasConflictMarkers,
  parseMergeLines,
  renderMergeModal,
  resolvedContent,
  unresolvedCount,
  type MergeChoice,
  type MergeSegment,
} from './views/merge';
import {
  renderAuthorFilterPopover,
  renderBranchFilterPopover,
  renderCommandPalette,
  renderHistoryPopover,
  renderPathFilterPopover,
  renderRootModal,
  renderShelfStatPopover,
  renderSkillsPopover,
  renderTimeFilterPopover,
} from './views/popover';
import { renderRebaseModal } from './views/rebase';
import { renderShelf } from './views/shelf';
import { renderSidebar, visibleRepos } from './views/sidebar';
import { changeKey, dirtyTotal, esc, stripAnsi } from './views/util';
import { renderWorktreeModal } from './views/worktree';

// --- types & state --------------------------------------------------------

interface MergeView {
  file: string;
  state: MergeState;
  segments: MergeSegment[];
  choices: MergeChoice[];
  active: number;
  editMode: boolean;
  customText: string | null;
}

interface BranchView {
  refs: GitRef[];
  busy: boolean;
  filter: string;
}

interface RebaseView {
  onto: string;
  items: RebaseCommit[];
  busy: boolean;
}

interface WorktreeView {
  items: WorktreeInfo[];
  busy: boolean;
}

interface BlameView {
  path: string;
  rev: string;
  lines: BlameLine[];
  nextLine: number;
  hasMore: boolean;
  loading: boolean;
  ms: number;
}

interface DiscardModalState {
  targets: FileEntry[];
}

interface ConfirmState {
  title: string;
  message: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

type ActiveModal =
  | { kind: 'merge' }
  | { kind: 'branch' }
  | { kind: 'rebase' }
  | { kind: 'worktree' }
  | { kind: 'root' }
  | { kind: 'discard'; data: DiscardModalState }
  | { kind: 'confirm'; data: ConfirmState }
  | null;

interface AppState {
  host: HostState | null;
  repos: Repo[];
  excluded: string[];
  excludedOpen: boolean;
  sidebarCollapsed: boolean;
  query: string;
  selectedPath: string;
  tab: Tab;
  fullDiff: boolean;
  fullDiffSource: 'commit' | 'worktree';
  commits: Commit[];
  logMs: number;
  logHasMore: boolean;
  logNextCursor: string;
  logLoadingMore: boolean;
  logScrollTop: number;
  commitIndex: number;
  commitFiles: FileEntry[];
  filesHash: string;
  selectedFile: FileEntry | null;
  detailCollapsed: Set<string>;
  worktreeCollapsed: Set<string>;
  fileFilter: string | null;
  filterQuery: string;
  authorFilter: string;
  timeFilter: 'all' | 'today' | 'week' | 'month';
  branchAll: boolean;
  diff: DiffFile | null;
  diffMode: 'split' | 'unified';
  ignoreWhitespace: boolean;
  expanded: Record<string, boolean>;
  renderAll: Record<string, boolean>;
  changes: FileEntry[];
  selectedChangeKey: string;
  changeDiff: DiffFile | null;
  msg: string;
  amend: boolean;
  draft: { text: string; ts: number } | null;
  busy: string | null;
  remoteBusy: 'fetch' | 'pull' | null;
  lastRefresh: number;
  console: ConsoleEntry[];
  shelf: ShelfItem[];
  merge: MergeView | null;
  branchModal: BranchView | null;
  rebase: RebaseView | null;
  rebaseState: RebaseState | null;
  worktree: WorktreeView | null;
  blame: BlameView | null;
  modal: ActiveModal;
  popover: { key: string; anchor: HTMLElement; data?: string } | null;
  termOpen: boolean;
  termTab: 'term' | 'pi' | 'codex';
  mode: Mode;
  skills: Record<string, boolean>;
  config: AgentConfig | null;
  agentLines: AgentLine[];
  agentSession: string | null;
  agentRunning: boolean;
  agentBusy: boolean;
  agentQueuedPos: number;
  agentDirtyRecovery: { path: string; snapshotSha: string; preUntracked: string[] } | null;
  agentOneShot: 'commit' | null;
  agentOutputRaw: string;
  agentDirtyBefore: number;
  msgAtAgentStart: string;
  termSession: string | null;
  pendingWrites: string[];
}

const DEFAULT_GLOBS = ['node_modules', 'target', '.venv', 'vendor', 'dist', 'build', '.cache'];

const lsGet = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const lsSet = (key: string, val: string): void => {
  try {
    window.localStorage.setItem(key, val);
  } catch {
    /* ignore storage quota errors */
  }
};

const lsDel = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

const state: AppState = {
  host: null,
  repos: [],
  excluded: [],
  excludedOpen: false,
  sidebarCollapsed: lsGet('knit.sidebar.collapsed') === '1',
  query: '',
  selectedPath: '',
  tab: 'log',
  fullDiff: false,
  fullDiffSource: 'commit',
  commits: [],
  logMs: 0,
  logHasMore: false,
  logNextCursor: '',
  logLoadingMore: false,
  logScrollTop: 0,
  commitIndex: 0,
  commitFiles: [],
  filesHash: '',
  selectedFile: null,
  detailCollapsed: new Set(),
  worktreeCollapsed: new Set(),
  fileFilter: null,
  filterQuery: '',
  authorFilter: '',
  timeFilter: 'all',
  branchAll: false,
  diff: null,
  diffMode: 'split',
  ignoreWhitespace: false,
  expanded: {},
  renderAll: {},
  changes: [],
  selectedChangeKey: '',
  changeDiff: null,
  msg: '',
  amend: false,
  draft: null,
  busy: null,
  remoteBusy: null,
  lastRefresh: 0,
  console: [],
  shelf: [],
  merge: null,
  branchModal: null,
  rebase: null,
  rebaseState: null,
  worktree: null,
  blame: null,
  modal: null,
  popover: null,
  termOpen: false,
  termTab: 'pi',
  mode: 'read',
  skills: { 'understanding-anything': true, 'commit-msg': true },
  config: null,
  agentLines: [],
  agentSession: null,
  agentRunning: false,
  agentBusy: false,
  agentQueuedPos: 0,
  agentDirtyRecovery: null,
  agentOneShot: null,
  agentOutputRaw: '',
  agentDirtyBefore: 0,
  msgAtAgentStart: '',
  termSession: null,
  pendingWrites: [],
};

const diffRequest = { value: 0 };
const watchRefreshed = new Map<string, number>();

// --- DOM & feedback helpers -----------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`缺少 DOM 节点 ${selector}`);
  return node;
};

let toastTimer = 0;
function toast(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const ic = tone === 'success' ? 'check' : tone === 'error' ? 'x' : 'sparkles';
  root.innerHTML = `<div class="toast ${tone}">${icon(ic)}<span>${esc(message)}</span></div>`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (root) root.innerHTML = '';
  }, 2800);
}

function report(error: unknown): void {
  const message = error instanceof IpcError ? error.message : error instanceof Error ? error.message : String(error);
  toast(message, 'error');
  console.error(error);
  if (state.tab === 'console') {
    state.console.push({ cmd: `✗ ${message}`, ms: 0, ok: false });
    renderConsoleOnly();
  }
}

const selectedRepo = (): Repo | null => state.repos.find((repo) => repo.path === state.selectedPath) ?? null;

function visibleCommitList(): Commit[] {
  const now = Date.now();
  const cutoff =
    state.timeFilter === 'today'
      ? now - 86_400_000
      : state.timeFilter === 'week'
        ? now - 7 * 86_400_000
        : state.timeFilter === 'month'
          ? now - 30 * 86_400_000
          : 0;
  const query = state.filterQuery.trim().toLowerCase();
  return state.commits.filter((commit) => {
    if (state.authorFilter && commit.author.name !== state.authorFilter) return false;
    if (cutoff && commit.committedAt < cutoff) return false;
    if (!query) return true;
    return `${commit.subject} ${commit.hash} ${commit.author.name}`.toLowerCase().includes(query);
  });
}

function currentCommitIndex(): number {
  return Math.min(Math.max(0, state.commitIndex), Math.max(0, visibleCommitList().length - 1));
}

function currentCommit(): Commit | null {
  const list = visibleCommitList();
  if (!list.length) return null;
  return list[currentCommitIndex()] ?? null;
}

const diffKey = (kind: string, file: string): string => `${kind}:${file}`;

function showAllRows(kind: 'commit' | 'workdir'): boolean {
  const file =
    kind === 'commit'
      ? state.selectedFile
      : state.changes.find((f) => changeKey(f) === state.selectedChangeKey) ?? null;
  if (!file) return false;
  return Boolean(state.renderAll[diffKey(kind, changeKey(file))]);
}

function isExpanded(kind: 'commit' | 'workdir'): boolean {
  const file =
    kind === 'commit'
      ? state.selectedFile
      : state.changes.find((f) => changeKey(f) === state.selectedChangeKey) ?? null;
  if (!file) return false;
  return Boolean(state.expanded[diffKey(kind, changeKey(file))]);
}

// --- modals & confirm -----------------------------------------------------

function closeModal(): void {
  if (state.modal?.kind === 'confirm') {
    const res = state.modal.data.resolve;
    state.modal = null;
    renderModal();
    res(false);
    return;
  }
  state.modal = null;
  state.merge = null;
  state.branchModal = null;
  state.rebase = null;
  state.worktree = null;
  renderModal();
}

function askConfirm(title: string, message: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    if (state.modal?.kind === 'confirm') state.modal.data.resolve(false);
    state.modal = { kind: 'confirm', data: { title, message, danger, resolve } };
    renderModal();
  });
}

function answerConfirm(ok: boolean): void {
  if (state.modal?.kind !== 'confirm') return;
  const resolve = state.modal.data.resolve;
  state.modal = null;
  renderModal();
  resolve(ok);
}

function renderModal(): void {
  const root = document.getElementById('modalRoot');
  if (!root) return;
  const m = state.modal;
  const repo = selectedRepo();
  if (!m) {
    root.innerHTML = '';
    return;
  }
  if (m.kind === 'confirm') {
    const { title, message, danger } = m.data;
    root.innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop="1">
        <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="modal-head">
            <span class="modal-head-icon${danger ? ' danger' : ''}">${icon(danger ? 'undo' : 'check')}</span>
            <span class="modal-head-text">
              <span class="modal-title">${esc(title)}</span>
            </span>
          </div>
          <div class="modal-body">
            <div style="font-size:11.5px;color:var(--text-soft);line-height:1.6;white-space:pre-wrap">${esc(message)}</div>
          </div>
          <div class="modal-foot">
            <span class="spacer"></span>
            <button class="btn" type="button" id="confirmCancel">取消</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" type="button" id="confirmOk">确定</button>
          </div>
        </div>
      </div>`;
    return;
  }
  if (m.kind === 'discard' && repo) {
    root.innerHTML = renderDiscardModal(repo, m.data.targets);
    return;
  }
  if (m.kind === 'root' && state.host) {
    const allGlobs = Array.from(new Set([...DEFAULT_GLOBS, ...state.host.excludeGlobs]));
    root.innerHTML = renderRootModal(state.host.root, allGlobs, state.host.excludeGlobs, state.excluded);
    return;
  }
  if (m.kind === 'merge' && state.merge) {
    root.innerHTML = renderMergeModal({
      state: state.merge.state,
      segments: state.merge.segments,
      choices: state.merge.choices,
      activeBlock: state.merge.active,
      editMode: state.merge.editMode,
      customText: state.merge.customText,
    });
    return;
  }
  if (m.kind === 'branch' && state.branchModal && repo) {
    root.innerHTML = renderBranchModal({
      repo,
      refs: state.branchModal.refs,
      protectedBranches: state.host?.protectedBranches ?? ['main', 'master'],
      defaultStart: currentCommit()?.shortHash ?? 'HEAD',
      busy: state.branchModal.busy,
      filter: state.branchModal.filter,
    });
    return;
  }
  if (m.kind === 'rebase' && state.rebase) {
    root.innerHTML = renderRebaseModal(state.rebase.onto, state.rebase.items, state.rebase.busy);
    bindRebaseDrag(root);
    return;
  }
  if (m.kind === 'worktree' && state.worktree && repo) {
    root.innerHTML = renderWorktreeModal(
      repo.name,
      state.worktree.items,
      currentCommit()?.shortHash ?? 'HEAD',
      state.worktree.busy,
    );
    return;
  }
  root.innerHTML = '';
}

// --- popovers -------------------------------------------------------------

function closePopover(): void {
  state.popover = null;
  const root = document.getElementById('popoverRoot');
  if (root) root.innerHTML = '';
}

function showPopover(anchor: HTMLElement, key: string, html: string, width = 290, align: 'left' | 'right' = 'left'): void {
  if (state.popover && state.popover.key === key) {
    closePopover();
    return;
  }
  state.popover = { key, anchor };
  const root = document.getElementById('popoverRoot');
  if (!root) return;
  const rect = anchor.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.style.width = `${width}px`;
  pop.innerHTML = html;
  root.innerHTML = '';
  root.appendChild(pop);

  const popRect = pop.getBoundingClientRect();
  let left = align === 'right' ? rect.right - popRect.width : rect.left;
  left = Math.max(8, Math.min(window.innerWidth - popRect.width - 8, left));
  let top = rect.bottom + 6;
  if (top + popRect.height > window.innerHeight - 10) {
    top = Math.max(8, rect.top - popRect.height - 6);
  }
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

// --- rendering ------------------------------------------------------------

function renderSidebarOnly(): void {
  const repo = selectedRepo();
  const rootPath = state.host?.root ?? '';
  const rootNameEl = document.getElementById('rootName');
  const rootPathEl = document.getElementById('rootPath');
  if (rootNameEl) rootNameEl.textContent = rootPath ? basenameOf(rootPath.replace(/\/+$/, '')) : '…';
  if (rootPathEl) rootPathEl.textContent = rootPath ? shortPath(rootPath) : '…';

  const side = renderSidebar({
    repos: state.repos,
    excluded: state.excluded,
    excludedOpen: state.excludedOpen,
    query: state.query,
    selectedId: repo?.id ?? '',
    lastRefresh: state.lastRefresh,
  });

  const searchInput = document.getElementById('repoSearch') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.placeholder = `搜索 ${side.activeCount} 个仓库`;
    if (searchInput.value !== state.query) searchInput.value = state.query;
  }
  const searchClear = document.getElementById('repoSearchClear');
  if (searchClear) searchClear.hidden = !state.query;

  $('#repoListMeta').innerHTML = side.meta;
  $('#repoList').innerHTML = side.html;
  $('#sidebarFoot').innerHTML = side.foot;
}

function applySidebarCollapsed(): void {
  const ws = document.getElementById('workspace');
  if (ws) ws.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  const btn = document.getElementById('sidebarToggle');
  if (btn) {
    const label = state.sidebarCollapsed ? '展开工作区' : '收起工作区';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
  }
}

function renderTopBarState(): void {
  const fetchBtn = document.getElementById('fetchBtn');
  const pullBtn = document.getElementById('pullBtn');
  if (fetchBtn) fetchBtn.classList.toggle('busy', state.remoteBusy === 'fetch');
  if (pullBtn) pullBtn.classList.toggle('busy', state.remoteBusy === 'pull');
}

function renderViewBar(): void {
  const repo = selectedRepo();
  const count = state.changes.length || (repo ? dirtyTotal(repo) : 0);

  const projectIcon = document.getElementById('tabProjectIcon');
  const projectName = document.getElementById('tabProjectName');
  const projectBranch = document.getElementById('tabProjectBranch');
  const viewBranchName = document.getElementById('viewBranchName');
  const viewChangesCount = document.getElementById('viewChangesCount');
  const right = document.getElementById('viewbarRight');

  if (repo) {
    const lm = langMeta(repo.lang);
    if (projectIcon) {
      projectIcon.textContent = lm.short;
      projectIcon.style.background = tint(lm.color, 0.13);
      projectIcon.style.color = lm.color;
      projectIcon.style.borderColor = tint(lm.color, 0.16);
    }
    if (projectName) projectName.textContent = repo.name;
    const br = repo.branch ?? (repo.detached ? 'detached' : 'HEAD');
    if (projectBranch) projectBranch.innerHTML = `${icon('branch')}<span>${esc(br)}</span>`;
    if (viewBranchName) viewBranchName.textContent = state.branchAll ? 'all' : br;
  }

  if (viewChangesCount) {
    viewChangesCount.textContent = String(count);
    viewChangesCount.classList.toggle('zero', count === 0);
  }

  const tabs: [string, Tab][] = [
    ['viewTabLog', 'log'],
    ['viewTabChanges', 'changes'],
    ['viewTabConsole', 'console'],
    ['viewTabShelf', 'shelf'],
  ];
  for (const [id, tab] of tabs) {
    const el = document.getElementById(id);
    if (el) {
      const on = state.tab === tab;
      el.classList.toggle('active', on);
      el.setAttribute('aria-selected', String(on));
    }
  }

  if (right) {
    if (state.busy) {
      right.innerHTML = `<span style="color:var(--accent-strong)">${esc(state.busy)}</span>`;
    } else if (!repo) {
      right.innerHTML = `<span class="vb-clean">未选择仓库</span>`;
    } else if (count > 0) {
      const conf = state.changes.filter((f) => f.conflict).length || repo.dirty.conflicted;
      right.innerHTML = conf
        ? `<span style="color:var(--red);font-weight:550">${conf} 个冲突 · ${count} 个未提交更改</span>`
        : `<span>${count} 个未提交更改</span>`;
    } else {
      right.innerHTML = `<span class="vb-clean">工作区干净</span>`;
    }
  }
}

function applyViewModeClasses(): void {
  const ws = $('#workspace');
  const logPane = $('#logPane');
  const changesView = $('#changesView');
  const auxView = $('#auxView');
  const isChanges = state.tab === 'changes';
  const isAux = state.tab === 'console' || state.tab === 'shelf';

  ws.classList.toggle('changes-mode', isChanges);
  ws.classList.toggle('aux-mode', isAux);
  logPane.classList.toggle('changes-mode', isChanges);
  logPane.classList.toggle('aux-mode', isAux);
  changesView.hidden = !isChanges;
  auxView.hidden = !isAux;
}

function currentLogFilter(commits: Commit[]): LogFilterState {
  const conflictCount = state.changes.filter((f) => f.conflict).length;
  return {
    branchAll: state.branchAll,
    filterPath: state.fileFilter,
    author: state.authorFilter,
    time: state.timeFilter,
    query: state.filterQuery,
    total: state.commits.length,
    shown: commits.length,
    ms: state.logMs,
    hasMore: state.logHasMore && !state.filterQuery && !state.authorFilter && state.timeFilter === 'all',
    loadingMore: state.logLoadingMore,
    rebaseInProgress: Boolean(state.rebaseState?.inProgress),
    rebaseProgress:
      state.rebaseState?.inProgress && state.rebaseState.end
        ? `${state.rebaseState.msgNum}/${state.rebaseState.end}`
        : undefined,
    mergeConflictCount: conflictCount,
  };
}

function renderLogArea(): void {
  const repo = selectedRepo();
  const listEl = $('#commitList');
  if (!repo) {
    $('#logRepoName').textContent = '选择一个仓库';
    $('#logRepoPath').textContent = '左侧列表点击一个仓库，或按 ⌘P 搜索';
    $('#logFilters').innerHTML = '';
    $('#logBanner').innerHTML = '';
    listEl.innerHTML = `<div class="empty-log"><span class="empty-icon">${icon('folder')}</span><strong>还没有选中仓库</strong><span>在左侧工作区选择一个仓库开始</span></div>`;
    $('#logFoot').innerHTML = '';
    $('#quickChanges').innerHTML = '';
    return;
  }

  const lm = langMeta(repo.lang);
  const badge = $('#logRepoIcon');
  badge.textContent = lm.short;
  badge.style.background = tint(lm.color, 0.13);
  badge.style.color = lm.color;
  badge.style.borderColor = tint(lm.color, 0.17);
  $('#logRepoName').textContent = repo.name;
  $('#logBranch').innerHTML = `${icon('branch')}<span>${esc(repo.branch ?? 'detached')}</span>`;
  $('#logRepoPath').textContent = shortPath(repo.path);

  const commitSearch = document.getElementById('commitSearch') as HTMLInputElement | null;
  if (commitSearch && commitSearch.value !== state.filterQuery) commitSearch.value = state.filterQuery;
  const clearBtn = document.getElementById('commitSearchClear');
  if (clearBtn) clearBtn.hidden = !state.filterQuery;

  const commits = visibleCommitList();
  const filter = currentLogFilter(commits);
  const pane = document.getElementById('logPane');
  if (pane) pane.style.setProperty('--graph-w', `${logGraphWidth(commits)}px`);
  $('#logFilters').innerHTML = renderLogFilters(repo, filter);
  $('#logBanner').innerHTML = renderLogBanner(filter);

  const prevScrollTop = listEl.scrollTop || state.logScrollTop;
  listEl.innerHTML = renderLogRows(repo, commits, currentCommitIndex(), {
    query: state.filterQuery,
    filterPath: state.fileFilter,
    filtering: hasActiveLogFilters(filter),
    scrollTop: prevScrollTop,
    viewportHeight: listEl.clientHeight || 600,
    hasMore: filter.hasMore,
    loadingMore: filter.loadingMore,
  });
  if (prevScrollTop > 0) listEl.scrollTop = prevScrollTop;

  $('#logFoot').innerHTML = renderLogFooter(filter);

  const qc = renderQuickChanges(repo, state.changes, state.draft);
  const qcEl = $('#quickChanges');
  qcEl.className = qc.className;
  qcEl.innerHTML = qc.html;
  if (qc.clickable) {
    qcEl.setAttribute('data-action', 'open-changes');
    qcEl.setAttribute('role', 'button');
    qcEl.setAttribute('tabindex', '0');
  } else {
    qcEl.removeAttribute('data-action');
    qcEl.removeAttribute('role');
    qcEl.removeAttribute('tabindex');
  }
}

function renderDetailsArea(): void {
  const details = $('#details');
  const repo = selectedRepo();
  if (!repo) {
    details.innerHTML = `<div class="empty-details"><span class="empty-icon">${icon('branch')}</span><strong>选择一个仓库</strong><span>选中仓库后这里会显示提交详情与并排 diff。</span></div>`;
    return;
  }
  const blameHtml = state.blame ? renderBlamePanel(state.blame) : null;
  details.innerHTML = renderDetails({
    commit: currentCommit(),
    repo,
    allCommits: state.commits,
    files: state.commitFiles,
    selectedFile: state.selectedFile,
    collapsedFolders: state.detailCollapsed,
    loadingFiles: state.busy === '读取文件列表…',
    diff: state.diff,
    diffMode: state.diffMode,
    ignoreWhitespace: state.ignoreWhitespace,
    expanded: isExpanded('commit'),
    loadingDiff: state.busy === '读取 diff…',
    renderAllRows: showAllRows('commit'),
    blameHtml,
  });
}

function renderChangesArea(): void {
  const repo = selectedRepo();
  const head = $('#changesViewHead');
  const treePanel = $('#changesTreePanel');
  const diffPanel = $('#changesDiffPanel');
  const composer = $('#composer');

  if (!repo) {
    head.innerHTML = '';
    treePanel.innerHTML = `<div class="cv-clean-state">${icon('branch')}<span>选择一个仓库</span></div>`;
    diffPanel.innerHTML = '';
    composer.innerHTML = '';
    composer.hidden = true;
    return;
  }

  head.innerHTML = renderChangesHead({ repo, files: state.changes });
  treePanel.innerHTML = renderChangesTreePanel(state.changes, state.selectedChangeKey, state.worktreeCollapsed);
  const selectAll = document.getElementById('selectAllChanges') as HTMLInputElement | null;
  if (selectAll) {
    const stagedCount = stagedFiles(state.changes).length;
    selectAll.indeterminate = stagedCount > 0 && stagedCount < state.changes.length;
  }

  const blameHtml = state.blame ? renderBlamePanel(state.blame) : null;
  diffPanel.innerHTML = renderChangesDiffPanel({
    files: state.changes,
    selectedKey: state.selectedChangeKey,
    diff: state.changeDiff,
    diffMode: state.diffMode,
    ignoreWhitespace: state.ignoreWhitespace,
    expanded: isExpanded('workdir'),
    loading: state.busy === '读取 diff…',
    renderAllRows: showAllRows('workdir'),
    blameHtml,
  });

  if (!state.changes.length && !state.amend) {
    composer.innerHTML = '';
    composer.hidden = true;
  } else {
    composer.hidden = false;
    const prevMsg = document.getElementById('msgBox') as HTMLTextAreaElement | null;
    const wasFocused = Boolean(prevMsg && document.activeElement === prevMsg);
    const selStart = prevMsg?.selectionStart ?? state.msg.length;
    const selEnd = prevMsg?.selectionEnd ?? state.msg.length;
    composer.innerHTML = renderCommitBox({
      repo,
      files: state.changes,
      message: state.msg,
      amend: state.amend,
      draft: state.draft,
      busy: state.busy === '提交中…',
      aiBusy: state.agentOneShot === 'commit' && state.agentRunning,
    });
    if (wasFocused) {
      const nextMsg = document.getElementById('msgBox') as HTMLTextAreaElement | null;
      if (nextMsg) {
        nextMsg.focus({ preventScroll: true });
        nextMsg.setSelectionRange(selStart, selEnd);
      }
    }
  }
}

function renderAuxArea(): void {
  const aux = $('#auxView');
  if (state.tab === 'console') {
    aux.innerHTML = renderConsole(state.console);
  } else if (state.tab === 'shelf') {
    aux.innerHTML = renderShelf(state.shelf);
  }
}

function renderConsoleOnly(): void {
  if (state.tab !== 'console') return;
  const list = document.getElementById('consoleList');
  if (list) list.innerHTML = renderConsoleRows(state.console);
}

function renderFullDiffOnly(): void {
  const app = $('#app');
  const page = $('#fullDiffPage');
  app.classList.toggle('diff-mode', state.fullDiff);
  page.hidden = !state.fullDiff;
  if (!state.fullDiff) {
    page.innerHTML = '';
    return;
  }
  const repo = selectedRepo();
  if (!repo) return;

  const isWorktree = state.fullDiffSource === 'worktree';
  const files = isWorktree ? state.changes : state.commitFiles;
  const file = isWorktree
    ? state.changes.find((f) => changeKey(f) === state.selectedChangeKey) ?? state.changes[0] ?? null
    : state.selectedFile ?? state.commitFiles[0] ?? null;
  const fileIndex = file ? files.findIndex((f) => (isWorktree ? changeKey(f) === changeKey(file) : f.path === file.path)) : -1;
  const blameHtml = state.blame ? renderBlamePanel(state.blame) : null;

  page.innerHTML = renderFullDiffPage({
    repo,
    source: state.fullDiffSource,
    returnTab: state.tab === 'changes' ? 'changes' : 'log',
    commit: currentCommit(),
    files,
    fileIndex,
    file,
    diff: isWorktree ? state.changeDiff : state.diff,
    mode: state.diffMode,
    ignoreWhitespace: state.ignoreWhitespace,
    expanded: isExpanded(isWorktree ? 'workdir' : 'commit'),
    loading: state.busy === '读取 diff…',
    renderAllRows: showAllRows(isWorktree ? 'workdir' : 'commit'),
    blameHtml,
  });
}

function renderTerminalOnly(focusInput = false): void {
  const terminal = document.getElementById('terminal');
  const splitter = document.getElementById('termSplitter');
  if (!terminal) return;

  const existingInput = document.getElementById('termInput') as HTMLInputElement | null;
  const wasFocused = Boolean(existingInput && document.activeElement === existingInput);
  const prevValue = existingInput?.value ?? '';
  const prevScroll = document.getElementById('termBody');
  const atBottom = !prevScroll || prevScroll.scrollHeight - prevScroll.scrollTop - prevScroll.clientHeight < 48;

  const rendered = renderTerminalPanel({
    open: state.termOpen,
    repo: selectedRepo(),
    commit: currentCommit(),
    changesCount: state.changes.length,
    termTab: state.termTab,
    mode: state.mode,
    skills: state.skills,
    config: state.config,
    running: state.termTab === 'term' ? state.termSession !== null : state.agentRunning,
    busy: state.agentBusy,
    queuedPos: state.agentQueuedPos,
    dirtyWarning: state.agentDirtyRecovery !== null && state.agentDirtyRecovery.path === state.selectedPath,
    lines: state.agentLines,
  });

  terminal.className = rendered.className;
  terminal.innerHTML = rendered.html;
  if (splitter) splitter.classList.toggle('hidden', !state.termOpen);

  const nextInput = document.getElementById('termInput') as HTMLInputElement | null;
  if (nextInput) {
    if (prevValue) nextInput.value = prevValue;
    if (state.termOpen && (focusInput || wasFocused) && !nextInput.disabled) {
      nextInput.focus({ preventScroll: true });
    }
  }
  const nextScroll = document.getElementById('termBody');
  if (nextScroll && atBottom) {
    nextScroll.scrollTop = nextScroll.scrollHeight;
  }
}

function render(): void {
  applySidebarCollapsed();
  renderTopBarState();
  renderSidebarOnly();
  renderViewBar();
  applyViewModeClasses();
  if (state.tab === 'log') {
    renderLogArea();
    renderDetailsArea();
  } else if (state.tab === 'changes') {
    renderChangesArea();
  } else {
    renderAuxArea();
  }
  renderFullDiffOnly();
  renderTerminalOnly();
}

function refreshLogRowsOnly(): void {
  const repo = selectedRepo();
  const list = document.getElementById('commitList');
  if (!repo || !list || state.tab !== 'log') return;
  const commits = visibleCommitList();
  const filter = currentLogFilter(commits);
  const pane = document.getElementById('logPane');
  if (pane) pane.style.setProperty('--graph-w', `${logGraphWidth(commits)}px`);
  list.innerHTML = renderLogRows(repo, commits, currentCommitIndex(), {
    query: state.filterQuery,
    filterPath: state.fileFilter,
    filtering: hasActiveLogFilters(filter),
    scrollTop: list.scrollTop,
    viewportHeight: list.clientHeight || 600,
    hasMore: filter.hasMore,
    loadingMore: filter.loadingMore,
  });
}

// --- draggable panel splitters --------------------------------------------

function restoreSplitterSizes(): void {
  const ws = document.getElementById('workspace');
  const contentArea = document.getElementById('contentArea');
  const details = document.getElementById('details');
  const changesBody = document.getElementById('changesViewBody');
  const mainContent = document.getElementById('mainContent');

  const sw = lsGet('knit.split.sidebar');
  if (ws && sw) ws.style.setProperty('--sidebar-w', sw);
  const dw = lsGet('knit.split.details');
  if (contentArea && dw) contentArea.style.setProperty('--details-w', dw);
  const ch = lsGet('knit.split.changesH');
  if (details && ch) details.style.setProperty('--changes-h', ch);
  const tw = lsGet('knit.split.treeW');
  if (changesBody && tw) changesBody.style.setProperty('--tree-w', tw);
  const th = lsGet('knit.split.termH');
  if (mainContent && th) mainContent.style.setProperty('--term-h', th);
}

function bindSplitters(): void {
  const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

  document.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const sidebarSplit = target.closest<HTMLElement>('#sidebarSplitter');
    const paneSplit = target.closest<HTMLElement>('#paneSplitter');
    const detailsSplit = target.closest<HTMLElement>('#detailsSplitter');
    const changesSplit = target.closest<HTMLElement>('#changesSplitter');
    const termSplit = target.closest<HTMLElement>('#termSplitter');

    const splitter = sidebarSplit || paneSplit || detailsSplit || changesSplit || termSplit;
    if (!splitter) return;
    event.preventDefault();

    const isHorizontal = Boolean(detailsSplit || termSplit);
    const bodyCls = isHorizontal ? 'resizing-v' : 'resizing-h';
    document.body.classList.add(bodyCls);
    splitter.classList.add('active');

    const onMove = (e: PointerEvent): void => {
      if (sidebarSplit) {
        const ws = document.getElementById('workspace');
        if (!ws) return;
        const rect = ws.getBoundingClientRect();
        const w = clamp(Math.round(e.clientX - rect.left), 180, Math.min(440, rect.width - 420));
        ws.style.setProperty('--sidebar-w', `${w}px`);
        lsSet('knit.split.sidebar', `${w}px`);
      } else if (paneSplit) {
        const area = document.getElementById('contentArea');
        if (!area) return;
        const rect = area.getBoundingClientRect();
        const w = clamp(Math.round(rect.right - e.clientX), 340, Math.max(360, rect.width - 340));
        area.style.setProperty('--details-w', `${w}px`);
        lsSet('knit.split.details', `${w}px`);
      } else if (detailsSplit) {
        const details = document.getElementById('details');
        const meta = details?.querySelector<HTMLElement>('.commit-meta');
        if (!details) return;
        const rect = details.getBoundingClientRect();
        const metaH = meta ? meta.getBoundingClientRect().height : 0;
        const h = clamp(Math.round(e.clientY - rect.top - metaH), 84, Math.max(120, Math.round((rect.height - metaH) * 0.68)));
        details.style.setProperty('--changes-h', `${h}px`);
        lsSet('knit.split.changesH', `${h}px`);
      } else if (changesSplit) {
        const body = document.getElementById('changesViewBody');
        if (!body) return;
        const rect = body.getBoundingClientRect();
        const w = clamp(Math.round(e.clientX - rect.left), 220, Math.max(260, Math.round(rect.width * 0.62)));
        body.style.setProperty('--tree-w', `${w}px`);
        lsSet('knit.split.treeW', `${w}px`);
      } else if (termSplit) {
        const main = document.getElementById('mainContent');
        if (!main) return;
        const rect = main.getBoundingClientRect();
        const h = clamp(Math.round(rect.bottom - e.clientY), 150, Math.max(180, Math.round(rect.height * 0.68)));
        main.style.setProperty('--term-h', `${h}px`);
        lsSet('knit.split.termH', `${h}px`);
      }
    };

    const onUp = (): void => {
      document.body.classList.remove(bodyCls);
      splitter.classList.remove('active');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  document.addEventListener('dblclick', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('#sidebarSplitter')) {
      document.getElementById('workspace')?.style.removeProperty('--sidebar-w');
      lsDel('knit.split.sidebar');
    } else if (target.closest('#paneSplitter')) {
      document.getElementById('contentArea')?.style.removeProperty('--details-w');
      lsDel('knit.split.details');
    } else if (target.closest('#detailsSplitter')) {
      document.getElementById('details')?.style.removeProperty('--changes-h');
      lsDel('knit.split.changesH');
    } else if (target.closest('#changesSplitter')) {
      document.getElementById('changesViewBody')?.style.removeProperty('--tree-w');
      lsDel('knit.split.treeW');
    } else if (target.closest('#termSplitter')) {
      document.getElementById('mainContent')?.style.removeProperty('--term-h');
      lsDel('knit.split.termH');
    }
  });
}

// --- data loading ---------------------------------------------------------

let repoToken = 0;

async function selectRepo(path: string): Promise<void> {
  if (!path) return;
  const token = ++repoToken;
  state.selectedPath = path;
  state.fullDiff = false;
  state.commitIndex = 0;
  state.commits = [];
  state.logHasMore = false;
  state.logNextCursor = '';
  state.logLoadingMore = false;
  state.logScrollTop = 0;
  state.commitFiles = [];
  state.filesHash = '';
  state.selectedFile = null;
  state.detailCollapsed = new Set();
  state.worktreeCollapsed = new Set();
  state.diff = null;
  state.fileFilter = null;
  state.filterQuery = '';
  state.authorFilter = '';
  state.timeFilter = 'all';
  state.branchAll = false;
  state.changes = [];
  state.selectedChangeKey = '';
  state.changeDiff = null;
  state.expanded = {};
  state.renderAll = {};
  state.merge = null;
  state.branchModal = null;
  state.rebase = null;
  state.rebaseState = null;
  state.worktree = null;
  state.blame = null;
  state.modal = null;
  state.agentLines = [];
  state.agentRunning = false;
  state.agentSession = null;
  state.termSession = null;
  closePopover();
  renderModal();

  const repo = selectedRepo();
  if (repo) {
    void api.setSelected(repo.id).catch(() => undefined);
    const ui = loadUi(repo.id);
    state.diffMode = ui.diffMode ?? (state.host?.diffMode as 'split' | 'unified') ?? 'split';
    state.ignoreWhitespace = ui.ignoreWhitespace ?? false;
    const draft = loadDraft(repo.id);
    state.draft = draft;
    state.msg = draft?.text ?? '';
    await stopAgent();
  }
  render();
  await loadLog();
  if (token !== repoToken) return;
  const firstFile = state.commitFiles[0];
  if (firstFile) await openCommitDiff(firstFile);
  await loadChanges();
  void refreshRebaseState();
  render();
}

async function loadLog(): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  const token = repoToken;
  try {
    const result = await api.log(repo.path, 200, {
      branch: !state.branchAll && repo.branch ? repo.branch : undefined,
      all: state.branchAll,
      filterPath: state.fileFilter ?? undefined,
    });
    if (token !== repoToken) return;
    state.commits = result.commits;
    state.logMs = result.ms;
    state.logHasMore = Boolean(result.hasMore);
    state.logNextCursor = result.nextCursor ?? '';
    state.logLoadingMore = false;
    state.commitIndex = Math.min(state.commitIndex, Math.max(0, result.commits.length - 1));
    await loadCommitFiles();
  } catch (error) {
    if (token === repoToken) {
      state.commits = [];
      state.logHasMore = false;
      state.logNextCursor = '';
      state.logLoadingMore = false;
      state.commitFiles = [];
      report(error);
    }
  }
}

async function loadMoreLog(): Promise<void> {
  const repo = selectedRepo();
  if (!repo || !state.logHasMore || !state.logNextCursor || state.logLoadingMore) return;
  const token = repoToken;
  state.logLoadingMore = true;
  refreshLogRowsOnly();
  try {
    const result = await api.log(repo.path, 200, {
      branch: !state.branchAll && repo.branch ? repo.branch : undefined,
      all: state.branchAll,
      filterPath: state.fileFilter ?? undefined,
      cursor: state.logNextCursor,
    });
    if (token !== repoToken) return;
    const seen = new Set(state.commits.map((c) => c.hash));
    for (const commit of result.commits) {
      if (!seen.has(commit.hash)) state.commits.push(commit);
    }
    state.logHasMore = Boolean(result.hasMore);
    state.logNextCursor = result.nextCursor ?? '';
  } catch (error) {
    report(error);
  } finally {
    if (token === repoToken) {
      state.logLoadingMore = false;
      renderLogArea();
    }
  }
}

async function loadCommitFiles(): Promise<void> {
  const repo = selectedRepo();
  const commit = currentCommit();
  if (!repo || !commit) {
    state.commitFiles = [];
    state.filesHash = '';
    state.selectedFile = null;
    state.diff = null;
    return;
  }
  if (state.filesHash === commit.hash && state.commitFiles.length) return;
  const token = repoToken;
  state.busy = '读取文件列表…';
  renderViewBar();
  try {
    const files = await api.logFiles(repo.path, commit.hash);
    if (token !== repoToken) return;
    state.commitFiles = files;
    state.filesHash = commit.hash;
    state.selectedFile = files[0] ?? null;
    state.diff = null;
    state.blame = null;
  } catch (error) {
    report(error);
  } finally {
    if (token === repoToken) {
      state.busy = null;
      render();
    }
  }
}

async function openCommitDiff(file: FileEntry): Promise<void> {
  const repo = selectedRepo();
  const commit = currentCommit();
  if (!repo || !commit) return;
  const token = repoToken;
  const request = ++diffRequest.value;
  state.selectedFile = file;
  state.blame = null;
  state.diff = null;
  state.busy = '读取 diff…';
  if (state.tab === 'log') renderDetailsArea();
  if (state.fullDiff) renderFullDiffOnly();
  try {
    const result = await api.diffCommit(
      repo.path,
      commit.hash,
      file.path,
      state.ignoreWhitespace,
      state.expanded[diffKey('commit', changeKey(file))] ? 500 : 3,
    );
    if (token !== repoToken || request !== diffRequest.value) return;
    state.diff = await api.fullDiff(result.diff);
  } catch (error) {
    report(error);
    state.diff = null;
  } finally {
    if (token === repoToken && request === diffRequest.value) {
      state.busy = null;
      if (state.tab === 'log') renderDetailsArea();
      if (state.fullDiff) renderFullDiffOnly();
      renderViewBar();
    }
  }
}

async function loadChanges(): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  const token = repoToken;
  try {
    const result = await api.changes(repo.path);
    if (token !== repoToken) return;
    state.changes = result.files;
    if (!state.changes.some((file) => changeKey(file) === state.selectedChangeKey)) {
      const first = state.changes.find((file) => file.group === 'unstaged') ?? state.changes[0] ?? null;
      state.selectedChangeKey = first ? changeKey(first) : '';
      state.changeDiff = null;
    }
    if (state.tab === 'changes' || (state.fullDiff && state.fullDiffSource === 'worktree')) {
      const selected = state.changes.find((file) => changeKey(file) === state.selectedChangeKey) ?? null;
      if (selected) await loadChangeDiff(selected);
      else state.changeDiff = null;
    }
  } catch (error) {
    report(error);
  }
}

async function loadChangeDiff(file: FileEntry): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  const token = repoToken;
  const request = ++diffRequest.value;
  state.blame = null;
  state.changeDiff = null;
  state.busy = '读取 diff…';
  if (state.tab === 'changes') renderChangesArea();
  if (state.fullDiff) renderFullDiffOnly();
  try {
    const result = await api.diffWorkdir(
      repo.path,
      file.path,
      file.group === 'staged',
      file.untracked === true,
      state.ignoreWhitespace,
      state.expanded[diffKey('workdir', changeKey(file))] ? 500 : 3,
    );
    if (token !== repoToken || request !== diffRequest.value) return;
    state.changeDiff = await api.fullDiff(result.diff);
  } catch (error) {
    report(error);
    state.changeDiff = null;
  } finally {
    if (token === repoToken && request === diffRequest.value) {
      state.busy = null;
      if (state.tab === 'changes') renderChangesArea();
      if (state.fullDiff) renderFullDiffOnly();
      renderViewBar();
    }
  }
}

function updateRepo(repo: Repo): void {
  const index = state.repos.findIndex((item) => item.path === repo.path);
  if (index >= 0) state.repos[index] = repo;
}

async function refreshStatus(paths?: string[]): Promise<void> {
  const targets = paths ?? state.repos.map((repo) => repo.path);
  if (!targets.length) return;
  try {
    const result = await api.status(targets);
    for (const repo of result.repos) updateRepo(repo);
    state.lastRefresh = Date.now();
    renderSidebarOnly();
    renderViewBar();
  } catch (error) {
    report(error);
  }
}

async function refreshAfterWrite(reloadLog = true): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  await refreshStatus([repo.path]);
  await loadChanges();
  if (reloadLog) {
    const keepHash = currentCommit()?.hash ?? '';
    await loadLog();
    const list = visibleCommitList();
    const found = list.findIndex((commit) => commit.hash === keepHash);
    state.commitIndex = found >= 0 ? found : 0;
    state.filesHash = '';
    await loadCommitFiles();
    const firstFile = state.commitFiles[0];
    if (firstFile) await openCommitDiff(firstFile);
  }
  void refreshRebaseState();
  render();
}

// --- boot & scan ----------------------------------------------------------

const mergeScanned = (scanned: Repo[]): Repo[] => {
  const known = new Map(state.repos.map((repo) => [repo.path, repo]));
  return scanned.map((repo) => {
    const old = known.get(repo.path);
    if (!old) return repo;
    return {
      ...repo,
      branch: old.branch ?? repo.branch,
      detached: old.detached,
      head: old.head || repo.head,
      ahead: old.ahead,
      behind: old.behind,
      dirty: old.dirty,
      lastCommitAt: old.lastCommitAt,
      lang: old.lang !== '—' ? old.lang : repo.lang,
    };
  });
};

async function rescan(): Promise<void> {
  if (!state.host) return;
  const previous = state.selectedPath;
  state.busy = '扫描中…';
  renderViewBar();
  try {
    const scan = await api.scan({
      root: state.host.root,
      excludeGlobs: state.host.excludeGlobs,
      scanDepth: state.host.scanDepth,
    });
    state.repos = mergeScanned(scan.repos);
    state.busy = '刷新状态…';
    renderViewBar();
    await refreshStatus(scan.repos.map((repo) => repo.path));
    if (!state.selectedPath || !state.repos.some((repo) => repo.path === state.selectedPath)) {
      const preferred =
        state.repos.find((repo) => repo.id === state.host?.selectedRepoId) ??
        visibleRepos(state.repos, state.excluded, '')[0] ??
        null;
      state.selectedPath = preferred?.path ?? '';
    }
    toast(`已扫描 ${state.repos.length} 个仓库`, 'success');
  } catch (error) {
    report(error);
  } finally {
    state.busy = null;
    render();
  }
  if (state.selectedPath && (state.selectedPath !== previous || !state.commits.length)) {
    void selectRepo(state.selectedPath);
  }
}

async function boot(): Promise<void> {
  const started = performance.now();
  let readySent = false;
  const signalReady = async (): Promise<void> => {
    if (readySent) return;
    readySent = true;
    await api.ready(state.repos.length, Math.round(performance.now() - started));
  };

  try {
    state.host = await api.hostState();
    state.excluded = [...state.host.excludeRepos];
    state.diffMode = state.host.diffMode ?? 'split';
    try {
      state.config = await api.agentConfig();
      state.mode = 'read';
    } catch (error) {
      console.error(error);
    }

    let cached: Repo[] = [];
    try {
      cached = await api.cached(state.host.root);
    } catch {
      cached = [];
    }
    state.repos = cached;
    const pickPreferred = (): Repo | null =>
      state.repos.find((repo) => repo.id === state.host?.selectedRepoId) ??
      visibleRepos(state.repos, state.excluded, '')[0] ??
      null;
    state.selectedPath = pickPreferred()?.path ?? '';
    render();
    if (cached.length) await signalReady();
    if (state.selectedPath) void selectRepo(state.selectedPath);

    const scan = await api.scan({
      root: state.host.root,
      excludeGlobs: state.host.excludeGlobs,
      scanDepth: state.host.scanDepth,
    });
    state.repos = mergeScanned(scan.repos);
    state.lastRefresh = Date.now();
    const stillValid = state.repos.some((repo) => repo.path === state.selectedPath);
    if (!stillValid) {
      state.selectedPath = pickPreferred()?.path ?? '';
      render();
      if (state.selectedPath) void selectRepo(state.selectedPath);
    } else {
      render();
      if (!cached.length && state.selectedPath) void selectRepo(state.selectedPath);
    }
    if (!readySent) {
      render();
      await signalReady();
    }

    const statusPaths = state.repos.map((repo) => repo.path);
    if (state.selectedPath) {
      const idx = statusPaths.indexOf(state.selectedPath);
      if (idx > 0) {
        statusPaths.splice(idx, 1);
        statusPaths.unshift(state.selectedPath);
      }
    }
    void refreshStatus(statusPaths);

    const hash = location.hash.replace('#', '');
    if (hash === 'changes') await switchTab('changes');
    if (hash === 'merge') {
      await loadChanges();
      const conflict = state.changes.find((file) => file.conflict) ?? null;
      if (conflict) await openMerge(conflict.path);
    }
    if (hash === 'branches') {
      await openBranchModal();
    }
  } catch (error) {
    report(error);
    const list = document.getElementById('repoList');
    if (list) {
      list.innerHTML = `<div class="repo-list-empty">${icon('x')}<div>启动失败：${esc(
        error instanceof Error ? error.message : String(error),
      )}</div></div>`;
    }
    await signalReady();
  }
}

// --- tabs & full-diff -----------------------------------------------------

async function switchTab(tab: Tab): Promise<void> {
  if (state.fullDiff) state.fullDiff = false;
  closePopover();
  state.tab = tab;
  state.blame = null;
  if (tab === 'changes') {
    await loadChanges();
  } else if (tab === 'console') {
    try {
      const result = await api.console();
      state.console = result.commands;
    } catch (error) {
      report(error);
    }
  } else if (tab === 'shelf') {
    await loadShelf();
  } else if (tab === 'log') {
    if (!state.commitFiles.length) await loadCommitFiles();
    if (state.selectedFile && !state.diff) await openCommitDiff(state.selectedFile);
  }
  render();
}

function openFullDiff(source: 'commit' | 'worktree'): void {
  const repo = selectedRepo();
  if (!repo) return;
  if (source === 'worktree') {
    if (!state.changes.length) {
      toast('当前工作区没有未提交的更改');
      return;
    }
    if (!state.selectedChangeKey) state.selectedChangeKey = changeKey(state.changes[0]);
    const file = state.changes.find((f) => changeKey(f) === state.selectedChangeKey);
    if (file && !state.changeDiff) void loadChangeDiff(file);
  } else {
    if (!state.commitFiles.length) {
      toast('当前提交没有可查看的变更');
      return;
    }
    if (!state.selectedFile) state.selectedFile = state.commitFiles[0];
    if (state.selectedFile && !state.diff) void openCommitDiff(state.selectedFile);
  }
  closePopover();
  state.fullDiff = true;
  state.fullDiffSource = source;
  renderFullDiffOnly();
}

function closeFullDiff(): void {
  if (!state.fullDiff) return;
  state.fullDiff = false;
  render();
}

async function stepDiffFile(delta: number): Promise<void> {
  const isWorktree = state.fullDiff ? state.fullDiffSource === 'worktree' : state.tab === 'changes';
  if (isWorktree) {
    if (!state.changes.length) return;
    let idx = state.changes.findIndex((f) => changeKey(f) === state.selectedChangeKey);
    if (idx < 0) idx = 0;
    idx = (idx + delta + state.changes.length) % state.changes.length;
    const next = state.changes[idx];
    if (!next) return;
    state.selectedChangeKey = changeKey(next);
    await loadChangeDiff(next);
  } else {
    if (!state.commitFiles.length) return;
    let idx = state.selectedFile ? state.commitFiles.findIndex((f) => f.path === state.selectedFile?.path) : 0;
    if (idx < 0) idx = 0;
    idx = (idx + delta + state.commitFiles.length) % state.commitFiles.length;
    const next = state.commitFiles[idx];
    if (!next) return;
    await openCommitDiff(next);
  }
}

// --- daily branch & remote operations -------------------------------------

async function runBranchFetch(): Promise<void> {
  const repo = selectedRepo();
  if (!repo || state.remoteBusy) return;
  state.remoteBusy = 'fetch';
  if (state.branchModal) state.branchModal.busy = true;
  renderTopBarState();
  renderModal();
  try {
    await api.branchFetch(repo.path);
    toast(`Fetch 完成 · ${repo.name}`, 'success');
    await refreshStatus([repo.path]);
    if (state.branchModal) {
      const res = await api.logRefs(repo.path);
      state.branchModal.refs = res.refs;
    }
    await loadLog();
    render();
  } catch (error) {
    report(error);
  } finally {
    state.remoteBusy = null;
    if (state.branchModal) state.branchModal.busy = false;
    renderTopBarState();
    renderModal();
  }
}

async function runBranchPull(rebase = false): Promise<void> {
  const repo = selectedRepo();
  if (!repo || state.remoteBusy) return;
  state.remoteBusy = 'pull';
  if (state.branchModal) state.branchModal.busy = true;
  renderTopBarState();
  renderModal();
  try {
    const res = await api.branchPull(repo.path, rebase);
    if (res.conflict) {
      toast('Pull 遇到合并冲突，请在 Changes 中解决', 'error');
      closeModal();
      await refreshAfterWrite(true);
      await switchTab('changes');
    } else {
      toast(rebase ? 'Pull --rebase 完成' : 'Pull 完成', 'success');
      if (state.branchModal) {
        const refs = await api.logRefs(repo.path);
        state.branchModal.refs = refs.refs;
      }
      await refreshAfterWrite(true);
    }
  } catch (error) {
    report(error);
  } finally {
    state.remoteBusy = null;
    if (state.branchModal) state.branchModal.busy = false;
    renderTopBarState();
    renderModal();
  }
}

async function openBranchModal(): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  closePopover();
  state.branchModal = { refs: [], busy: true, filter: '' };
  state.modal = { kind: 'branch' };
  renderModal();
  try {
    const res = await api.logRefs(repo.path);
    if (!state.branchModal) return;
    state.branchModal.refs = res.refs;
    state.branchModal.busy = false;
    renderModal();
  } catch (error) {
    closeModal();
    report(error);
  }
}

async function createBranchFromModal(): Promise<void> {
  const repo = selectedRepo();
  if (!repo || !state.branchModal) return;
  const nameEl = document.getElementById('bmNewName') as HTMLInputElement | null;
  const startEl = document.getElementById('bmNewStart') as HTMLInputElement | null;
  const coEl = document.getElementById('bmNewCheckout') as HTMLInputElement | null;
  const name = nameEl?.value.trim() ?? '';
  if (!name) {
    toast('请输入新分支名', 'error');
    nameEl?.focus();
    return;
  }
  const startPoint = startEl?.value.trim() || 'HEAD';
  const checkout = coEl ? coEl.checked : true;
  state.branchModal.busy = true;
  renderModal();
  try {
    await api.branchCreate(repo.path, name, startPoint, checkout);
    toast(checkout ? `已新建并切换到 ${name}` : `已新建分支 ${name}`, 'success');
    const refs = await api.logRefs(repo.path);
    if (state.branchModal) {
      state.branchModal.refs = refs.refs;
      state.branchModal.busy = false;
    }
    await refreshAfterWrite(true);
    renderModal();
  } catch (error) {
    if (state.branchModal) state.branchModal.busy = false;
    renderModal();
    report(error);
  }
}

async function checkoutBranchTarget(target: string): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  if (state.branchModal) {
    state.branchModal.busy = true;
    renderModal();
  }
  try {
    await api.branchCheckout(repo.path, target);
    toast(`已切换到分支 ${target}`, 'success');
    closeModal();
    await refreshAfterWrite(true);
  } catch (error) {
    if (state.branchModal) {
      state.branchModal.busy = false;
      renderModal();
    }
    report(error);
  }
}

async function mergeBranchTarget(target: string): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  if (state.branchModal) {
    state.branchModal.busy = true;
    renderModal();
  }
  try {
    const res = await api.branchMerge(repo.path, target);
    closeModal();
    if (res.conflict) {
      toast(`合并 ${target} 遇到冲突，请在 Changes 中解决`, 'error');
      await refreshAfterWrite(true);
      await switchTab('changes');
    } else {
      toast(`已合并 ${target} 到 ${repo.branch ?? 'HEAD'}`, 'success');
      await refreshAfterWrite(true);
    }
  } catch (error) {
    if (state.branchModal) {
      state.branchModal.busy = false;
      renderModal();
    }
    report(error);
  }
}

async function deleteBranchTarget(name: string): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  const ok = await askConfirm('删除本地分支', `确定删除本地分支 ${name}？`, true);
  if (!ok) {
    await openBranchModal();
    return;
  }
  try {
    await api.branchDelete(repo.path, name, false);
    toast(`已删除分支 ${name}`, 'success');
    await openBranchModal();
    await refreshAfterWrite(true);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('not fully merged') || msg.includes('未完全合并')) {
      const force = await askConfirm(
        '强制删除未合并分支',
        `分支 ${name} 尚未完全合并到当前分支。\n确定使用 git branch -D 强制删除吗？`,
        true,
      );
      if (force) {
        try {
          await api.branchDelete(repo.path, name, true);
          toast(`已强制删除分支 ${name}`, 'success');
          await openBranchModal();
          await refreshAfterWrite(true);
          return;
        } catch (err2) {
          report(err2);
        }
      }
      await openBranchModal();
      return;
    }
    report(error);
    await openBranchModal();
  }
}

async function runMergeAbort(): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  const ok = await askConfirm('中止合并', '确定执行 git merge --abort，取消当前合并并还原工作区？', true);
  if (!ok) return;
  try {
    await api.branchMergeAbort(repo.path);
    toast('已中止合并', 'success');
    await refreshAfterWrite(true);
  } catch (error) {
    report(error);
  }
}

// --- staging, discard, commit, shelf --------------------------------------

async function loadShelf(): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  try {
    state.shelf = await api.shelfList(repo.path);
  } catch (error) {
    report(error);
  }
}

async function stageFilesBatch(paths: string[], staged: boolean): Promise<void> {
  const repo = selectedRepo();
  if (!repo || !paths.length) return;
  try {
    await api.stageFiles(repo.path, paths, staged);
    await refreshAfterWrite(false);
  } catch (error) {
    report(error);
  }
}

async function stageHunkAt(index: number): Promise<void> {
  const repo = selectedRepo();
  const file = state.changes.find((item) => changeKey(item) === state.selectedChangeKey);
  if (!repo || !file || !state.changeDiff) return;
  const hunk = state.changeDiff.hunks[index];
  if (!hunk) return;
  if (file.status === 'R' || file.status === 'C') {
    toast('重命名/复制的文件请用整文件暂存');
    return;
  }
  const patch = buildHunkPatch(file, hunk);
  try {
    await api.stageHunk(repo.path, patch, file.group === 'staged');
    toast(file.group === 'staged' ? '已撤销暂存该块' : '已暂存该代码块', 'success');
    await refreshAfterWrite(false);
  } catch (error) {
    report(error);
  }
}

function openDiscardModal(): void {
  const staged = stagedFiles(state.changes);
  const selected = state.changes.find((f) => changeKey(f) === state.selectedChangeKey);
  const targets = staged.length ? staged : selected ? [selected] : [];
  if (!targets.length) {
    toast('先勾选或选中要放弃的文件');
    return;
  }
  state.modal = { kind: 'discard', data: { targets } };
  renderModal();
}

async function confirmDiscard(): Promise<void> {
  const repo = selectedRepo();
  if (!repo || state.modal?.kind !== 'discard') return;
  const paths = Array.from(new Set(state.modal.data.targets.map((f) => f.path)));
  closeModal();
  try {
    await api.discard(repo.path, paths);
    toast(`已放弃 ${paths.length} 个文件的更改（快照已保存）`, 'success');
    await refreshAfterWrite(false);
  } catch (error) {
    report(error);
  }
}

async function submitCommit(push: boolean): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  if (!state.msg.trim()) {
    toast('提交信息不能为空', 'error');
    return;
  }
  const stagedCount = stagedFiles(state.changes).length;
  if (!stagedCount && !state.amend) {
    toast('没有已暂存的文件（请先勾选左侧文件）', 'error');
    return;
  }
  if (state.amend && repo.ahead === 0) {
    const ok = await askConfirm(
      '修改已推送的提交',
      '当前提交看起来已经推送到远端；Amend 后需要 --force-with-lease 才能推送。确定继续？',
      true,
    );
    if (!ok) return;
  }
  state.busy = '提交中…';
  render();
  try {
    const result = await api.commit(repo.path, state.msg, state.amend, push);
    clearDraft(repo.id);
    pushMessageHistory(state.msg.trim());
    state.draft = null;
    state.msg = '';
    state.amend = false;
    toast(
      result.pushError ? `已提交，但推送失败：${result.pushError}` : `已提交 ${result.hash.slice(0, 7)}`,
      result.pushError ? 'error' : 'success',
    );
    await refreshAfterWrite(true);
  } catch (error) {
    report(error);
    toast('提交失败，草稿已保留', 'error');
  } finally {
    state.busy = null;
    render();
  }
}

// --- three-pane merge (with editable Result) ------------------------------

async function openMerge(filePath: string): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  try {
    const mergeState = await api.mergeState(repo.path, filePath);
    if (mergeState.binary) {
      toast('二进制冲突需要在外部工具中解决', 'error');
      return;
    }
    const segments = parseMergeLines(mergeState.lines);
    const total = blockCount(segments);
    if (total === 0) {
      toast('该冲突没有可解析的文本块，请用外部工具解决');
      return;
    }
    const choices: MergeChoice[] = segments.map(() => null);
    state.merge = {
      file: filePath,
      state: mergeState,
      segments,
      choices,
      active: total ? 0 : -1,
      editMode: false,
      customText: null,
    };
    state.modal = { kind: 'merge' };
    renderModal();
  } catch (error) {
    report(error);
  }
}

function toggleMergeEditMode(): void {
  const merge = state.merge;
  if (!merge) return;
  if (!merge.editMode) {
    if (merge.customText === null) {
      merge.customText = resolvedContent(merge.segments, merge.choices, true);
    }
    merge.editMode = true;
    renderModal();
    const editor = document.getElementById('mergeEditor') as HTMLTextAreaElement | null;
    editor?.focus();
  } else {
    merge.editMode = false;
    renderModal();
  }
}

function resetMergeEditorText(): void {
  const merge = state.merge;
  if (!merge) return;
  merge.customText = resolvedContent(merge.segments, merge.choices, true);
  renderModal();
  const editor = document.getElementById('mergeEditor') as HTMLTextAreaElement | null;
  editor?.focus();
}

function autoResolveMerge(): void {
  const merge = state.merge;
  if (!merge) return;
  let solved = 0;
  merge.segments.forEach((segment, index) => {
    if (segment.kind !== 'block' || !segment.block || merge.choices[index]) return;
    const choice = autoChoice(segment.block);
    if (choice) {
      merge.choices[index] = choice;
      solved += 1;
    }
  });
  merge.customText = null;
  renderModal();
  toast(solved ? `自动解决了 ${solved} 处简单冲突` : '没有可自动解决的简单冲突');
}

function acceptMergeBlock(blockIndex: number, choice: MergeChoice): void {
  const merge = state.merge;
  if (!merge) return;
  let seen = 0;
  for (let i = 0; i < merge.segments.length; i += 1) {
    if (merge.segments[i].kind !== 'block') continue;
    if (seen === blockIndex) {
      merge.choices[i] = choice;
      merge.active = blockIndex;
      merge.customText = null;
      break;
    }
    seen += 1;
  }
  renderModal();
}

function stepMergeBlock(delta: number): void {
  const merge = state.merge;
  if (!merge) return;
  const total = blockCount(merge.segments);
  if (!total) return;
  merge.active = (merge.active + delta + total) % total;
  renderModal();
  document.querySelector(`[data-block-anchor="${merge.active}"]`)?.scrollIntoView({ block: 'center' });
}

async function applyMerge(): Promise<void> {
  const repo = selectedRepo();
  const merge = state.merge;
  if (!repo || !merge) return;
  let content: string;
  if (merge.editMode) {
    const editor = document.getElementById('mergeEditor') as HTMLTextAreaElement | null;
    content = editor ? editor.value : (merge.customText ?? '');
    if (hasConflictMarkers(content)) {
      toast('编辑结果里仍包含冲突标记（<<<<<<< / ======= / >>>>>>>），请先清理', 'error');
      return;
    }
  } else {
    if (unresolvedCount(merge.segments, merge.choices) > 0) {
      toast('还有未解决的冲突块（或点「编辑结果」手工编辑）', 'error');
      return;
    }
    content = resolvedContent(merge.segments, merge.choices, true);
  }
  try {
    await api.mergeResolve(repo.path, merge.file, content);
    toast(`已解决并暂存：${merge.file}`, 'success');
    closeModal();
    await refreshAfterWrite(false);
  } catch (error) {
    report(error);
  }
}

// --- rebase -i, worktree, blame -------------------------------------------

async function refreshRebaseState(): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  try {
    state.rebaseState = await api.rebaseState(repo.path);
    if (state.tab === 'log') {
      const commits = visibleCommitList();
      $('#logBanner').innerHTML = renderLogBanner(currentLogFilter(commits));
    }
  } catch {
    state.rebaseState = null;
  }
}

async function openRebaseModal(): Promise<void> {
  const repo = selectedRepo();
  const commit = currentCommit();
  if (!repo || !commit) {
    toast('先选择一个作为变基基点的提交');
    return;
  }
  try {
    const plan = await api.rebasePlan(repo.path, commit.hash);
    if (!plan.commits.length) {
      toast('当前选中的提交就是 HEAD，请选择更早的提交作为基点');
      return;
    }
    state.rebase = { onto: plan.onto, items: plan.commits, busy: false };
    state.modal = { kind: 'rebase' };
    renderModal();
  } catch (error) {
    report(error);
  }
}

let rebaseDragFrom = -1;
function bindRebaseDrag(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('.rb-row').forEach((row) => {
    row.addEventListener('dragstart', () => {
      rebaseDragFrom = Number(row.dataset.rbIdx ?? -1);
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const to = Number(row.dataset.rbIdx ?? -1);
      if (state.rebase && rebaseDragFrom >= 0 && to >= 0 && rebaseDragFrom !== to) {
        const [moved] = state.rebase.items.splice(rebaseDragFrom, 1);
        if (moved) state.rebase.items.splice(to, 0, moved);
        renderModal();
      }
      rebaseDragFrom = -1;
    });
  });
}

async function runRebaseStart(): Promise<void> {
  const repo = selectedRepo();
  if (!repo || !state.rebase) return;
  state.rebase.busy = true;
  renderModal();
  try {
    const res = await api.rebaseStart(repo.path, state.rebase.onto, state.rebase.items);
    state.rebaseState = res.state;
    closeModal();
    if (res.conflict) {
      toast('变基遇到冲突：请在 Changes 解决冲突后点「继续」', 'error');
      await switchTab('changes');
    } else {
      toast('交互式变基已完成', 'success');
      await refreshAfterWrite(true);
    }
  } catch (error) {
    if (state.rebase) state.rebase.busy = false;
    renderModal();
    report(error);
  }
}

async function runRebaseOp(op: 'continue' | 'abort' | 'skip'): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  try {
    const res = await api.rebaseAction(repo.path, op);
    state.rebaseState = res.state;
    if (res.conflict) {
      toast('仍有冲突待解决', 'error');
      await switchTab('changes');
    } else {
      toast(op === 'abort' ? '已中止变基' : op === 'skip' ? '已跳过当前提交' : '变基已完成', 'success');
      await refreshAfterWrite(true);
    }
  } catch (error) {
    report(error);
  }
}

async function openWorktreeModal(): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  closePopover();
  state.worktree = { items: [], busy: true };
  state.modal = { kind: 'worktree' };
  renderModal();
  try {
    const res = await api.worktreeList(repo.path);
    if (!state.worktree) return;
    state.worktree = { items: res.worktrees, busy: false };
    renderModal();
  } catch (error) {
    closeModal();
    report(error);
  }
}

async function createWorktreeFromForm(): Promise<void> {
  const repo = selectedRepo();
  if (!repo || !state.worktree) return;
  const branchInput = document.getElementById('wtBranch') as HTMLInputElement | null;
  const startInput = document.getElementById('wtStart') as HTMLInputElement | null;
  const dirInput = document.getElementById('wtDir') as HTMLInputElement | null;
  const branch = branchInput?.value.trim() ?? '';
  if (!branch) {
    toast('请输入新分支名', 'error');
    return;
  }
  const startPoint = startInput?.value.trim() || 'HEAD';
  const dir = dirInput?.value.trim() || '';
  state.worktree.busy = true;
  renderModal();
  try {
    const res = await api.worktreeAdd(repo.path, branch, startPoint, dir);
    toast(`已创建 worktree（${res.handId}）：${res.path}`, 'success');
    const list = await api.worktreeList(repo.path);
    if (state.worktree) state.worktree = { items: list.worktrees, busy: false };
    renderModal();
  } catch (error) {
    if (state.worktree) state.worktree.busy = false;
    renderModal();
    report(error);
  }
}

async function openBlameFor(filePath: string, rev = ''): Promise<void> {
  const repo = selectedRepo();
  if (!repo || !filePath) return;
  state.blame = { path: filePath, rev, lines: [], nextLine: 1, hasMore: false, loading: true, ms: 0 };
  if (state.fullDiff) renderFullDiffOnly();
  else if (state.tab === 'changes') renderChangesArea();
  else renderDetailsArea();

  try {
    const res = await api.blame(repo.path, filePath, rev, 1, 2000);
    if (!state.blame || state.blame.path !== filePath) return;
    state.blame = {
      path: filePath,
      rev,
      lines: res.lines,
      nextLine: res.nextLine,
      hasMore: res.hasMore,
      loading: false,
      ms: res.ms,
    };
  } catch (error) {
    state.blame = null;
    report(error);
  }
  if (state.fullDiff) renderFullDiffOnly();
  else if (state.tab === 'changes') renderChangesArea();
  else renderDetailsArea();
}

async function loadMoreBlame(): Promise<void> {
  const repo = selectedRepo();
  const b = state.blame;
  if (!repo || !b || !b.hasMore || b.loading) return;
  b.loading = true;
  try {
    const res = await api.blame(repo.path, b.path, b.rev, b.nextLine, 2000);
    if (state.blame !== b) return;
    b.lines = [...b.lines, ...res.lines];
    b.nextLine = res.nextLine;
    b.hasMore = res.hasMore;
    b.ms += res.ms;
  } catch (error) {
    report(error);
  } finally {
    b.loading = false;
    if (state.fullDiff) renderFullDiffOnly();
    else if (state.tab === 'changes') renderChangesArea();
    else renderDetailsArea();
  }
}

// --- agent & terminal -----------------------------------------------------

function pushAgentLine(cls: AgentLine['cls'], text: string, applyCommit?: string): void {
  state.agentLines.push({ cls, text, applyCommit });
  if (state.agentLines.length > 400) state.agentLines.splice(0, state.agentLines.length - 400);
  renderTerminalOnly();
}

async function stopAgent(): Promise<void> {
  const active = [state.agentSession, state.termSession].filter(Boolean) as string[];
  state.agentSession = null;
  state.termSession = null;
  state.agentRunning = false;
  state.agentBusy = false;
  state.agentQueuedPos = 0;
  state.agentOneShot = null;
  for (const id of active) {
    await api.agentStop(id).catch(() => undefined);
  }
}

async function startAgentSession(
  opts: { mode?: Mode; oneShot?: 'commit'; rev?: string } = {},
): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  if (opts.mode) state.mode = opts.mode;
  if (state.termTab === 'term') state.termTab = 'pi';
  state.termOpen = true;
  await stopAgent();

  const rev = opts.rev ?? currentCommit()?.hash ?? 'HEAD';
  const enabledSkills = Object.keys(state.skills).filter((key) => state.skills[key]);
  const sessionId = `ag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const agentId = state.termTab === 'codex' ? 'codex' : state.config?.defaultAgent ?? 'pi';

  state.agentSession = sessionId;
  state.agentRunning = true;
  state.agentBusy = true;
  state.agentOneShot = opts.oneShot ?? null;
  state.agentOutputRaw = '';
  state.agentDirtyBefore = dirtyTotal(repo);
  state.msgAtAgentStart = state.msg;
  state.agentDirtyRecovery = null;

  pushAgentLine('p', agentPromptLine(repo.name, state.mode, state.skills, rev.slice(0, 7)));
  renderTerminalOnly();

  void api
    .agentStart({
      path: repo.path,
      sessionId,
      mode: state.mode,
      skills: enabledSkills,
      rev,
      agent: agentId,
    })
    .catch((error) => {
      if (state.agentSession === sessionId) {
        state.agentRunning = false;
        state.agentBusy = false;
        state.agentSession = null;
        state.agentOneShot = null;
        pushAgentLine('err', `启动失败：${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

async function startShellSession(): Promise<void> {
  const repo = selectedRepo();
  if (!repo) return;
  if (state.termSession) return;
  const sessionId = `sh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  state.termSession = sessionId;
  state.termOpen = true;
  pushAgentLine('dim', `启动终端 · ${shortPath(repo.path)}`);
  renderTerminalOnly(true);

  void api
    .agentStart({
      path: repo.path,
      sessionId,
      mode: 'term',
      skills: [],
    })
    .catch((error) => {
      if (state.termSession === sessionId) {
        state.termSession = null;
        pushAgentLine('err', `终端启动失败：${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

async function sendTerminalInput(): Promise<void> {
  const input = document.getElementById('termInput') as HTMLInputElement | null;
  if (!input) return;
  const text = input.value;
  if (!text.trim()) return;
  input.value = '';

  if (state.termTab === 'term') {
    pushAgentLine('p', text);
    if (!state.termSession) {
      state.pendingWrites.push(`${text}\n`);
      await startShellSession();
      return;
    }
    await api.agentWrite(state.termSession, `${text}\n`).catch(report);
    return;
  }

  pushAgentLine('p', text);
  if (!state.agentSession) {
    state.pendingWrites.push(`${text}\n`);
    await startAgentSession({ mode: state.mode });
    return;
  }
  await api.agentWrite(state.agentSession, `${text}\n`).catch(report);
}

// --- host events ----------------------------------------------------------

function installHostEvents(): void {
  installEventBridge();

  // Drain worker-thread events (git:command, agent:*) on the UI thread without
  // cross-thread GC sharing in Nim refc. Fast while agent/terminal runs, gentle otherwise.
  let pollBusy = false;
  window.setInterval(() => {
    if (pollBusy) return;
    if (!state.agentRunning && !state.termSession && state.tab !== 'console') return;
    pollBusy = true;
    void api.pollEvents().finally(() => {
      pollBusy = false;
    });
  }, 150);

  onEvent('repo:changed', (raw) => {
    const ev = raw as RepoChangedEvent;
    if (!ev?.path) return;
    const prev = watchRefreshed.get(ev.path) ?? 0;
    if (Date.now() - prev < 500) return;
    watchRefreshed.set(ev.path, Date.now());
    void refreshStatus([ev.path]);
    if (ev.path === state.selectedPath) {
      void loadChanges().then(() => {
        if (state.tab === 'changes') renderChangesArea();
        else if (state.tab === 'log') {
          renderLogArea();
          renderViewBar();
        }
      });
    }
  });

  onEvent('git:command', (raw) => {
    const ev = raw as GitCommandEvent;
    if (!ev?.cmd) return;
    state.console.push(ev);
    if (state.console.length > 500) state.console.splice(0, state.console.length - 500);
    renderConsoleOnly();
  });

  onEvent('agent:queued', (raw) => {
    const ev = raw as AgentQueuedEvent;
    if (ev.sessionId !== state.agentSession) return;
    state.agentQueuedPos = ev.position;
    pushAgentLine('dim', `并发槽位已满，排队中 #${ev.position}…`);
  });

  onEvent('agent:started', (raw) => {
    const ev = raw as AgentStartedEvent;
    if (ev.sessionId === state.agentSession) {
      state.agentQueuedPos = 0;
      pushAgentLine('ok', `✓ 会话已启动 · ${ev.command}`);
    }
    if ((ev.sessionId === state.termSession || ev.sessionId === state.agentSession) && state.pendingWrites.length) {
      const queued = state.pendingWrites.splice(0);
      for (const chunk of queued) {
        void api.agentWrite(ev.sessionId, chunk).catch(() => undefined);
      }
    }
  });

  onEvent('agent:output', (raw) => {
    const ev = raw as AgentOutputEvent;
    if (ev.sessionId !== state.agentSession && ev.sessionId !== state.termSession) return;
    const clean = stripAnsi(ev.chunk ?? '');
    if (!clean) return;
    if (ev.sessionId === state.agentSession) {
      state.agentOutputRaw += clean;
      const lines = clean.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
      for (const line of lines) {
        pushAgentLine(ev.stream === 'err' ? 'err' : 'ai', line);
      }
    } else {
      pushAgentLine(ev.stream === 'err' ? 'err' : '', clean.replace(/\n$/, ''));
    }
  });

  onEvent('agent:exit', (raw) => {
    const ev = raw as AgentExitEvent;
    if (ev.sessionId === state.termSession) {
      state.termSession = null;
      pushAgentLine('dim', `终端已退出（code ${ev.code}）`);
      return;
    }
    if (ev.sessionId !== state.agentSession) return;
    const oneShot = state.agentOneShot;
    const fullOut = (ev.output || state.agentOutputRaw).trim();
    state.agentSession = null;
    state.agentRunning = false;
    state.agentBusy = false;
    state.agentQueuedPos = 0;
    state.agentOneShot = null;

    if (ev.error) {
      pushAgentLine('err', ev.error);
    } else if (oneShot === 'commit' && fullOut) {
      const repo = selectedRepo();
      if (repo && state.msg === state.msgAtAgentStart) {
        state.msg = fullOut;
        const ts = Date.now();
        state.draft = { text: fullOut, ts };
        saveDraft(repo.id, fullOut);
        toast('已根据暂存 diff 生成提交信息', 'success');
      }
      pushAgentLine('ok', '已生成提交信息，可一键填入提交框：', fullOut);
      if (state.tab === 'changes') renderChangesArea();
    } else {
      pushAgentLine(ev.code === 0 ? 'dim' : 'warn', `会话结束（退出码 ${ev.code}）`);
    }

    // Read-only mode dirty worktree guardrail
    const repo = selectedRepo();
    if (repo && state.mode === 'read' && ev.snapshotSha) {
      void api.status([repo.path]).then((res) => {
        const updated = res.repos[0];
        if (updated) {
          updateRepo(updated);
          if (dirtyTotal(updated) > state.agentDirtyBefore) {
            state.agentDirtyRecovery = {
              path: repo.path,
              snapshotSha: ev.snapshotSha ?? '',
              preUntracked: ev.preUntracked ?? [],
            };
            pushAgentLine('warn', '⚠ 只读会话期间工作区被修改，可点「恢复到打开前」还原');
          }
          renderSidebarOnly();
          renderTerminalOnly();
        }
      });
    } else {
      renderTerminalOnly();
    }
  });
}

// --- event delegation -----------------------------------------------------

function openFilterPopover(kind: string, anchor: HTMLElement): void {
  const repo = selectedRepo();
  if (!repo) return;
  if (kind === 'branch') {
    showPopover(anchor, 'pop-branch', renderBranchFilterPopover(repo, state.branchAll), 290, 'left');
  } else if (kind === 'author') {
    const authors = Array.from(new Set(state.commits.map((c) => c.author.name))).sort();
    showPopover(anchor, 'pop-author', renderAuthorFilterPopover(repo, authors, state.authorFilter), 260, 'left');
  } else if (kind === 'time') {
    showPopover(anchor, 'pop-time', renderTimeFilterPopover(repo, state.timeFilter), 260, 'left');
  } else if (kind === 'path') {
    showPopover(
      anchor,
      'pop-path',
      renderPathFilterPopover(repo, state.fileFilter, state.changes, state.commitFiles),
      310,
      'left',
    );
  } else if (kind === 'history') {
    showPopover(anchor, 'pop-history', renderHistoryPopover(messageHistory()), 320, 'right');
  } else if (kind === 'skills') {
    showPopover(anchor, 'pop-skills', renderSkillsPopover(state.config, state.skills), 310, 'right');
  }
}

function bindEvents(): void {
  // Log scroll virtualization & infinite cursor pagination
  let logScrollRaf = 0;
  const commitList = $('#commitList');
  commitList.addEventListener('scroll', () => {
    state.logScrollTop = commitList.scrollTop;
    if (
      state.logHasMore &&
      !state.logLoadingMore &&
      !state.filterQuery &&
      !state.authorFilter &&
      state.timeFilter === 'all' &&
      commitList.scrollHeight - commitList.scrollTop - commitList.clientHeight < 140
    ) {
      void loadMoreLog();
    }
    if (visibleCommitList().length > 120 && !logScrollRaf) {
      logScrollRaf = window.requestAnimationFrame(() => {
        logScrollRaf = 0;
        refreshLogRowsOnly();
      });
    }
  });

  // Search inputs & form inputs
  document.addEventListener('input', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (target.id === 'repoSearch') {
      state.query = (target as HTMLInputElement).value;
      renderSidebarOnly();
      return;
    }
    if (target.id === 'commitSearch') {
      state.filterQuery = (target as HTMLInputElement).value;
      state.commitIndex = 0;
      renderLogArea();
      return;
    }
    if (target.id === 'msgBox') {
      const repo = selectedRepo();
      state.msg = (target as HTMLTextAreaElement).value;
      if (repo) {
        if (state.msg.trim()) {
          saveDraft(repo.id, state.msg);
          state.draft = { text: state.msg, ts: Date.now() };
        } else {
          clearDraft(repo.id);
          state.draft = null;
        }
      }
      const firstLine = state.msg.split('\n')[0] ?? '';
      const charCount = document.getElementById('charCount');
      if (charCount) {
        charCount.textContent = state.msg.trim() ? `首行 ${firstLine.length} / 72` : '';
        charCount.classList.toggle('warn', firstLine.length > 72);
      }
      const canCommit =
        Boolean(state.msg.trim()) && (stagedFiles(state.changes).length > 0 || state.amend) && state.busy !== '提交中…';
      document.querySelectorAll<HTMLButtonElement>('[data-commit]').forEach((btn) => {
        btn.disabled = !canCommit;
      });
      return;
    }
    if (target.id === 'mergeEditor' && state.merge) {
      state.merge.customText = (target as HTMLTextAreaElement).value;
      const badge = document.getElementById('confCount');
      if (badge) {
        const hasMark = hasConflictMarkers(state.merge.customText);
        badge.className = `mbadge ${hasMark ? 'warn' : 'ok'}`;
        badge.textContent = hasMark ? '包含未清理的冲突标记' : '自由编辑模式 · 可直接应用';
      }
      return;
    }
    if (target.id === 'bmSearch' && state.branchModal) {
      const input = target as HTMLInputElement;
      const pos = input.selectionStart ?? input.value.length;
      state.branchModal.filter = input.value;
      renderModal();
      const next = document.getElementById('bmSearch') as HTMLInputElement | null;
      if (next) {
        next.focus({ preventScroll: true });
        next.setSelectionRange(pos, pos);
      }
      return;
    }
    const rbMsg = target.closest<HTMLInputElement>('[data-rb-msg]');
    if (rbMsg && state.rebase) {
      const idx = Number(rbMsg.dataset.rbMsg ?? -1);
      if (state.rebase.items[idx]) state.rebase.items[idx].message = rbMsg.value;
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (target.id === 'amend') {
      state.amend = (target as HTMLInputElement).checked;
      if (state.amend && !state.msg.trim() && state.commits[0]) {
        state.msg = state.commits[0].subject + (state.commits[0].body ? `\n\n${state.commits[0].body}` : '');
      }
      renderChangesArea();
      return;
    }
    const check = target.closest<HTMLInputElement>('[data-check]');
    if (check) {
      const key = check.dataset.check ?? '';
      const file = state.changes.find((f) => changeKey(f) === key);
      if (file) void stageFilesBatch([file.path], check.checked);
      return;
    }
    if (target.id === 'selectAllChanges') {
      const checked = (target as HTMLInputElement).checked;
      const paths = Array.from(
        new Set(state.changes.filter((f) => (checked ? f.group === 'unstaged' : f.group === 'staged')).map((f) => f.path)),
      );
      if (paths.length) void stageFilesBatch(paths, checked);
      return;
    }
    const rbAct = target.closest<HTMLSelectElement>('[data-rb-action]');
    if (rbAct && state.rebase) {
      const idx = Number(rbAct.dataset.rbAction ?? -1);
      if (state.rebase.items[idx]) {
        state.rebase.items[idx].action = rbAct.value as RebaseAction;
        renderModal();
      }
    }
  });

  // Double-click file row opens full-page diff
  document.addEventListener('dblclick', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const commitRow = target.closest<HTMLElement>('.file-row[data-file-index]');
    if (commitRow) {
      const idx = Number(commitRow.dataset.fileIndex ?? -1);
      const file = state.commitFiles[idx];
      if (file) {
        void openCommitDiff(file).then(() => openFullDiff('commit'));
      }
      return;
    }
    const treeFile = target.closest<HTMLElement>('.tree-file[data-cfile]');
    if (treeFile && !target.closest('input,label,button')) {
      const key = treeFile.dataset.cfile ?? '';
      const file = state.changes.find((f) => changeKey(f) === key);
      if (file) {
        state.selectedChangeKey = key;
        void loadChangeDiff(file).then(() => openFullDiff('worktree'));
      }
    }
  });

  // Main click delegation
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    // Close popover if click outside popover & trigger
    if (state.popover && !target.closest('.popover') && !target.closest('[data-popover-trigger]')) {
      closePopover();
    }

    // Modal backdrop / close buttons
    if (target.dataset.modalBackdrop === '1' || target.closest('[data-modal-close]')) {
      closeModal();
      return;
    }
    if (target.closest('#confirmCancel')) {
      answerConfirm(false);
      return;
    }
    if (target.closest('#confirmOk')) {
      answerConfirm(true);
      return;
    }
    if (target.closest('#confirmDiscardBtn')) {
      void confirmDiscard();
      return;
    }

    // Root modal
    if (target.closest('#applyRootBtn')) {
      const rootInput = document.getElementById('rootInput') as HTMLInputElement | null;
      const newRoot = rootInput?.value.trim();
      closeModal();
      if (newRoot && state.host && newRoot !== state.host.root) {
        void api
          .setRoot(newRoot)
          .then((res) => {
            if (state.host) state.host.root = res.root;
            return rescan();
          })
          .catch(report);
      } else {
        void rescan();
      }
      return;
    }
    const globBtn = target.closest<HTMLElement>('[data-toggle-glob]');
    if (globBtn && state.host) {
      const glob = globBtn.dataset.toggleGlob ?? '';
      const set = new Set(state.host.excludeGlobs);
      if (set.has(glob)) set.delete(glob);
      else set.add(glob);
      state.host.excludeGlobs = Array.from(set);
      void api.setExclusions(state.host.excludeGlobs, state.excluded).catch(report);
      renderModal();
      return;
    }

    // Merge modal
    if (target.closest('#mergeClose')) {
      closeModal();
      return;
    }
    if (target.closest('#mergeApply')) {
      void applyMerge();
      return;
    }
    if (target.closest('#autoResolve')) {
      autoResolveMerge();
      return;
    }
    if (target.closest('#mergeToggleEdit')) {
      toggleMergeEditMode();
      return;
    }
    if (target.closest('#mergeResetText')) {
      resetMergeEditorText();
      return;
    }
    const mergeNav = target.closest<HTMLElement>('[data-merge-nav]');
    if (mergeNav) {
      stepMergeBlock(Number(mergeNav.dataset.mergeNav ?? 0));
      return;
    }
    const acceptBtn = target.closest<HTMLElement>('[data-accept]');
    if (acceptBtn) {
      acceptMergeBlock(Number(acceptBtn.dataset.block ?? 0), acceptBtn.dataset.accept as MergeChoice);
      return;
    }

    // Branch modal
    const bmOp = target.closest<HTMLElement>('[data-bm-op]');
    if (bmOp) {
      const op = bmOp.dataset.bmOp;
      if (op === 'fetch') void runBranchFetch();
      else if (op === 'pull') void runBranchPull(false);
      else if (op === 'pull-rebase') void runBranchPull(true);
      return;
    }
    if (target.closest('#bmCreateBtn')) {
      void createBranchFromModal();
      return;
    }
    const bmCo = target.closest<HTMLElement>('[data-bm-checkout]');
    if (bmCo?.dataset.bmCheckout) {
      void checkoutBranchTarget(bmCo.dataset.bmCheckout);
      return;
    }
    const bmMerge = target.closest<HTMLElement>('[data-bm-merge]');
    if (bmMerge?.dataset.bmMerge) {
      void mergeBranchTarget(bmMerge.dataset.bmMerge);
      return;
    }
    const bmDel = target.closest<HTMLElement>('[data-bm-delete]');
    if (bmDel?.dataset.bmDelete) {
      void deleteBranchTarget(bmDel.dataset.bmDelete);
      return;
    }

    // Rebase modal
    if (target.closest('#rebaseClose')) {
      closeModal();
      return;
    }
    if (target.closest('#rebaseStart')) {
      void runRebaseStart();
      return;
    }
    const rbMove = target.closest<HTMLElement>('[data-rb-move]');
    if (rbMove && state.rebase) {
      const [idxStr, deltaStr] = (rbMove.dataset.rbMove ?? '').split(':');
      const idx = Number(idxStr);
      const next = idx + Number(deltaStr);
      if (next >= 0 && next < state.rebase.items.length) {
        const [item] = state.rebase.items.splice(idx, 1);
        if (item) state.rebase.items.splice(next, 0, item);
        renderModal();
      }
      return;
    }

    // Worktree modal
    if (target.closest('#wtClose')) {
      closeModal();
      return;
    }
    if (target.closest('#wtCreate')) {
      void createWorktreeFromForm();
      return;
    }
    if (target.closest('#wtPrune')) {
      const repo = selectedRepo();
      if (repo) {
        void api
          .worktreePrune(repo.path)
          .then(async () => {
            toast('已清理失效 worktree 引用', 'success');
            const list = await api.worktreeList(repo.path);
            if (state.worktree) state.worktree = { items: list.worktrees, busy: false };
            renderModal();
          })
          .catch(report);
      }
      return;
    }
    const wtOpen = target.closest<HTMLElement>('[data-wt-open]');
    if (wtOpen?.dataset.wtOpen) {
      void api.openFile(wtOpen.dataset.wtOpen, 0).catch(report);
      return;
    }
    const wtRemove = target.closest<HTMLElement>('[data-wt-remove]');
    if (wtRemove?.dataset.wtRemove) {
      const wtPath = wtRemove.dataset.wtRemove;
      const repo = selectedRepo();
      if (repo) {
        void askConfirm('移除 Worktree', `确定移除 worktree：\n${wtPath}？`, true).then(async (ok) => {
          if (!ok) {
            await openWorktreeModal();
            return;
          }
          try {
            await api.worktreeRemove(repo.path, wtPath);
            toast('已移除 worktree', 'success');
          } catch (error) {
            report(error);
          }
          await openWorktreeModal();
        });
      }
      return;
    }

    // Popover items
    const branchAllBtn = target.closest<HTMLElement>('[data-branchall]');
    if (branchAllBtn) {
      state.branchAll = branchAllBtn.dataset.branchall === '1';
      closePopover();
      state.commitIndex = 0;
      void loadLog().then(() => {
        const first = state.commitFiles[0];
        if (first) void openCommitDiff(first);
        render();
      });
      return;
    }
    const authorBtn = target.closest<HTMLElement>('[data-author]');
    if (authorBtn) {
      state.authorFilter = authorBtn.dataset.author ?? '';
      state.commitIndex = 0;
      closePopover();
      void loadCommitFiles().then(() => render());
      return;
    }
    const timeBtn = target.closest<HTMLElement>('[data-time]');
    if (timeBtn) {
      state.timeFilter = (timeBtn.dataset.time as AppState['timeFilter']) ?? 'all';
      state.commitIndex = 0;
      closePopover();
      void loadCommitFiles().then(() => render());
      return;
    }
    const fpBtn = target.closest<HTMLElement>('[data-filterpath]');
    if (fpBtn) {
      state.fileFilter = fpBtn.dataset.filterpath || null;
      state.commitIndex = 0;
      closePopover();
      void loadLog().then(() => {
        const first = state.commitFiles[0];
        if (first) void openCommitDiff(first);
        render();
      });
      return;
    }
    const useMsg = target.closest<HTMLElement>('[data-usemsg]');
    if (useMsg) {
      const repo = selectedRepo();
      state.msg = useMsg.dataset.usemsg ?? '';
      if (repo) {
        saveDraft(repo.id, state.msg);
        state.draft = { text: state.msg, ts: Date.now() };
      }
      closePopover();
      renderChangesArea();
      return;
    }
    const skillRow = target.closest<HTMLElement>('[data-skill]');
    if (skillRow) {
      const id = skillRow.dataset.skill ?? '';
      state.skills[id] = !state.skills[id];
      if (state.popover?.key === 'pop-skills') {
        const pop = document.querySelector('.popover');
        if (pop) pop.innerHTML = renderSkillsPopover(state.config, state.skills);
      }
      renderTerminalOnly();
      return;
    }
    const cmdBtn = target.closest<HTMLElement>('[data-cmd]');
    if (cmdBtn?.dataset.cmd) {
      const cmd = cmdBtn.dataset.cmd;
      closePopover();
      void runCommandAction(cmd);
      return;
    }

    // Popover triggers
    const popBtn = target.closest<HTMLElement>('[data-pop]');
    if (popBtn?.dataset.pop) {
      openFilterPopover(popBtn.dataset.pop, popBtn);
      return;
    }

    // Sidebar actions
    const excludeBtn = target.closest<HTMLElement>('[data-exclude]');
    if (excludeBtn?.dataset.exclude) {
      event.stopPropagation();
      const p = excludeBtn.dataset.exclude;
      if (!state.excluded.includes(p)) state.excluded.push(p);
      if (state.host) void api.setExclusions(state.host.excludeGlobs, state.excluded).catch(report);
      if (state.selectedPath === p) {
        const next = visibleRepos(state.repos, state.excluded, state.query)[0];
        if (next) void selectRepo(next.path);
        else {
          state.selectedPath = '';
          render();
        }
      } else {
        renderSidebarOnly();
      }
      return;
    }
    const restoreBtn = target.closest<HTMLElement>('[data-restore]');
    if (restoreBtn?.dataset.restore) {
      event.stopPropagation();
      const p = restoreBtn.dataset.restore;
      state.excluded = state.excluded.filter((x) => x !== p);
      if (state.host) void api.setExclusions(state.host.excludeGlobs, state.excluded).catch(report);
      renderSidebarOnly();
      if (state.modal?.kind === 'root') renderModal();
      return;
    }
    if (target.closest('[data-toggle-excluded]')) {
      state.excludedOpen = !state.excludedOpen;
      renderSidebarOnly();
      return;
    }
    const repoRow = target.closest<HTMLElement>('[data-repo]');
    if (repoRow?.dataset.repo) {
      void selectRepo(repoRow.dataset.repo);
      return;
    }

    // View tabs
    const viewTab = target.closest<HTMLElement>('[data-view]');
    if (viewTab?.dataset.view) {
      void switchTab(viewTab.dataset.view as Tab);
      return;
    }

    // Commit row selection
    const commitRow = target.closest<HTMLElement>('[data-commit]');
    if (commitRow) {
      const idx = Number(commitRow.dataset.commit ?? 0);
      state.commitIndex = idx;
      state.filesHash = '';
      state.selectedFile = null;
      state.diff = null;
      state.blame = null;
      renderLogArea();
      void loadCommitFiles().then(() => {
        const first = state.commitFiles[0];
        if (first) void openCommitDiff(first);
      });
      return;
    }

    // Details folder toggle & file selection
    const detailFolder = target.closest<HTMLElement>('[data-detail-folder]');
    if (detailFolder?.dataset.detailFolder) {
      const p = detailFolder.dataset.detailFolder;
      if (state.detailCollapsed.has(p)) state.detailCollapsed.delete(p);
      else state.detailCollapsed.add(p);
      renderDetailsArea();
      return;
    }
    const fileHistoryBtn = target.closest<HTMLElement>('[data-act="hist"][data-file]');
    if (fileHistoryBtn) {
      event.stopPropagation();
      const file = state.commitFiles[Number(fileHistoryBtn.dataset.file ?? -1)];
      if (file) {
        state.fileFilter = file.path;
        state.commitIndex = 0;
        void loadLog().then(() => {
          const first = state.commitFiles[0];
          if (first) void openCommitDiff(first);
          render();
        });
      }
      return;
    }
    const fileRow = target.closest<HTMLElement>('.file-row[data-file-index]');
    if (fileRow) {
      const file = state.commitFiles[Number(fileRow.dataset.fileIndex ?? -1)];
      if (file) void openCommitDiff(file);
      return;
    }

    // Changes tree folder toggle, merge button, file selection
    const treeFolder = target.closest<HTMLElement>('[data-tree-folder]');
    if (treeFolder?.dataset.treeFolder) {
      const p = treeFolder.dataset.treeFolder;
      if (state.worktreeCollapsed.has(p)) state.worktreeCollapsed.delete(p);
      else state.worktreeCollapsed.add(p);
      renderChangesArea();
      return;
    }
    const mergeBtn = target.closest<HTMLElement>('[data-merge]');
    if (mergeBtn?.dataset.merge) {
      event.stopPropagation();
      void openMerge(mergeBtn.dataset.merge);
      return;
    }
    const cfileRow = target.closest<HTMLElement>('[data-cfile]');
    if (cfileRow && !target.closest('input,label,button')) {
      const key = cfileRow.dataset.cfile ?? '';
      const file = state.changes.find((f) => changeKey(f) === key);
      if (file) {
        state.selectedChangeKey = key;
        void loadChangeDiff(file);
      }
      return;
    }

    // Diff toolbar / fold / hunk actions
    const diffModeBtn = target.closest<HTMLElement>('[data-diffmode]');
    if (diffModeBtn?.dataset.diffmode) {
      state.diffMode = diffModeBtn.dataset.diffmode as 'split' | 'unified';
      const repo = selectedRepo();
      if (repo) saveUi(repo.id, { diffMode: state.diffMode, ignoreWhitespace: state.ignoreWhitespace });
      if (state.fullDiff) renderFullDiffOnly();
      else if (state.tab === 'changes') renderChangesArea();
      else renderDetailsArea();
      return;
    }
    const hunkBtn = target.closest<HTMLElement>('[data-stage-hunk]');
    if (hunkBtn) {
      void stageHunkAt(Number(hunkBtn.dataset.stageHunk ?? 0));
      return;
    }
    if (target.closest('[data-fold]')) {
      const isWorktree = state.fullDiff ? state.fullDiffSource === 'worktree' : state.tab === 'changes';
      const file = isWorktree
        ? state.changes.find((f) => changeKey(f) === state.selectedChangeKey) ?? null
        : state.selectedFile;
      if (file) {
        state.expanded[diffKey(isWorktree ? 'workdir' : 'commit', changeKey(file))] = true;
        if (isWorktree) void loadChangeDiff(file);
        else void openCommitDiff(file);
      }
      return;
    }
    if (target.closest('[data-render-all]')) {
      const isWorktree = state.fullDiff ? state.fullDiffSource === 'worktree' : state.tab === 'changes';
      const file = isWorktree
        ? state.changes.find((f) => changeKey(f) === state.selectedChangeKey) ?? null
        : state.selectedFile;
      if (file) {
        state.renderAll[diffKey(isWorktree ? 'workdir' : 'commit', changeKey(file))] = true;
        if (state.fullDiff) renderFullDiffOnly();
        else if (isWorktree) renderChangesArea();
        else renderDetailsArea();
      }
      return;
    }

    // Blame gutter click -> jump to commit
    const blameCommit = target.closest<HTMLElement>('[data-blame-commit]');
    if (blameCommit?.dataset.blameCommit) {
      const hash = blameCommit.dataset.blameCommit;
      const idx = visibleCommitList().findIndex((c) => c.hash === hash || c.hash.startsWith(hash));
      if (idx >= 0) {
        state.blame = null;
        state.fullDiff = false;
        state.tab = 'log';
        state.commitIndex = idx;
        state.filesHash = '';
        void loadCommitFiles().then(() => {
          const first = state.commitFiles[0];
          if (first) void openCommitDiff(first);
          render();
        });
      } else {
        toast(`提交 ${hash.slice(0, 7)} 不在当前已加载列表内`);
      }
      return;
    }

    // Commit buttons & draft clear
    const commitBtn = target.closest<HTMLElement>('[data-commit]');
    if (commitBtn) {
      void submitCommit(commitBtn.dataset.commit === 'push');
      return;
    }
    if (target.closest('[data-cleardraft]')) {
      const repo = selectedRepo();
      if (repo) clearDraft(repo.id);
      state.draft = null;
      state.msg = '';
      renderChangesArea();
      return;
    }

    // Shelf row actions
    const shelfStat = target.closest<HTMLElement>('[data-shelfstat]');
    if (shelfStat?.dataset.shelfstat) {
      const repo = selectedRepo();
      if (repo) {
        void api
          .shelfStat(repo.path, shelfStat.dataset.shelfstat)
          .then((res) => showPopover(shelfStat, 'pop-shelfstat', renderShelfStatPopover(res.text), 380, 'right'))
          .catch(report);
      }
      return;
    }
    const shelfApply = target.closest<HTMLElement>('[data-shelfapply]');
    if (shelfApply?.dataset.shelfapply) {
      const repo = selectedRepo();
      if (repo) {
        void api
          .shelfApply(repo.path, shelfApply.dataset.shelfapply)
          .then(async () => {
            toast('已应用补丁到工作区', 'success');
            await refreshAfterWrite(false);
            await switchTab('changes');
          })
          .catch(report);
      }
      return;
    }
    const shelfDrop = target.closest<HTMLElement>('[data-shelfdrop]');
    if (shelfDrop?.dataset.shelfdrop) {
      const repo = selectedRepo();
      const id = shelfDrop.dataset.shelfdrop;
      if (repo) {
        void askConfirm('删除 Shelf 项', `确定删除 ${id}？`, true).then(async (ok) => {
          if (!ok) return;
          await api.shelfDrop(repo.path, id).catch(report);
          await loadShelf();
          renderAuxArea();
        });
      }
      return;
    }

    // Terminal / Agent controls
    const termTabBtn = target.closest<HTMLElement>('[data-termtab]');
    if (termTabBtn?.dataset.termtab) {
      state.termTab = termTabBtn.dataset.termtab as AppState['termTab'];
      state.termOpen = true;
      renderTerminalOnly(true);
      if (state.termTab === 'term' && !state.termSession) void startShellSession();
      return;
    }
    const modeBtn = target.closest<HTMLElement>('[data-mode]');
    if (modeBtn?.dataset.mode) {
      const nextMode = modeBtn.dataset.mode as Mode;
      state.mode = nextMode;
      state.termOpen = true;
      void startAgentSession({ mode: nextMode });
      return;
    }
    const applyCommitBtn = target.closest<HTMLElement>('[data-apply-commit]');
    if (applyCommitBtn?.dataset.applyCommit) {
      const text = decodeURIComponent(applyCommitBtn.dataset.applyCommit);
      const repo = selectedRepo();
      state.msg = text;
      if (repo) {
        saveDraft(repo.id, text);
        state.draft = { text, ts: Date.now() };
      }
      void switchTab('changes').then(() => toast('已填入提交信息', 'success'));
      return;
    }
    if (target.closest('#termClear')) {
      state.agentLines = [];
      void stopAgent().then(() => renderTerminalOnly());
      return;
    }

    // Named `data-action` handlers
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (actionEl?.dataset.action) {
      void handleNamedAction(actionEl.dataset.action, actionEl);
      return;
    }

    // Legacy / shared `data-act` handlers
    const actEl = target.closest<HTMLElement>('[data-act]');
    if (actEl?.dataset.act) {
      void handleDataAct(actEl.dataset.act);
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey;
    const target = event.target as HTMLElement | null;
    const inInput = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'));

    if (event.key === 'Escape') {
      if (state.modal) {
        closeModal();
        return;
      }
      if (state.popover) {
        closePopover();
        return;
      }
      if (state.fullDiff) {
        closeFullDiff();
        return;
      }
      if (state.blame) {
        state.blame = null;
        render();
        return;
      }
      if (state.termOpen && target?.id === 'termInput') {
        state.termOpen = false;
        renderTerminalOnly();
        return;
      }
    }

    if (meta && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      if (state.sidebarCollapsed) {
        state.sidebarCollapsed = false;
        lsSet('knit.sidebar.collapsed', '0');
        applySidebarCollapsed();
      }
      const input = document.getElementById('repoSearch') as HTMLInputElement | null;
      input?.focus();
      input?.select();
      return;
    }

    if (meta && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      const anchor = document.getElementById('cmdPaletteBtn') ?? document.getElementById('cmdSearch');
      if (anchor) {
        const repo = selectedRepo();
        const isProtected = Boolean(repo?.branch && (state.host?.protectedBranches ?? ['main', 'master']).includes(repo.branch));
        showPopover(anchor, 'pop-cmd', renderCommandPalette(repo, isProtected, currentCommit()), 340, 'right');
      }
      return;
    }

    if (meta && event.key.toLowerCase() === 'j') {
      event.preventDefault();
      state.termOpen = !state.termOpen;
      renderTerminalOnly(state.termOpen);
      return;
    }

    if (meta && ['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      const map: Record<string, Tab> = { '1': 'log', '2': 'changes', '3': 'console', '4': 'shelf' };
      void switchTab(map[event.key]);
      return;
    }

    if (meta && event.key === 'Enter' && target?.id === 'msgBox') {
      event.preventDefault();
      void submitCommit(false);
      return;
    }

    if (event.key === 'Enter' && target?.id === 'termInput') {
      event.preventDefault();
      void sendTerminalInput();
      return;
    }

    if (event.key === 'Enter' && target?.id === 'bmNewName') {
      event.preventDefault();
      void createBranchFromModal();
      return;
    }

    if (state.fullDiff && !inInput && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      void stepDiffFile(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }

    if (!inInput && !state.modal && !state.fullDiff && state.tab === 'log' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const commits = visibleCommitList();
      if (!commits.length) return;
      event.preventDefault();
      const next = Math.max(0, Math.min(commits.length - 1, currentCommitIndex() + (event.key === 'ArrowDown' ? 1 : -1)));
      if (next !== state.commitIndex) {
        state.commitIndex = next;
        state.filesHash = '';
        state.selectedFile = null;
        state.diff = null;
        state.blame = null;
        renderLogArea();
        document.querySelector(`.commit-row[data-commit="${next}"]`)?.scrollIntoView({ block: 'nearest' });
        void loadCommitFiles().then(() => {
          const first = state.commitFiles[0];
          if (first) void openCommitDiff(first);
        });
      }
    }
  });
}

async function handleNamedAction(action: string, el: HTMLElement): Promise<void> {
  const repo = selectedRepo();
  switch (action) {
    case 'focus-repo-search': {
      if (state.sidebarCollapsed) {
        state.sidebarCollapsed = false;
        lsSet('knit.sidebar.collapsed', '0');
        applySidebarCollapsed();
      }
      const input = document.getElementById('repoSearch') as HTMLInputElement | null;
      input?.focus();
      input?.select();
      return;
    }
    case 'clear-repo-search': {
      state.query = '';
      renderSidebarOnly();
      return;
    }
    case 'clear-commit-search': {
      state.filterQuery = '';
      state.commitIndex = 0;
      renderLogArea();
      return;
    }
    case 'clear-log-filters': {
      state.branchAll = false;
      state.authorFilter = '';
      state.timeFilter = 'all';
      state.fileFilter = null;
      state.filterQuery = '';
      state.commitIndex = 0;
      await loadLog();
      const first = state.commitFiles[0];
      if (first) await openCommitDiff(first);
      render();
      return;
    }
    case 'toggle-workspace': {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      lsSet('knit.sidebar.collapsed', state.sidebarCollapsed ? '1' : '0');
      applySidebarCollapsed();
      return;
    }
    case 'change-root': {
      state.modal = { kind: 'root' };
      renderModal();
      return;
    }
    case 'rescan': {
      await rescan();
      return;
    }
    case 'branch-fetch': {
      await runBranchFetch();
      return;
    }
    case 'branch-pull': {
      await runBranchPull(false);
      return;
    }
    case 'open-branches': {
      await openBranchModal();
      return;
    }
    case 'open-worktrees': {
      await openWorktreeModal();
      return;
    }
    case 'open-commands': {
      const isProtected = Boolean(repo?.branch && (state.host?.protectedBranches ?? ['main', 'master']).includes(repo.branch));
      const align = el.id === 'cmdSearch' ? 'left' : 'right';
      showPopover(el, 'pop-cmd', renderCommandPalette(repo, isProtected, currentCommit()), 360, align);
      return;
    }
    case 'toggle-theme': {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return;
    }
    case 'open-changes': {
      await switchTab('changes');
      return;
    }
    case 'expand-diff': {
      openFullDiff(state.tab === 'changes' ? 'worktree' : 'commit');
      return;
    }
    case 'exit-full-diff': {
      closeFullDiff();
      return;
    }
    case 'diff-prev-file': {
      await stepDiffFile(-1);
      return;
    }
    case 'diff-next-file': {
      await stepDiffFile(1);
      return;
    }
    case 'discard-changes': {
      openDiscardModal();
      return;
    }
    case 'worktree-history': {
      const path = el.dataset.path;
      if (path) {
        state.fileFilter = path;
        state.commitIndex = 0;
        await switchTab('log');
        await loadLog();
        const first = state.commitFiles[0];
        if (first) await openCommitDiff(first);
        render();
      }
      return;
    }
    case 'goto-parent': {
      const hash = el.dataset.hash;
      if (hash) {
        const idx = visibleCommitList().findIndex((c) => c.hash === hash);
        if (idx >= 0) {
          state.commitIndex = idx;
          state.filesHash = '';
          await loadCommitFiles();
          const first = state.commitFiles[0];
          if (first) await openCommitDiff(first);
          render();
        }
      }
      return;
    }
    case 'open-terminal-at-commit': {
      state.termTab = 'term';
      state.termOpen = true;
      renderTerminalOnly(true);
      await startShellSession();
      return;
    }
    case 'toggle-terminal': {
      state.termOpen = !state.termOpen;
      renderTerminalOnly(state.termOpen);
      return;
    }
    case 'term-send': {
      await sendTerminalInput();
      return;
    }
  }
}

async function runCommandAction(cmd: string): Promise<void> {
  const repo = selectedRepo();
  const commit = currentCommit();
  if (!repo) return;
  if (cmd === 'branches') {
    await openBranchModal();
  } else if (cmd === 'fetch') {
    await runBranchFetch();
  } else if (cmd === 'pull') {
    await runBranchPull(false);
  } else if (cmd === 'pull-rebase') {
    await runBranchPull(true);
  } else if (cmd === 'worktree') {
    await openWorktreeModal();
  } else if (cmd === 'rebase') {
    await openRebaseModal();
  } else if (cmd === 'reset-soft' || cmd === 'reset-mixed' || cmd === 'reset-hard') {
    if (!commit) return;
    const mode = cmd.replace('reset-', '') as 'soft' | 'mixed' | 'hard';
    const warn =
      mode === 'hard'
        ? `将工作区和暂存区强制重置到 ${commit.shortHash}（会先创建 stash 快照）。确定继续？`
        : `将 HEAD 重置到 ${commit.shortHash}（--${mode}）。确定继续？`;
    const ok = await askConfirm(`Reset --${mode}`, warn, mode === 'hard');
    if (!ok) return;
    try {
      await api.resetRepo(repo.path, commit.hash, mode);
      toast(`已 Reset --${mode} 到 ${commit.shortHash}`, 'success');
      await refreshAfterWrite(true);
    } catch (error) {
      report(error);
    }
  } else if (cmd === 'push-force') {
    const ok = await askConfirm(
      'Push --force-with-lease',
      `将向远端强制推送分支 ${repo.branch ?? 'HEAD'}（使用 --force-with-lease 保护）。确定继续？`,
      true,
    );
    if (!ok) return;
    try {
      await api.pushForce(repo.path);
      toast('Force push 完成', 'success');
      await refreshStatus([repo.path]);
    } catch (error) {
      report(error);
    }
  }
}

async function handleDataAct(act: string): Promise<void> {
  const repo = selectedRepo();
  const commit = currentCommit();

  switch (act) {
    case 'pickroot': {
      try {
        const picked = await api.pickRoot();
        if (picked) {
          const input = document.getElementById('rootInput') as HTMLInputElement | null;
          if (input) input.value = picked;
        }
      } catch (error) {
        report(error);
      }
      return;
    }
    case 'loadmorelog': {
      await loadMoreLog();
      return;
    }
    case 'copy': {
      if (!commit) return;
      try {
        await navigator.clipboard.writeText(commit.hash);
        toast(`已复制 ${commit.shortHash}`, 'success');
      } catch {
        toast(commit.hash);
      }
      return;
    }
    case 'cherry': {
      if (!repo || !commit) return;
      const ok = await askConfirm('Cherry-pick', `将提交 ${commit.shortHash}（${commit.subject}）应用到当前分支？`);
      if (!ok) return;
      try {
        await api.cherryPick(repo.path, commit.hash);
        toast(`已 Cherry-pick ${commit.shortHash}`, 'success');
        await refreshAfterWrite(true);
      } catch (error) {
        report(error);
        await refreshAfterWrite(false);
      }
      return;
    }
    case 'revert': {
      if (!repo || !commit) return;
      const ok = await askConfirm('Revert', `创建新提交回滚 ${commit.shortHash}（${commit.subject}）？`, true);
      if (!ok) return;
      try {
        await api.revert(repo.path, commit.hash);
        toast(`已回滚 ${commit.shortHash}`, 'success');
        await refreshAfterWrite(true);
      } catch (error) {
        report(error);
      }
      return;
    }
    case 'rebase': {
      await openRebaseModal();
      return;
    }
    case 'patch': {
      if (!repo || !commit) return;
      try {
        const res = await api.createPatch(repo.path, commit.hash);
        toast(`已导出补丁：${basenameOf(res.file)}`, 'success');
      } catch (error) {
        report(error);
      }
      return;
    }
    case 'agent': {
      await startAgentSession({ mode: 'read', rev: commit?.hash });
      return;
    }
    case 'genmsg': {
      if (!stagedFiles(state.changes).length) {
        toast('先勾选至少一个文件暂存，再生成提交信息');
        return;
      }
      await startAgentSession({ mode: 'commit', oneShot: 'commit' });
      return;
    }
    case 'ignorews': {
      state.ignoreWhitespace = !state.ignoreWhitespace;
      if (repo) saveUi(repo.id, { diffMode: state.diffMode, ignoreWhitespace: state.ignoreWhitespace });
      const isWorktree = state.fullDiff ? state.fullDiffSource === 'worktree' : state.tab === 'changes';
      if (isWorktree) {
        const file = state.changes.find((f) => changeKey(f) === state.selectedChangeKey);
        if (file) await loadChangeDiff(file);
      } else if (state.selectedFile) {
        await openCommitDiff(state.selectedFile);
      }
      return;
    }
    case 'blame': {
      if (state.blame) {
        state.blame = null;
        if (state.fullDiff) renderFullDiffOnly();
        else if (state.tab === 'changes') renderChangesArea();
        else renderDetailsArea();
        return;
      }
      const isWorktree = state.fullDiff ? state.fullDiffSource === 'worktree' : state.tab === 'changes';
      const file = isWorktree
        ? state.changes.find((f) => changeKey(f) === state.selectedChangeKey) ?? null
        : state.selectedFile;
      if (file) {
        await openBlameFor(file.path, isWorktree ? '' : commit?.hash ?? '');
      }
      return;
    }
    case 'blame-back': {
      state.blame = null;
      if (state.fullDiff) renderFullDiffOnly();
      else if (state.tab === 'changes') renderChangesArea();
      else renderDetailsArea();
      return;
    }
    case 'blame-more': {
      await loadMoreBlame();
      return;
    }
    case 'locate': {
      if (!repo) return;
      const isWorktree = state.fullDiff ? state.fullDiffSource === 'worktree' : state.tab === 'changes';
      const file = isWorktree
        ? state.changes.find((f) => changeKey(f) === state.selectedChangeKey) ?? null
        : state.selectedFile;
      if (!file) return;
      try {
        if (isWorktree) {
          await api.openFile(`${repo.path}/${file.path}`, 0);
        } else if (commit) {
          const temp = await api.openTemp(repo.path, commit.hash, file.path);
          await api.openFile(temp.path, 0);
        }
      } catch (error) {
        report(error);
      }
      return;
    }
    case 'loadall': {
      const isWorktree = state.fullDiff ? state.fullDiffSource === 'worktree' : state.tab === 'changes';
      const cur = isWorktree ? state.changeDiff : state.diff;
      if (!cur) return;
      try {
        const full = await api.fullDiff(cur);
        if (isWorktree) state.changeDiff = full;
        else state.diff = full;
        if (state.fullDiff) renderFullDiffOnly();
        else if (isWorktree) renderChangesArea();
        else renderDetailsArea();
      } catch (error) {
        report(error);
      }
      return;
    }
    case 'rebase-continue': {
      await runRebaseOp('continue');
      return;
    }
    case 'rebase-skip': {
      await runRebaseOp('skip');
      return;
    }
    case 'rebase-abort': {
      await runRebaseOp('abort');
      return;
    }
    case 'merge-abort': {
      await runMergeAbort();
      return;
    }
    case 'agent-restore': {
      const rec = state.agentDirtyRecovery;
      if (!rec) return;
      try {
        await api.agentRestore(rec.path, rec.snapshotSha, rec.preUntracked);
        state.agentDirtyRecovery = null;
        toast('已恢复工作区到只读会话打开前', 'success');
        await refreshAfterWrite(false);
      } catch (error) {
        report(error);
      }
      return;
    }
    case 'refresh-console': {
      try {
        const res = await api.console();
        state.console = res.commands;
        renderAuxArea();
      } catch (error) {
        report(error);
      }
      return;
    }
    case 'shelfsave': {
      if (!repo) return;
      try {
        const res = await api.shelfSave(repo.path);
        toast(`已保存到 Shelf：${basenameOf(res.file)}`, 'success');
        await loadShelf();
        renderAuxArea();
      } catch (error) {
        report(error);
      }
      return;
    }
    case 'shelfimport': {
      if (!repo) return;
      try {
        const source = await api.pickPatch();
        if (!source) return;
        const res = await api.shelfImport(repo.path, source);
        toast(`已导入补丁：${basenameOf(res.file)}`, 'success');
        await loadShelf();
        renderAuxArea();
      } catch (error) {
        report(error);
      }
      return;
    }
  }
}

// --- startup --------------------------------------------------------------

window.addEventListener('error', (event) => {
  api.jsError(`uncaught: ${event.message} (${event.filename}:${event.lineno})`);
});
window.addEventListener('unhandledrejection', (event) => {
  api.jsError(`unhandledrejection: ${String(event.reason)}`);
});

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
  lsSet('knit.theme', theme);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    const isDark = theme === 'dark';
    btn.innerHTML = icon(isDark ? 'sun' : 'moon');
    btn.title = isDark ? '切换到浅色主题（Porcelain）' : '切换到深色主题（Slate）';
    btn.setAttribute('aria-label', btn.title);
  }
  void api.setTheme(theme === 'dark');
}

function initTheme(): void {
  const saved = lsGet('knit.theme') ?? 'light';
  applyTheme(saved === 'dark' ? 'dark' : 'light');
}

mountShell();
initTheme();
restoreSplitterSizes();
installHostEvents();
bindSplitters();
bindEvents();
void boot();

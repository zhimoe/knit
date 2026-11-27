// Typed wrappers over nimi's IPC bridge (docs/03 §3).
//
// Background methods (`Repo.*`, `Log.*`, `Diff.*`, …) take one JSON-string
// argument and resolve with `{ok, data} | {ok, error}`. Sync methods
// (`Shell.*`) are plain typed calls on the UI thread.

import type {
  AgentConfig,
  AgentMode,
  AgentQueuedEvent,
  AgentStartedEvent,
  AgentOutputEvent,
  AgentExitEvent,
  BlameLine,
  ChangesResult,
  ChunkResult,
  CommitResult,
  ConsoleEntry,
  DiffFile,
  DiffResult,
  FileEntry,
  GitCommandEvent,
  GitRef,
  HostState,
  ImagePreview,
  LogResult,
  MergeState,
  RebaseCommit,
  RebaseState,
  ReflogEntry,
  RemoteInfo,
  Repo,
  RepoChangedEvent,
  ScanResult,
  ShelfItem,
  StatusResult,
  WorktreeInfo,
} from './types';

interface NimiBridge {
  call(method: string, ...args: unknown[]): Promise<unknown>;
  on(name: string, fn: (payload: unknown) => void): void;
}

declare global {
  interface Window {
    nimi: NimiBridge;
    mygo?: NimiBridge;
    knitEvent?: (name: string, payloadJson: string) => void;
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { kind: string; message: string; hint?: string } };

function bridge(): NimiBridge {
  const b = window.nimi ?? window.mygo;
  if (!b) throw new Error('nimi bridge 未注入（页面不在 nimi:// 下加载？）');
  return b;
}

async function callEnvelope<T>(method: string, args: unknown): Promise<T> {
  const raw = await bridge().call(method, JSON.stringify(args));
  if (typeof raw !== 'object' || raw === null) throw new Error(`${method}: 返回值不是对象`);
  const envelope = raw as Envelope<T>;
  if (!('ok' in envelope)) throw new Error(`${method}: 缺少 ok 字段`);
  if (envelope.ok === false) {
    const { message, hint } = envelope.error;
    throw new IpcError(envelope.error.kind, hint ? `${message}（${hint}）` : message);
  }
  return envelope.data;
}

export class IpcError extends Error {
  constructor(
    public kind: string,
    message: string,
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

async function guard<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof IpcError) throw error;
    throw new IpcError('internal', `${label} 失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

const call = <T>(method: string, args: unknown): Promise<T> =>
  guard(method, () => callEnvelope<T>(method, args));

export const api = {
  version: () => guard('Shell.version', () => bridge().call('Shell.version') as Promise<string>),

  ready: (repos: number, ms: number) => guard('Shell.ready', () => bridge().call('Shell.ready', repos, ms)),

  hostState: () =>
    guard('Shell.getState', async () => {
      const raw = await bridge().call('Shell.getState');
      return JSON.parse(String(raw)) as HostState;
    }),

  setRoot: (path: string) =>
    guard('Shell.setRoot', async () => JSON.parse(String(await bridge().call('Shell.setRoot', path))) as { ok: boolean; root: string }),

  setSelected: (repoId: string) =>
    guard('Shell.setSelected', async () => {
      const raw = await bridge().call('Shell.setSelected', repoId);
      return JSON.parse(String(raw)) as { ok: boolean };
    }),

  setExclusions: (globs: string[], repos: string[]) =>
    guard('Shell.setExclusions', async () => {
      const raw = await bridge().call('Shell.setExclusions', JSON.stringify({ globs, repos }));
      return JSON.parse(String(raw)) as { ok: boolean; error?: string };
    }),

  pickRoot: () => guard('Shell.pickRoot', () => bridge().call('Shell.pickRoot') as Promise<string>),

  pickPatch: () => guard('Shell.pickPatch', () => bridge().call('Shell.pickPatch') as Promise<string>),

  setTheme: (dark: boolean) =>
    bridge()
      .call('Shell.setTheme', dark)
      .catch(() => ({ ok: false })),

  openFile: (path: string, line = 0) => guard('Shell.openFile', () => bridge().call('Shell.openFile', path, line)),

  revealPath: (path: string) =>
    guard('Shell.revealPath', async () => {
      const raw = await bridge().call('Shell.revealPath', path);
      return JSON.parse(String(raw)) as { ok: boolean; error?: string };
    }),

  saveSettings: (settings: Partial<HostState>) =>
    guard('Shell.saveSettings', async () => {
      const raw = await bridge().call('Shell.saveSettings', JSON.stringify(settings));
      return JSON.parse(String(raw)) as { ok: boolean; state?: HostState; error?: string };
    }),

  jsError: (message: string) => {
    // Never make a synchronous bridge call from inside a knitEvent eval:
    // deferring keeps the native call out of the eval's re-entrant path.
    window.setTimeout(() => {
      try {
        void bridge().call('Shell.jsError', message).catch(() => undefined);
      } catch {
        /* the bridge can be gone during shutdown */
      }
    }, 0);
  },

  pollEvents: async (): Promise<void> => {
    try {
      const raw = await bridge().call('Shell.pollEvents');
      if (typeof raw !== 'string' || raw === '[]') return;
      const items = JSON.parse(raw) as { name: string; payload: string }[];
      for (const item of items) {
        window.knitEvent?.(item.name, item.payload);
      }
    } catch {
      /* ignore transient poll errors */
    }
  },

  scan: (args: { root: string; excludeGlobs: string[]; scanDepth: number }) => call<ScanResult>('Repo.scan', args),

  status: (paths: string[]) => call<StatusResult>('Repo.status', { paths }),

  cached: (root: string) => call<Repo[]>('Repo.cached', { root }),

  changes: (path: string) => call<ChangesResult>('Repo.changes', { path }),

  log: (
    path: string,
    limit = 200,
    opts: {
      branch?: string;
      all?: boolean;
      filterPath?: string;
      cursor?: string;
      pickaxe?: string;
      pickaxeRegex?: boolean;
    } = {},
  ) => call<LogResult>('Log.list', { path, limit, ...opts }),

  logFiles: (path: string, hash: string) => call<FileEntry[]>('Log.files', { path, hash }),

  logRefs: (path: string) => call<{ refs: GitRef[] }>('Log.refs', { path }),

  compareFiles: (path: string, base: string, head: string) =>
    call<FileEntry[]>('Log.compareFiles', { path, base, head }),

  reflog: (path: string, limit = 80) => call<{ entries: ReflogEntry[] }>('Log.reflog', { path, limit }),

  diffCommit: (path: string, hash: string, file: string, ignoreWhitespace = false, contextLines = 3) =>
    call<DiffResult>('Diff.commit', { path, hash, file, ignoreWhitespace, contextLines }),

  diffRange: (
    path: string,
    base: string,
    head: string,
    file: string,
    ignoreWhitespace = false,
    contextLines = 3,
  ) => call<DiffResult>('Diff.range', { path, base, head, file, ignoreWhitespace, contextLines }),

  diffImage: (
    path: string,
    file: string,
    opts: { hash?: string; staged?: boolean; untracked?: boolean; base?: string; head?: string } = {},
  ) => call<ImagePreview>('Diff.image', { path, file, ...opts }),

  diffWorkdir: (
    path: string,
    file: string,
    staged: boolean,
    untracked: boolean,
    ignoreWhitespace = false,
    contextLines = 3,
  ) => call<DiffResult>('Diff.workdir', { path, file, staged, untracked, ignoreWhitespace, contextLines }),

  diffChunk: (token: string, index: number) => call<ChunkResult>('Diff.chunk', { token, index }),

  stageHunk: (path: string, patch: string, reverse = false) =>
    call<{ ok: boolean }>('Stage.hunk', { path, patch, reverse }),

  discardHunk: (path: string, patch: string) =>
    call<{ ok: boolean }>('Stage.discardHunk', { path, patch }),

  stageFiles: (path: string, files: string[], staged: boolean) =>
    call<{ ok: boolean }>('Stage.files', { path, files, staged }),

  discard: (path: string, files: string[]) => call<{ ok: boolean }>('Stage.discard', { path, files }),

  commit: (path: string, message: string, amend: boolean, push: boolean) =>
    call<CommitResult>('Commit.create', { path, message, amend, push }),

  cherryPick: (path: string, hash: string) => call<{ ok: boolean }>('Commit.cherryPick', { path, hash }),

  cherryPickMany: (path: string, hashes: string[]) => call<{ ok: boolean }>('Commit.cherryPick', { path, hashes }),

  revert: (path: string, hash: string) => call<{ ok: boolean }>('Commit.revert', { path, hash }),

  createPatch: (path: string, hash: string) => call<{ ok: boolean; file: string }>('Commit.patch', { path, hash }),

  resetRepo: (path: string, rev: string, mode: 'soft' | 'mixed' | 'hard') =>
    call<{ ok: boolean }>('Repo.reset', { path, rev, mode }),

  repoClone: (url: string, parentDir = '', folderName = '') =>
    call<{ ok: boolean; path: string }>('Repo.clone', { url, parentDir, folderName }),

  repoInit: (dir: string, name = '', branch = 'main') =>
    call<{ ok: boolean; path: string }>('Repo.init', { dir, name, branch }),

  addGitignore: (path: string, pattern: string) =>
    call<{ ok: boolean }>('Repo.addGitignore', { path, pattern }),

  pushForce: (path: string) => call<{ ok: boolean }>('Commit.pushForce', { path }),

  mergeState: (path: string, file: string) => call<MergeState>('Merge.state', { path, file }),

  mergeResolve: (path: string, file: string, resolved: string) =>
    call<{ ok: boolean }>('Merge.resolve', { path, file, resolved }),

  mergeResolveSide: (path: string, file: string, side: 'ours' | 'theirs') =>
    call<{ ok: boolean }>('Merge.resolveSide', { path, file, side }),

  shelfList: (path: string) => call<ShelfItem[]>('Shelf.list', { path }),

  shelfSave: (path: string) => call<{ ok: boolean; file: string }>('Shelf.save', { path }),

  shelfApply: (path: string, id: string) => call<{ ok: boolean }>('Shelf.apply', { path, id }),

  shelfDrop: (path: string, id: string) => call<{ ok: boolean }>('Shelf.drop', { path, id }),

  shelfStat: (path: string, id: string) => call<{ text: string }>('Shelf.stat', { path, id }),

  shelfImport: (path: string, source: string) => call<{ file: string }>('Shelf.import', { path, source }),

  console: () => call<{ commands: ConsoleEntry[] }>('Git.console', {}),

  agentConfig: () => call<AgentConfig>('Agent.config', {}),

  /** Resolves only when the process exits; stream via events instead. */
  agentStart: (args: {
    path: string;
    sessionId: string;
    mode: AgentMode;
    skills: string[];
    rev?: string;
    agent?: string;
    cols?: number;
    rows?: number;
  }) => call<{ sessionId: string; code: number }>('Agent.start', args),

  agentWrite: (sessionId: string, chunk: string) =>
    call<{ ok: boolean }>('Agent.write', { sessionId, chunk }),

  agentStop: (sessionId: string) => call<{ ok: boolean }>('Agent.stop', { sessionId }),

  agentRestore: (path: string, snapshotSha: string, preUntracked: string[]) =>
    call<{ ok: boolean }>('Agent.restore', { path, snapshotSha, preUntracked }),

  openTemp: (path: string, hash: string, file: string) =>
    call<{ path: string }>('External.openTemp', { path, hash, file }),

  worktreeList: (path: string) => call<{ worktrees: WorktreeInfo[] }>('Worktree.list', { path }),

  worktreeAdd: (path: string, branch: string, startPoint = 'HEAD', dir = '') =>
    call<{ ok: boolean; path: string; branch: string; handId: string }>('Worktree.add', {
      path,
      branch,
      startPoint,
      dir,
    }),

  worktreeRemove: (path: string, worktreePath: string) =>
    call<{ ok: boolean }>('Worktree.remove', { path, worktreePath }),

  worktreePrune: (path: string) => call<{ ok: boolean }>('Worktree.prune', { path }),

  blame: (path: string, file: string, hash = '', minLine = 1, limit = 2000) =>
    call<{ lines: BlameLine[]; minLine: number; nextLine: number; hasMore: boolean; ms: number }>('Blame.file', {
      path,
      file,
      hash,
      minLine,
      limit,
    }),

  branchFetch: (path: string) => call<{ ok: boolean }>('Branch.fetch', { path }),

  branchPull: (path: string, rebase = false) =>
    call<{ ok: boolean; conflict: boolean; conflicts?: string[]; output?: string }>('Branch.pull', {
      path,
      rebase,
    }),

  branchPush: (path: string, includeTags = false) =>
    call<{ ok: boolean }>('Branch.push', { path, includeTags }),

  tagCreate: (path: string, name: string, target = 'HEAD', message = '') =>
    call<{ ok: boolean }>('Tag.create', { path, name, target, message }),

  tagDelete: (path: string, name: string, deleteRemote = false) =>
    call<{ ok: boolean }>('Tag.delete', { path, name, deleteRemote }),

  tagPush: (path: string, name: string) => call<{ ok: boolean }>('Tag.push', { path, name }),

  remoteList: (path: string) => call<{ remotes: RemoteInfo[] }>('Remote.list', { path }),

  remoteAdd: (path: string, name: string, url: string) =>
    call<{ ok: boolean }>('Remote.add', { path, name, url }),

  remoteSetUrl: (path: string, name: string, url: string) =>
    call<{ ok: boolean }>('Remote.setUrl', { path, name, url }),

  remoteRemove: (path: string, name: string) => call<{ ok: boolean }>('Remote.remove', { path, name }),

  branchCheckout: (path: string, target: string) =>
    call<{ ok: boolean }>('Branch.checkout', { path, target }),

  branchCreate: (path: string, name: string, startPoint = 'HEAD', checkout = true) =>
    call<{ ok: boolean }>('Branch.create', { path, name, startPoint, checkout }),

  branchDelete: (path: string, name: string, force = false) =>
    call<{ ok: boolean }>('Branch.delete', { path, name, force }),

  branchMerge: (path: string, branch: string) =>
    call<{ ok: boolean; conflict: boolean; conflicts?: string[]; output?: string }>('Branch.merge', {
      path,
      branch,
    }),

  branchMergeAbort: (path: string) => call<{ ok: boolean }>('Branch.mergeAbort', { path }),

  rebasePlan: (path: string, onto: string) =>
    call<{ commits: RebaseCommit[]; onto: string }>('Rebase.plan', { path, onto }),

  rebaseState: (path: string) => call<RebaseState>('Rebase.state', { path }),

  rebaseStart: (path: string, onto: string, todo: RebaseCommit[]) =>
    call<{ ok: boolean; conflict: boolean; state: RebaseState }>('Rebase.start', { path, onto, todo }),

  rebaseAction: (path: string, op: 'continue' | 'abort' | 'skip') =>
    call<{ ok: boolean; conflict: boolean; state: RebaseState }>('Rebase.action', { path, op }),

  /** Load every chunk of a truncated diff. */
  async fullDiff(diff: DiffFile): Promise<DiffFile> {
    if (!diff.truncated || !diff.token) return diff;
    if (diff.hunks.length > 0) return diff;
    let text = '';
    const count = diff.chunks ?? 0;
    for (let index = 0; index < count; index += 1) {
      const part = await api.diffChunk(diff.token, index);
      text += part.chunk;
    }
    return JSON.parse(text) as DiffFile;
  },
};

// --- events ---------------------------------------------------------------

type EventName = 'repo:changed' | 'git:command' | 'agent:started' | 'agent:queued' | 'agent:output' | 'agent:exit';
type Handler = (payload: unknown) => void;
const handlers = new Map<EventName, Set<Handler>>();

export function onEvent(name: EventName, handler: Handler): void {
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  set.add(handler);
}

export function installEventBridge(): void {
  window.knitEvent = (name: string, payloadJson: string) => {
    const set = handlers.get(name as EventName);
    if (!set) return;
    let payload: unknown;
    try {
      payload = JSON.parse(payloadJson);
    } catch {
      payload = payloadJson;
    }
    for (const handler of set) {
      try {
        handler(payload);
      } catch (error) {
        console.error('knit event handler failed', name, error);
      }
    }
  };
}

export type { AgentQueuedEvent, AgentStartedEvent, AgentOutputEvent, AgentExitEvent, GitCommandEvent, RepoChangedEvent };

// Wire types — must stay identical to src/knit/types.nim (docs/06 §2).

export interface Dirty {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

export interface Repo {
  id: string;
  name: string;
  path: string;
  branch: string | null;
  detached: boolean;
  head: string;
  ahead: number | null;
  behind: number | null;
  dirty: Dirty;
  lastCommitAt: number;
  lang: string;
  error?: { kind: string; message: string };
}

export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: { name: string; email: string };
  committedAt: number;
  subject: string;
  body: string;
  refs: string[];
}

export type FileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U';

export interface FileEntry {
  path: string;
  oldPath?: string;
  status: FileStatus;
  group: 'commit' | 'staged' | 'unstaged';
  additions: number;
  deletions: number;
  binary?: boolean;
  untracked?: boolean;
  conflict?: boolean;
}

export interface DiffRow {
  t: 'ctx' | 'add' | 'del';
  oldNo?: number;
  newNo?: number;
  text: string;
  hl?: [number, number][];
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  rows: DiffRow[];
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  size: number;
  additions: number;
  deletions: number;
  hunks: Hunk[];
  truncated?: boolean;
  token?: string;
  chunks?: number;
  preview?: { hunks: Hunk[] };
}

export interface ConflictSide {
  start: number;
  lines: string[];
}

export interface ConflictBlock {
  index: number;
  start: number;
  ours: ConflictSide;
  theirs: ConflictSide;
  base?: ConflictSide;
}

export interface MergeState {
  path: string;
  ours: string;
  theirs: string;
  base: string;
  lines: string[];
  blocks: ConflictBlock[];
  binary: boolean;
}

export interface ShelfItem {
  id: string;
  kind: 'patch' | 'stash';
  name: string;
  subtitle: string;
  path: string;
  epochMs: number;
}

export interface ConsoleEntry {
  cmd: string;
  ms: number;
  ok: boolean;
  detail?: string;
}

export interface AgentSummary {
  id: string;
  label: string;
  command: string;
}

export interface SkillSummary {
  id: string;
  label: string;
  path: string;
}

export interface AgentConfig {
  defaultAgent: string;
  concurrency: number;
  agents: AgentSummary[];
  skills: SkillSummary[];
  modes: Record<string, string[]>;
  configPath: string;
}

export interface ScanResult {
  repos: Repo[];
  scanned: number;
  skipped: number;
  ms: number;
}

export interface StatusResult {
  repos: Repo[];
  ms: number;
}

export interface LogResult {
  commits: Commit[];
  hasMore?: boolean;
  nextCursor?: string;
  ms: number;
}

export interface BlameLine {
  line: number;
  hash: string;
  shortHash: string;
  author: string;
  time: number;
  summary: string;
  text: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
  handId: string | null;
  locked: boolean;
  isMain?: boolean;
}

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface RebaseCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  action: RebaseAction;
  message?: string;
}

export interface RebaseState {
  inProgress: boolean;
  headName: string;
  msgNum: number;
  end: number;
  onto: string;
  conflicts: string[];
}

export interface ChangesResult {
  files: FileEntry[];
  ms: number;
}

export interface DiffResult {
  diff: DiffFile;
}

export interface ChunkResult {
  index: number;
  count: number;
  chunk: string;
}

export interface GitRef {
  name: string;
  type: 'head' | 'branch' | 'remote' | 'tag';
  target: string;
}

export interface CommitResult {
  hash: string;
  pushError?: string;
}

export interface HostState {
  root: string;
  scanDepth: number;
  excludeGlobs: string[];
  excludeRepos: string[];
  selectedRepoId: string;
  diffMode: 'split' | 'unified';
  editor: { command: string; args: string[] };
  terminal: { shell: string; args: string[] };
  protectedBranches: string[];
  confirmDangerous: boolean;
}

export type Tab = 'log' | 'changes' | 'console' | 'shelf';
export type Mode = 'read' | 'commit' | 'review';
export type AgentMode = Mode | 'term';

export interface AgentStartedEvent {
  sessionId: string;
  agent: string;
  dir: string;
  command: string;
  args: string[];
}

export interface AgentOutputEvent {
  sessionId: string;
  chunk: string;
  stream: 'out' | 'err';
}

export interface AgentQueuedEvent {
  sessionId: string;
  position: number;
}

export interface AgentExitEvent {
  sessionId: string;
  code: number;
  output?: string;
  mode?: AgentMode;
  error?: string;
  dir?: string;
  snapshotSha?: string;
  preUntracked?: string[];
}

export interface GitCommandEvent {
  cmd: string;
  ms: number;
  ok: boolean;
  detail?: string;
}

export interface RepoChangedEvent {
  path: string;
}

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface ReflogEntry {
  hash: string;
  shortHash: string;
  selector: string;
  action: string;
  epochMs: number;
}

export interface ImagePreview {
  supported: boolean;
  mime: string;
  beforeDataUrl: string;
  afterDataUrl: string;
  beforeBytes: number;
  afterBytes: number;
  tooLarge: boolean;
}

export interface CompareSelection {
  base: Commit;
  head: Commit;
}

export interface ContextMenuItem {
  id: string;
  label?: string;
  icon?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

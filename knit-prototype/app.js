'use strict';

/* ============================================================================
   Knit — interactive prototype
   Pure vanilla JS. All repository, commit and agent data is simulated.
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));
const icon = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const pad2 = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}
function pickOne(rng, list) {
  return list[Math.floor(rng() * list.length)];
}
function makeHash(rng) {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 40; i += 1) out += chars[Math.floor(rng() * 16)];
  return out;
}
function randomHash() {
  try {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    let out = '';
    for (let i = 0; i < 40; i += 1) out += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    return out;
  }
}
function timeAgo(ts) {
  const diff = Date.now() - Number(ts);
  const mins = Math.max(0, Math.round(diff / 60000));
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  const date = new Date(ts);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
function timeCompact(ts) {
  const mins = Math.max(0, Math.round((Date.now() - Number(ts)) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days}d`;
  const date = new Date(ts);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
function absTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function clockTime(date = new Date()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
function basename(path) {
  return String(path).split('/').pop() || path;
}
function dirname(path) {
  const parts = String(path).split('/');
  parts.pop();
  return parts.length ? `${parts.join('/')}/` : '';
}
function extOf(path) {
  const base = basename(path);
  const idx = base.lastIndexOf('.');
  return idx >= 0 ? base.slice(idx + 1).toLowerCase() : '';
}
function shortPath(path) {
  return String(path).replace(/^\/Users\/zhimoe/, '~');
}
function initials(name) {
  return String(name).split(/\s+/).map((part) => part[0] || '').join('').slice(0, 2).toUpperCase();
}
function tint(hex, alpha) {
  const clean = String(hex).replace('#', '');
  const num = parseInt(clean, 16);
  if (!Number.isFinite(num)) return `rgba(110, 168, 255, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function highlightMatch(text, query) {
  const raw = String(text ?? '');
  const tokens = String(query ?? '').trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (!tokens.length) return esc(raw);
  const re = new RegExp(`(${tokens.join('|')})`, 'ig');
  let out = '';
  let last = 0;
  let match;
  while ((match = re.exec(raw)) !== null) {
    out += esc(raw.slice(last, match.index));
    out += `<mark>${esc(match[0])}</mark>`;
    last = re.lastIndex;
    if (match[0] === '') re.lastIndex += 1;
  }
  out += esc(raw.slice(last));
  return out;
}
function formatRichText(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function storeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}
function storeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    /* localStorage can be unavailable on file:// in some browsers */
  }
}

/* ================================================================ people */
const PEOPLE = {
  z: { name: 'Zhimoe', email: 'zhimoe@users.noreply.github.com', color: '#6ea8ff', me: true },
  mia: { name: 'Mia Chen', email: 'mia@knit.dev', color: '#63c6a5' },
  leo: { name: 'Leo Park', email: 'leo@knit.dev', color: '#e0a25d' },
  ava: { name: 'Ava Patel', email: 'ava@knit.dev', color: '#bb8ff2' },
  noah: { name: 'Noah Kim', email: 'noah@knit.dev', color: '#e57984' },
  yuki: { name: 'Yuki Sato', email: 'yuki@knit.dev', color: '#6fb3e8' },
  rami: { name: 'Rami Haddad', email: 'rami@knit.dev', color: '#d5a35c' },
};
const AUTHOR_POOL = [PEOPLE.mia, PEOPLE.leo, PEOPLE.ava, PEOPLE.noah, PEOPLE.yuki, PEOPLE.rami];

const LANGS = {
  TypeScript: { short: 'TS', color: '#4f8cf7' },
  Go: { short: 'GO', color: '#38b8c9' },
  Kotlin: { short: 'KT', color: '#b088ff' },
  Rust: { short: 'RS', color: '#df8a5f' },
  MDX: { short: 'MDX', color: '#e6b25e' },
  CSS: { short: 'CSS', color: '#58a6e0' },
  HCL: { short: 'TF', color: '#b07cf0' },
  Shell: { short: 'SH', color: '#79c98d' },
  Markdown: { short: 'MD', color: '#9aa6b5' },
  Python: { short: 'PY', color: '#e5c15c' },
  JSON: { short: '{}', color: '#c9a76a' },
};

const GROUPS = { work: '工作', oss: '开源', personal: '个人', labs: '实验' };

/* ================================================================= repos */
const REPO_DEFS = [
  {
    id: 'knit', name: 'knit', group: 'personal', rel: 'personal/knit', branch: 'main',
    lang: 'TypeScript', dirty: 5, ahead: 2, behind: 0, updatedMin: 2,
    currentFile: 'src/features/log/CommitGraph.tsx',
  },
  {
    id: 'orbit-web', name: 'orbit-web', group: 'work', rel: 'work/orbit-web', branch: 'main',
    lang: 'TypeScript', dirty: 3, ahead: 1, behind: 0, updatedMin: 8,
    currentFile: 'src/app/dashboard/page.tsx',
  },
  {
    id: 'orbit-api', name: 'orbit-api', group: 'work', rel: 'work/orbit-api', branch: 'feat/webhooks',
    lang: 'Go', dirty: 0, ahead: 0, behind: 2, updatedMin: 26,
    currentFile: 'internal/webhooks/dispatcher.go',
  },
  {
    id: 'atlas-mobile', name: 'atlas-mobile', group: 'work', rel: 'work/atlas-mobile', branch: 'release/2.8',
    lang: 'Kotlin', dirty: 2, ahead: 0, behind: 0, updatedMin: 58,
    currentFile: 'app/src/main/java/dev/atlas/sync/SyncWorker.kt',
  },
  {
    id: 'payments-core', name: 'payments-core', group: 'work', rel: 'work/payments-core', branch: 'main',
    lang: 'Rust', dirty: 1, ahead: 0, behind: 0, updatedMin: 120,
    currentFile: 'crates/ledger/src/entry.rs',
  },
  {
    id: 'ledger-service', name: 'ledger-service', group: 'work', rel: 'work/ledger-service', branch: 'main',
    lang: 'Go', dirty: 0, ahead: 0, behind: 0, updatedMin: 190,
    currentFile: 'internal/ledger/balance.go',
  },
  {
    id: 'docs-site', name: 'docs-site', group: 'work', rel: 'work/docs-site', branch: 'main',
    lang: 'MDX', dirty: 2, ahead: 0, behind: 0, updatedMin: 360,
    currentFile: 'content/guides/self-hosting.mdx',
  },
  {
    id: 'design-tokens', name: 'design-tokens', group: 'work', rel: 'work/design-tokens', branch: 'main',
    lang: 'CSS', dirty: 0, ahead: 0, behind: 0, updatedMin: 1440,
    currentFile: 'tokens/color.css',
  },
  {
    id: 'telemetry-relay', name: 'telemetry-relay', group: 'work', rel: 'work/telemetry-relay', branch: 'main',
    lang: 'Go', dirty: 0, ahead: 0, behind: 0, updatedMin: 1500,
    currentFile: 'pipeline/relay.go',
  },
  {
    id: 'infra-terraform', name: 'infra-terraform', group: 'work', rel: 'work/infra-terraform', branch: 'main',
    lang: 'HCL', dirty: 0, ahead: 0, behind: 0, updatedMin: 2880,
    currentFile: 'envs/prod/main.tf',
  },
  {
    id: 'vitest', name: 'vitest', group: 'oss', rel: 'oss/vitest', branch: 'main',
    lang: 'TypeScript', dirty: 0, ahead: 0, behind: 0, updatedMin: 1600,
    currentFile: 'packages/vitest/src/node/runner.ts',
  },
  {
    id: 'tanstack-query', name: 'tanstack-query', group: 'oss', rel: 'oss/tanstack-query', branch: 'main',
    lang: 'TypeScript', dirty: 0, ahead: 0, behind: 0, updatedMin: 3000,
    currentFile: 'packages/query-core/src/query.ts',
  },
  {
    id: 'shiki', name: 'shiki', group: 'oss', rel: 'oss/shiki', branch: 'main',
    lang: 'TypeScript', dirty: 0, ahead: 0, behind: 0, updatedMin: 4300,
    currentFile: 'packages/core/src/highlighter.ts',
  },
  {
    id: 'arktype', name: 'arktype', group: 'oss', rel: 'oss/arktype', branch: 'main',
    lang: 'TypeScript', dirty: 1, ahead: 0, behind: 0, updatedMin: 5800,
    currentFile: 'ark/schema/scope.ts',
  },
  {
    id: 'dotfiles', name: 'dotfiles', group: 'personal', rel: 'personal/dotfiles', branch: 'main',
    lang: 'Shell', dirty: 2, ahead: 0, behind: 0, updatedMin: 6200,
    currentFile: 'zsh/aliases.zsh',
  },
  {
    id: 'notes', name: 'notes', group: 'personal', rel: 'personal/notes', branch: 'main',
    lang: 'Markdown', dirty: 0, ahead: 0, behind: 0, updatedMin: 7000,
    currentFile: 'inbox/2026-11.md',
  },
  {
    id: 'blog', name: 'blog', group: 'personal', rel: 'personal/blog', branch: 'main',
    lang: 'MDX', dirty: 0, ahead: 0, behind: 0, updatedMin: 8300,
    currentFile: 'src/content/posts/agent-modes.mdx',
  },
  {
    id: 'design-refs', name: 'design-refs', group: 'personal', rel: 'personal/design-refs', branch: 'main',
    lang: 'JSON', dirty: 0, ahead: 0, behind: 0, updatedMin: 17000, excludedDefault: true,
    currentFile: 'refs/command-palette.json',
  },
  {
    id: 'wasm-playground', name: 'wasm-playground', group: 'labs', rel: 'labs/wasm-playground', branch: 'main',
    lang: 'Rust', dirty: 1, ahead: 0, behind: 0, updatedMin: 11500,
    currentFile: 'src/lib.rs',
  },
  {
    id: 'scratch-py', name: 'scratch-py', group: 'labs', rel: 'labs/scratch-py', branch: 'main',
    lang: 'Python', dirty: 0, ahead: 0, behind: 0, updatedMin: 14000,
    currentFile: 'scratch/ingest.py',
  },
  {
    id: 'old-prototype', name: 'old-prototype', group: 'labs', rel: 'labs/old-prototype', branch: 'main',
    lang: 'TypeScript', dirty: 0, ahead: 0, behind: 0, updatedMin: 49000, excludedDefault: true,
    currentFile: 'src/App.tsx',
  },
  {
    id: 'legacy-admin', name: 'legacy-admin', group: 'work', rel: 'work/legacy-admin', branch: 'main',
    lang: 'TypeScript', dirty: 0, ahead: 0, behind: 0, updatedMin: 86000, excludedDefault: true,
    currentFile: 'src/pages/Users.tsx',
  },
];

/* ================================================================ files */
const FILE_POOLS = {
  TypeScript: [
    'src/features/log/CommitGraph.tsx', 'src/features/log/graphLayout.ts', 'src/features/log/log.store.ts',
    'src/components/CommitComposer.tsx', 'src/terminal/agentSession.ts', 'src/terminal/agentProfiles.ts',
    'src/features/repos/RepoFinder.tsx', 'src/features/repos/repoIndex.ts', 'src/features/diff/SplitDiff.tsx',
    'src/editor/editorSelection.ts', 'src/editor/RevisionView.tsx', 'src/lib/search.ts',
    'src/persistence/drafts.ts', 'tests/commit-graph.test.ts', 'tests/repo-search.test.ts',
    'docs/agents.md', 'docs/keyboard-shortcuts.md', 'package.json', 'README.md',
  ],
  Go: [
    'internal/webhooks/dispatcher.go', 'internal/store/events.go', 'internal/auth/session.go',
    'cmd/server/main.go', 'pkg/retry/backoff.go', 'internal/ledger/balance.go',
    'pipeline/relay.go', 'internal/config/load.go', 'tests/webhook_test.go',
  ],
  Kotlin: [
    'app/src/main/java/dev/atlas/sync/SyncWorker.kt', 'app/src/main/java/dev/atlas/ui/Dashboard.kt',
    'app/src/main/java/dev/atlas/net/ApiClient.kt', 'app/src/test/java/dev/atlas/SyncWorkerTest.kt',
  ],
  Rust: [
    'crates/ledger/src/entry.rs', 'crates/ledger/src/balance.rs', 'crates/api/src/routes.rs',
    'crates/common/src/retry.rs', 'src/lib.rs', 'tests/parity.rs',
  ],
  MDX: [
    'content/guides/self-hosting.mdx', 'content/changelog/v0.9.mdx', 'app/routes/docs.tsx',
    'src/lib/nav.ts',
  ],
  CSS: ['tokens/color.css', 'tokens/spacing.css', 'tokens/motion.css', 'docs/usage.md'],
  Shell: ['.zshrc', 'zsh/aliases.zsh', 'zsh/functions.zsh', 'bin/sync-dotfiles', 'README.md'],
  Markdown: ['inbox/2026-11.md', 'notes/agent-workflows.md', 'journal/week-47.md', 'reading/cli-design.md'],
  Python: ['scratch/ingest.py', 'scratch/vectors.py', 'tests/test_ingest.py', 'notebooks/explore.py'],
  JSON: ['refs/command-palette.json', 'refs/navigation.json', 'schema/layout.json'],
  HCL: ['envs/prod/main.tf', 'envs/prod/variables.tf', 'modules/relay/main.tf', 'modules/relay/outputs.tf'],
};

const REPO_FILE_POOLS = {
  knit: FILE_POOLS.TypeScript,
  'orbit-web': [
    'src/app/dashboard/page.tsx', 'src/components/CommandMenu.tsx', 'src/lib/api.ts',
    'src/features/billing/PlanCard.tsx', 'src/app/layout.tsx', 'src/styles/globals.css', 'package.json',
  ],
  vitest: [
    'packages/vitest/src/node/runner.ts', 'packages/vitest/src/node/plugins/workspace.ts',
    'packages/runner/src/run.ts', 'test/core/test/runner.test.ts',
  ],
  'tanstack-query': [
    'packages/query-core/src/query.ts', 'packages/query-core/src/queryCache.ts',
    'packages/react-query/src/useQuery.ts', 'packages/query-core/src/__tests__/query.test.tsx',
  ],
  shiki: [
    'packages/core/src/highlighter.ts', 'packages/core/src/registry.ts',
    'packages/shiki/src/bundle-full.ts', 'packages/core/test/highlight.test.ts',
  ],
  arktype: [
    'ark/schema/scope.ts', 'ark/schema/constraint.ts', 'ark/type/type.ts',
    'ark/schema/__tests__/scope.test.ts',
  ],
  'telemetry-relay': FILE_POOLS.Go,
  'orbit-api': FILE_POOLS.Go,
  'ledger-service': FILE_POOLS.Go,
};

function poolFor(repo) {
  return REPO_FILE_POOLS[repo.id] || FILE_POOLS[repo.lang] || FILE_POOLS.TypeScript;
}

/* ================================================================= diffs */
const KNOWN_DIFFS = {
  'src/features/log/CommitGraph.tsx': {
    old: [
      'export function CommitLane({ commit, points }: LaneProps) {',
      '  return (',
      '    <svg className="lane" width={64} height={36}>',
      '      <polyline',
      '        points={points}',
      '        fill="none"',
      '        stroke={commit.color}',
      '      />',
      '      <circle cx={points.x} cy={18} r={4} />',
      '    </svg>',
      '  );',
      '}',
    ],
    new: [
      'export function CommitLane({ commit, index }: LaneProps) {',
      '  const layout = useGraphLayout(commit.lane);',
      '  const color = laneColor(commit.lane);',
      '',
      '  return (',
      '    <svg className="lane" width={64} height={36}>',
      '      {layout.active && (',
      '        <path',
      '          d={layout.curve(index)}',
      '          fill="none"',
      '          stroke={color}',
      '          strokeLinecap="round"',
      '          strokeWidth={2}',
      '        />',
      '      )}',
      '      <circle',
      '        cx={layout.x}',
      '        cy={18}',
      '        r={4}',
      '        fill="var(--bg)"',
      '        stroke={color}',
      '        strokeWidth={2}',
      '      />',
      '    </svg>',
      '  );',
      '}',
    ],
  },
  'src/features/log/graphLayout.ts': {
    old: [
      'const LANE_GAP = 24;',
      '',
      'export function laneOffset(lane: number) {',
      '  return lane * LANE_GAP + 12;',
      '}',
      '',
      'export function buildPath(points: Point[]) {',
      '  return points',
      '    .map((point) => `${point.x},${point.y}`)',
      '    .join(" ");',
      '}',
    ],
    new: [
      'const LANE_GAP = 22;',
      'const CURVE = 10;',
      '',
      'export const laneOffset = (lane: number) =>',
      '  lane * LANE_GAP + 12;',
      '',
      'export function buildPath(from: Point, to: Point) {',
      '  const dx = to.x - from.x;',
      '  const dy = to.y - from.y;',
      '',
      '  return [',
      '    `M ${from.x} ${from.y}`',
      '    `C ${from.x + dx * 0.4} ${from.y + CURVE},`',
      '    `  ${to.x - dx * 0.4} ${to.y - CURVE},`',
      '    `  ${to.x} ${to.y}`',
      '  ].join(" ");',
      '}',
    ],
  },
  'src/features/log/log.store.ts': {
    old: [
      'export function selectRows(state: LogState) {',
      '  return state.rows.filter((row) => row.visible);',
      '}',
      '',
      'export function selectActive(state: LogState) {',
      '  return state.rows.find((row) => row.hash === state.active);',
      '}',
    ],
    new: [
      'const selectRows = (state: LogState) =>',
      '  state.rows.filter((row) => row.visible);',
      '',
      'const selectActive = (state: LogState) =>',
      '  state.rows.find((row) => row.hash === state.active);',
      '',
      'export const selectVisible = (state: LogState) => {',
      '  const rows = selectRows(state);',
      '  const active = selectActive(state);',
      '',
      '  return rows.map((row) => ({',
      '    ...row,',
      '    active: row.hash === active?.hash,',
      '  }));',
      '};',
    ],
  },
  'src/styles/graph.css': {
    old: [
      '.lane polyline {',
      '  stroke-width: 1.5;',
      '  stroke-linejoin: miter;',
      '}',
      '',
      '.lane circle {',
      '  fill: var(--panel);',
      '  stroke-width: 1.5;',
      '}',
    ],
    new: [
      '.lane path {',
      '  stroke-width: 2;',
      '  stroke-linecap: round;',
      '  stroke-linejoin: round;',
      '  vector-effect: non-scaling-stroke;',
      '}',
      '',
      '.lane circle {',
      '  fill: var(--bg);',
      '  stroke-width: 2;',
      '  transition: r 120ms ease;',
      '}',
      '',
      '.commit-row:hover .lane circle {',
      '  r: 5;',
      '}',
    ],
  },
  'src/terminal/agentSession.ts': {
    old: [
      'import { spawn } from "node:child_process";',
      '',
      'export function startAgent(command: string, cwd: string) {',
      '  const child = spawn(command, {',
      '    cwd,',
      '    shell: true,',
      '    stdio: ["pipe", "pipe", "pipe"],',
      '  });',
      '',
      '  child.stdout.on("data", (chunk) => {',
      '    process.stdout.write(chunk);',
      '  });',
      '',
      '  return child;',
      '}',
    ],
    new: [
      'import { spawn } from "node:child_process";',
      'import { loadProfile } from "./agentProfiles";',
      '',
      'export function startAgent(profileId: string, cwd: string) {',
      '  const profile = loadProfile(profileId);',
      '  const child = spawn(profile.command, profile.args, {',
      '    cwd,',
      '    env: {',
      '      ...process.env,',
      '      KNIT_SKILLS: profile.skills.join(","),',
      '      KNIT_COMMIT: process.env.KNIT_COMMIT ?? "HEAD",',
      '    },',
      '    stdio: ["pipe", "pipe", "pipe"],',
      '  });',
      '',
      '  child.stdout.on("data", (chunk) => {',
      '    emit("agent.output", chunk.toString());',
      '  });',
      '',
      '  return child;',
      '}',
    ],
  },
  'src/components/CommitComposer.tsx': {
    old: [
      'export function CommitComposer({ repo }: Props) {',
      '  const [message, setMessage] = useState("");',
      '',
      '  async function commit() {',
      '    if (!message.trim()) return;',
      '    await api.commit(message);',
      '    setMessage("");',
      '  }',
      '',
      '  return (',
      '    <textarea',
      '      value={message}',
      '      onChange={(event) => setMessage(event.target.value)}',
      '    />',
      '  );',
      '}',
    ],
    new: [
      'export function CommitComposer({ repo }: Props) {',
      '  const [message, setMessage] = useDraft(repo.id);',
      '  const files = useCheckedFiles(repo);',
      '  const canCommit = message.trim() && files.length > 0;',
      '',
      '  async function commit() {',
      '    if (!canCommit) return;',
      '    await api.commit(message, files);',
      '    clearDraft(repo.id);',
      '    setMessage("");',
      '  }',
      '',
      '  return (',
      '    <>',
      '      <DraftHint repoId={repo.id} />',
      '      <textarea',
      '        value={message}',
      '        placeholder="Describe this change..."',
      '        onChange={(event) => setMessage(event.target.value)}',
      '      />',
      '      <button disabled={!canCommit} onClick={commit}>',
      '        Commit {files.length} files',
      '      </button>',
      '    </>',
      '  );',
      '}',
    ],
  },
  'src/features/repos/RepoFinder.tsx': {
    old: [
      'export function useVisibleRepos(repos: Repo[], query: string) {',
      '  return repos.filter((repo) =>',
      '    repo.name.toLowerCase().includes(query.toLowerCase()),',
      '  );',
      '}',
    ],
    new: [
      'export function useVisibleRepos(repos: Repo[], query: string) {',
      '  const index = useMemo(() => buildIndex(repos), [repos]);',
      '',
      '  return useMemo(() => {',
      '    const tokens = query.toLowerCase().split(/\\s+/);',
      '    return index',
      '      .search(tokens)',
      '      .map((hit) => hit.repo)',
      '      .sort((a, b) => a.lastActive - b.lastActive);',
      '  }, [index, query]);',
      '}',
    ],
  },
  'src/features/diff/SplitDiff.tsx': {
    old: [
      'function renderLine(line: DiffLine) {',
      '  return (',
      '    <div className={line.kind}>',
      '      <span className="ln">{line.number}</span>',
      '      <code>{line.text}</code>',
      '    </div>',
      '  );',
      '}',
    ],
    new: [
      'function renderLine(line: DiffLine) {',
      '  const ranges = wordDiff(line.left, line.right);',
      '',
      '  return (',
      '    <div className={line.kind}>',
      '      <span className="ln">{line.number}</span>',
      '      <code>',
      '        {ranges.map((range) => (',
      '          <mark key={range.start}>{range.text}</mark>',
      '        ))}',
      '      </code>',
      '    </div>',
      '  );',
      '}',
    ],
  },
  'package.json': {
    old: [
      '{',
      '  "name": "branchline",',
      '  "version": "0.4.0",',
      '  "scripts": {',
      '    "dev": "vite",',
      '    "test": "vitest run"',
      '  },',
      '  "dependencies": {',
      '    "react": "^19.0.0",',
      '    "react-dom": "^19.0.0"',
      '  }',
      '}',
    ],
    new: [
      '{',
      '  "name": "knit",',
      '  "version": "0.4.1",',
      '  "scripts": {',
      '    "dev": "vite",',
      '    "test": "vitest run"',
      '  },',
      '  "dependencies": {',
      '    "react": "^19.0.0",',
      '    "react-dom": "^19.0.0",',
      '    "@knit/agent-sdk": "^0.3.1"',
      '  },',
      '  "packageManager": "pnpm@10.4.0"',
      '}',
    ],
  },
};

const EXT_DIFFS = {
  tsx: [
    {
      old: [
        'export function Panel({ title }: PanelProps) {',
        '  return (',
        '    <section className="panel">',
        '      <h2>{title}</h2>',
        '      <Content />',
        '    </section>',
        '  );',
        '}',
      ],
      new: [
        'export function Panel({ title, dense }: PanelProps) {',
        '  return (',
        '    <section',
        '      className="panel"',
        '      data-density={dense ? "compact" : "cozy"}',
        '    >',
        '      <h2>{title}</h2>',
        '      <Content virtualized />',
        '    </section>',
        '  );',
        '}',
      ],
    },
    {
      old: [
        'export function Toolbar({ query, onQuery }: ToolbarProps) {',
        '  return (',
        '    <div className="toolbar">',
        '      <input value={query} onChange={onQuery} />',
        '    </div>',
        '  );',
        '}',
      ],
      new: [
        'export function Toolbar({ query, onQuery }: ToolbarProps) {',
        '  const deferred = useDeferredValue(query);',
        '',
        '  return (',
        '    <div className="toolbar">',
        '      <SearchInput',
        '        value={query}',
        '        onValueChange={onQuery}',
        '        placeholder="Filter commits"',
        '      />',
        '      <ResultCount query={deferred} />',
        '    </div>',
        '  );',
        '}',
      ],
    },
  ],
  ts: [
    {
      old: [
        'export function retryDelay(attempt: number) {',
        '  return attempt * 250;',
        '}',
      ],
      new: [
        'const MAX_DELAY = 5_000;',
        '',
        'export function retryDelay(attempt: number) {',
        '  const jitter = Math.random() * 120;',
        '  return Math.min(attempt * 250 + jitter, MAX_DELAY);',
        '}',
      ],
    },
    {
      old: [
        'export function indexRepos(repos: Repo[]) {',
        '  const index = new Map<string, Repo>();',
        '  repos.forEach((repo) => index.set(repo.id, repo));',
        '  return index;',
        '}',
      ],
      new: [
        'export function indexRepos(repos: Repo[]) {',
        '  const index = new Map<string, Repo>();',
        '',
        '  repos.forEach((repo) => {',
        '    index.set(repo.id, repo);',
        '    index.set(repo.slug.toLowerCase(), repo);',
        '    index.set(repo.branch.toLowerCase(), repo);',
        '  });',
        '',
        '  return index;',
        '}',
      ],
    },
  ],
  go: [
    {
      old: [
        'func (s *Server) HandleEvent(w http.ResponseWriter, r *http.Request) {',
        '\tvar event Event',
        '\tif err := json.NewDecoder(r.Body).Decode(&event); err != nil {',
        '\t\thttp.Error(w, "invalid payload", http.StatusBadRequest)',
        '\t\treturn',
        '\t}',
        '',
        '\ts.queue.Push(event)',
        '\tw.WriteHeader(http.StatusAccepted)',
        '}',
      ],
      new: [
        'func (s *Server) HandleEvent(w http.ResponseWriter, r *http.Request) {',
        '\tctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)',
        '\tdefer cancel()',
        '',
        '\tvar event Event',
        '\tif err := json.NewDecoder(r.Body).Decode(&event); err != nil {',
        '\t\thttp.Error(w, "invalid payload", http.StatusBadRequest)',
        '\t\treturn',
        '\t}',
        '',
        '\tif err := s.queue.Push(ctx, event); err != nil {',
        '\t\ts.log.Error("enqueue failed", "err", err)',
        '\t\thttp.Error(w, "unavailable", http.StatusServiceUnavailable)',
        '\t\treturn',
        '\t}',
        '',
        '\tw.WriteHeader(http.StatusAccepted)',
        '}',
      ],
    },
    {
      old: [
        'func (p *Pipeline) Flush() error {',
        '\tfor _, batch := range p.batches {',
        '\t\tif err := p.send(batch); err != nil {',
        '\t\t\treturn err',
        '\t\t}',
        '\t}',
        '\treturn nil',
        '}',
      ],
      new: [
        'func (p *Pipeline) Flush(ctx context.Context) error {',
        '\tgroup, ctx := errgroup.WithContext(ctx)',
        '',
        '\tfor _, batch := range p.batches {',
        '\t\tbatch := batch',
        '\t\tgroup.Go(func() error {',
        '\t\t\treturn p.send(ctx, batch)',
        '\t\t})',
        '\t}',
        '',
        '\treturn group.Wait()',
        '}',
      ],
    },
  ],
  rs: [
    {
      old: [
        'pub fn apply(entry: &mut Entry, delta: i64) -> Result<(), LedgerError> {',
        '    entry.balance += delta;',
        '    entry.version += 1;',
        '    Ok(())',
        '}',
      ],
      new: [
        'pub fn apply(entry: &mut Entry, delta: i64) -> Result<(), LedgerError> {',
        '    let next = entry',
        '        .balance',
        '        .checked_add(delta)',
        '        .ok_or(LedgerError::Overflow)?;',
        '',
        '    entry.balance = next;',
        '    entry.version = entry.version.wrapping_add(1);',
        '    entry.touch();',
        '    Ok(())',
        '}',
      ],
    },
    {
      old: [
        'pub async fn send(&self, batch: Batch) -> Result<(), Error> {',
        '    let body = serde_json::to_vec(&batch)?;',
        '    self.client.post(self.url).body(body).send().await?;',
        '    Ok(())',
        '}',
      ],
      new: [
        'pub async fn send(&self, batch: Batch) -> Result<(), Error> {',
        '    let body = serde_json::to_vec(&batch)?;',
        '    let mut attempt = 0;',
        '',
        '    loop {',
        '        match self.post(&body).await {',
        '            Ok(_) => return Ok(()),',
        '            Err(_) if attempt < 3 => attempt += 1,',
        '            Err(err) => return Err(err),',
        '        }',
        '    }',
        '}',
      ],
    },
  ],
  kt: [
    {
      old: [
        'override fun doWork(): Result {',
        '    val batch = api.pull()',
        '    store.write(batch)',
        '    return Result.success()',
        '}',
      ],
      new: [
        'override fun doWork(): Result {',
        '    return runCatching {',
        '        val batch = api.pull()',
        '        store.write(batch)',
        '        Result.success()',
        '    }.getOrElse { error ->',
        '        if (runAttemptCount < 3) Result.retry()',
        '        else Result.failure(error)',
        '    }',
        '}',
      ],
    },
    {
      old: [
        'class DashboardViewModel(private val repo: Repo) {',
        '    val state = MutableStateFlow(DashboardState())',
        '}',
      ],
      new: [
        'class DashboardViewModel(private val repo: Repo) {',
        '    private val _state = MutableStateFlow(DashboardState())',
        '    val state = _state.asStateFlow()',
        '',
        '    fun refresh() = viewModelScope.launch {',
        '        _state.update { it.copy(loading = true) }',
        '        _state.update { it.copy(loading = false) }',
        '    }',
        '}',
      ],
    },
  ],
  py: [
    {
      old: [
        'def ingest(rows):',
        '    out = []',
        '    for row in rows:',
        '        out.append(normalize(row))',
        '    return out',
      ],
      new: [
        'def ingest(rows, batch_size=500):',
        '    out = []',
        '    for batch in chunked(rows, batch_size):',
        '        cleaned = (normalize(row) for row in batch)',
        '        out.extend(r for r in cleaned if r is not None)',
        '    return out',
      ],
    },
  ],
  sh: [
    {
      old: [
        'alias gs="git status"',
        'alias gl="git log --oneline --graph"',
        'alias gd="git diff"',
      ],
      new: [
        'alias gs="git status --short --branch"',
        'alias gl="git log --oneline --graph -n 20"',
        'alias gd="git diff --stat"',
        'alias gco="git checkout"',
        '',
        'knit() {',
        '  command knit-terminal --cwd "$PWD" "$@"',
        '}',
      ],
    },
    {
      old: [
        'function sync_dotfiles() {',
        '  rsync -av ~/dotfiles/zsh ~/.config/zsh',
        '}',
      ],
      new: [
        'function sync_dotfiles() {',
        '  local root="${1:-$HOME/dotfiles}"',
        '  rsync -av --delete "$root/zsh/" ~/.config/zsh/',
        '  rsync -av "$root/gitconfig" ~/.gitconfig',
        '}',
      ],
    },
  ],
  css: [
    {
      old: [
        ':root {',
        '  --radius-sm: 4px;',
        '  --radius-md: 6px;',
        '  --surface: #fff;',
        '}',
      ],
      new: [
        ':root {',
        '  --radius-sm: 5px;',
        '  --radius-md: 8px;',
        '  --radius-lg: 12px;',
        '  --surface: color-mix(in oklab, #fff 92%, #eef2ff);',
        '  --focus-ring: 0 0 0 2px rgb(91 140 255 / 0.3);',
        '}',
      ],
    },
    {
      old: [
        '.button {',
        '  border-radius: var(--radius-sm);',
        '  background: var(--accent);',
        '}',
      ],
      new: [
        '.button {',
        '  border-radius: var(--radius-md);',
        '  background: var(--accent);',
        '  transition: background 120ms ease;',
        '}',
        '',
        '.button:focus-visible {',
        '  box-shadow: var(--focus-ring);',
        '}',
      ],
    },
  ],
  json: [
    {
      old: [
        '{',
        '  "version": 1,',
        '  "providers": ["openai"],',
        '  "timeout": 30',
        '}',
      ],
      new: [
        '{',
        '  "version": 2,',
        '  "providers": ["openai", "anthropic"],',
        '  "timeout": 60,',
        '  "retries": 3',
        '}',
      ],
    },
  ],
  md: [
    {
      old: [
        '## Local development',
        '',
        'Run the dev server:',
        '',
        '```bash',
        'pnpm dev',
        '```',
      ],
      new: [
        '## Local development',
        '',
        'Run the dev server:',
        '',
        '```bash',
        'pnpm install',
        'pnpm dev --host 0.0.0.0',
        '```',
        '',
        'The workspace index is cached in `.knit/index.json`.',
      ],
    },
    {
      old: [
        '## Keyboard shortcuts',
        '',
        '- `G` — open the commit graph',
        '- `T` — toggle the terminal',
      ],
      new: [
        '## Keyboard shortcuts',
        '',
        '- `G` — open the commit graph',
        '- `T` — toggle the terminal',
        '- `K` — search repositories',
        '- `F` — locate the current file history',
      ],
    },
  ],
  yaml: [
    {
      old: [
        'replicas: 1',
        'image: relay:0.8.2',
        'resources:',
        '  limits:',
        '    memory: 256Mi',
      ],
      new: [
        'replicas: 3',
        'image: relay:0.9.0',
        'resources:',
        '  requests:',
        '    cpu: 100m',
        '  limits:',
        '    memory: 512Mi',
        'readinessProbe:',
        '  periodSeconds: 5',
      ],
    },
  ],
  tf: [
    {
      old: [
        'resource "aws_lambda_function" "relay" {',
        '  function_name = "relay"',
        '  memory_size   = 256',
        '  timeout       = 10',
        '}',
      ],
      new: [
        'resource "aws_lambda_function" "relay" {',
        '  function_name = "relay"',
        '  memory_size   = 512',
        '  timeout       = 30',
        '',
        '  environment {',
        '    variables = {',
        '      QUEUE_URL = aws_sqs_queue.events.url',
        '    }',
        '  }',
        '}',
      ],
    },
  ],
};

const EXT_ALIAS = {
  tsx: 'tsx', jsx: 'tsx', ts: 'ts', js: 'ts', mjs: 'ts', cjs: 'ts',
  go: 'go', rs: 'rs', kt: 'kt', kts: 'kt', py: 'py', sh: 'sh', zsh: 'sh',
  bash: 'sh', css: 'css', json: 'json', md: 'md', mdx: 'md', yaml: 'yaml',
  yml: 'yaml', tf: 'tf', hcl: 'tf', toml: 'yaml',
};

function templateFor(path) {
  if (KNOWN_DIFFS[path]) return KNOWN_DIFFS[path];
  const alias = EXT_ALIAS[extOf(path)] || 'ts';
  const list = EXT_DIFFS[alias] || EXT_DIFFS.ts;
  return list[hashString(path) % list.length];
}

function langForPath(path) {
  const ext = extOf(path);
  if (ext === 'tsx' || ext === 'jsx') return 'tsx';
  return EXT_ALIAS[ext] || 'ts';
}

/* ============================================================ code coloring */
const CODE_KEYWORDS = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'import', 'from',
  'export', 'default', 'class', 'extends', 'new', 'async', 'await', 'true', 'false', 'null',
  'undefined', 'type', 'interface', 'using', 'pub', 'fn', 'struct', 'impl', 'match', 'mut',
  'package', 'func', 'defer', 'go', 'chan', 'select', 'case', 'switch', 'break', 'continue',
  'int', 'string', 'bool', 'error', 'val', 'fun', 'override', 'private', 'public', 'when',
  'def', 'in', 'not', 'and', 'or', 'None', 'True', 'False', 'self', 'require', 'resource',
  'module', 'variable', 'locals', 'provider',
];
const KEYWORD_RE = new RegExp(`\\b(${CODE_KEYWORDS.join('|')})\\b`);

function highlightCode(raw, lang) {
  const code = String(raw ?? '');
  if (lang === 'md' || lang === 'txt') return esc(code);

  const commentSource = ['py', 'sh', 'yaml', 'tf'].includes(lang)
    ? '#[^\\n]*'
    : (lang === 'css' || lang === 'json' ? '\\/\\*[\\s\\S]*?\\*\\/' : '\\/\\/[^\\n]*');
  const source = `(${commentSource})|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|\\b(${CODE_KEYWORDS.join('|')})\\b|\\b(\\d+(?:\\.\\d+)?)\\b`;
  const re = new RegExp(source, 'g');
  let out = '';
  let last = 0;
  let match;
  while ((match = re.exec(code)) !== null) {
    out += esc(code.slice(last, match.index));
    if (match[1]) out += `<span class="tok-com">${esc(match[1])}</span>`;
    else if (match[2]) out += `<span class="tok-str">${esc(match[2])}</span>`;
    else if (match[3]) out += `<span class="tok-kw">${esc(match[3])}</span>`;
    else if (match[4]) out += `<span class="tok-num">${esc(match[4])}</span>`;
    last = re.lastIndex;
    if (match[0] === '') re.lastIndex += 1;
  }
  out += esc(code.slice(last));
  return out;
}

/* ========================================================== diff computation */
function lineOps(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'same', text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: oldLines[i] });
      i += 1;
    } else {
      ops.push({ type: 'add', text: newLines[j] });
      j += 1;
    }
  }
  while (i < n) { ops.push({ type: 'del', text: oldLines[i] }); i += 1; }
  while (j < m) { ops.push({ type: 'add', text: newLines[j] }); j += 1; }
  return ops;
}

function computeDiff(oldText, newText, lang) {
  const oldLines = String(oldText ?? '').split('\n').filter((line, idx, arr) => !(idx === 0 && line === ''));
  const newLines = String(newText ?? '').split('\n').filter((line, idx, arr) => !(idx === 0 && line === ''));
  while (oldLines.length && oldLines[oldLines.length - 1] === '') oldLines.pop();
  while (newLines.length && newLines[newLines.length - 1] === '') newLines.pop();

  const ops = lineOps(oldLines, newLines);
  const base = 24;
  let oldNo = base;
  let newNo = base;
  let additions = 0;
  let deletions = 0;
  const annotated = ops.map((op) => {
    if (op.type === 'same') {
      oldNo += 1;
      newNo += 1;
      return { type: 'same', text: op.text, oldNo, newNo };
    }
    if (op.type === 'del') {
      oldNo += 1;
      deletions += 1;
      return { type: 'del', text: op.text, oldNo, newNo: null };
    }
    newNo += 1;
    additions += 1;
    return { type: 'add', text: op.text, oldNo: null, newNo };
  });

  const splitRows = [];
  let idx = 0;
  while (idx < annotated.length) {
    const item = annotated[idx];
    if (item.type === 'same') {
      splitRows.push({ left: item, right: item, kind: 'same' });
      idx += 1;
    } else {
      const dels = [];
      const adds = [];
      while (idx < annotated.length && annotated[idx].type !== 'same') {
        if (annotated[idx].type === 'del') dels.push(annotated[idx]);
        else adds.push(annotated[idx]);
        idx += 1;
      }
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k += 1) {
        splitRows.push({
          left: dels[k] || null,
          right: adds[k] || null,
          kind: dels[k] && adds[k] ? 'change' : (dels[k] ? 'del' : 'add'),
        });
      }
    }
  }

  const oldStart = oldLines.length ? base + 1 : 0;
  const newStart = newLines.length ? base + 1 : 0;
  return {
    lang,
    oldLines,
    newLines,
    splitRows,
    unifiedRows: annotated,
    additions,
    deletions,
    hunk: `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`,
  };
}

function buildFileDiff(repoId, marker, file) {
  const cacheKey = `${repoId}|${marker}|${file.path}|${file.status}`;
  if (buildFileDiff.cache.has(cacheKey)) return buildFileDiff.cache.get(cacheKey);
  const template = templateFor(file.path);
  const oldLines = (file.status === 'A' || file.status === 'U' || file.untracked) ? [] : template.old;
  const newLines = file.status === 'D' ? [] : template.new;
  const result = computeDiff(oldLines.join('\n'), newLines.join('\n'), langForPath(file.path));
  buildFileDiff.cache.set(cacheKey, result);
  return result;
}
buildFileDiff.cache = new Map();

/* ============================================================ text assets */
const FILE_NOTES_ZH = {
  'src/features/log/CommitGraph.tsx': '用 cubic path 替换折线，fork / join 复用同一曲线半径',
  'src/features/log/graphLayout.ts': '抽出布局缓存，避免逐行测量 lane 偏移',
  'src/styles/graph.css': '统一 SVG 描边与 hover 半径，补上非缩放描边',
  'src/terminal/agentSession.ts': '把会话生命周期从面板里拆出，按 profile 注入 skill 环境变量',
  'src/features/log/log.store.ts': '把可见行与 active 行的派生逻辑收敛到同一个 selector',
  'src/components/CommitComposer.tsx': '接入按仓库记忆的草稿与勾选状态',
  'src/features/repos/RepoFinder.tsx': '搜索改为对预热索引做多 token 匹配',
  'src/features/diff/SplitDiff.tsx': '并排 diff 增加 word-level 高亮区间',
  'package.json': '重命名包并补充 agent sdk 依赖',
  'internal/webhooks/dispatcher.go': '为 webhook 入队补上超时与队列错误处理',
  'pipeline/relay.go': '并行发送批量事件并聚合错误',
  'crates/ledger/src/entry.rs': '余额累加使用 checked_add，补充版本与 touch',
  'crates/api/src/routes.rs': '路由层补充幂等键参数',
  'app/src/main/java/dev/atlas/sync/SyncWorker.kt': '同步任务加入重试和 Result.retry 分支',
  'app/src/main/java/dev/atlas/ui/Dashboard.kt': 'Dashboard 状态改用 StateFlow 暴露',
  'scratch/ingest.py': '按 batch 切分数据清洗，避免一次性加载',
  'zsh/aliases.zsh': '补全日常别名与终端启动入口',
  'content/guides/self-hosting.mdx': '补充自托管环境变量与索引缓存说明',
  'tokens/color.css': '统一圆角与 focus ring 变量',
};

const FILE_NOTES_EN = {
  'src/features/log/CommitGraph.tsx': 'render fork and join lanes with rounded curve paths',
  'src/features/log/graphLayout.ts': 'reuse cached lane offsets between layout passes',
  'src/styles/graph.css': 'align lane stroke styling with the new graph geometry',
  'src/terminal/agentSession.ts': 'isolate agent session lifecycle and skill env injection',
  'src/features/log/log.store.ts': 'derive visible and active rows through one selector',
  'src/components/CommitComposer.tsx': 'remember commit drafts per repository',
  'src/features/repos/RepoFinder.tsx': 'search a warm index with multi-token matching',
  'src/features/diff/SplitDiff.tsx': 'add word-level highlight ranges to the split diff',
  'package.json': 'rename the package and add the agent sdk dependency',
};

function fileNoteZh(path) {
  return FILE_NOTES_ZH[path] || `更新 ${basename(path)} 以覆盖新的交互路径`;
}
function fileNoteEn(path) {
  return FILE_NOTES_EN[path] || `align ${basename(path)} with the updated flow`;
}

function pickScope(files) {
  const found = [];
  const add = (scope) => { if (!found.includes(scope)) found.push(scope); };
  files.forEach((file) => {
    const p = file.path.toLowerCase();
    if (/graph|commitgraph|log\./.test(p)) add('log');
    if (/terminal|agent/.test(p)) add('terminal');
    if (/diff/.test(p)) add('diff');
    if (/repo|search|finder|index/.test(p)) add('repos');
    if (/composer|commit/.test(p)) add('commit');
    if (/editor|selection/.test(p)) add('editor');
    if (/webhook/.test(p)) add('webhooks');
    if (/ledger|balance|payment/.test(p)) add('ledger');
    if (/syncworker|sync/.test(p)) add('sync');
    if (/\.md$|\.mdx$|docs\//.test(p)) add('docs');
    if (/test|spec/.test(p)) add('tests');
  });
  return found;
}

function buildCommitSuggestion(repo, files) {
  const scopes = pickScope(files);
  const allDocs = files.every((file) => /\.(md|mdx)$/.test(file.path));
  const allTests = files.every((file) => /test|spec/.test(file.path));
  const type = allDocs ? 'docs' : (allTests ? 'test' : 'feat');
  const scope = scopes[0] || repo.name.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'core';

  let subject;
  if (files.some((file) => file.path.includes('CommitGraph'))) {
    subject = 'polish commit lanes and agent handoff';
  } else if (files.some((file) => file.path.includes('agentSession'))) {
    subject = 'carry agent context across sessions';
  } else if (scopes.length >= 2) {
    subject = `streamline ${scopes[0]} and ${scopes[1]} workflows`;
  } else {
    subject = `update ${scope} workflow for the new layout`;
  }

  const notes = [];
  files.forEach((file) => {
    const note = fileNoteEn(file.path);
    if (!notes.includes(note)) notes.push(note);
  });
  if (!notes.length) notes.push('refresh snapshots for the updated behavior');
  if (notes.length < 2) notes.push('keep the existing behavior unchanged on the default path');
  const bullets = notes.slice(0, 3).map((note) => `- ${note}`).join('\n');
  return `${type}(${scope}): ${subject}\n\n${bullets}`;
}

function buildAgentAnalysis(repo, commit) {
  if (!commit) {
    const files = repo.workingChanges;
    if (!files.length) return `当前工作区是干净的，没有可供分析的未提交改动。可以选中一个提交让我解释 diff。`;
    const lines = files.slice(0, 4).map((file) => `• \`${basename(file.path)}\` — ${fileNoteZh(file.path)}`);
    return `当前处于工作区上下文，共 ${files.length} 个未提交文件：\n\n${lines.join('\n')}\n\n建议先跑 \`test/${repo.id === 'knit' ? 'commit-graph' : 'smoke'}\` 覆盖主要路径，再决定提交粒度。`;
  }
  const files = commit.files;
  const lines = files.slice(0, 4).map((file) => `• \`${basename(file.path)}\` — ${fileNoteZh(file.path)}`);
  const prefix = commit.isMerge ? '这是一个 merge commit，' : '';
  return `提交 \`${commit.hash.slice(0, 7)}\` · ${commit.subject}\n\n${prefix}改动集中在 ${files.length} 个文件：\n\n${lines.join('\n')}\n\n风险点：建议重点检查 lane 切换与选择状态在快速刷新下的边界情况；如果这是 UI 改动，补一张 merge 分支的快照会很有价值。`;
}

/* ========================================================== repo generation */
const SUBJECT_SCOPES = ['log', 'diff', 'terminal', 'search', 'sync', 'auth', 'cache', 'api', 'ui', 'config', 'repos', 'graph', 'tests', 'docs', 'queue', 'webhooks', 'ledger', 'mobile', 'editor'];
const SUBJECT_ACTIONS = [
  'keep repository search responsive while scanning',
  'handle stale drafts after a force checkout',
  'reduce re-renders in the commit list',
  'guard against empty diff hunks',
  'normalize retry backoff across services',
  'surface sync errors in the status bar',
  'split the diff pipeline into pure steps',
  'cache lane offsets between layout passes',
  'align agent banner with terminal tabs',
  'drop unused highlight rules from the bundle',
  'add regression coverage for detached HEAD',
  'document the new agent profile flags',
  'avoid an extra round trip on cold start',
  'stabilize cursor position after undo',
  'retry webhook delivery with jitter',
  'tighten permission checks on session refresh',
  'reuse pending request caches on focus',
  'collapse duplicate remote refs',
  'preserve scroll position when switching tabs',
  'make the empty state actionable',
  'dedupe file history entries by rename',
  'keep drafts isolated per repository',
  'batch token refreshes during reconnect',
  'clamp selection after a document swap',
];
const BODY_OPENERS = [
  'Keeps the default path unchanged while removing an unnecessary round trip.',
  'This unblocks the next step of the refactor and keeps existing snapshots green.',
  'The previous implementation scanned more data than it needed to.',
  'A small follow-up after the related selection fix.',
  'Prepares the surface for the agent handoff that follows.',
  'No behavior change for repositories without a remote.',
];
const BODY_BULLETS = [
  'guard against stale selection after refresh',
  'reuse the cached index instead of rebuilding it',
  'add regression coverage for detached HEAD',
  'skip empty hunks in the renderer',
  'keep the previous behavior behind a flag',
  'make the failure path visible in the status bar',
  'reduce the number of repeated layout passes',
  'cover the multi-cursor undo path',
  'normalize error messages across adapters',
  'update shortcut docs with the new chord',
];

function genSubject(rng, avoid) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const type = pickOne(rng, ['feat', 'fix', 'fix', 'refactor', 'perf', 'test', 'chore', 'docs']);
    const scope = pickOne(rng, SUBJECT_SCOPES);
    const action = pickOne(rng, SUBJECT_ACTIONS);
    const subject = `${type}(${scope}): ${action}`;
    if (subject !== avoid) return subject;
  }
  return `chore(core): refresh generated fixtures`;
}

function genBody(rng) {
  const opener = pickOne(rng, BODY_OPENERS);
  const bullets = new Set();
  let guard = 0;
  while (bullets.size < 3 && guard < 30) {
    bullets.add(pickOne(rng, BODY_BULLETS));
    guard += 1;
  }
  return `${opener}\n\n${Array.from(bullets).map((bullet) => `- ${bullet}`).join('\n')}`;
}

function refType(name) {
  if (/^v\d/.test(name)) return 'tag';
  if (name.startsWith('origin/')) return 'remote';
  return 'branch';
}

function planRegions(repo, count) {
  const rng = repo._rng;
  const branches = ['fix/sync-retry', 'feat/lazy-diff', 'perf/index-cache', 'feat/agent-presets', 'fix/selection-state', 'refactor/queue'];
  const firstIndex = Math.floor(rng() * branches.length);
  const forkA = randInt(rng, 3, 5);
  let baseA = forkA + randInt(rng, 4, 6);
  baseA = Math.min(baseA, count - 9);
  const plans = [{
    lane: 1,
    branch: branches[firstIndex],
    forkIndex: forkA,
    baseIndex: Math.max(forkA + 3, baseA),
  }];
  const forkB = plans[0].baseIndex + randInt(rng, 2, 3);
  const baseB = forkB + randInt(rng, 4, 5);
  if (baseB < count - 2) {
    plans.push({
      lane: 2,
      branch: branches[(firstIndex + 2) % branches.length],
      forkIndex: forkB,
      baseIndex: baseB,
    });
  }
  return plans;
}

function genFiles(repo, rng, index, isMerge) {
  const pool = poolFor(repo);
  const paths = new Set();
  if (index === 0 || index % 4 === 0) paths.add(repo.currentFile);
  const target = 2 + randInt(rng, 0, 2) + (isMerge ? 1 : 0);
  let guard = 0;
  while (paths.size < target && guard < 80) {
    paths.add(pool[Math.floor(rng() * pool.length)]);
    guard += 1;
  }
  if (!paths.size) paths.add(repo.currentFile);
  return Array.from(paths).slice(0, 5).map((path) => {
    const r = rng();
    const status = r < 0.08 ? 'A' : (r < 0.13 ? 'D' : 'M');
    return { path, status };
  });
}

function orgName(repo) {
  return repo.group === 'oss' ? 'upstream' : (repo.group === 'work' ? 'orbit-labs' : 'knit-git');
}

function buildGeneratedRepo(repo) {
  const rng = repo._rng;
  const plans = planRegions(repo, 22);
  const tagVersion = `v${randInt(rng, 1, 3)}.${randInt(rng, 0, 9)}.0`;
  let ts = Date.now() - (repo.updatedMin + 25 + randInt(rng, 0, 80)) * 60000;
  const commits = [];
  const org = orgName(repo);

  for (let i = 0; i < 22; i += 1) {
    const region = plans.find((plan) => i > plan.forkIndex && i < plan.baseIndex);
    const forkPlan = plans.find((plan) => plan.forkIndex === i);
    const isMerge = Boolean(forkPlan);
    let subject;
    let body;
    if (isMerge) {
      subject = `Merge pull request #${randInt(rng, 120, 820)} from ${org}/${forkPlan.branch}`;
      body = `Merge ${forkPlan.branch} into ${repo.branch}.\n\n- keep the main lane stable\n- resolve snapshot drift after rebase`;
    } else {
      const previous = commits[commits.length - 1]?.subject;
      subject = genSubject(rng, previous);
      body = genBody(rng);
    }
    const author = (i === 1 || i % 6 === 1)
      ? PEOPLE.z
      : AUTHOR_POOL[Math.floor(rng() * AUTHOR_POOL.length)];
    const refs = [];
    if (i === 0) {
      refs.push({ name: repo.branch, type: 'branch' });
      if (rng() < 0.78) refs.push({ name: `origin/${repo.branch}`, type: 'remote' });
    }
    const baseA = plans[0]?.baseIndex ?? 8;
    if (i === baseA) refs.push({ name: tagVersion, type: 'tag' });
    if (repo.branch !== 'main' && i === (plans[1]?.baseIndex ?? baseA)) {
      refs.push({ name: 'main', type: 'branch' });
    }
    if (repo.branch === 'main' && i === baseA + 1) {
      refs.push({ name: 'origin/main', type: 'remote' });
    }
    commits.push({
      hash: makeHash(rng),
      subject,
      body,
      author,
      date: ts,
      lane: region ? region.lane : 0,
      isMerge,
      files: genFiles(repo, rng, i, isMerge),
      refs,
      parents: [],
    });
    ts -= (2 + Math.floor(rng() * 18)) * 3600e3;
  }

  repo.commits = commits;
  repo.regions = plans.map((plan) => ({
    branch: plan.branch,
    lane: plan.lane,
    forkHash: commits[plan.forkIndex].hash,
    baseHash: commits[plan.baseIndex].hash,
  }));
}

const KNIT_CURATED = [
  {
    who: 'z', hours: 2,
    subject: 'feat(log): draw merge lanes with rounded curves',
    body: 'Replace the elbow polylines with cubic curves so fork and join rows\nread as a single track. Lane spacing now comes from the layout cache\ninstead of measuring every row.\n\n- unify curve radii for fork / join\n- keep lane colors stable after rebase\n- add snapshot coverage for octopus merges',
    files: ['src/features/log/CommitGraph.tsx', 'src/features/log/graphLayout.ts', 'src/styles/graph.css'],
    refs: ['main', 'origin/main'],
  },
  {
    who: 'mia', hours: 6,
    subject: 'fix(search): avoid re-indexing when the finder regains focus',
    body: 'The finder was rebuilding its trie on every focus event. Keep the\nindex warm for the lifetime of the workspace and invalidate it only\nwhen a repository is added or removed.\n\n- debounce scan progress events\n- cancel in-flight index builds on unmount',
    files: ['src/features/repos/RepoFinder.tsx', 'src/features/repos/repoIndex.ts'],
    refs: [],
  },
  {
    who: 'z', hours: 9, merge: true,
    subject: "Merge pull request #184 from knit-git/fix/editor-selection",
    body: 'Preserve the editor selection while stepping through revisions.\n\n- restore caret snapshots after async loads\n- clamp stale ranges before applying',
    files: ['src/editor/editorSelection.ts', 'src/editor/RevisionView.tsx', 'src/features/log/CommitGraph.tsx'],
    refs: [],
  },
  {
    who: 'ava', hours: 13,
    subject: 'fix(editor): retain selection when stepping through revisions',
    body: 'Store a caret snapshot before swapping the document, then restore it\nonce the new revision has parsed.\n\n- skip restore when the user has moved the caret\n- cover multi-cursor undo',
    files: ['src/editor/editorSelection.ts', 'src/editor/RevisionView.tsx'],
    refs: [],
  },
  {
    who: 'leo', hours: 17,
    subject: 'fix(editor): guard caret restore against removed ranges',
    body: 'A stale snapshot could point past the end of the new document after\na rebase or a partial revert. Clamp every range before applying it.',
    files: ['src/editor/editorSelection.ts'],
    refs: [],
  },
  {
    who: 'mia', hours: 21,
    subject: 'test(editor): cover multi-cursor undo regression',
    body: 'Adds a regression spec for multi-cursor selections that cross an\nundo boundary. Reproduces #181.',
    files: ['tests/selection.test.ts'],
    refs: [],
  },
  {
    who: 'ava', hours: 26,
    subject: 'fix(editor): clamp restored offsets to document length',
    body: 'Follow-up for #181. Clamp both the anchor and head offsets and fall\nback to the document end when a range cannot be restored.',
    files: ['src/editor/editorSelection.ts', 'tests/selection.test.ts'],
    refs: [],
  },
  {
    who: 'leo', hours: 30,
    subject: 'chore(editor): extract selection snapshot helpers',
    body: 'Pulls snapshot/restore into a tiny module so the revision view and\nthe diff editor can share the same behavior.',
    files: ['src/editor/editorSelection.ts', 'src/editor/RevisionView.tsx'],
    refs: [],
  },
  {
    who: 'z', hours: 36,
    subject: 'perf(log): cache graph layout between renders',
    body: 'The commit graph recomputed lane offsets on every selection change,\nwhich dominated render time for larger logs. Memoize the layout per\ncommit list and invalidate it when rows are added.\n\n- reuse the layout across diff toggles\n- keep selected-row highlighting off the hot path',
    files: ['src/features/log/CommitGraph.tsx', 'src/features/log/graphLayout.ts'],
    refs: ['v0.4.1'],
  },
  {
    who: 'mia', hours: 42,
    subject: 'feat(diff): add word-level highlights to the split view',
    body: 'Pair changed lines and mark the smallest changed spans so reviewers\ncan spot edits without reading both lines.\n\n- cache token spans per line\n- keep the unified view unchanged',
    files: ['src/features/diff/SplitDiff.tsx', 'src/features/diff/wordDiff.ts'],
    refs: [],
  },
  {
    who: 'z', hours: 50, merge: true,
    subject: "Merge branch 'feat/agent-modes' into main",
    body: 'Adds read and commit agent presets to the terminal panel. Skills are\nloaded from the user profile before the session starts.',
    files: ['src/terminal/agentProfiles.ts', 'src/terminal/agentSession.ts'],
    refs: [],
  },
  {
    who: 'z', hours: 56,
    subject: 'feat(terminal): add read and commit agent presets',
    body: 'Each agent tab can boot in read, commit, or free mode. The mode\ndecides which fixed skills are preloaded for the session.',
    files: ['src/terminal/agentProfiles.ts'],
    refs: [],
  },
  {
    who: 'ava', hours: 62,
    subject: 'feat(terminal): preload configured skills per mode',
    body: 'Read mode boots `understanding-anything` and `codebase-index`;\ncommit mode boots `commit-craft` and `diff-digest`. The enabled set\ncomes from the user profile.',
    files: ['src/terminal/agentProfiles.ts', 'config/skills.json'],
    refs: [],
  },
  {
    who: 'leo', hours: 69,
    subject: 'feat(terminal): stream agent output into the session log',
    body: 'Attach stdout/stderr to the active session so switching tabs keeps\nthe transcript. Add a compact thinking indicator for slow turns.',
    files: ['src/terminal/agentSession.ts'],
    refs: [],
  },
  {
    who: 'mia', hours: 76,
    subject: 'refactor(terminal): isolate pseudo-terminal lifecycle',
    body: 'Move spawn/resize/dispose into an AgentSession so tab switches no\nlonger leak child processes.\n\n- kill orphaned ptys on window close\n- expose exit codes to the UI',
    files: ['src/terminal/agentSession.ts', 'src/terminal/TerminalPanel.tsx'],
    refs: [],
  },
  {
    who: 'ava', hours: 84,
    subject: 'test(terminal): snapshot skill preload banners',
    body: 'Snapshots the banner for read and commit modes, including the case\nwhere the user has disabled every skill.',
    files: ['tests/terminal.test.ts'],
    refs: [],
  },
  {
    who: 'z', hours: 92,
    subject: 'docs(terminal): document agent profile configuration',
    body: 'Explain how fixed skills and CLI arguments are resolved for pi,\nCodex, and Claude, with a sample ~/.knit/agents.json.',
    files: ['docs/agents.md'],
    refs: [],
  },
  {
    who: 'z', hours: 104,
    subject: 'chore: rename project to knit',
    body: 'Rename packages, binaries, and the user config directory. Existing\n~/.branchline configs are migrated on first run.',
    files: ['package.json', 'README.md'],
    refs: ['v0.4.0'],
  },
  {
    who: 'mia', hours: 118,
    subject: 'feat(repos): fuzzy finder across the workspace',
    body: 'Index repository names, branches, and folder paths once, then score\nmatches on each keystroke. Keeps the finder responsive with hundreds\nof repositories.\n\n- collapse duplicate remotes\n- surface excluded repositories separately',
    files: ['src/features/repos/RepoFinder.tsx', 'src/features/repos/repoIndex.ts'],
    refs: [],
  },
  {
    who: 'ava', hours: 136,
    subject: 'docs: add keyboard shortcuts reference',
    body: 'Documents repository search, commit navigation, and the terminal\nshortcuts. Links each shortcut from the empty states.',
    files: ['docs/keyboard-shortcuts.md'],
    refs: [],
  },
];

function buildKnitRepo(repo) {
  const rng = repo._rng;
  const base = Date.now();
  const commits = KNIT_CURATED.map((item) => ({
    hash: makeHash(rng),
    subject: item.subject,
    body: item.body,
    author: PEOPLE[item.who],
    date: base - item.hours * 3600e3,
    lane: 0,
    isMerge: Boolean(item.merge),
    files: item.files.map((path) => ({ path, status: 'M' })),
    refs: item.refs.map((name) => ({ name, type: refType(name) })),
    parents: [],
  }));

  for (let i = 3; i <= 7; i += 1) commits[i].lane = 1;
  for (let i = 11; i <= 16; i += 1) commits[i].lane = 2;

  let ts = commits[commits.length - 1].date;
  for (let k = 0; k < 8; k += 1) {
    ts -= (8 + Math.floor(rng() * 24)) * 3600e3;
    commits.push({
      hash: makeHash(rng),
      subject: genSubject(rng, commits[commits.length - 1]?.subject),
      body: genBody(rng),
      author: k % 3 === 0 ? PEOPLE.z : AUTHOR_POOL[Math.floor(rng() * AUTHOR_POOL.length)],
      date: ts,
      lane: 0,
      isMerge: false,
      files: genFiles(repo, rng, 40 + k, false),
      refs: [],
      parents: [],
    });
  }

  repo.commits = commits;
  repo.regions = [
    { branch: 'fix/editor-selection', lane: 1, forkHash: commits[2].hash, baseHash: commits[8].hash },
    { branch: 'feat/agent-modes', lane: 2, forkHash: commits[10].hash, baseHash: commits[17].hash },
  ];
}

function initWorkingChanges(repo) {
  if (repo.id === 'knit') {
    repo.workingChanges = [
      { path: 'src/features/log/CommitGraph.tsx', status: 'M', checked: true },
      { path: 'src/features/log/graphLayout.ts', status: 'M', checked: true },
      { path: 'src/features/log/log.store.ts', status: 'M', checked: true },
      { path: 'src/terminal/agentSession.ts', status: 'M', checked: true },
      { path: 'src/terminal/agentProfiles.ts', status: 'M', checked: true },
      { path: 'src/components/CommitComposer.tsx', status: 'M', checked: true },
      { path: 'src/features/diff/SplitDiff.tsx', status: 'M', checked: true },
      { path: 'src/features/repos/RepoFinder.tsx', status: 'M', checked: true },
      { path: 'tests/commit-graph.test.ts', status: 'M', checked: false },
      { path: 'docs/keyboard-shortcuts.md', status: 'M', checked: false },
      { path: 'src/features/log/experimental/LanePreview.tsx', status: 'U', untracked: true, checked: false },
      { path: 'scripts/bench-graph.mjs', status: 'U', untracked: true, checked: false },
      { path: 'scratch/commit-graph-notes.md', status: 'U', untracked: true, checked: false },
    ];
  } else if (repo.dirty > 0) {
    const pool = poolFor(repo).filter((path) => path !== repo.currentFile);
    const paths = [repo.currentFile];
    const rng = repo._rng;
    let guard = 0;
    while (paths.length < Math.min(repo.dirty, pool.length + 1) && guard < 100) {
      const next = pool[Math.floor(rng() * pool.length)];
      if (!paths.includes(next)) paths.push(next);
      guard += 1;
    }
    repo.workingChanges = paths.map((path, idx) => ({
      path,
      status: idx > 0 && rng() < 0.12 ? 'A' : 'M',
      checked: true,
    }));
  } else {
    repo.workingChanges = [];
  }
  repo.checked = new Set(repo.workingChanges.filter((file) => file.checked !== false).map((file) => file.path));
}

function assignParents(repo) {
  repo.commits.forEach((commit, idx) => {
    commit.parents = [];
    if (repo.commits[idx + 1]) commit.parents.push(repo.commits[idx + 1].hash);
    if (commit.isMerge) {
      const alternate = repo.commits[idx + 2] || repo.commits[idx + 3];
      if (alternate) commit.parents.push(alternate.hash);
    }
  });
}

function createRepo(def) {
  const lang = LANGS[def.lang] || LANGS.TypeScript;
  const repo = {
    ...def,
    short: lang.short,
    color: lang.color,
    updatedAt: Date.now() - def.updatedMin * 60000,
    _rng: mulberry32(hashString(def.id) ^ 0x9e3779b9),
    commits: [],
    regions: [],
    workingChanges: [],
    checked: new Set(),
  };
  if (def.id === 'knit') buildKnitRepo(repo);
  else buildGeneratedRepo(repo);
  initWorkingChanges(repo);
  assignParents(repo);
  return repo;
}

const REPOS = REPO_DEFS.map(createRepo);

/* ============================================================== agent data */
const SKILLS = [
  { id: 'understanding-anything', name: 'understanding-anything', desc: '先建立代码地图、调用链和边界，再回答问题', defaultOn: true },
  { id: 'codebase-index', name: 'codebase-index', desc: '检索符号、引用与相关测试', defaultOn: true },
  { id: 'commit-craft', name: 'commit-craft', desc: '按仓库习惯起草 subject / body', defaultOn: true },
  { id: 'diff-digest', name: 'diff-digest', desc: '把大 diff 压缩成变更摘要', defaultOn: true },
  { id: 'test-impact', name: 'test-impact', desc: '推断受影响的测试并建议执行范围', defaultOn: false },
  { id: 'repo-map', name: 'repo-map', desc: '构建跨仓库依赖与入口图', defaultOn: false },
  { id: 'changelog-writer', name: 'changelog-writer', desc: '根据提交生成 CHANGELOG 条目', defaultOn: false },
];
const PLUGINS = [
  { id: 'knit-agent-tools', name: 'knit-agent-tools', desc: '仓库检索、diff 摘要与提交动作', defaultOn: true },
  { id: 'git-inspector', name: 'git-inspector', desc: '把提交、分支与工作区上下文注入 agent', defaultOn: true },
  { id: 'terminal-profiles', name: 'terminal-profiles', desc: '把用户终端配置注入 agent 子进程', defaultOn: false },
];
const MODES = {
  read: {
    label: '读代码',
    skills: ['understanding-anything', 'codebase-index', 'repo-map'],
    placeholder: '询问当前代码、调用链或这个提交…',
  },
  commit: {
    label: '提交',
    skills: ['commit-craft', 'diff-digest', 'test-impact'],
    placeholder: '让我根据 diff 起草提交信息…',
  },
  free: {
    label: '自由',
    skills: [],
    placeholder: '与 agent 对话…',
  },
};
const AGENT_LABELS = { codex: 'Codex', pi: 'pi', claude: 'Claude' };

/* ================================================================== state */
const initialDrafts = storeGet('knit:drafts', {});
const savedExcluded = storeGet('knit:excluded', null);
const savedSkills = storeGet('knit:skills', null);
const savedPlugins = storeGet('knit:plugins', null);
const savedSidebar = storeGet('knit:sidebar-collapsed', false);

const state = {
  root: '/Users/zhimoe/code',
  scannedAt: new Date(),
  repoQuery: '',
  commitQuery: '',
  onlyMine: false,
  followFile: null,
  branchFilter: 'current',
  authorFilter: 'all',
  dateFilter: 'all',
  view: 'log',
  sidebarCollapsed: Boolean(savedSidebar),
  fullDiff: false,
  fullDiffSource: 'commit',
  worktreeFile: null,
  worktreeCollapsed: new Set(),
  detailTreeCollapsed: new Set(),
  selectedRepoId: 'knit',
  selectedHash: null,
  selectedFile: 0,
  diffMode: 'split',
  excludedOpen: false,
  excluded: new Set(Array.isArray(savedExcluded)
    ? savedExcluded
    : REPO_DEFS.filter((repo) => repo.excludedDefault).map((repo) => repo.id)),
  drafts: initialDrafts && typeof initialDrafts === 'object' ? initialDrafts : {},
  history: storeGet('knit:history', {}) || {},
  aiBusy: false,
  genToken: 0,
  draftTimer: null,
  modalToken: 0,
  terminal: {
    open: false,
    tab: 'codex',
    modes: { codex: 'read', pi: 'commit', claude: 'free' },
    contextHash: null,
    worktree: false,
    skills: new Set(Array.isArray(savedSkills) && savedSkills.length
      ? savedSkills
      : SKILLS.filter((skill) => skill.defaultOn).map((skill) => skill.id)),
    plugins: new Set(Array.isArray(savedPlugins)
      ? savedPlugins
      : PLUGINS.filter((plugin) => plugin.defaultOn).map((plugin) => plugin.id)),
    sessions: {},
    inputKey: '',
    inputDrafts: {},
    thinking: {},
  },
};

const SEED_DRAFT_TEXT = [
  'feat(log): polish commit lanes and composer feedback',
  '',
  '- draw fork and join lanes as rounded curves',
  '- restore per-repo drafts when switching repositories',
  '- pin agent sessions to the selected commit',
].join('\n');

(function seedDemoDraft() {
  const seeded = storeGet('knit:seeded:v1', false);
  if (!seeded) {
    state.drafts.knit = {
      text: SEED_DRAFT_TEXT,
      ts: Date.now() - 2 * 3600e3,
      restored: true,
    };
    storeSet('knit:drafts', state.drafts);
    storeSet('knit:seeded:v1', true);
  }
})();

const sortedRepos = [...REPOS].sort((a, b) => a.updatedMin - b.updatedMin || a.name.localeCompare(b.name));
const firstActive = sortedRepos.find((repo) => !state.excluded.has(repo.id)) || sortedRepos[0];
state.selectedRepoId = firstActive.id;
state.selectedHash = firstActive.commits[0]?.hash || null;
state.worktreeFile = firstActive.workingChanges[0]?.path || null;
state.terminal.contextHash = state.selectedHash;
state.terminal.inputKey = `${firstActive.id}:${state.terminal.tab}`;

/* ============================================================== selectors */
function activeRepos() {
  return sortedRepos.filter((repo) => !state.excluded.has(repo.id));
}
function currentRepo() {
  return REPOS.find((repo) => repo.id === state.selectedRepoId) || activeRepos()[0] || null;
}
function repoById(id) {
  return REPOS.find((repo) => repo.id === id) || null;
}
function selectedCommit(repo = currentRepo()) {
  if (!repo || !state.selectedHash) return null;
  return repo.commits.find((commit) => commit.hash === state.selectedHash) || null;
}
function checkedFiles(repo = currentRepo()) {
  if (!repo) return [];
  return repo.workingChanges.filter((file) => repo.checked.has(file.path));
}
function hasLogFilters() {
  return Boolean(state.commitQuery.trim())
    || state.branchFilter !== 'current'
    || state.authorFilter !== 'all'
    || state.dateFilter !== 'all'
    || Boolean(state.followFile);
}

function dateFilterFloor(filter) {
  if (filter === 'today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  if (filter === '7d') return Date.now() - 7 * 864e5;
  if (filter === '30d') return Date.now() - 30 * 864e5;
  return null;
}

function branchScopeSet(repo) {
  if (!repo || state.branchFilter === 'current') return null;
  const region = repo.regions.find((item) => item.branch === state.branchFilter);
  if (!region) return null;
  const hashes = new Set();
  let inside = false;
  repo.commits.forEach((commit) => {
    if (commit.hash === region.forkHash) inside = true;
    if (inside) {
      hashes.add(commit.hash);
      if (commit.hash === region.baseHash) inside = false;
    }
  });
  return hashes;
}
function repoMatches(repo, query) {
  const tokens = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = [
    repo.name, repo.rel, repo.branch, repo.lang, GROUPS[repo.group] || '',
  ].join(' ').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}
function commitMatchesQuery(commit, query) {
  const tokens = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = [
    commit.subject,
    commit.body,
    commit.hash,
    commit.author.name,
    ...commit.refs.map((ref) => ref.name),
  ].join(' ').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}
function visibleCommits(repo = currentRepo()) {
  if (!repo) return [];
  let list = repo.commits;
  const scope = branchScopeSet(repo);
  if (scope) list = list.filter((commit) => scope.has(commit.hash));
  if (state.authorFilter === 'me') {
    list = list.filter((commit) => commit.author.me);
  } else if (state.authorFilter !== 'all') {
    list = list.filter((commit) => commit.author.name === state.authorFilter);
  }
  const floor = dateFilterFloor(state.dateFilter);
  if (floor != null) list = list.filter((commit) => new Date(commit.date).getTime() >= floor);
  if (state.followFile) {
    list = list.filter((commit) => commit.files.some((file) => file.path === state.followFile));
  }
  if (state.commitQuery.trim()) list = list.filter((commit) => commitMatchesQuery(commit, state.commitQuery));
  return list;
}
function draftFor(repoId) {
  const draft = state.drafts[repoId];
  return draft && typeof draft.text === 'string' ? draft : null;
}
function addHistory(repoId, text) {
  if (!String(text || '').trim()) return;
  const list = state.history[repoId] || [];
  const next = [{ text: String(text), ts: Date.now() }, ...list.filter((item) => item.text !== text)].slice(0, 8);
  state.history[repoId] = next;
  storeSet('knit:history', state.history);
}
function saveDraftsSoon() {
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(() => storeSet('knit:drafts', state.drafts), 220);
}
function filesWithStats(repo, files, marker) {
  return files.map((file) => {
    const diff = buildFileDiff(repo.id, marker, file);
    return { ...file, diff, additions: diff.additions, deletions: diff.deletions };
  });
}
function totalStats(entries) {
  return entries.reduce((acc, entry) => {
    acc.additions += entry.additions || 0;
    acc.deletions += entry.deletions || 0;
    return acc;
  }, { additions: 0, deletions: 0 });
}
function avatarChip(person, size, cls = 'mini-avatar') {
  return `<span class="${cls}" style="background:${tint(person.color, 0.15)};color:${person.color};width:${size}px;height:${size}px">${esc(initials(person.name))}</span>`;
}
function renderRefPills(refs, limit = 3) {
  if (!refs || !refs.length) return '';
  const shown = refs.slice(0, limit);
  const more = refs.length - shown.length;
  return shown.map((ref) => (
    `<span class="ref-pill ${ref.type}" title="${esc(ref.name)}">${icon(ref.type === 'tag' ? 'tag' : 'branch')}<span>${esc(ref.name)}</span></span>`
  )).join('') + (more > 0 ? `<span class="ref-more">+${more}</span>` : '');
}

/* =============================================================== sidebar */
function renderSidebar() {
  const repo = currentRepo();
  const input = $('#repoSearch');
  const clear = $('#repoSearchClear');
  const active = activeRepos();
  const query = state.repoQuery;
  const matchesActive = active.filter((item) => repoMatches(item, query));
  const excludedRepos = sortedRepos.filter((item) => state.excluded.has(item.id));
  const matchesExcluded = excludedRepos.filter((item) => repoMatches(item, query));

  $('#rootName').textContent = basename(state.root);
  $('#rootPath').textContent = shortPath(state.root);

  if (input) {
    input.placeholder = `搜索 ${active.length} 个仓库`;
    if (input.value !== query) input.value = query;
  }
  if (clear) clear.hidden = !query;

  const meta = $('#repoListMeta');
  if (meta) {
    const parts = [`<span class="meta-strong">${active.length} 个仓库</span><span class="dot">·</span><span>${state.excluded.size} 已排除</span>`];
    if (query) parts.push(`<span class="dot">·</span><span>匹配 ${matchesActive.length + matchesExcluded.length}</span>`);
    meta.innerHTML = parts.join('');
  }

  const list = $('#repoList');
  if (!list) return;

  let html = '';
  if (matchesActive.length) {
    html += matchesActive.map((item) => renderRepoRow(item, false)).join('');
  }
  if (!matchesActive.length && !matchesExcluded.length) {
    html += `
      <div class="repo-list-empty">
        ${icon('search')}
        <div>没有匹配 “${esc(query)}” 的仓库</div>
        <button type="button" data-action="clear-repo-search">清除搜索</button>
      </div>`;
  }

  if (excludedRepos.length) {
    const open = state.excludedOpen || Boolean(query.trim());
    html += `
      <div class="excluded-section">
        <button class="excluded-toggle" type="button" data-toggle-excluded="1" title="${open ? '收起已排除仓库' : '展开已排除仓库'}">
          ${icon(open ? 'chevron-down' : 'chevron-right')}
          <span>已排除</span>
          <span class="excluded-count">${excludedRepos.length}</span>
        </button>
        ${open ? `<div class="excluded-list">${matchesExcluded.map((item) => renderRepoRow(item, true)).join('')}</div>` : ''}
      </div>`;
  }

  list.innerHTML = html;

  const foot = $('#sidebarFoot');
  if (foot) {
    foot.innerHTML = `
      <span class="foot-dot"></span>
      <span>${active.length + excludedRepos.length} 个仓库已索引</span>
      <span class="sep">·</span>
      <span>${active.length} 启用</span>
      <span class="spacer"></span>
      <span class="kbd-hint">${clockTime(state.scannedAt)}</span>`;
  }
}

function renderRepoRow(repo, excluded) {
  const query = state.repoQuery;
  const dirty = repo.workingChanges.length;
  const ahead = repo.ahead > 0
    ? `<span class="sync-badge ahead" title="领先远端 ${repo.ahead} 个提交">${icon('arrow-up')}${repo.ahead}</span>`
    : '';
  const behind = repo.behind > 0
    ? `<span class="sync-badge behind" title="落后远端 ${repo.behind} 个提交">${icon('arrow-down')}${repo.behind}</span>`
    : '';
  return `
    <div class="repo-row ${excluded ? 'excluded-row' : ''} ${repo.id === state.selectedRepoId && !excluded ? 'active' : ''}"
      role="listitem" ${excluded ? '' : `tabindex="0" data-repo="${repo.id}"`}
      title="${esc(shortPath(`${state.root}/${repo.rel}`))}">
      <span class="lang-square" style="background:${tint(repo.color, 0.13)};color:${repo.color};border-color:${tint(repo.color, 0.16)}">${esc(repo.short)}</span>
      <span class="repo-info">
        <span class="repo-line1">
          <span class="repo-name">${highlightMatch(repo.name, query)}</span>
          <span class="repo-badges">
            ${ahead}${behind}
            ${dirty ? `<span class="dirty-badge" title="${dirty} 个未提交更改">${dirty}</span>` : ''}
          </span>
        </span>
        <span class="repo-line2">
          ${icon('branch')}
          <span class="repo-branch">${highlightMatch(repo.branch, query)}</span>
          <span class="dot">·</span>
          <span class="repo-time">${timeCompact(repo.updatedAt)}</span>
        </span>
      </span>
      <button class="repo-action" type="button" ${excluded ? `data-include="${repo.id}" title="恢复到仓库列表"` : `data-exclude="${repo.id}" title="从列表排除"`}>
        ${icon(excluded ? 'eye' : 'eye-off')}
      </button>
    </div>`;
}

/* ============================================================== git log */
function renderLogHeader() {
  const repo = currentRepo();
  if (!repo) return;
  const badge = $('#logRepoIcon');
  if (badge) {
    badge.textContent = repo.short;
    badge.style.background = tint(repo.color, 0.13);
    badge.style.color = repo.color;
    badge.style.borderColor = tint(repo.color, 0.17);
  }
  $('#logRepoName').textContent = repo.name;
  $('#logBranch').innerHTML = `${icon('branch')}<span>${esc(repo.branch)}</span>`;
  $('#logRepoPath').textContent = shortPath(`${state.root}/${repo.rel}`);
  renderLogFilters();
  const commitSearch = $('#commitSearch');
  if (commitSearch && commitSearch.value !== state.commitQuery) commitSearch.value = state.commitQuery;
  const clear = $('#commitSearchClear');
  if (clear) clear.hidden = !state.commitQuery;
}

function renderLogFilters() {
  const repo = currentRepo();
  const container = $('#logFilters');
  if (!repo || !container) return;
  const branchValue = state.branchFilter === 'current' ? repo.branch : state.branchFilter;
  const authorValue = state.authorFilter === 'all'
    ? '全部作者'
    : (state.authorFilter === 'me' ? '仅我的' : state.authorFilter);
  const dateValue = {
    all: '全部时间', today: '今天', '7d': '最近 7 天', '30d': '最近 30 天',
  }[state.dateFilter] || '全部时间';
  const pathValue = state.followFile ? basename(state.followFile) : '全部路径';
  const chips = [
    { type: 'branch', label: '分支', value: branchValue, active: state.branchFilter !== 'current', icon: 'branch' },
    { type: 'author', label: '作者', value: authorValue, active: state.authorFilter !== 'all', icon: 'user' },
    { type: 'date', label: '时间', value: dateValue, active: state.dateFilter !== 'all', icon: 'clock' },
    { type: 'path', label: '路径', value: pathValue, active: Boolean(state.followFile), icon: 'file-search' },
  ];
  container.innerHTML = chips.map((chip) => `
    <button class="filter-chip ${chip.active ? 'active' : ''}" type="button"
      data-filter="${chip.type}" data-popover-trigger="1"
      title="${esc(chip.label)}筛选${chip.active ? '（已启用）' : ''}">
      ${icon(chip.icon)}
      <span class="filter-label">${chip.label}</span>
      <span class="filter-value">${esc(chip.value)}</span>
      ${icon('chevron-down', 'ic chev')}
    </button>`).join('')
    + (hasLogFilters() ? `<button class="filter-reset" type="button" data-action="clear-log-filters">清除筛选</button>` : '');
}

function branchFilterOptions(repo) {
  const options = [{ value: 'current', label: repo.branch, sub: '当前分支 · HEAD' }];
  repo.regions.forEach((region) => {
    if (region.branch === repo.branch) return;
    if (options.some((item) => item.value === region.branch)) return;
    options.push({ value: region.branch, label: region.branch, sub: '已合并分支 · 查看其提交' });
  });
  if (!options.some((item) => item.value === state.branchFilter)) {
    options.push({ value: state.branchFilter, label: state.branchFilter, sub: '当前筛选' });
  }
  return options;
}

function authorFilterOptions(repo) {
  const options = [
    { value: 'all', label: '全部作者', sub: '不限制提交作者' },
    { value: 'me', label: '仅我的提交', sub: PEOPLE.z.name },
  ];
  const seen = new Set();
  repo.commits.forEach((commit) => {
    if (commit.author.me || seen.has(commit.author.name)) return;
    seen.add(commit.author.name);
    options.push({ value: commit.author.name, label: commit.author.name, sub: commit.author.email });
  });
  return options;
}

function pathFilterOptions(repo) {
  const options = [
    { value: 'all', label: '全部路径', sub: '不限制文件' },
    { value: 'current', label: basename(repo.currentFile), sub: `编辑器当前文件 · ${repo.currentFile}` },
  ];
  const seen = new Set([repo.currentFile, state.followFile].filter(Boolean));
  repo.workingChanges.forEach((file) => {
    if (!seen.has(file.path)) {
      seen.add(file.path);
      options.push({ value: file.path, label: basename(file.path), sub: `未提交更改 · ${file.path}` });
    }
  });
  const selected = selectedCommit(repo);
  (selected?.files || []).forEach((file) => {
    if (!seen.has(file.path)) {
      seen.add(file.path);
      options.push({ value: file.path, label: basename(file.path), sub: file.path });
    }
  });
  if (state.followFile && !options.some((item) => item.value === state.followFile)) {
    options.push({ value: state.followFile, label: basename(state.followFile), sub: state.followFile });
  }
  return options.slice(0, 14);
}

function openLogFilterPopover(type, anchor) {
  const repo = currentRepo();
  if (!repo || !anchor) return;
  let title = '';
  let footer = '';
  let options = [];
  if (type === 'branch') {
    title = '分支筛选';
    options = branchFilterOptions(repo);
    footer = `${icon('branch')} 当前分支显示全部历史；合并分支显示其 lane 内的提交`;
  } else if (type === 'author') {
    title = '作者筛选';
    options = authorFilterOptions(repo);
    footer = `${icon('user')} 按提交作者过滤当前仓库的 log`;
  } else if (type === 'date') {
    title = '时间筛选';
    options = [
      { value: 'all', label: '全部时间', sub: '不限制提交时间' },
      { value: 'today', label: '今天', sub: '只显示今天提交' },
      { value: '7d', label: '最近 7 天', sub: '从当前时间向前 7 天' },
      { value: '30d', label: '最近 30 天', sub: '从当前时间向前 30 天' },
    ];
    footer = `${icon('clock')} 时间筛选只影响 Log 列表`;
  } else {
    title = '路径筛选';
    options = pathFilterOptions(repo);
    footer = `${icon('file-search')} 选择文件后，只显示涉及该文件的提交`;
  }
  const selectedValue = type === 'branch'
    ? state.branchFilter
    : type === 'author'
      ? state.authorFilter
      : type === 'date'
        ? state.dateFilter
        : (state.followFile === null ? 'all' : (state.followFile === repo.currentFile ? 'current' : state.followFile));
  const list = options.map((option) => {
    const active = option.value === selectedValue;
    return `<button class="filter-option ${active ? 'active' : ''}" type="button"
      data-filter-kind="${type}" data-filter-value="${esc(option.value)}">
      <span class="filter-check">${active ? icon('check') : ''}</span>
      <span class="branch-ico">${type === 'branch' ? icon('branch') : (type === 'author' ? icon('user') : (type === 'date' ? icon('clock') : icon('file')))}</span>
      <span class="filter-option-main">
        <span>${esc(option.label)}</span>
        ${option.sub ? `<span class="filter-option-sub">${esc(option.sub)}</span>` : ''}
      </span>
    </button>`;
  }).join('');
  showPopover(anchor, `log-filter-${type}`, `
    <div class="pop-head">
      <span class="pop-title">${title}</span>
      <span class="pop-sub">${esc(repo.name)}</span>
    </div>
    <div class="filter-list">${list}</div>
    <div class="pop-foot">${footer}</div>`, 300, 'left');
}

function applyLogFilter(kind, value) {
  const repo = currentRepo();
  if (!repo) return;
  if (kind === 'branch') state.branchFilter = value;
  else if (kind === 'author') state.authorFilter = value;
  else if (kind === 'date') state.dateFilter = value;
  else if (kind === 'path') {
    if (value === 'all') state.followFile = null;
    else if (value === 'current') state.followFile = repo.currentFile;
    else state.followFile = value;
  }
  closePopover();
  refreshLog(true, { details: true });
  renderViewBar();
  const list = $('#commitList');
  if (list) list.scrollTop = 0;
}

function renderGraph(repo, commit, index, selected) {
  const laneX = [14, 36, 58];
  const laneColors = [repo.color, '#68c98d', '#c18df2'];
  const parts = [];
  parts.push(`<line x1="14" y1="0" x2="14" y2="36" stroke="${repo.color}" stroke-opacity=".78" stroke-width="1.8"/>`);

  repo.regions.forEach((region) => {
    const forkIndex = repo.commits.findIndex((item) => item.hash === region.forkHash);
    const baseIndex = repo.commits.findIndex((item) => item.hash === region.baseHash);
    if (forkIndex < 0 || baseIndex < 0) return;
    const x = laneX[region.lane] || 36;
    const color = laneColors[region.lane] || '#68c98d';
    if (index === forkIndex) {
      parts.push(`<path d="M 14 18 C 14 28, ${x} 27, ${x} 36" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`);
    } else if (index === baseIndex) {
      parts.push(`<path d="M ${x} 0 C ${x} 9, 14 8, 14 18" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`);
    } else if (index > forkIndex && index < baseIndex) {
      parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="36" stroke="${color}" stroke-opacity=".9" stroke-width="1.8"/>`);
    }
  });

  const lx = laneX[commit.lane] ?? 14;
  const color = laneColors[commit.lane] || repo.color;
  if (selected) {
    parts.push(`<circle cx="${lx}" cy="18" r="8.5" fill="${color}" opacity=".14"/>`);
  }
  if (index === 0) {
    parts.push(`<circle cx="${lx}" cy="18" r="5" fill="${color}"/>`);
    parts.push(`<circle cx="${lx}" cy="18" r="1.7" fill="#17181c" opacity=".9"/>`);
  } else if (commit.isMerge) {
    parts.push(`<circle cx="${lx}" cy="18" r="4.7" fill="#17181c" stroke="${color}" stroke-width="2"/>`);
    parts.push(`<circle cx="${lx}" cy="18" r="1.35" fill="${color}"/>`);
  } else {
    parts.push(`<circle cx="${lx}" cy="18" r="4" fill="#17181c" stroke="${color}" stroke-width="2"/>`);
  }
  return `<svg width="64" height="36" viewBox="0 0 64 36" aria-hidden="true">${parts.join('')}</svg>`;
}

function renderCommitList() {
  const repo = currentRepo();
  const listEl = $('#commitList');
  if (!repo || !listEl) {
    if (listEl) listEl.innerHTML = '';
    return;
  }
  const list = visibleCommits(repo);
  if (!list.length) {
    let title = '没有可显示的提交';
    let desc = '这个仓库还没有提交记录。';
    if (state.followFile) {
      title = '这个文件还没有提交历史';
      desc = `没有找到涉及 ${state.followFile} 的提交。`;
    } else if (hasLogFilters()) {
      title = '没有匹配的提交';
      desc = '试试更短的关键词，或清除筛选后再看。';
    }
    listEl.innerHTML = `
      <div class="empty-log">
        <span class="empty-icon">${icon(state.followFile ? 'file-search' : 'history')}</span>
        <strong>${title}</strong>
        <span>${desc}</span>
        ${hasLogFilters() ? `<button type="button" data-action="clear-log-filters">清除筛选</button>` : ''}
      </div>`;
    return;
  }

  listEl.innerHTML = list.map((commit) => {
    const index = repo.commits.indexOf(commit);
    const selected = commit.hash === state.selectedHash;
    const localRefs = commit.refs.filter((ref) => ref.type !== 'remote');
    const displayRefs = localRefs.length ? localRefs : commit.refs.slice(0, 1);
    const refs = renderRefPills(displayRefs, 2);
    const merge = commit.isMerge ? `<span class="merge-mark" title="merge commit">${icon('merge')}</span>` : '';
    return `
      <div class="commit-row ${selected ? 'selected' : ''}" role="button" tabindex="-1"
        data-hash="${commit.hash}" title="${esc(commit.subject)} · ${commit.hash.slice(0, 7)} — ${esc(absTime(commit.date))}">
        <span class="lane-cell">${renderGraph(repo, commit, index, selected)}</span>
        <span class="commit-subject-cell">
          ${refs ? `<span class="refs">${refs}</span>` : ''}
          ${merge}
          <span class="commit-subject">${highlightMatch(commit.subject, state.commitQuery)}</span>
          ${refs ? '' : `<span class="commit-hash">${commit.hash.slice(0, 7)}</span>`}
        </span>
        <span class="commit-author-cell">
          ${avatarChip(commit.author, 16)}
          <span class="commit-author-name">${highlightMatch(commit.author.name, state.commitQuery)}</span>
        </span>
        <span class="commit-date-cell">${timeAgo(commit.date)}</span>
      </div>`;
  }).join('');
}

function renderLogFooter() {
  const repo = currentRepo();
  const foot = $('#logFoot');
  if (!repo || !foot) return;
  const visible = visibleCommits(repo);
  const filtering = hasLogFilters();
  foot.innerHTML = `
    <span class="foot-count">${filtering ? `筛选 ${visible.length} / ${repo.commits.length}` : `${repo.commits.length} 个提交`}</span>
    <span class="sep">·</span>
    <button class="foot-file ${state.followFile === repo.currentFile ? 'active' : ''}" type="button"
      data-action="locate-current-file" title="从编辑器当前文件定位提交历史">
      ${icon('crosshair')}<span>${esc(basename(repo.currentFile))}</span>
    </button>
    <span class="spacer"></span>
    ${filtering ? `<button class="foot-btn" type="button" data-action="clear-log-filters">清除筛选</button>` : ''}
    <button class="foot-btn" type="button" data-action="load-more">加载更早的提交</button>
    <span class="foot-hint"><kbd>↑</kbd><kbd>↓</kbd> 导航</span>`;
}

/* ======================================================== views & changes */
function renderViewBar() {
  const repo = currentRepo();
  if (!repo) return;
  const branch = state.branchFilter === 'current' ? repo.branch : state.branchFilter;
  const count = repo.workingChanges.length;
  const branchEl = $('#viewBranchName');
  if (branchEl) branchEl.textContent = branch;
  const countEl = $('#viewChangesCount');
  if (countEl) {
    countEl.textContent = String(count);
    countEl.classList.toggle('zero', count === 0);
  }
  const projectIcon = $('#tabProjectIcon');
  if (projectIcon) {
    projectIcon.textContent = repo.short;
    projectIcon.style.background = tint(repo.color, 0.13);
    projectIcon.style.color = repo.color;
    projectIcon.style.borderColor = tint(repo.color, 0.16);
  }
  const projectName = $('#tabProjectName');
  if (projectName) projectName.textContent = repo.name;
  const projectBranch = $('#tabProjectBranch');
  if (projectBranch) projectBranch.innerHTML = `${icon('branch')}<span>${esc(repo.branch)}</span>`;
  const projectChip = $('#projectChip');
  if (projectChip) {
    projectChip.title = `${shortPath(`${state.root}/${repo.rel}`)} · ${repo.branch}`;
  }
  const logTab = $('#viewTabLog');
  const changesTab = $('#viewTabChanges');
  if (logTab) {
    logTab.classList.toggle('active', state.view === 'log');
    logTab.setAttribute('aria-selected', String(state.view === 'log'));
  }
  if (changesTab) {
    changesTab.classList.toggle('active', state.view === 'changes');
    changesTab.setAttribute('aria-selected', String(state.view === 'changes'));
  }
  const right = $('#viewbarRight');
  if (right) {
    right.innerHTML = `<span class="${count ? '' : 'vb-clean'}">${count ? `${count} 个未提交更改` : '工作区干净'}</span>`;
  }
}

function applySidebarState() {
  const workspace = $('#workspace');
  if (workspace) workspace.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  const button = $('#sidebarToggle');
  if (button) {
    const label = state.sidebarCollapsed ? '展开工作区' : '收起工作区';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
  }
  storeSet('knit:sidebar-collapsed', state.sidebarCollapsed);
}

function toggleWorkspace() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  applySidebarState();
  if (!state.sidebarCollapsed) scrollActiveRepoIntoView();
}

function showWorkspace() {
  if (state.sidebarCollapsed) {
    state.sidebarCollapsed = false;
    applySidebarState();
  }
  scrollActiveRepoIntoView();
}

function applyViewMode() {
  const changes = state.view === 'changes';
  const workspace = $('#workspace');
  const logPane = $('#logPane');
  const changesView = $('#changesView');
  if (workspace) workspace.classList.toggle('changes-mode', changes);
  if (logPane) logPane.classList.toggle('changes-mode', changes);
  if (changesView) changesView.hidden = !changes;
}

function setView(view) {
  if (!['log', 'changes'].includes(view) || !currentRepo()) return;
  if (state.fullDiff) closeFullDiff();
  if (view === state.view) return;
  closePopover();
  state.view = view;
  if (view === 'changes') ensureWorktreeFile(currentRepo());
  applyViewMode();
  renderAll();
}

function ensureWorktreeFile(repo = currentRepo()) {
  if (!repo || !repo.workingChanges.length) {
    state.worktreeFile = null;
    return;
  }
  if (!state.worktreeFile || !repo.workingChanges.some((file) => file.path === state.worktreeFile)) {
    state.worktreeFile = repo.workingChanges[0].path;
  }
}

function applyFullDiffMode() {
  const app = $('#app');
  const page = $('#fullDiffPage');
  if (app) app.classList.toggle('diff-mode', state.fullDiff);
  if (page) page.hidden = !state.fullDiff;
}

function fullDiffData() {
  const repo = currentRepo();
  if (!repo) return null;
  if (state.fullDiffSource === 'worktree') {
    const entries = filesWithStats(repo, repo.workingChanges, 'work');
    let index = entries.findIndex((entry) => entry.path === state.worktreeFile);
    if (index < 0 && entries.length) {
      index = 0;
      state.worktreeFile = entries[0].path;
    }
    return { repo, commit: null, entries, index, entry: entries[index] || null };
  }
  const commit = selectedCommit(repo);
  if (!commit) return { repo, commit: null, entries: [], index: -1, entry: null };
  const entries = filesWithStats(repo, commit.files, commit.hash);
  state.selectedFile = clamp(state.selectedFile, 0, Math.max(0, entries.length - 1));
  return { repo, commit, entries, index: state.selectedFile, entry: entries[state.selectedFile] || null };
}

function openFullDiff(source = (state.view === 'changes' ? 'worktree' : 'commit')) {
  const repo = currentRepo();
  if (!repo) return;
  if (source === 'worktree') {
    if (!repo.workingChanges.length) {
      toast('当前工作区没有未提交的更改', { tone: 'info', duration: 1600 });
      return;
    }
    ensureWorktreeFile(repo);
  } else if (!selectedCommit(repo)?.files.length) {
    toast('当前提交没有可查看的变更', { tone: 'info', duration: 1600 });
    return;
  }
  closePopover();
  state.fullDiff = true;
  state.fullDiffSource = source;
  applyFullDiffMode();
  renderFullDiff();
}

function closeFullDiff() {
  if (!state.fullDiff) return;
  state.fullDiff = false;
  applyFullDiffMode();
  renderAll();
}

function renderFullDiff() {
  const page = $('#fullDiffPage');
  if (!page) return;
  const data = fullDiffData();
  if (!data) {
    page.innerHTML = '';
    return;
  }
  const { repo, commit, entries, index, entry } = data;
  const backLabel = state.view === 'changes' ? '返回 Changes' : '返回 Log';
  const isWorktree = state.fullDiffSource === 'worktree';
  const sourceLabel = isWorktree ? 'working tree' : `commit ${commit?.hash.slice(0, 7) || ''}`;
  const sourceTitle = isWorktree
    ? `${repo.workingChanges.length} 个未提交文件`
    : (commit?.subject || '');
  const mode = state.diffMode;

  const header = `
    <div class="full-diff-head">
      <button class="fd-back" type="button" data-action="exit-full-diff" title="返回（Esc）">
        ${icon('chevron-left')}<span>${backLabel}</span><kbd>Esc</kbd>
      </button>
      <span class="fd-divider"></span>
      <div class="fd-context">
        <span class="fd-repo">${icon('branch')}${esc(repo.name)}</span>
        <span class="fd-branch">${esc(repo.branch)}</span>
        <span class="fd-source ${isWorktree ? 'worktree' : ''}" title="${esc(sourceTitle)}">${esc(sourceLabel)}</span>
      </div>
      <div class="fd-file-area">
        <button class="fd-nav" type="button" data-action="full-diff-prev-file" title="上一个文件" ${entries.length <= 1 ? 'disabled' : ''}>${icon('chevron-left')}</button>
        ${entry ? `
          <span class="fd-path" title="${esc(entry.path)}">
            ${icon('file')}
            <span class="fd-dir">${esc(dirname(entry.path))}</span>
            <span class="fd-name">${esc(basename(entry.path))}</span>
          </span>` : '<span class="fd-path">没有可显示的文件</span>'}
        <button class="fd-nav" type="button" data-action="full-diff-next-file" title="下一个文件" ${entries.length <= 1 ? 'disabled' : ''}>${icon('chevron-right')}</button>
        <span class="fd-index">${entries.length ? `${index + 1} / ${entries.length}` : '0 / 0'}</span>
      </div>
      ${entry ? `<span class="fd-stats"><span class="plus">+${entry.additions}</span>${entry.deletions ? `<span class="minus">−${entry.deletions}</span>` : ''}</span>` : ''}
      <div class="fd-actions">
        <span class="diff-mode-seg" role="group" aria-label="Diff 视图">
          <button class="diff-mode-btn ${mode === 'split' ? 'active' : ''}" type="button" data-action="full-diff-mode" data-mode="split" title="并排 diff">${icon('split')}</button>
          <button class="diff-mode-btn ${mode === 'unified' ? 'active' : ''}" type="button" data-action="full-diff-mode" data-mode="unified" title="统一 diff">${icon('unified')}</button>
        </span>
        <button class="fd-close" type="button" data-action="exit-full-diff" title="关闭全页 Diff">${icon('x')}</button>
      </div>
    </div>`;

  let body;
  if (!entry) {
    body = `<div class="full-diff-body"><div class="diff-empty">${icon('file')}<span>没有可显示的文件 diff。</span></div></div>`;
  } else {
    const diff = entry.diff;
    const leftLabel = isWorktree ? 'HEAD' : '修改前';
    const rightLabel = isWorktree ? '工作区 · 未暂存' : '修改后';
    body = `
      <div class="full-diff-body">
        <div class="full-diff-scroll">
          <div class="diff-head">
            <div class="diff-side">${leftLabel} <span>${diff.oldLines.length} 行</span></div>
            <div class="diff-side">${rightLabel} <span>${diff.newLines.length} 行</span></div>
          </div>
          <div class="diff-rows">
            <div class="diff-hunk">${esc(diff.hunk)}</div>
            ${mode === 'split' ? renderSplitDiff(diff) : renderUnifiedDiff(diff)}
          </div>
        </div>
      </div>`;
  }
  page.innerHTML = header + body;
}

function moveFullDiffFile(delta) {
  if (!state.fullDiff) return;
  const repo = currentRepo();
  if (!repo) return;
  if (state.fullDiffSource === 'worktree') {
    if (!repo.workingChanges.length) return;
    let index = repo.workingChanges.findIndex((file) => file.path === state.worktreeFile);
    if (index < 0) index = 0;
    index = (index + delta + repo.workingChanges.length) % repo.workingChanges.length;
    state.worktreeFile = repo.workingChanges[index].path;
  } else {
    const commit = selectedCommit(repo);
    if (!commit || !commit.files.length) return;
    state.selectedFile = (state.selectedFile + delta + commit.files.length) % commit.files.length;
  }
  renderFullDiff();
}

function setFullDiffMode(mode) {
  if (!['split', 'unified'].includes(mode) || state.diffMode === mode) return;
  state.diffMode = mode;
  renderFullDiff();
}

function renderQuickChanges() {
  const el = $('#quickChanges');
  const repo = currentRepo();
  if (!el) return;
  if (!repo) {
    el.innerHTML = '';
    return;
  }
  const files = repo.workingChanges;
  const draft = draftFor(repo.id);
  if (!files.length) {
    el.className = 'quick-changes clean';
    el.removeAttribute('data-action');
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.innerHTML = `
      <span class="qc-icon clean">${icon('check')}</span>
      <span class="qc-main">
        <strong>工作区干净</strong>
        <span class="qc-clean-text">没有未提交的更改 · ${esc(repo.branch)}</span>
      </span>
      <span class="spacer"></span>
      <span class="qc-hint">✓ 已同步</span>`;
    return;
  }
  const entries = filesWithStats(repo, files, 'work');
  const stats = totalStats(entries);
  const checked = checkedFiles(repo).length;
  const firstLine = draft ? draft.text.split('\n')[0] : '';
  el.className = 'quick-changes';
  el.setAttribute('data-action', 'open-changes');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.innerHTML = `
    <span class="qc-icon">${icon('file')}</span>
    <span class="qc-main">
      <strong>${files.length} 个未提交更改</strong>
      <span class="qc-stats"><span class="plus">+${stats.additions}</span><span class="minus">−${stats.deletions}</span></span>
      ${draft ? `<span class="qc-draft" title="${esc(draft.text)}">${draft.restored ? '已恢复草稿' : '草稿'} · ${esc(firstLine)}</span>` : ''}
    </span>
    <span class="qc-actions">
      <span class="qc-open">${icon('unified')} 查看并提交 <span class="qc-hint">${checked}/${files.length}</span></span>
    </span>`;
}

function countTreeFiles(node) {
  let count = node.files.length;
  node.children.forEach((child) => { count += countTreeFiles(child); });
  return count;
}

function buildPathTree(entries) {
  const root = { name: '', path: '', children: new Map(), files: [] };
  entries.forEach((entry) => {
    const parts = entry.path.split('/');
    let node = root;
    let prefix = '';
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        node.files.push({ ...entry, name: part });
        return;
      }
      prefix = prefix ? `${prefix}/${part}` : part;
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path: prefix, children: new Map(), files: [] });
      }
      node = node.children.get(part);
    });
  });
  return root;
}

function renderTreeRows(node, repo, depth) {
  let html = '';
  const folders = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  folders.forEach((folder) => {
    const collapsed = state.worktreeCollapsed.has(folder.path);
    const count = countTreeFiles(folder);
    html += `
      <div class="tree-folder" data-tree-folder="${esc(folder.path)}" style="padding-left:${depth * 13 + 6}px" title="${esc(folder.path)}">
        ${icon('chevron-right', `ic tree-chev ${collapsed ? '' : 'open'}`)}
        ${icon('folder')}
        <span class="tree-folder-name">${esc(folder.name)}</span>
        <span class="tree-count">${count}</span>
      </div>`;
    if (!collapsed) html += renderTreeRows(folder, repo, depth + 1);
  });
  files.forEach((file) => {
    const checked = repo.checked.has(file.path);
    const active = state.worktreeFile === file.path;
    html += `
      <div class="tree-file ${active ? 'active' : ''} ${checked ? '' : 'off'} ${file.untracked ? 'untracked' : ''}"
        data-worktree-file="${esc(file.path)}" role="button" tabindex="0"
        style="padding-left:${depth * 13 + 6}px" title="${esc(file.path)}${file.untracked ? ' · 未跟踪' : ''} · 双击全页查看 diff">
        <label class="check-wrap">
          <input type="checkbox" data-file-check="${esc(file.path)}" ${checked ? 'checked' : ''}>
          <span class="check-box">${icon('check')}</span>
        </label>
        <span class="fstat ${file.status}">${file.status}</span>
        <span class="tree-name">${esc(file.name)}</span>
        <span class="tree-file-stats">
          <span class="plus">+${file.additions}</span>
          ${file.deletions ? `<span class="minus">−${file.deletions}</span>` : ''}
        </span>
        ${file.untracked ? '' : `<button class="tree-history" type="button" data-action="worktree-history" data-path="${esc(file.path)}" title="在 Log 中查看此文件历史">
          ${icon('history')}
        </button>`}
      </div>`;
  });
  return html;
}

function renderChangesTree(repo, entries) {
  const checked = entries.filter((entry) => repo.checked.has(entry.path));
  const allChecked = checked.length === entries.length && entries.length > 0;
  const totals = totalStats(entries);
  const tracked = entries.filter((entry) => !entry.untracked);
  const untracked = entries.filter((entry) => entry.untracked);
  const trackedRoot = buildPathTree(tracked);
  const untrackedRoot = buildPathTree(untracked);
  const trackedHtml = tracked.length ? renderTreeRows(trackedRoot, repo, 0) : '';
  const untrackedHtml = untracked.length
    ? `${tracked.length ? '<div class="tree-section-divider"></div>' : ''}
      <div class="tree-section-title">
        ${icon('file-plus')}<span>未跟踪文件</span>
        <span class="tree-section-count">${untracked.length}</span>
        <span class="tree-section-note">未忽略</span>
      </div>
      ${renderTreeRows(untrackedRoot, repo, 0)}`
    : '';
  return `
    <div class="cv-tree-head">
      <label class="check-wrap">
        <input type="checkbox" id="selectAllChanges" data-select-all="1" ${allChecked ? 'checked' : ''}>
        <span class="check-box">${icon('check')}</span>
        <span>全选</span>
      </label>
      <span class="change-count" id="changeCount">${checked.length} / ${entries.length}</span>
      <button class="discard-btn" id="discardChangesBtn" type="button" data-action="discard-changes"
        title="放弃所选文件的更改（git restore / discard）" ${checked.length === 0 ? 'disabled' : ''}>
        ${icon('undo')}<span>放弃更改</span>
      </button>
      <span class="spacer"></span>
      <span class="change-total">
        <span class="plus">+${totals.additions}</span>
        <span class="minus">−${totals.deletions}</span>
      </span>
    </div>
    <div class="cv-tree-scroll">${trackedHtml}${untrackedHtml}</div>`;
}

function renderWorktreeDiff(repo, entries) {
  const entry = entries.find((file) => file.path === state.worktreeFile);
  if (!entry) {
    return `<div class="diff-empty">${icon('file')}<span>选择一个文件查看工作区 diff。</span></div>`;
  }
  const diff = entry.diff;
  const mode = state.diffMode;
  const fileCount = entries.length;
  const index = entries.findIndex((file) => file.path === entry.path);
  return `
    <div class="diff-toolbar">
      <button class="diff-nav" type="button" data-action="worktree-prev-file" title="上一个更改" ${fileCount <= 1 ? 'disabled' : ''}>${icon('chevron-left')}</button>
      <button class="diff-nav" type="button" data-action="worktree-next-file" title="下一个更改" ${fileCount <= 1 ? 'disabled' : ''}>${icon('chevron-right')}</button>
      <span class="diff-file" title="${esc(entry.path)}">
        ${icon('file')}
        <span class="dfdir">${esc(dirname(entry.path))}</span>
        <span class="dfname">${esc(basename(entry.path))}</span>
      </span>
      <span class="diff-file-stats">
        <span class="plus">+${diff.additions}</span>
        ${diff.deletions ? `<span class="minus">−${diff.deletions}</span>` : ''}
      </span>
      <span class="diff-mode-seg" role="group" aria-label="工作区 diff 视图">
        <button class="diff-mode-btn ${mode === 'split' ? 'active' : ''}" type="button" data-action="worktree-diff-mode" data-mode="split" title="并排 diff">
          ${icon('split')}
        </button>
        <button class="diff-mode-btn ${mode === 'unified' ? 'active' : ''}" type="button" data-action="worktree-diff-mode" data-mode="unified" title="统一 diff">
          ${icon('unified')}
        </button>
      </span>
      <span class="diff-index">${index + 1} / ${fileCount}</span>
      <button class="diff-nav diff-expand" type="button" data-action="expand-diff" title="全页面查看 diff（双击文件也可）">
        ${icon('expand')}
      </button>
    </div>
    <div class="diff-scroll">
      <div class="diff-head">
        <div class="diff-side">HEAD <span>${diff.oldLines.length} 行</span></div>
        <div class="diff-side">工作区 · 未暂存 <span>${diff.newLines.length} 行</span></div>
      </div>
      <div class="diff-rows">
        <div class="diff-hunk">${esc(diff.hunk)}</div>
        ${mode === 'split' ? renderSplitDiff(diff) : renderUnifiedDiff(diff)}
      </div>
    </div>`;
}

function renderChangesView() {
  const repo = currentRepo();
  const head = $('#changesViewHead');
  const treePanel = $('#changesTreePanel');
  const diffPanel = $('#changesDiffPanel');
  if (!head || !treePanel || !diffPanel) return;
  if (!repo) {
    head.innerHTML = '';
    treePanel.innerHTML = `<div class="cv-clean-state">${icon('branch')}<span>选择一个仓库</span></div>`;
    diffPanel.innerHTML = '';
    return;
  }
  ensureWorktreeFile(repo);
  const entries = filesWithStats(repo, repo.workingChanges, 'work');
  const totals = totalStats(entries);
  const checked = entries.filter((entry) => repo.checked.has(entry.path));
  const untrackedCount = entries.filter((entry) => entry.untracked).length;
  const hasChanges = entries.length > 0;
  head.innerHTML = `
    <span class="cv-head-icon ${hasChanges ? '' : 'clean'}">${icon(hasChanges ? 'file' : 'check')}</span>
    <div>
      <div class="cv-head-title">Working changes <span class="branch-pill">${icon('branch')}<span>${esc(repo.branch)}</span></span></div>
      <div class="cv-head-sub">
        ${hasChanges ? `
          <span>${entries.length} 个文件</span>
          ${untrackedCount ? `<span class="sep">·</span><span class="untracked-meta">${untrackedCount} 未跟踪</span>` : ''}
          <span class="sep">·</span>
          <span class="plus">+${totals.additions}</span><span class="minus">−${totals.deletions}</span><span class="sep">·</span>
          <span><span id="changesCheckedCount">${checked.length}</span> / ${entries.length} 已选择</span><span class="sep">·</span>
          <span>草稿按仓库记忆</span>` : `
          <span>工作区干净</span><span class="sep">·</span><span>没有未提交的更改</span>`}
      </div>
    </div>
    <span class="spacer"></span>
    <div class="cv-head-actions">
      ${hasChanges ? `<button class="cv-full-btn" type="button" data-action="expand-diff" title="全页面查看当前文件 diff">${icon('expand')} 全页 Diff</button>
      <span class="cv-head-hint">未暂存 · 左侧勾选文件，右下提交</span>` : ''}
    </div>`;

  if (!hasChanges) {
    state.worktreeFile = null;
    treePanel.innerHTML = `
      <div class="cv-clean-state">
        <span class="clean-icon">${icon('check')}</span>
        <strong>工作区干净</strong>
        <span>没有未提交的更改。可以回到 Log 继续查看提交历史。</span>
      </div>`;
    diffPanel.innerHTML = `<div class="cv-clean-state">${icon('file')}<span>工作区没有可预览的 diff。</span></div>`;
    return;
  }

  treePanel.innerHTML = renderChangesTree(repo, entries);
  diffPanel.innerHTML = renderWorktreeDiff(repo, entries);
  updateCommitUI();
}

function moveWorktreeFile(delta) {
  const repo = currentRepo();
  if (!repo || !repo.workingChanges.length) return;
  const files = repo.workingChanges;
  let index = files.findIndex((file) => file.path === state.worktreeFile);
  if (index < 0) index = 0;
  index = (index + delta + files.length) % files.length;
  state.worktreeFile = files[index].path;
  renderChangesView();
  requestAnimationFrame(() => {
    const scroll = $('.changes-diff-panel .diff-scroll');
    if (scroll) scroll.scrollTop = 0;
  });
}

function setWorktreeDiffMode(mode) {
  if (!['split', 'unified'].includes(mode) || state.diffMode === mode) return;
  state.diffMode = mode;
  renderChangesView();
}

/* ============================================================== details */
function renderCommitTreeRows(node, depth = 0) {
  let html = '';
  const folders = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  folders.forEach((folder) => {
    const collapsed = state.detailTreeCollapsed.has(folder.path);
    const count = countTreeFiles(folder);
    html += `
      <div class="file-folder" data-detail-folder="${esc(folder.path)}" style="padding-left:${depth * 12 + 6}px" title="${esc(folder.path)}">
        ${icon('chevron-right', `ic file-chev ${collapsed ? '' : 'open'}`)}
        ${icon('folder')}
        <span class="file-folder-name">${esc(folder.name)}</span>
        <span class="folder-count">${count}</span>
      </div>`;
    if (!collapsed) html += renderCommitTreeRows(folder, depth + 1);
  });
  files.forEach((file) => {
    const active = file.index === state.selectedFile;
    html += `
      <div class="file-row ${active ? 'active' : ''}" data-file-index="${file.index}" role="button" tabindex="0"
        style="padding-left:${depth * 12 + 6}px" title="${esc(file.path)} · 双击全页查看 diff">
        <span class="fstat ${file.status}">${file.status}</span>
        <span class="file-path"><span class="fname">${esc(file.name)}</span></span>
        <span class="file-mini-stats">
          <span class="plus">+${file.additions}</span>
          ${file.deletions ? `<span class="minus">−${file.deletions}</span>` : ''}
        </span>
        <button class="file-history" type="button" data-action="file-history" data-path="${esc(file.path)}" title="查看此文件的提交历史">
          ${icon('history')}
        </button>
      </div>`;
  });
  return html;
}

function renderDetails() {
  const details = $('#details');
  const repo = currentRepo();
  const commit = selectedCommit(repo);
  if (!repo || !commit) {
    details.innerHTML = `
      <div class="empty-details">
        <span class="empty-icon">${icon('branch')}</span>
        <strong>选择一个提交</strong>
        <span>提交信息、变更文件和并排 diff 会显示在这里。按 ↑↓ 可以在提交间移动。</span>
      </div>`;
    return;
  }

  const entries = filesWithStats(repo, commit.files, commit.hash).map((entry, index) => ({ ...entry, index }));
  const totals = totalStats(entries);
  state.selectedFile = clamp(state.selectedFile, 0, Math.max(0, entries.length - 1));
  const selectedFileEntry = entries[state.selectedFile] || null;
  const refs = commit.refs.length ? `<div class="refs-line">${renderRefPills(commit.refs, 8)}</div>` : '';
  const body = commit.body ? `<div class="commit-body">${esc(commit.body)}</div>` : '';

  const parentLinks = commit.parents.length
    ? commit.parents.map((hash) => {
      const exists = repo.commits.some((item) => item.hash === hash);
      return `<button class="parent-link" type="button" ${exists ? `data-action="goto-parent" data-hash="${hash}"` : 'disabled'} title="${esc(hash)}">${hash.slice(0, 7)}</button>`;
    }).join(' ')
    : `<span>root commit</span>`;

  const fileTree = buildPathTree(entries);
  const fileRows = renderCommitTreeRows(fileTree);

  const diffBlock = selectedFileEntry ? buildDiffBlock(selectedFileEntry, entries.length) : `
    <div class="diff-block">
      <div class="diff-toolbar"><span class="diff-file">没有文本变更</span></div>
      <div class="diff-empty">${icon('file')}<span>这个提交没有可显示的文件差异。</span></div>
    </div>`;

  details.innerHTML = `
    <div class="commit-meta">
      ${refs}
      <h2 class="commit-title">${esc(commit.subject)}</h2>
      ${body}
      <div class="meta-author-row">
        ${avatarChip(commit.author, 20, 'author-avatar')}
        <span class="author-info">
          <span class="author-name">${esc(commit.author.name)}</span>
          <span class="author-email">${esc(commit.author.email)}</span>
        </span>
        <span class="meta-dot">·</span>
        <span class="commit-time" title="${esc(absTime(commit.date))}">${timeAgo(commit.date)}</span>
        <button class="hash-chip" type="button" data-action="copy-hash" title="复制完整哈希">
          ${esc(commit.hash.slice(0, 7))} ${icon('copy')}
        </button>
      </div>
      <div class="meta-actions">
        <button class="action-btn" type="button" data-action="open-terminal-at-commit">
          ${icon('terminal')} 在终端打开
        </button>
        <button class="action-btn soft" type="button" data-action="analyze-commit">
          ${icon('sparkles')} AI 分析
        </button>
        <button class="action-btn" type="button" data-action="expand-diff" title="全页面查看当前文件 diff">
          ${icon('expand')} 全页 diff
        </button>
        <span class="spacer"></span>
        <span class="parent-line">${icon('branch')} parent ${parentLinks}</span>
      </div>
    </div>

    <div class="changes-block">
      <div class="section-head">
        ${icon('file')} 变更文件
        <span class="count-pill">${entries.length}</span>
        <span class="spacer"></span>
        <span class="stats-total">
          <span class="plus">+${totals.additions}</span>
          <span class="minus">−${totals.deletions}</span>
        </span>
      </div>
      <div class="file-rows">${fileRows}</div>
    </div>
    <div class="details-splitter" id="detailsSplitter" role="separator" aria-orientation="horizontal"
      tabindex="0" title="拖动调整变更文件高度（双击重置）"></div>

    ${diffBlock}`;
}

function buildDiffBlock(entry, fileCount) {
  const diff = entry.diff;
  const mode = state.diffMode;
  const toolbar = `
    <div class="diff-toolbar">
      <button class="diff-nav" type="button" data-action="prev-file" title="上一个文件" ${fileCount <= 1 ? 'disabled' : ''}>${icon('chevron-left')}</button>
      <button class="diff-nav" type="button" data-action="next-file" title="下一个文件" ${fileCount <= 1 ? 'disabled' : ''}>${icon('chevron-right')}</button>
      <span class="diff-file" title="${esc(entry.path)}">
        ${icon('file')}
        <span class="dfdir">${esc(dirname(entry.path))}</span>
        <span class="dfname">${esc(basename(entry.path))}</span>
      </span>
      <span class="diff-file-stats">
        <span class="plus">+${diff.additions}</span>
        ${diff.deletions ? `<span class="minus">−${diff.deletions}</span>` : ''}
      </span>
      <span class="diff-mode-seg" role="group" aria-label="Diff 视图">
        <button class="diff-mode-btn ${mode === 'split' ? 'active' : ''}" type="button" data-action="set-diff-mode" data-mode="split" title="并排 diff">
          ${icon('split')}
        </button>
        <button class="diff-mode-btn ${mode === 'unified' ? 'active' : ''}" type="button" data-action="set-diff-mode" data-mode="unified" title="统一 diff">
          ${icon('unified')}
        </button>
      </span>
      <button class="diff-nav diff-expand" type="button" data-action="expand-diff" title="全页面查看 diff（双击文件也可）">
        ${icon('expand')}
      </button>
    </div>`;

  return `
    <div class="diff-block">
      ${toolbar}
      <div class="diff-scroll">
        <div class="diff-head">
          <div class="diff-side">修改前 <span>${diff.oldLines.length} 行</span></div>
          <div class="diff-side">修改后 <span>${diff.newLines.length} 行</span></div>
        </div>
        <div class="diff-rows">
          <div class="diff-hunk">${esc(diff.hunk)}</div>
          ${mode === 'split' ? renderSplitDiff(diff) : renderUnifiedDiff(diff)}
        </div>
      </div>
    </div>`;
}

function renderSplitDiff(diff) {
  if (!diff.splitRows.length) {
    return `<div class="diff-empty">${icon('file')}<span>两侧内容一致，没有差异。</span></div>`;
  }
  return diff.splitRows.map((row) => {
    const left = row.left;
    const right = row.right;
    const leftIsDel = left && left.type === 'del';
    const rightIsAdd = right && right.type === 'add';
    const leftCode = left ? highlightCode(left.text, diff.lang) : '';
    const rightCode = right ? highlightCode(right.text, diff.lang) : '';
    return `
      <div class="diff-row">
        <span class="diff-ln ${leftIsDel ? 'del' : ''}">${left && left.oldNo != null ? left.oldNo : ''}</span>
        <span class="diff-code left ${leftIsDel ? 'del' : ''} ${!left ? 'fill' : ''}">${left ? leftCode : ' '}</span>
        <span class="diff-ln right ${rightIsAdd ? 'add' : ''}">${right && right.newNo != null ? right.newNo : ''}</span>
        <span class="diff-code right ${rightIsAdd ? 'add' : ''} ${!right ? 'fill' : ''}">${right ? rightCode : ' '}</span>
      </div>`;
  }).join('');
}

function renderUnifiedDiff(diff) {
  if (!diff.unifiedRows.length) {
    return `<div class="diff-empty">${icon('file')}<span>两侧内容一致，没有差异。</span></div>`;
  }
  return diff.unifiedRows.map((row) => {
    const sign = row.type === 'add' ? '+' : (row.type === 'del' ? '−' : ' ');
    return `
      <div class="uni-row ${row.type}">
        <span class="diff-ln">${row.oldNo != null ? row.oldNo : ''}</span>
        <span class="diff-ln right">${row.newNo != null ? row.newNo : ''}</span>
        <span class="uni-sign ${row.type}">${sign}</span>
        <span class="diff-code">${highlightCode(row.text, diff.lang)}</span>
      </div>`;
  }).join('');
}

/* ============================================================== composer */
function draftNoteInfo(repoId, providedText = null) {
  const draft = draftFor(repoId);
  const input = $('#commitMessage');
  const text = providedText != null ? providedText : (input ? input.value : '');
  const hasText = Boolean(String(text).trim());
  if (hasText && draft) {
    return draft.restored
      ? `${icon('undo')} 已恢复上次输入 · ${timeAgo(draft.ts)}`
      : `${icon('check')} 草稿已自动保存 · ${timeAgo(draft.ts)}`;
  }
  if (hasText) return `${icon('check')} 草稿已自动保存 · 刚刚`;
  return '输入内容会按仓库自动记忆';
}

function renderComposer() {
  const composer = $('#composer');
  const repo = currentRepo();
  if (!composer) return;
  if (!repo || !repo.workingChanges.length) {
    composer.innerHTML = '';
    composer.hidden = true;
    return;
  }
  composer.hidden = false;

  const draft = draftFor(repo.id);
  const text = draft ? draft.text : '';
  const checked = checkedFiles(repo);
  const entries = filesWithStats(repo, checked, 'work');
  const firstLine = text.split('\n')[0] || '';
  const note = draftNoteInfo(repo.id, text);
  const noteClass = draft && draft.restored && text.trim() ? ' restored' : '';
  const restoreChip = draft && draft.restored && text.trim()
    ? `<span class="restore-chip" id="restoreChip" title="已恢复上次输入 · ${esc(absTime(draft.ts))}">${icon('undo')} 已恢复</span>`
    : '';

  composer.innerHTML = `
    <div class="changes-commit">
      <div class="cc-context">
        <div class="cc-eyebrow">${icon('check')} 准备提交</div>
        <div class="commit-target" id="commitTarget">${commitTargetHtml(repo, entries)}</div>
        <div class="cc-selected" id="commitSelectionHint">${checked.length} / ${repo.workingChanges.length} 个文件已勾选</div>
        <div class="cc-hint">勾选左侧文件，填写提交信息；<kbd>⌘↵</kbd> 提交</div>
      </div>
      <div class="cc-editor">
        <div class="cc-editor-head">
          <span class="message-title">提交信息</span>
          ${restoreChip}
          <span class="spacer"></span>
          <button class="msg-icon-btn" type="button" data-action="message-history" data-popover-trigger title="最近输入与提交信息记忆">
            ${icon('history')}
          </button>
          <button class="ai-button ${state.aiBusy ? 'busy' : ''}" type="button" data-action="generate-message" title="让 agent 分析 diff 并生成提交信息" ${state.aiBusy ? 'disabled' : ''}>
            ${icon('sparkles')} 生成
          </button>
        </div>
        <textarea id="commitMessage" class="message-area" spellcheck="false" autocomplete="off"
          placeholder="描述这次更改…（⌘↵ 提交）">${esc(text)}</textarea>
        <div class="cc-editor-foot">
          <span class="draft-note${noteClass}" id="draftNote">${note}</span>
          <span class="spacer"></span>
          <span class="char-count" id="charCount">${text ? `首行 ${firstLine.length} / 72` : ''}</span>
        </div>
      </div>
      <div class="cc-actions">
        <button class="commit-btn" type="button" id="commitBtn" data-action="commit" ${state.aiBusy || !checked.length || !text.trim() ? 'disabled' : ''}>
          提交 <kbd>⌘↵</kbd>
        </button>
        <span class="cc-selected" id="commitButtonHint">${checked.length} 个文件 · ${esc(repo.branch)}</span>
      </div>
    </div>`;

  updateCommitUI();
  const charCount = $('#charCount');
  if (charCount) charCount.classList.toggle('warn', firstLine.length > 72);
}

function updateDraftNoteUI() {
  const repo = currentRepo();
  const note = $('#draftNote');
  if (!repo || !note) return;
  const draft = draftFor(repo.id);
  note.innerHTML = draftNoteInfo(repo.id);
  const input = $('#commitMessage');
  note.classList.toggle('restored', Boolean(input && input.value.trim() && draft && draft.restored));
}

function updateCharCountUI() {
  const input = $('#commitMessage');
  const count = $('#charCount');
  if (!input || !count) return;
  const text = input.value;
  if (!text.trim()) {
    count.textContent = '';
    count.classList.remove('warn');
    return;
  }
  const firstLine = text.split('\n')[0];
  count.textContent = `首行 ${firstLine.length} / 72`;
  count.classList.toggle('warn', firstLine.length > 72);
}

function commitTargetHtml(repo, entries) {
  if (!entries.length) {
    return `提交到 <b>${esc(repo.branch)}</b><span class="sep">·</span>选择要提交的文件`;
  }
  const stats = totalStats(entries);
  return `提交到 <b>${esc(repo.branch)}</b><span class="sep">·</span>${entries.length} 个文件<span class="sep">·</span><span class="stats"><span class="plus">+${stats.additions}</span> <span class="minus">−${stats.deletions}</span></span>`;
}

function updateCommitUI() {
  const repo = currentRepo();
  if (!repo) return;
  const checked = checkedFiles(repo);
  const input = $('#commitMessage');
  const message = input ? input.value : (draftFor(repo.id)?.text || '');
  const entries = filesWithStats(repo, checked, 'work');
  const target = $('#commitTarget');
  if (target) target.innerHTML = commitTargetHtml(repo, entries);
  const count = $('#changeCount');
  if (count) count.textContent = `${checked.length} / ${repo.workingChanges.length}`;
  const headCount = $('#changesCheckedCount');
  if (headCount) headCount.textContent = String(checked.length);
  const selectionHint = $('#commitSelectionHint');
  if (selectionHint) selectionHint.textContent = `${checked.length} / ${repo.workingChanges.length} 个文件已勾选`;
  const buttonHint = $('#commitButtonHint');
  if (buttonHint) buttonHint.textContent = `${checked.length} 个文件 · ${repo.branch}`;
  const button = $('#commitBtn');
  if (button) button.disabled = state.aiBusy || !checked.length || !message.trim();
  const selectAll = $('#selectAllChanges');
  if (selectAll) {
    selectAll.checked = checked.length === repo.workingChanges.length && repo.workingChanges.length > 0;
    selectAll.indeterminate = checked.length > 0 && checked.length < repo.workingChanges.length;
  }
  const discardButton = $('#discardChangesBtn');
  if (discardButton) discardButton.disabled = checked.length === 0;
}

function syncComposerSelection() {
  const repo = currentRepo();
  if (!repo) return;
  const scope = $('#changesView') || document;
  $$('[data-file-check]', scope).forEach((input) => {
    const checked = repo.checked.has(input.dataset.fileCheck);
    input.checked = checked;
    const row = input.closest('.change-row, .tree-file');
    if (row) row.classList.toggle('off', !checked);
  });
  updateCommitUI();
}

function handleMessageInput(event) {
  const repo = currentRepo();
  if (!repo) return;
  const text = event.target.value;
  state.genToken += 1;
  if (state.aiBusy) {
    state.aiBusy = false;
    setGenerateBusy(false);
  }
  if (text.trim()) {
    state.drafts[repo.id] = { text, ts: Date.now(), restored: false };
  } else {
    delete state.drafts[repo.id];
  }
  const chip = $('#restoreChip');
  if (chip) chip.remove();
  saveDraftsSoon();
  updateDraftNoteUI();
  updateCharCountUI();
  updateCommitUI();
}

function setGenerateBusy(busy) {
  const button = $('.ai-button', $('#composer'));
  if (!button) return;
  button.classList.toggle('busy', busy);
  button.disabled = busy;
}

function setComposerText(text, options = {}) {
  const repo = currentRepo();
  if (!repo) return;
  if (state.view !== 'changes') {
    if (!repo.workingChanges.length) {
      toast('当前工作区没有可提交的更改', { tone: 'error' });
      return;
    }
    state.view = 'changes';
    ensureWorktreeFile(repo);
    applyViewMode();
    renderAll();
  }
  const input = $('#commitMessage');
  if (!input) {
    toast('当前工作区没有可提交的更改', { tone: 'error' });
    return;
  }
  input.value = text;
  state.drafts[repo.id] = { text, ts: Date.now(), restored: false };
  const chip = $('#restoreChip');
  if (chip) chip.remove();
  saveDraftsSoon();
  updateDraftNoteUI();
  updateCharCountUI();
  updateCommitUI();
  input.focus({ preventScroll: true });
  if (options.toast) toast(options.toast, { tone: 'success' });
}

function captureTerminalInput() {
  const input = $('#termInput');
  if (input && state.terminal.domKey) state.terminal.inputDrafts[state.terminal.domKey] = input.value;
}

function setTerminalInputDraft(value) {
  if (state.terminal.inputKey) state.terminal.inputDrafts[state.terminal.inputKey] = value;
  const input = $('#termInput');
  if (input) input.value = value;
}

async function typeIntoComposer(input, text, token) {
  const note = $('#draftNote');
  if (note) note.innerHTML = `${icon('sparkles')} agent 正在根据 diff 起草…`;
  const chip = $('#restoreChip');
  if (chip) chip.remove();
  input.value = '';
  let index = 0;
  while (index < text.length) {
    if (token !== state.genToken) return false;
    index = Math.min(text.length, index + 3 + Math.floor(Math.random() * 4));
    input.value = text.slice(0, index);
    updateCharCountUI();
    await sleep(13 + Math.random() * 12);
  }
  return token === state.genToken;
}

async function generateCommitMessage() {
  if (state.aiBusy) return;
  const repo = currentRepo();
  if (!repo) return;
  const files = checkedFiles(repo);
  if (!files.length) {
    toast('先勾选至少一个文件', { tone: 'error' });
    return;
  }
  const input = $('#commitMessage');
  if (!input) return;

  const token = state.genToken + 1;
  state.genToken = token;
  state.aiBusy = true;
  setGenerateBusy(true);
  updateCommitUI();

  if (input.value.trim()) addHistory(repo.id, input.value.trim());

  state.terminal.open = true;
  state.terminal.tab = 'codex';
  state.terminal.modes.codex = 'commit';
  state.terminal.worktree = true;
  const session = ensureSession(repo, 'codex');
  session.push({ role: 'system', text: `commit-craft 已加载 · 分析 ${files.length} 个文件的 diff…` });
  renderTerminal({ forceBottom: true });
  await sleep(420);

  if (token !== state.genToken) { state.aiBusy = false; setGenerateBusy(false); return; }
  session.push({ role: 'system', text: '先读变更范围，再对齐最近几次提交的语气。' });
  renderTerminal({ forceBottom: true });
  await sleep(460);

  if (token !== state.genToken) { state.aiBusy = false; setGenerateBusy(false); return; }
  const suggestion = buildCommitSuggestion(repo, files);
  const stats = totalStats(filesWithStats(repo, files, 'work'));
  session.push({
    role: 'agent',
    text: `已读完 ${files.length} 个文件（+${stats.additions} −${stats.deletions}），建议提交信息：\n\n${suggestion}`,
  });
  renderTerminal({ forceBottom: true });
  await sleep(180);

  if (token !== state.genToken) { state.aiBusy = false; setGenerateBusy(false); return; }
  const completed = await typeIntoComposer(input, suggestion, token);
  if (!completed || token !== state.genToken) {
    state.aiBusy = false;
    setGenerateBusy(false);
    return;
  }

  state.aiBusy = false;
  state.drafts[repo.id] = { text: suggestion, ts: Date.now(), restored: false };
  saveDraftsSoon();
  setGenerateBusy(false);
  updateDraftNoteUI();
  updateCharCountUI();
  updateCommitUI();
  toast('已根据当前 diff 生成提交信息', { tone: 'success' });
}

/* =============================================================== terminal */
function initShellSession(repo) {
  const status = repo.ahead ? ` [ahead ${repo.ahead}]` : (repo.behind ? ` [behind ${repo.behind}]` : '');
  const messages = [
    { role: 'meta', text: `Last login: Wed Nov 26 09:38:12 on ttys002` },
    { role: 'cmd', text: 'git status --short --branch' },
  ];
  let output = `## ${repo.branch}...origin/${repo.branch}${status}\n`;
  if (repo.workingChanges.length) {
    output += repo.workingChanges.slice(0, 7).map((file) => {
      const prefix = file.status === 'A' ? 'A ' : ' M';
      return `${prefix} ${file.path}`;
    }).join('\n');
  } else {
    output += 'nothing to commit, working tree clean';
  }
  messages.push({ role: 'out', text: output });
  return messages;
}

function initAgentSession(repo, tab) {
  const label = AGENT_LABELS[tab] || 'Agent';
  if (repo.id === 'knit' && tab === 'codex') {
    return [
      { role: 'user', text: '这个提交的 merge 曲线是怎么画的？' },
      {
        role: 'agent',
        text: '`CommitGraph.tsx` 用 cubic path 替换了 polyline；`graphLayout.ts` 复用布局缓存，fork / join 共用同一半径。lane 颜色由 `laneColor()` 推导，rebase 后不会跳色。',
      },
    ];
  }
  const commit = selectedCommit(repo);
  const context = commit ? `${repo.name}@${commit.hash.slice(0, 7)}` : `${repo.name} worktree`;
  return [{
    role: 'agent',
    text: `${label} 已就绪。当前上下文是 ${context}。可以让我解释提交、梳理调用链，或根据工作区 diff 起草提交信息。`,
  }];
}

function ensureSession(repo, tab) {
  const key = `${repo.id}:${tab}`;
  if (!state.terminal.sessions[key]) {
    state.terminal.sessions[key] = tab === 'terminal'
      ? initShellSession(repo)
      : initAgentSession(repo, tab);
  }
  return state.terminal.sessions[key];
}

function skillsForMode(mode) {
  const definition = MODES[mode];
  if (!definition) return [];
  return definition.skills.filter((skill) => state.terminal.skills.has(skill));
}

function terminalContext(repo) {
  if (state.terminal.worktree) {
    const selected = checkedFiles(repo).length;
    const total = repo.workingChanges.length;
    const suffix = selected && selected !== total ? `${selected}/${total}` : `${total}`;
    return { kind: 'worktree', label: `worktree · ${suffix} files`, commit: null };
  }
  const commit = selectedCommit(repo);
  if (!commit) return { kind: 'none', label: '无提交上下文', commit: null };
  return { kind: 'commit', label: `@ ${commit.hash.slice(0, 7)} · ${repo.branch}`, commit };
}

function renderTerminalTab(tab) {
  const active = state.terminal.tab === tab;
  const label = tab === 'terminal' ? '终端' : AGENT_LABELS[tab];
  const glyph = tab === 'pi'
    ? '<span class="pi-glyph">π</span>'
    : icon(tab === 'terminal' ? 'terminal' : 'sparkles');
  return `<button class="term-tab ${active ? 'active' : ''}" type="button" data-term-tab="${tab}" title="${label}">
    ${glyph}<span>${label}</span>
  </button>`;
}

function renderTerminalMessage(message, repo) {
  const actions = message.actions && message.actions.length
    ? `<div class="term-actions-row">${message.actions.map((action) => (
      `<button class="term-action" type="button" data-term-action="${esc(action.kind)}" data-payload="${esc(encodeURIComponent(action.payload || ''))}">
        ${icon('check')}${esc(action.label)}
      </button>`
    )).join('')}</div>`
    : '';

  let body = '';
  if (message.role === 'out' || message.role === 'meta') {
    body = `<div class="t-line t-out"><span class="t-prefix"></span><span>${esc(message.text)}</span></div>`;
  } else if (message.role === 'cmd') {
    body = `<div class="t-line t-cmd"><span class="t-prefix">❯</span><span><span class="t-path">${esc(shortPath(`${state.root}/${repo.rel}`))}</span> <span class="t-branch">${esc(repo.branch)}</span>  ${esc(message.text)}</span></div>`;
  } else if (message.role === 'user') {
    body = `<div class="t-line t-user"><span class="t-prefix">›</span><span>${formatRichText(message.text)}</span></div>`;
  } else if (message.role === 'agent') {
    body = `<div class="t-line t-agent"><span class="t-prefix">▸</span><span>${formatRichText(message.text)}</span></div>`;
  } else if (message.role === 'system') {
    body = `<div class="t-line t-system"><span class="t-prefix">▍</span><span>${formatRichText(message.text)}</span></div>`;
  } else {
    body = `<div class="t-line t-out"><span class="t-prefix"></span><span>${esc(message.text)}</span></div>`;
  }
  return `<div class="t-message">${body}${actions}</div>`;
}

function renderTerminal(options = {}) {
  const terminal = $('#terminal');
  const repo = currentRepo();
  if (!terminal) return;

  const existingInput = $('#termInput');
  const inputWasFocused = Boolean(existingInput && document.activeElement === existingInput);
  if (existingInput && state.terminal.domKey) {
    state.terminal.inputDrafts[state.terminal.domKey] = existingInput.value;
  }
  const oldScroll = $('#termScroll');
  const nearBottom = !oldScroll || (oldScroll.scrollHeight - oldScroll.scrollTop - oldScroll.clientHeight < 40);

  if (!repo) {
    terminal.className = 'terminal collapsed';
    terminal.innerHTML = `<div class="term-head">${renderTerminalTab('terminal')}<span class="term-collapsed-hint">没有选中的仓库</span></div>`;
    return;
  }

  const tab = state.terminal.tab;
  const key = `${repo.id}:${tab}`;
  const session = ensureSession(repo, tab);
  state.terminal.inputKey = key;
  const isAgent = tab !== 'terminal';
  const mode = isAgent ? state.terminal.modes[tab] : null;
  const context = isAgent ? terminalContext(repo) : null;
  const loadedSkills = isAgent ? skillsForMode(mode) : [];
  const loadedPlugins = isAgent ? PLUGINS.filter((plugin) => state.terminal.plugins.has(plugin.id)) : [];
  const placeholder = tab === 'terminal'
    ? '输入命令…（git status / git log / git diff --stat）'
    : (MODES[mode]?.placeholder || '与 agent 对话…');

  let headerActions = '';
  if (isAgent) {
    const modeButtons = ['read', 'commit', 'free'].map((item) => (
      `<button class="mode-btn ${mode === item ? 'active' : ''}" type="button" data-term-mode="${item}" title="${MODES[item].label}模式">${MODES[item].label}</button>`
    )).join('');
    headerActions = `
      <div class="mode-seg" role="group" aria-label="Agent 模式">${modeButtons}</div>
      <span class="term-ctx ${context.kind === 'worktree' ? 'worktree' : ''}" title="${esc(context.label)}">
        ${icon(context.kind === 'worktree' ? 'file' : 'crosshair')}<span>${esc(context.label)}</span>
      </span>
      <button class="term-icon-btn" type="button" data-action="open-skills" data-popover-trigger title="配置固定 skills 与 plugins">
        ${icon('gear')}
      </button>`;
  } else {
    headerActions = `
      <span class="term-ctx" title="${esc(shortPath(`${state.root}/${repo.rel}`))}">
        ${icon('terminal')}<span>${esc(repo.name)} · ${esc(repo.branch)}</span>
      </span>`;
  }

  const banner = isAgent ? `
    <div class="agent-banner">
      <span class="ab-agent">${icon('sparkles')}${AGENT_LABELS[tab]}</span>
      <span class="ab-mode">${MODES[mode].label}模式</span>
      <span class="ab-skills-label">skills</span>
      ${loadedSkills.length
        ? loadedSkills.map((skill) => `<span class="skill-chip" title="${esc(skill)}">${esc(skill)}</span>`).join('')
        : `<span class="skill-chip none">未启用固定 skill</span>`}
      ${loadedPlugins.length ? `
        <span class="ab-skills-label">plugins</span>
        ${loadedPlugins.map((plugin) => `<span class="skill-chip plugin" title="${esc(plugin.desc)}">${esc(plugin.name)}</span>`).join('')}` : ''}
      <span class="ab-context">${esc(context.label)}</span>
    </div>` : '';

  const thinking = state.terminal.thinking[key];
  const messagesHtml = session.map((message) => renderTerminalMessage(message, repo)).join('');
  const thinkingHtml = thinking
    ? `<div class="t-line t-agent"><span class="t-prefix">▸</span><span class="typing"><i></i><i></i><i></i></span></div>`
    : '';

  const hint = tab === 'terminal' ? '↵ 执行' : '↵ 发送';
  const body = state.terminal.open ? `
    <div class="term-body">
      ${banner}
      <div class="term-scroll" id="termScroll">
        ${session.length || thinking ? '' : `<div class="t-line t-out"><span class="t-prefix"></span><span>新会话已就绪。</span></div>`}
        ${messagesHtml}
        ${thinkingHtml}
      </div>
      <div class="term-input-row">
        <span class="term-prompt">${icon('chevron-right')}</span>
        <input class="term-input" id="termInput" type="text" autocomplete="off" spellcheck="false"
          placeholder="${esc(placeholder)}" aria-label="终端输入">
        <span class="term-hint">${hint}</span>
        <button class="term-send" type="button" data-action="term-send" title="发送">${icon('send')}</button>
      </div>
    </div>` : `
    <div class="term-body">
      <div class="term-collapsed-hint">${esc(context ? context.label : `${repo.name} · ${repo.branch}`)}</div>
    </div>`;

  terminal.className = `terminal ${state.terminal.open ? 'open' : 'collapsed'}`;
  terminal.innerHTML = `
    <div class="term-head">
      <div class="term-tabs">
        ${renderTerminalTab('terminal')}
        ${renderTerminalTab('codex')}
        ${renderTerminalTab('pi')}
        ${renderTerminalTab('claude')}
      </div>
      <div class="term-actions">
        ${headerActions}
        <button class="term-icon-btn" type="button" data-action="reset-session" title="重置当前会话">
          ${icon('refresh')}
        </button>
        <button class="term-icon-btn" type="button" data-action="toggle-terminal" title="${state.terminal.open ? '收起终端' : '展开终端'}">
          ${icon(state.terminal.open ? 'chevron-down' : 'chevron-up')}
        </button>
      </div>
    </div>
    ${body}`;

  const input = $('#termInput');
  state.terminal.domKey = key;
  if (input) {
    input.value = state.terminal.inputDrafts[key] || '';
    if (state.terminal.open && (options.focus || inputWasFocused)) {
      input.focus({ preventScroll: true });
      const pos = input.value.length;
      input.setSelectionRange(pos, pos);
    }
  }
  const scroll = $('#termScroll');
  if (scroll && (nearBottom || options.forceBottom)) {
    scroll.scrollTop = scroll.scrollHeight;
  }
}

function switchTerminalTab(tab) {
  if (!['terminal', 'codex', 'pi', 'claude'].includes(tab)) return;
  captureTerminalInput();
  state.terminal.tab = tab;
  state.terminal.open = true;
  renderTerminal({ focus: true, forceBottom: true });
}

function setTerminalMode(mode) {
  const tab = state.terminal.tab;
  if (tab === 'terminal' || !MODES[mode]) return;
  if (state.terminal.modes[tab] === mode) return;
  state.terminal.modes[tab] = mode;
  const repo = currentRepo();
  if (repo) {
    const session = ensureSession(repo, tab);
    const loaded = skillsForMode(mode);
    session.push({
      role: 'system',
      text: `切换到 ${MODES[mode].label}模式${loaded.length ? ` · 加载 ${loaded.join(', ')}` : ' · 未启用固定 skill'}`,
    });
  }
  renderTerminal({ focus: true, forceBottom: true });
}

function resetSession() {
  const repo = currentRepo();
  if (!repo) return;
  const key = `${repo.id}:${state.terminal.tab}`;
  delete state.terminal.sessions[key];
  state.terminal.inputDrafts[key] = '';
  state.terminal.thinking[key] = false;
  ensureSession(repo, state.terminal.tab);
  renderTerminal({ focus: true, forceBottom: true });
  toast('会话已重置', { tone: 'info', duration: 1500 });
}

function openTerminalAtCommit() {
  const repo = currentRepo();
  const commit = selectedCommit(repo);
  if (!repo || !commit) return;
  captureTerminalInput();
  state.terminal.open = true;
  state.terminal.tab = 'codex';
  state.terminal.modes.codex = 'read';
  state.terminal.worktree = false;
  state.terminal.contextHash = commit.hash;
  const session = ensureSession(repo, 'codex');
  session.push({ role: 'system', text: `已附着 ${commit.hash.slice(0, 7)} · ${commit.subject}` });
  renderTerminal({ focus: true, forceBottom: true });
}

function analyzeCommit() {
  const repo = currentRepo();
  const commit = selectedCommit(repo);
  if (!repo || !commit) return;
  captureTerminalInput();
  state.terminal.open = true;
  state.terminal.tab = 'codex';
  state.terminal.modes.codex = 'read';
  state.terminal.worktree = false;
  state.terminal.contextHash = commit.hash;
  const session = ensureSession(repo, 'codex');
  const key = `${repo.id}:codex`;
  session.push({ role: 'system', text: `已附着 ${commit.hash.slice(0, 7)} · 读代码模式` });
  session.push({ role: 'user', text: '解释这个提交的核心改动和潜在风险。' });
  state.terminal.thinking[key] = true;
  renderTerminal({ forceBottom: true });
  setTimeout(() => {
    state.terminal.thinking[key] = false;
    session.push({ role: 'agent', text: buildAgentAnalysis(repo, commit) });
    if (isTerminalSessionActive(key)) renderTerminal({ focus: true });
  }, 720);
}

function isTerminalSessionActive(key) {
  const repo = currentRepo();
  if (!repo || !state.terminal.open) return false;
  return `${repo.id}:${state.terminal.tab}` === key;
}

function handleShellCommand(text, repo, session) {
  const cmd = text.trim();
  session.push({ role: 'cmd', text });
  if (cmd === 'clear') {
    session.length = 0;
    return;
  }
  let output = '';
  if (cmd === 'pwd') {
    output = `${state.root}/${repo.rel}`;
  } else if (cmd === 'ls') {
    output = 'README.md   package.json   src/   tests/   docs/';
  } else if (cmd.startsWith('git status')) {
    const status = repo.ahead ? ` [ahead ${repo.ahead}]` : (repo.behind ? ` [behind ${repo.behind}]` : '');
    output = `## ${repo.branch}...origin/${repo.branch}${status}\n`;
    if (repo.workingChanges.length) {
      output += repo.workingChanges.map((file) => `${file.status === 'A' ? 'A ' : ' M'} ${file.path}`).join('\n');
      output += '\n\nno changes added to commit';
    } else {
      output += 'nothing to commit, working tree clean';
    }
  } else if (cmd.startsWith('git log')) {
    output = repo.commits.slice(0, 6).map((commit) => `${commit.hash.slice(0, 7)} ${commit.subject}`).join('\n');
  } else if (cmd === 'git branch' || cmd === 'git branch -a') {
    output = `* ${repo.branch}\n  main\n  remotes/origin/${repo.branch}`;
  } else if (cmd.startsWith('git diff')) {
    const entries = filesWithStats(repo, repo.workingChanges, 'work');
    if (!entries.length) output = '(no working tree changes)';
    else {
      output = entries.map((entry) => ` ${entry.path} | ${entry.additions + entry.deletions} +++---`).join('\n');
      const totals = totalStats(entries);
      output += `\n ${entries.length} files changed, ${totals.additions} insertions(+), ${totals.deletions} deletions(-)`;
    }
  } else if (cmd === 'git add .' || cmd === 'git add -A') {
    output = '(prototype) 已将工作区更改加入暂存区。在左侧提交框中选择文件后提交。';
  } else if (cmd === 'help') {
    output = '支持：git status · git log · git diff · git branch · git add . · pwd · ls · clear';
  } else if (cmd === 'exit') {
    output = '会话在后台保留，点击标签页可以回来。';
  } else {
    output = `zsh: command not found: ${cmd.split(/\s+/)[0]}`;
  }
  if (output) session.push({ role: 'out', text: output });
}

function buildCommitSuggestionForRepo(repo, files) {
  return buildCommitSuggestion(repo, files);
}

function buildAgentReply(tab, text, repo) {
  const label = AGENT_LABELS[tab] || 'Agent';
  const inputFiles = checkedFiles(repo).length ? checkedFiles(repo) : repo.workingChanges;
  const commit = state.terminal.worktree ? null : selectedCommit(repo);
  const wantsCommit = /提交信息|commit message|生成.*提交|写.*提交|commit msg/i.test(text);
  const wantsAnalysis = /解释|分析|diff|改了什么|做了什么|风险|review/i.test(text);
  const contextText = state.terminal.worktree
    ? `worktree（${repo.workingChanges.length} 个文件）`
    : (commit ? `提交 ${commit.hash.slice(0, 7)}` : '当前仓库');

  if (wantsCommit) {
    if (!inputFiles.length) {
      return { text: `工作区是干净的，暂时没有 diff 可以总结。选中一个提交或产生一些改动，我再起草提交信息。` };
    }
    const suggestion = buildCommitSuggestionForRepo(repo, inputFiles);
    const stats = totalStats(filesWithStats(repo, inputFiles, 'work'));
    return {
      text: `基于 ${contextText} 的 ${inputFiles.length} 个文件（+${stats.additions} −${stats.deletions}）起草如下：\n\n${suggestion}\n\n需要更短的 subject，或拆成多个提交，可以继续让我调整。`,
      actions: [{ kind: 'apply-message', label: '填入提交框', payload: suggestion }],
    };
  }
  if (wantsAnalysis) {
    return { text: buildAgentAnalysis(repo, state.terminal.worktree ? null : commit) };
  }
  if (/文件|变更|paths?/i.test(text)) {
    const files = commit ? commit.files : inputFiles;
    if (!files.length) return { text: '当前上下文里没有变更文件。' };
    const lines = files.map((file) => `• \`${file.path}\`${commit ? '' : ` (${file.status})`}`);
    return { text: `当前上下文（${contextText}）涉及 ${files.length} 个文件：\n\n${lines.join('\n')}` };
  }
  if (/skill|模式|加载/i.test(text)) {
    const mode = state.terminal.modes[tab];
    const loaded = skillsForMode(mode);
    return {
      text: `当前是 ${MODES[mode].label}模式，固定加载的 skills：\n\n${loaded.length ? loaded.map((skill) => `• \`${skill}\``).join('\n') : '（无）'}\n\n可以在终端右上角的齿轮里调整，也可以切换模式。每个 agent 标签页维护自己的模式。`,
    };
  }
  if (commit) {
    return {
      text: `${label} 已读取 ${contextText} 的上下文：${commit.subject}。\n\n可以继续问我：\n• 这个提交的调用链与影响范围\n• 哪些测试值得补\n• 如何拆成更清晰的提交\n\n当前上下文：${commit.files.length} 个文件。`,
    };
  }
  return {
    text: `${label} 已准备好。当前上下文是 ${contextText}。\n\n可以让我阅读代码、解释提交，或根据工作区 diff 起草提交信息。`,
  };
}

function sendTerminalInput() {
  const repo = currentRepo();
  const input = $('#termInput');
  if (!repo || !input) return;
  const text = input.value.trim();
  if (!text) return;
  const tab = state.terminal.tab;
  const key = `${repo.id}:${tab}`;
  const session = ensureSession(repo, tab);
  state.terminal.inputDrafts[key] = '';
  input.value = '';

  if (tab === 'terminal') {
    handleShellCommand(text, repo, session);
    renderTerminal({ focus: true, forceBottom: true });
    return;
  }

  session.push({ role: 'user', text });
  state.terminal.thinking[key] = true;
  renderTerminal({ focus: true, forceBottom: true });

  setTimeout(() => {
    state.terminal.thinking[key] = false;
    const reply = buildAgentReply(tab, text, repo);
    session.push({ role: 'agent', text: reply.text, actions: reply.actions });
    if (isTerminalSessionActive(key)) renderTerminal({ focus: true });
  }, 620 + Math.random() * 420);
}

/* ============================================================== popovers */
function closePopover() {
  const root = $('#popoverRoot');
  if (!root) return;
  root.innerHTML = '';
  delete root.dataset.key;
}

function showPopover(anchor, key, html, width = 320, align = 'right') {
  const root = $('#popoverRoot');
  if (!root || !anchor) return;
  if (root.dataset.key === key && root.firstElementChild) {
    closePopover();
    return;
  }
  root.dataset.key = key;
  root.innerHTML = `<div class="popover" style="width:${width}px; visibility:hidden">${html}</div>`;
  const pop = root.firstElementChild;
  const place = () => {
    if (!pop || !pop.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const preferredLeft = align === 'left' ? rect.left : rect.right - popRect.width;
    let left = Math.min(window.innerWidth - popRect.width - 12, Math.max(12, preferredLeft));
    let top = rect.top - popRect.height - 8;
    if (top < 52) top = rect.bottom + 8;
    if (top + popRect.height > window.innerHeight - 10) {
      top = Math.max(52, window.innerHeight - popRect.height - 12);
    }
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.visibility = 'visible';
  };
  place();
  requestAnimationFrame(place);
}

function buildHistoryPopover(repo) {
  const stored = state.history[repo.id] || [];
  const commits = repo.commits.slice(0, 5);
  const storedHtml = stored.length ? `
    <div class="hist-label">最近输入</div>
    ${stored.map((item, index) => `
      <button class="hist-item" type="button" data-hist-kind="stored" data-hist-index="${index}">
        ${icon('undo')}
        <span class="hist-item-text">
          <span class="hist-subject">${esc(item.text.split('\n')[0])}</span>
          <span class="hist-time">${timeAgo(item.ts)}</span>
        </span>
      </button>`).join('')}` : '';

  const commitHtml = commits.length ? `
    <div class="hist-label">最近提交</div>
    ${commits.map((commit, index) => `
      <button class="hist-item" type="button" data-hist-kind="commit" data-hist-index="${index}">
        ${icon('history')}
        <span class="hist-item-text">
          <span class="hist-subject">${esc(commit.subject)}</span>
          <span class="hist-time">${esc(commit.hash.slice(0, 7))} · ${timeAgo(commit.date)}</span>
        </span>
      </button>`).join('')}` : '';

  return `
    <div class="pop-head">
      <span class="pop-title">提交信息记忆</span>
      <span class="pop-sub">${esc(repo.name)}</span>
    </div>
    <div class="pop-body">
      ${storedHtml || commitHtml ? storedHtml + commitHtml : '<div class="hist-empty">还没有记忆的提交信息。输入一次后会自动按仓库保存。</div>'}
    </div>
    <div class="pop-foot">${icon('clock')} 草稿仅保存在本机 · 按仓库隔离</div>`;
}

function toggleHistoryPopover(anchor) {
  const repo = currentRepo();
  if (!repo) return;
  showPopover(anchor, 'history', buildHistoryPopover(repo), 330);
}

function buildSkillsPopover() {
  const skillsOn = state.terminal.skills.size;
  const pluginsOn = state.terminal.plugins.size;
  return `
    <div class="skills-head">
      ${icon('gear')}
      <span class="pop-title">Agent 配置</span>
      <span class="skills-count">${skillsOn} skills · ${pluginsOn} plugins</span>
    </div>
    <div class="hist-label">固定 skills</div>
    <div class="skills-list">
      ${SKILLS.map((skill) => `
        <label class="skill-row">
          <span class="check-wrap">
            <input type="checkbox" data-skill="${skill.id}" ${state.terminal.skills.has(skill.id) ? 'checked' : ''}>
            <span class="check-box">${icon('check')}</span>
          </span>
          <span class="skill-text">
            <span class="skill-name">${esc(skill.name)}</span>
            <span class="skill-desc">${esc(skill.desc)}</span>
          </span>
        </label>`).join('')}
    </div>
    <div class="skills-subhead">固定 plugins</div>
    <div class="skills-list plugins">
      ${PLUGINS.map((plugin) => `
        <label class="skill-row">
          <span class="check-wrap">
            <input type="checkbox" data-plugin="${plugin.id}" ${state.terminal.plugins.has(plugin.id) ? 'checked' : ''}>
            <span class="check-box">${icon('check')}</span>
          </span>
          <span class="skill-text">
            <span class="skill-name">${esc(plugin.name)}</span>
            <span class="skill-desc">${esc(plugin.desc)}</span>
          </span>
        </label>`).join('')}
    </div>
    <div class="pop-foot">${icon('info')} 按模式注入 pi / Codex / Claude 会话</div>`;
}

function toggleSkillsPopover(anchor) {
  showPopover(anchor, 'skills', buildSkillsPopover(), 320);
}

/* ============================================================== toasts */
function toast(text, options = {}) {
  const root = $('#toastRoot');
  if (!root) return;
  const tone = options.tone || 'success';
  const node = document.createElement('div');
  node.className = `toast ${tone}`;
  const glyph = tone === 'error' ? 'x' : (tone === 'info' ? 'sparkles' : 'check');
  node.innerHTML = `
    <span class="toast-icon">${icon(glyph)}</span>
    <span class="toast-text">${esc(text)}</span>
    ${options.actionLabel ? `<button class="toast-action" type="button">${esc(options.actionLabel)}</button>` : ''}`;
  root.appendChild(node);
  requestAnimationFrame(() => node.classList.add('in'));

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    node.classList.remove('in');
    setTimeout(() => node.remove(), 180);
  };
  const timer = setTimeout(remove, options.duration || 2800);
  const action = $('.toast-action', node);
  if (action) {
    action.addEventListener('click', () => {
      clearTimeout(timer);
      if (typeof options.onAction === 'function') options.onAction();
      remove();
    });
  }
}

async function copyText(text, label = '已复制') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, { tone: 'success', duration: 1800 });
  } catch (err) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast(label, { tone: 'success', duration: 1800 });
    } catch (fallbackError) {
      toast('复制失败', { tone: 'error' });
    }
  }
}

/* ============================================================== modal */
function openDiscardModal() {
  const repo = currentRepo();
  if (!repo) return;
  const files = checkedFiles(repo);
  if (!files.length) {
    toast('先勾选要放弃的文件', { tone: 'info', duration: 1600 });
    return;
  }
  const root = $('#modalRoot');
  if (!root) return;
  const untrackedCount = files.filter((file) => file.untracked).length;
  const shown = files.slice(0, 8);
  const more = files.length - shown.length;
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop="1">
      <div class="modal discard-modal" role="dialog" aria-modal="true" aria-labelledby="discardTitle">
        <div class="modal-head">
          <span class="modal-head-icon danger">${icon('undo')}</span>
          <div class="modal-head-text">
            <div class="modal-title" id="discardTitle">放弃 ${files.length} 个文件的更改</div>
            <div class="modal-sub">这会执行类似 git restore / discard 的操作。</div>
          </div>
          <button class="modal-close" type="button" data-modal-close="1" title="关闭">${icon('x')}</button>
        </div>
        <div class="modal-body">
          <div class="discard-list">
            ${shown.map((file) => `<div class="${file.untracked ? 'untracked' : ''}">${file.status}  ${esc(file.path)}${file.untracked ? '  (未跟踪)' : ''}</div>`).join('')}
            ${more > 0 ? `<div class="more">… 以及其他 ${more} 个文件</div>` : ''}
          </div>
          <div class="discard-warn">
            ${icon('info')} 已跟踪文件会恢复到 HEAD 版本；未跟踪文件会从工作区移除${untrackedCount ? `（本次包含 ${untrackedCount} 个未跟踪文件）` : ''}。此操作无法撤销。
          </div>
        </div>
        <div class="modal-foot">
          <span class="modal-tip">只影响当前仓库的工作区</span>
          <button class="btn" type="button" data-modal-close="1">取消</button>
          <button class="btn danger" type="button" data-modal-action="discard-confirm">放弃更改</button>
        </div>
      </div>
    </div>`;
  requestAnimationFrame(() => $('.modal .btn:not(.danger)')?.focus());
}

function applyDiscardChanges() {
  const repo = currentRepo();
  if (!repo) return;
  const files = checkedFiles(repo);
  if (!files.length) {
    closeModal();
    return;
  }
  const paths = new Set(files.map((file) => file.path));
  const count = files.length;
  repo.workingChanges = repo.workingChanges.filter((file) => !paths.has(file.path));
  paths.forEach((path) => repo.checked.delete(path));
  if (state.worktreeFile && paths.has(state.worktreeFile)) {
    state.worktreeFile = repo.workingChanges[0]?.path || null;
  }
  closeModal();
  renderAll();
  toast(`已放弃 ${count} 个文件的更改`, { tone: 'info', duration: 2600 });
}

function openRootModal() {
  const root = $('#modalRoot');
  if (!root) return;
  const recent = ['/Users/zhimoe/code', '/Users/zhimoe/work', '/Users/zhimoe/oss'];
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop="1">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="rootModalTitle">
        <div class="modal-head">
          <span class="modal-head-icon">${icon('folder')}</span>
          <div class="modal-head-text">
            <div class="modal-title" id="rootModalTitle">选择根目录</div>
            <div class="modal-sub">Knit 会递归扫描该目录下的 Git 仓库，并把最近活跃的放在最前面。</div>
          </div>
          <button class="modal-close" type="button" data-modal-close="1" title="关闭">${icon('x')}</button>
        </div>
        <div class="modal-body">
          <label class="field-label" for="scanPathInput">根目录</label>
          <div class="path-field">
            ${icon('folder')}
            <input id="scanPathInput" type="text" value="${esc(state.root)}" spellcheck="false" autocomplete="off" aria-label="根目录路径">
            <button class="browse-btn" type="button" data-root="${esc(state.root)}">当前</button>
          </div>
          <div class="recent-roots">
            <span class="recent-label">最近</span>
            ${recent.map((path) => `<button class="root-chip" type="button" data-root="${esc(path)}">${esc(shortPath(path))}</button>`).join('')}
          </div>
          <div class="scan-note">
            ${icon('info')}
            <span>会跳过 <code>node_modules</code>、<code>.git</code> 内部目录和已排除仓库；搜索索引在扫描后常驻内存。</span>
          </div>
          <div class="scan-progress" id="scanProgress">
            <div class="progress-track"><div class="progress-fill" id="scanFill"></div></div>
            <div class="scan-log" id="scanLog">准备扫描…</div>
          </div>
        </div>
        <div class="modal-foot">
          <span class="modal-tip">原型演示：目录会更新，仓库列表使用内置数据。</span>
          <button class="btn" type="button" data-modal-close="1">取消</button>
          <button class="btn primary" type="button" id="scanBtn" data-modal-action="scan">开始扫描</button>
        </div>
      </div>
    </div>`;
  const input = $('#scanPathInput');
  if (input) {
    input.focus();
    input.select();
  }
}

function closeModal() {
  state.modalToken += 1;
  const root = $('#modalRoot');
  if (root) root.innerHTML = '';
}

function startScan() {
  const input = $('#scanPathInput');
  if (!input) return;
  const path = input.value.trim();
  if (!path) {
    toast('请输入一个根目录', { tone: 'error' });
    input.focus();
    return;
  }
  const token = state.modalToken + 1;
  state.modalToken = token;
  const button = $('#scanBtn');
  if (button) {
    button.disabled = true;
    button.textContent = '正在扫描…';
  }
  const progress = $('#scanProgress');
  const fill = $('#scanFill');
  const log = $('#scanLog');
  if (progress) progress.classList.add('on');
  if (fill) fill.style.width = '8%';
  if (log) log.textContent = '读取根目录…';

  const steps = [
    [220, '跳过 node_modules / dist / .git 内部目录', 22],
    [560, '发现 22 个 Git 仓库，建立仓库索引', 54],
    [900, '读取分支、最近提交与工作区状态', 82],
    [1150, `应用排除列表（${state.excluded.size} 个仓库）`, 94],
  ];
  steps.forEach(([delay, text, width]) => {
    setTimeout(() => {
      if (token !== state.modalToken) return;
      if (log) log.textContent = text;
      if (fill) fill.style.width = `${width}%`;
    }, delay);
  });
  setTimeout(() => {
    if (token !== state.modalToken) return;
    state.root = path.replace(/\/+$/, '') || '/';
    state.scannedAt = new Date();
    closeModal();
    renderSidebar();
    renderLogHeader();
    toast(`扫描完成 · ${REPOS.length} 个仓库 · ${state.excluded.size} 个已排除`, { tone: 'success' });
  }, 1380);
}

/* ============================================================== actions */
function selectRepo(id) {
  const repo = repoById(id);
  if (!repo || state.excluded.has(id) || id === state.selectedRepoId) return;
  captureTerminalInput();
  closePopover();
  state.genToken += 1;
  state.aiBusy = false;
  state.selectedRepoId = id;
  state.selectedHash = repo.commits[0]?.hash || null;
  state.selectedFile = 0;
  state.followFile = null;
  state.commitQuery = '';
  state.onlyMine = false;
  state.branchFilter = 'current';
  state.authorFilter = 'all';
  state.dateFilter = 'all';
  state.worktreeFile = repo.workingChanges[0]?.path || null;
  state.terminal.worktree = false;
  state.terminal.contextHash = state.selectedHash;
  const commitSearch = $('#commitSearch');
  if (commitSearch) commitSearch.value = '';
  renderAll();
  const list = $('#commitList');
  if (list) list.scrollTop = 0;
  scrollActiveRepoIntoView();
}

function selectCommit(hash, options = {}) {
  const repo = currentRepo();
  if (!repo) return;
  const commit = repo.commits.find((item) => item.hash === hash);
  if (!commit) return;
  state.selectedHash = hash;
  state.selectedFile = 0;
  state.terminal.worktree = false;
  state.terminal.contextHash = hash;
  renderCommitList();
  renderDetails();
  renderTerminal();
  if (options.focusList) {
    const list = $('#commitList');
    if (list) list.focus({ preventScroll: true });
  }
  if (options.scroll) {
    requestAnimationFrame(() => {
      const row = $(`.commit-row[data-hash="${hash}"]`);
      if (row) row.scrollIntoView({ block: 'nearest' });
    });
  }
}

function refreshLog(reconcile = true, options = {}) {
  const repo = currentRepo();
  if (!repo) return;
  let selectionChanged = false;
  if (reconcile) {
    const list = visibleCommits(repo);
    if (!state.selectedHash || !list.some((commit) => commit.hash === state.selectedHash)) {
      const nextHash = list[0]?.hash || null;
      if (nextHash !== state.selectedHash) {
        state.selectedHash = nextHash;
        state.selectedFile = 0;
        selectionChanged = true;
      }
      state.terminal.worktree = false;
      state.terminal.contextHash = state.selectedHash;
    }
  }
  renderLogHeader();
  renderCommitList();
  renderLogFooter();
  renderViewBar();
  if (selectionChanged || options.details) {
    renderDetails();
    renderTerminal();
  }
}

function clearLogFilters() {
  state.commitQuery = '';
  state.onlyMine = false;
  state.branchFilter = 'current';
  state.authorFilter = 'all';
  state.dateFilter = 'all';
  state.followFile = null;
  const input = $('#commitSearch');
  if (input) input.value = '';
  refreshLog(true, { details: true });
  const list = $('#commitList');
  if (list) list.scrollTop = 0;
}

function toggleFollowCurrent() {
  const repo = currentRepo();
  if (!repo) return;
  if (state.followFile) {
    state.followFile = null;
    refreshLog(true);
    toast('已取消文件历史筛选', { tone: 'info', duration: 1600 });
  } else {
    state.followFile = repo.currentFile;
    refreshLog(true);
    const list = $('#commitList');
    if (list) list.scrollTop = 0;
    toast(`已从编辑器定位 ${basename(repo.currentFile)} 的历史`, { tone: 'info', duration: 2000 });
  }
  renderViewBar();
}

function locateFileHistory(path) {
  const repo = currentRepo();
  if (!repo) return;
  state.followFile = path;
  const list = visibleCommits(repo);
  if (!list.some((commit) => commit.hash === state.selectedHash)) {
    state.selectedHash = list[0]?.hash || null;
    state.selectedFile = 0;
  }
  const commit = selectedCommit(repo);
  if (commit) {
    const nextIndex = commit.files.findIndex((file) => file.path === path);
    if (nextIndex >= 0) state.selectedFile = nextIndex;
  }
  state.terminal.worktree = false;
  state.terminal.contextHash = state.selectedHash;
  renderLogHeader();
  renderCommitList();
  renderLogFooter();
  renderDetails();
  renderTerminal();
  renderViewBar();
  const listEl = $('#commitList');
  if (listEl) listEl.scrollTop = 0;
  toast(`已定位 ${basename(path)} 的提交历史`, { tone: 'info', duration: 1900 });
}

function loadMoreCommits() {
  const repo = currentRepo();
  if (!repo) return;
  const rng = repo._rng;
  let ts = repo.commits[repo.commits.length - 1]?.date || Date.now();
  for (let i = 0; i < 10; i += 1) {
    ts -= (4 + Math.floor(rng() * 20)) * 3600e3;
    repo.commits.push({
      hash: makeHash(rng),
      subject: genSubject(rng, repo.commits[repo.commits.length - 1]?.subject),
      body: genBody(rng),
      author: rng() < 0.22 ? PEOPLE.z : AUTHOR_POOL[Math.floor(rng() * AUTHOR_POOL.length)],
      date: ts,
      lane: 0,
      isMerge: false,
      files: genFiles(repo, rng, repo.commits.length + i, false),
      refs: [],
      parents: [],
    });
  }
  assignParents(repo);
  refreshLog(true);
  toast('已加载更早的 10 个提交', { tone: 'info', duration: 1800 });
}

function toggleExclusion(id) {
  const repo = repoById(id);
  if (!repo) return;
  const wasExcluded = state.excluded.has(id);
  if (wasExcluded) state.excluded.delete(id);
  else state.excluded.add(id);
  storeSet('knit:excluded', [...state.excluded]);

  if (!wasExcluded && state.selectedRepoId === id) {
    state.genToken += 1;
    state.aiBusy = false;
    const remaining = activeRepos();
    if (remaining.length) {
      state.selectedRepoId = remaining[0].id;
      state.selectedHash = remaining[0].commits[0]?.hash || null;
      state.selectedFile = 0;
      state.followFile = null;
      state.commitQuery = '';
      state.onlyMine = false;
      state.branchFilter = 'current';
      state.authorFilter = 'all';
      state.dateFilter = 'all';
      state.worktreeFile = remaining[0].workingChanges[0]?.path || null;
      state.terminal.worktree = false;
      state.terminal.contextHash = state.selectedHash;
      const input = $('#commitSearch');
      if (input) input.value = '';
      renderAll();
      scrollActiveRepoIntoView();
    } else {
      state.selectedHash = null;
      state.selectedFile = 0;
      renderAll();
    }
  } else {
    renderSidebar();
  }

  toast(
    wasExcluded ? `已恢复 ${repo.name}` : `已排除 ${repo.name}`,
    {
      tone: wasExcluded ? 'success' : 'info',
      actionLabel: wasExcluded ? null : '撤销',
      onAction: wasExcluded ? null : () => {
        state.excluded.delete(id);
        storeSet('knit:excluded', [...state.excluded]);
        renderSidebar();
      },
    },
  );
}

function commitChanges() {
  const repo = currentRepo();
  if (!repo) return;
  if (state.aiBusy) {
    toast('agent 正在生成提交信息，请稍候', { tone: 'info' });
    return;
  }
  const input = $('#commitMessage');
  const message = input ? input.value.trim() : '';
  const files = checkedFiles(repo);
  if (!message) {
    toast('请先填写提交信息', { tone: 'error' });
    if (input) input.focus();
    return;
  }
  if (!files.length) {
    toast('请先勾选要提交的文件', { tone: 'error' });
    return;
  }

  const lines = message.split('\n');
  const subject = lines[0].trim();
  const body = lines.slice(1).join('\n').replace(/^\s*\n/, '').trim();
  const newHash = randomHash();
  const parents = repo.commits[0] ? [repo.commits[0].hash] : [];
  const commit = {
    hash: newHash,
    subject,
    body,
    author: PEOPLE.z,
    date: new Date(),
    lane: 0,
    isMerge: false,
    files: files.map((file) => ({ path: file.path, status: file.status === 'U' ? 'A' : file.status })),
    refs: [{ name: repo.branch, type: 'branch' }],
    parents,
  };
  repo.commits.unshift(commit);
  repo.commits.forEach((item, idx) => {
    if (idx === 0) return;
    item.refs = item.refs.filter((ref) => !(ref.type === 'branch' && ref.name === repo.branch));
  });
  const committed = new Set(files.map((file) => file.path));
  repo.workingChanges = repo.workingChanges.filter((file) => !committed.has(file.path));
  repo.checked = new Set(repo.workingChanges.filter((file) => repo.checked.has(file.path)).map((file) => file.path));
  repo.updatedAt = Date.now();
  repo.updatedMin = 0;
  repo.ahead += 1;
  assignParents(repo);

  delete state.drafts[repo.id];
  clearTimeout(state.draftTimer);
  storeSet('knit:drafts', state.drafts);
  addHistory(repo.id, message);

  state.selectedHash = newHash;
  state.selectedFile = 0;
  state.followFile = null;
  state.commitQuery = '';
  state.onlyMine = false;
  state.branchFilter = 'current';
  state.authorFilter = 'all';
  state.dateFilter = 'all';
  state.view = 'log';
  state.worktreeFile = repo.workingChanges[0]?.path || null;
  state.terminal.worktree = false;
  state.terminal.contextHash = newHash;
  const commitSearch = $('#commitSearch');
  if (commitSearch) commitSearch.value = '';
  const sessionKey = `${repo.id}:${state.terminal.tab}`;
  if (state.terminal.tab !== 'terminal' && state.terminal.sessions[sessionKey]) {
    state.terminal.sessions[sessionKey].push({
      role: 'system',
      text: `已创建提交 ${newHash.slice(0, 7)} · ${files.length} 个文件`,
    });
  }
  sortedRepos.sort((a, b) => a.updatedMin - b.updatedMin || a.name.localeCompare(b.name));
  renderAll();
  const list = $('#commitList');
  if (list) list.scrollTop = 0;
  toast(`已提交 ${files.length} 个文件到 ${repo.branch} · ${newHash.slice(0, 7)}`, { tone: 'success', duration: 3200 });
}

function moveFile(delta) {
  const commit = selectedCommit();
  if (!commit || !commit.files.length) return;
  const count = commit.files.length;
  state.selectedFile = (state.selectedFile + delta + count) % count;
  state.diffMode = state.diffMode || 'split';
  renderDetails();
  requestAnimationFrame(() => {
    const scroll = $('.diff-scroll');
    if (scroll) scroll.scrollTop = 0;
    const row = $(`.file-row[data-file-index="${state.selectedFile}"]`);
    if (row) row.focus({ preventScroll: true });
  });
}

function selectFile(index, options = {}) {
  const commit = selectedCommit();
  if (!commit || !commit.files.length) return;
  state.selectedFile = clamp(index, 0, commit.files.length - 1);
  renderDetails();
  requestAnimationFrame(() => {
    const scroll = $('.diff-scroll');
    if (scroll) scroll.scrollTop = 0;
    if (options.focus) {
      const row = $(`.file-row[data-file-index="${state.selectedFile}"]`);
      if (row) row.focus({ preventScroll: true });
    }
  });
}

function setDiffMode(mode) {
  if (!['split', 'unified'].includes(mode) || state.diffMode === mode) return;
  state.diffMode = mode;
  renderDetails();
  requestAnimationFrame(() => {
    const scroll = $('.diff-scroll');
    if (scroll) scroll.scrollTop = 0;
  });
}

function copySelectedHash() {
  const commit = selectedCommit();
  if (!commit) return;
  copyText(commit.hash, '已复制完整哈希');
}

function gotoParent(hash) {
  const repo = currentRepo();
  if (!repo || !hash) return;
  const commit = repo.commits.find((item) => item.hash === hash);
  if (!commit) {
    toast('父提交不在当前已加载的历史里', { tone: 'info' });
    return;
  }
  selectCommit(hash, { scroll: true, focusList: true });
}

function rescanRoot() {
  state.scannedAt = new Date();
  renderSidebar();
  toast(`已重新扫描根目录 · ${REPOS.length} 个仓库`, { tone: 'info', duration: 2000 });
}

/* ============================================================== events */
function scrollActiveRepoIntoView() {
  requestAnimationFrame(() => {
    const row = $('#repoList .repo-row.active');
    if (row) row.scrollIntoView({ block: 'nearest' });
  });
}

function focusRepoSearch() {
  if (state.fullDiff) closeFullDiff();
  if (state.sidebarCollapsed) {
    state.sidebarCollapsed = false;
    applySidebarState();
  }
  const input = $('#repoSearch');
  if (!input) return;
  input.focus();
  input.select();
}

function scrollCommitIntoView(hash) {
  requestAnimationFrame(() => {
    const row = $(`.commit-row[data-hash="${hash}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  });
}

function bindEvents() {
  const repoSearch = $('#repoSearch');
  repoSearch.addEventListener('input', (event) => {
    state.repoQuery = event.target.value;
    renderSidebar();
  });
  repoSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      state.repoQuery = '';
      event.target.value = '';
      renderSidebar();
      event.stopPropagation();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const first = activeRepos().filter((repo) => repoMatches(repo, state.repoQuery))[0];
      if (first) selectRepo(first.id);
    }
  });
  $('#repoSearchClear').addEventListener('click', () => {
    state.repoQuery = '';
    repoSearch.value = '';
    renderSidebar();
    repoSearch.focus();
  });
  $('#cmdSearch').addEventListener('click', focusRepoSearch);
  $('#rescanBtn').addEventListener('click', rescanRoot);

  $('#repoList').addEventListener('click', (event) => {
    const excludeButton = event.target.closest('[data-exclude]');
    if (excludeButton) {
      toggleExclusion(excludeButton.dataset.exclude);
      return;
    }
    const includeButton = event.target.closest('[data-include]');
    if (includeButton) {
      toggleExclusion(includeButton.dataset.include);
      return;
    }
    const toggle = event.target.closest('[data-toggle-excluded]');
    if (toggle) {
      state.excludedOpen = !state.excludedOpen;
      renderSidebar();
      return;
    }
    const row = event.target.closest('[data-repo]');
    if (row) selectRepo(row.dataset.repo);
  });
  $('#repoList').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('[data-repo]');
    if (!row) return;
    event.preventDefault();
    selectRepo(row.dataset.repo);
  });

  const commitSearch = $('#commitSearch');
  commitSearch.addEventListener('input', (event) => {
    state.commitQuery = event.target.value;
    refreshLog(true);
    const list = $('#commitList');
    if (list) list.scrollTop = 0;
  });
  commitSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      state.commitQuery = '';
      event.target.value = '';
      refreshLog(true);
      event.stopPropagation();
    }
  });
  $('#commitSearchClear').addEventListener('click', () => {
    state.commitQuery = '';
    commitSearch.value = '';
    refreshLog(true);
    commitSearch.focus();
  });
  $('#viewTabLog').addEventListener('click', () => setView('log'));
  $('#viewTabChanges').addEventListener('click', () => setView('changes'));
  $('#logFilters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    openLogFilterPopover(chip.dataset.filter, chip);
  });
  $('#quickChanges').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setView('changes');
  });

  const commitList = $('#commitList');
  commitList.addEventListener('click', (event) => {
    const row = event.target.closest('.commit-row');
    if (!row) return;
    selectCommit(row.dataset.hash, { focusList: true });
  });
  commitList.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const list = visibleCommits();
    if (!list.length) return;
    event.preventDefault();
    let index = list.findIndex((commit) => commit.hash === state.selectedHash);
    if (index < 0) index = 0;
    if (event.key === 'ArrowDown') index = Math.min(list.length - 1, index + 1);
    else if (event.key === 'ArrowUp') index = Math.max(0, index - 1);
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = list.length - 1;
    selectCommit(list[index].hash, { focusList: true, scroll: true });
  });

  const details = $('#details');
  const detailsMaxChanges = () => {
    const metaH = $('.commit-meta')?.getBoundingClientRect().height || 0;
    return Math.max(90, details.getBoundingClientRect().height - metaH - 5 - 90);
  };
  details.addEventListener('click', (event) => {
    if (event.target.closest('[data-action]')) return;
    const folder = event.target.closest('[data-detail-folder]');
    if (folder) {
      const path = folder.dataset.detailFolder;
      if (state.detailTreeCollapsed.has(path)) state.detailTreeCollapsed.delete(path);
      else state.detailTreeCollapsed.add(path);
      renderDetails();
      return;
    }
    const row = event.target.closest('[data-file-index]');
    if (row) selectFile(Number(row.dataset.fileIndex));
  });
  details.addEventListener('pointerdown', (event) => {
    const splitter = event.target.closest('#detailsSplitter');
    if (!splitter) return;
    event.preventDefault();
    const startY = event.clientY;
    const startH = $('.changes-block')?.getBoundingClientRect().height || 180;
    const maxH = detailsMaxChanges();
    document.body.classList.add('resizing-v');
    const move = (moveEvent) => {
      const next = clamp(startH + (moveEvent.clientY - startY), 80, maxH);
      details.style.setProperty('--changes-h', `${next}px`);
    };
    const up = () => {
      document.body.classList.remove('resizing-v');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  });
  details.addEventListener('dblclick', (event) => {
    if (event.target.closest('#detailsSplitter')) {
      details.style.removeProperty('--changes-h');
      return;
    }
    const row = event.target.closest('[data-file-index]');
    if (row && !event.target.closest('[data-action]')) {
      event.preventDefault();
      selectFile(Number(row.dataset.fileIndex));
      openFullDiff('commit');
    }
  });
  details.addEventListener('keydown', (event) => {
    if (event.target.id === 'detailsSplitter') {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const current = $('.changes-block')?.getBoundingClientRect().height || 180;
      const next = clamp(current + (event.key === 'ArrowDown' ? 16 : -16), 80, detailsMaxChanges());
      details.style.setProperty('--changes-h', `${next}px`);
      return;
    }
    const row = event.target.closest('[data-file-index]');
    if (!row) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectFile(Number(row.dataset.fileIndex), { focus: true });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const files = selectedCommit()?.files || [];
      if (!files.length) return;
      const next = clamp(Number(row.dataset.fileIndex) + (event.key === 'ArrowDown' ? 1 : -1), 0, files.length - 1);
      selectFile(next, { focus: true });
    }
  });

  const composer = $('#composer');
  const changesViewEl = $('#changesView');
  changesViewEl.addEventListener('change', (event) => {
    const repo = currentRepo();
    if (!repo) return;
    const target = event.target;
    if (target.matches('[data-select-all]')) {
      if (target.checked) repo.workingChanges.forEach((file) => repo.checked.add(file.path));
      else repo.workingChanges.forEach((file) => repo.checked.delete(file.path));
      syncComposerSelection();
    } else if (target.matches('[data-file-check]')) {
      if (target.checked) repo.checked.add(target.dataset.fileCheck);
      else repo.checked.delete(target.dataset.fileCheck);
      const row = target.closest('.change-row, .tree-file');
      if (row) row.classList.toggle('off', !target.checked);
      updateCommitUI();
    }
  });
  composer.addEventListener('input', (event) => {
    if (event.target.id === 'commitMessage') handleMessageInput(event);
  });
  composer.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      const button = $('#commitBtn');
      if (button && !button.disabled) commitChanges();
    }
  });

  const changesTree = $('#changesTreePanel');
  changesTree.addEventListener('click', (event) => {
    if (event.target.closest('[data-action]')) return;
    const folder = event.target.closest('[data-tree-folder]');
    if (folder) {
      const path = folder.dataset.treeFolder;
      if (state.worktreeCollapsed.has(path)) state.worktreeCollapsed.delete(path);
      else state.worktreeCollapsed.add(path);
      renderChangesView();
      return;
    }
    const fileRow = event.target.closest('[data-worktree-file]');
    if (!fileRow) return;
    if (event.target.closest('.check-wrap')) return;
    state.worktreeFile = fileRow.dataset.worktreeFile;
    renderChangesView();
  });
  changesTree.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const fileRow = event.target.closest('[data-worktree-file]');
    if (!fileRow || event.target.closest('.check-wrap')) return;
    event.preventDefault();
    state.worktreeFile = fileRow.dataset.worktreeFile;
    renderChangesView();
    requestAnimationFrame(() => {
      const row = $('.tree-file.active');
      if (row) row.focus({ preventScroll: true });
    });
  });
  changesTree.addEventListener('dblclick', (event) => {
    if (event.target.closest('[data-action]')) return;
    const fileRow = event.target.closest('[data-worktree-file]');
    if (!fileRow || event.target.closest('.check-wrap')) return;
    event.preventDefault();
    state.worktreeFile = fileRow.dataset.worktreeFile;
    openFullDiff('worktree');
  });

  const terminal = $('#terminal');
  terminal.addEventListener('click', (event) => {
    const tabButton = event.target.closest('[data-term-tab]');
    if (tabButton) {
      switchTerminalTab(tabButton.dataset.termTab);
      return;
    }
    const modeButton = event.target.closest('[data-term-mode]');
    if (modeButton) {
      setTerminalMode(modeButton.dataset.termMode);
      return;
    }
    const termAction = event.target.closest('[data-term-action]');
    if (termAction) {
      if (termAction.dataset.termAction === 'apply-message') {
        const payload = decodeURIComponent(termAction.dataset.payload || '');
        if (payload) setComposerText(payload, { toast: '已填入提交框' });
      }
    }
  });
  terminal.addEventListener('keydown', (event) => {
    if (event.target.id === 'termInput' && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      sendTerminalInput();
    }
  });

  $('#popoverRoot').addEventListener('click', (event) => {
    const filterOption = event.target.closest('[data-filter-kind]');
    if (filterOption) {
      applyLogFilter(filterOption.dataset.filterKind, filterOption.dataset.filterValue);
      return;
    }
    const item = event.target.closest('[data-hist-kind]');
    if (!item) return;
    const repo = currentRepo();
    if (!repo) return;
    const kind = item.dataset.histKind;
    const index = Number(item.dataset.histIndex);
    closePopover();
    if (kind === 'stored') {
      const stored = state.history[repo.id] || [];
      if (stored[index]) setComposerText(stored[index].text);
    } else if (kind === 'commit') {
      const commit = repo.commits[index];
      if (commit) setComposerText(commit.subject);
    }
  });
  $('#popoverRoot').addEventListener('change', (event) => {
    const skillInput = event.target.closest('[data-skill]');
    const pluginInput = event.target.closest('[data-plugin]');
    if (skillInput) {
      if (skillInput.checked) state.terminal.skills.add(skillInput.dataset.skill);
      else state.terminal.skills.delete(skillInput.dataset.skill);
      storeSet('knit:skills', [...state.terminal.skills]);
    } else if (pluginInput) {
      if (pluginInput.checked) state.terminal.plugins.add(pluginInput.dataset.plugin);
      else state.terminal.plugins.delete(pluginInput.dataset.plugin);
      storeSet('knit:plugins', [...state.terminal.plugins]);
    } else {
      return;
    }
    renderTerminal();
    const count = $('.skills-count', $('#popoverRoot'));
    if (count) count.textContent = `${state.terminal.skills.size} skills · ${state.terminal.plugins.size} plugins`;
  });

  $('#modalRoot').addEventListener('click', (event) => {
    if (event.target.closest('[data-modal-close]')) {
      closeModal();
      return;
    }
    if (event.target.classList.contains('modal-backdrop')) {
      closeModal();
      return;
    }
    const rootButton = event.target.closest('[data-root]');
    if (rootButton) {
      const input = $('#scanPathInput');
      if (input) {
        input.value = rootButton.dataset.root;
        input.focus();
      }
      return;
    }
    const discardButton = event.target.closest('[data-modal-action="discard-confirm"]');
    if (discardButton) {
      applyDiscardChanges();
      return;
    }
    const scanButton = event.target.closest('[data-modal-action="scan"]');
    if (scanButton) startScan();
  });
  $('#modalRoot').addEventListener('keydown', (event) => {
    if (event.target.id === 'scanPathInput' && event.key === 'Enter') {
      event.preventDefault();
      startScan();
    }
  });

  document.addEventListener('click', handleGlobalAction);
  document.addEventListener('click', (event) => {
    const root = $('#popoverRoot');
    if (!root || !root.firstElementChild) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('#popoverRoot') || event.target.closest('[data-popover-trigger]')) return;
    closePopover();
  });
  document.addEventListener('keydown', (event) => {
    if (state.fullDiff) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFullDiff();
        return;
      }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        moveFullDiffFile(event.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      focusRepoSearch();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && (event.key === '1' || event.key === '2')) {
      event.preventDefault();
      setView(event.key === '1' ? 'log' : 'changes');
      return;
    }
    if (event.key !== 'Escape') return;
    if ($('#modalRoot')?.firstElementChild) {
      closeModal();
      return;
    }
    if ($('#popoverRoot')?.firstElementChild) {
      closePopover();
      return;
    }
    const active = document.activeElement;
    if (active && active.id === 'repoSearch' && state.repoQuery) {
      state.repoQuery = '';
      active.value = '';
      renderSidebar();
    }
  });
  bindSplitter();
  window.addEventListener('resize', closePopover);
  window.addEventListener('beforeunload', () => {
    storeSet('knit:drafts', state.drafts);
    storeSet('knit:history', state.history);
    storeSet('knit:excluded', [...state.excluded]);
    storeSet('knit:skills', [...state.terminal.skills]);
    storeSet('knit:plugins', [...state.terminal.plugins]);
  });
}

function bindSplitter() {
  const splitter = $('#paneSplitter');
  const workspace = $('.workspace');
  const details = $('#details');
  if (!splitter || !workspace || !details) return;

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = details.getBoundingClientRect().width;
    document.body.classList.add('resizing-h');
    try { splitter.setPointerCapture(event.pointerId); } catch (err) { /* noop */ }

    const move = (moveEvent) => {
      const area = $('.content-area')?.getBoundingClientRect().width || window.innerWidth;
      const max = Math.max(420, area - 5 - 400);
      const next = clamp(startWidth - (moveEvent.clientX - startX), 420, max);
      workspace.style.setProperty('--details-w', `${next}px`);
    };
    const up = () => {
      document.body.classList.remove('resizing-h');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  });

  splitter.addEventListener('dblclick', () => {
    workspace.style.removeProperty('--details-w');
  });

  splitter.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = details.getBoundingClientRect().width;
    const area = $('.content-area')?.getBoundingClientRect().width || window.innerWidth;
    const max = Math.max(420, area - 5 - 400);
    const next = clamp(current + (event.key === 'ArrowLeft' ? 24 : -24), 420, max);
    workspace.style.setProperty('--details-w', `${next}px`);
  });
}

function handleGlobalAction(event) {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  switch (target.dataset.action) {
    case 'change-root':
      openRootModal();
      break;
    case 'rescan':
      rescanRoot();
      break;
    case 'clear-repo-search':
      state.repoQuery = '';
      renderSidebar();
      focusRepoSearch();
      break;
    case 'clear-follow':
      state.followFile = null;
      refreshLog(true);
      break;
    case 'locate-current-file':
      toggleFollowCurrent();
      break;
    case 'clear-log-filters':
      clearLogFilters();
      break;
    case 'load-more':
      loadMoreCommits();
      break;
    case 'copy-hash':
      copySelectedHash();
      break;
    case 'goto-parent':
      gotoParent(target.dataset.hash);
      break;
    case 'open-terminal-at-commit':
      openTerminalAtCommit();
      break;
    case 'analyze-commit':
      analyzeCommit();
      break;
    case 'file-history':
      locateFileHistory(target.dataset.path);
      break;
    case 'prev-file':
      moveFile(-1);
      break;
    case 'next-file':
      moveFile(1);
      break;
    case 'set-diff-mode':
      setDiffMode(target.dataset.mode);
      break;
    case 'message-history':
      toggleHistoryPopover(target);
      break;
    case 'generate-message':
      generateCommitMessage();
      break;
    case 'commit':
      commitChanges();
      break;
    case 'toggle-terminal':
      captureTerminalInput();
      state.terminal.open = !state.terminal.open;
      renderTerminal();
      break;
    case 'reset-session':
      resetSession();
      break;
    case 'open-skills':
      toggleSkillsPopover(target);
      break;
    case 'term-send':
      sendTerminalInput();
      break;
    case 'open-changes':
      setView('changes');
      break;
    case 'worktree-prev-file':
      moveWorktreeFile(-1);
      break;
    case 'worktree-next-file':
      moveWorktreeFile(1);
      break;
    case 'worktree-diff-mode':
      setWorktreeDiffMode(target.dataset.mode);
      break;
    case 'worktree-history': {
      const path = target.dataset.path;
      if (path) {
        state.view = 'log';
        applyViewMode();
        locateFileHistory(path);
        renderViewBar();
        renderQuickChanges();
      }
      break;
    }
    case 'toggle-workspace':
      toggleWorkspace();
      break;
    case 'show-workspace':
      showWorkspace();
      break;
    case 'discard-changes':
      openDiscardModal();
      break;
    case 'expand-diff':
      openFullDiff();
      break;
    case 'exit-full-diff':
      closeFullDiff();
      break;
    case 'full-diff-prev-file':
      moveFullDiffFile(-1);
      break;
    case 'full-diff-next-file':
      moveFullDiffFile(1);
      break;
    case 'full-diff-mode':
      setFullDiffMode(target.dataset.mode);
      break;
    default:
      break;
  }
}

function renderAll() {
  applyViewMode();
  applySidebarState();
  renderViewBar();
  renderSidebar();
  renderLogHeader();
  renderCommitList();
  renderLogFooter();
  renderQuickChanges();
  renderDetails();
  renderChangesView();
  renderComposer();
  renderTerminal();
}

function init() {
  state.terminal.domKey = '';
  bindEvents();
  renderAll();
}

init();

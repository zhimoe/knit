// Shared visual utilities, icon sprite references, language styling, and syntax
// highlighting (aligned with knit-prototype/app.js + host word-level hl spans).

import { esc } from './util';

export const icon = (name: string, cls = 'ic'): string =>
  `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

export const LANG_META: Record<string, { short: string; color: string }> = {
  TS: { short: 'TS', color: '#2563eb' },
  TypeScript: { short: 'TS', color: '#2563eb' },
  Nim: { short: 'NIM', color: '#c26d10' },
  Go: { short: 'GO', color: '#0891b2' },
  Rust: { short: 'RS', color: '#c2410c' },
  Py: { short: 'PY', color: '#b45309' },
  Python: { short: 'PY', color: '#b45309' },
  Kotlin: { short: 'KT', color: '#7c3aed' },
  MDX: { short: 'MDX', color: '#b45309' },
  md: { short: 'MD', color: '#64748b' },
  CSS: { short: 'CSS', color: '#0284c7' },
  Shell: { short: 'SH', color: '#15803d' },
  Astro: { short: 'AS', color: '#7c3aed' },
  '—': { short: 'GIT', color: '#2563eb' },
};

export function langMeta(lang: string): { short: string; color: string } {
  return LANG_META[lang] ?? { short: lang.slice(0, 3).toUpperCase() || 'GIT', color: '#2563eb' };
}

export function tint(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const num = Number.parseInt(clean, 16);
  if (!Number.isFinite(num)) return `rgba(37, 99, 235, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const AVATAR_PALETTE = ['#2563eb', '#0d9488', '#c26d10', '#7c3aed', '#e11d48', '#0284c7', '#15803d'];

export function authorColor(name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return AVATAR_PALETTE[(h >>> 0) % AVATAR_PALETTE.length] ?? '#6ea8ff';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

export function avatarChip(name: string, cls = 'mini-avatar'): string {
  const color = authorColor(name);
  return `<span class="${cls}" style="background:${tint(color, 0.16)};color:${color}">${esc(initials(name))}</span>`;
}

export function dirnameOf(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.length ? `${parts.join('/')}/` : '';
}

export function basenameOf(path: string): string {
  return path.split('/').pop() || path;
}

export function shortPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~').replace(/^[A-Za-z]:\/Users\/[^/]+/, '~');
}

export function timeCompact(epochMs: number): string {
  if (!epochMs) return '—';
  const mins = Math.max(0, Math.round((Date.now() - epochMs) / 60000));
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days}d`;
  const d = new Date(epochMs);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function absTime(epochMs: number): string {
  if (!epochMs) return '—';
  const d = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function clockTime(epochMs = Date.now()): string {
  const d = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightMatch(text: string, query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (!tokens.length) return esc(text);
  const re = new RegExp(`(${tokens.join('|')})`, 'ig');
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out += esc(text.slice(last, match.index));
    out += `<mark>${esc(match[0])}</mark>`;
    last = re.lastIndex;
    if (match[0] === '') re.lastIndex += 1;
  }
  out += esc(text.slice(last));
  return out;
}

const KW_RE =
  /\b(import|export|from|const|let|var|function|async|await|return|if|else|for|while|switch|case|break|continue|type|interface|class|extends|new|try|catch|finally|throw|true|false|null|undefined|proc|func|pub|fn|struct|enum|impl|defer|when|object|seq|string|int|bool|void|package|def|elif|in|not|and|or)\b/g;

function colorizeSegment(raw: string): string {
  if (!raw) return '';
  let out = '';
  let i = 0;
  while (i < raw.length) {
    // Line comment
    if ((raw[i] === '/' && raw[i + 1] === '/') || (raw[i] === '#' && (i === 0 || raw[i - 1] === ' '))) {
      out += `<span class="tok-com">${esc(raw.slice(i))}</span>`;
      break;
    }
    // String literal
    if (raw[i] === '"' || raw[i] === "'" || raw[i] === '`') {
      const q = raw[i];
      let j = i + 1;
      while (j < raw.length && raw[j] !== q) {
        if (raw[j] === '\\') j += 1;
        j += 1;
      }
      j = Math.min(raw.length, j + 1);
      out += `<span class="tok-str">${esc(raw.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < raw.length && raw[j] !== '"' && raw[j] !== "'" && raw[j] !== '`' && !(raw[j] === '/' && raw[j + 1] === '/')) {
      j += 1;
    }
    const chunk = esc(raw.slice(i, j))
      .replace(KW_RE, '<span class="tok-kw">$1</span>')
      .replace(/\b(\d+(?:_\d+)*(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
    out += chunk;
    i = j;
  }
  return out;
}

/** Render a diff line with syntax coloring AND host-computed word-level hl range. */
export function renderHighlightedLine(text: string, hl?: [number, number][]): string {
  if (!text.length) return ' ';
  if (!hl || !hl.length) return colorizeSegment(text);
  const [start, length] = hl[0];
  if (start < 0 || length <= 0 || start >= text.length) return colorizeSegment(text);
  const before = text.slice(0, start);
  const marked = text.slice(start, start + length);
  const after = text.slice(start + length);
  return `${colorizeSegment(before)}<span class="w">${esc(marked)}</span>${colorizeSegment(after)}`;
}

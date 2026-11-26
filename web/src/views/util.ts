import type { Commit, FileEntry, Repo } from '../types';

export const esc = (value: string): string =>
  String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

export const dirtyTotal = (repo: Repo): number =>
  repo.dirty.staged + repo.dirty.unstaged + repo.dirty.untracked + repo.dirty.conflicted;

/** docs/06 §8: <1min 刚刚, <1h N 分钟前, <24h N 小时前, <7d N 天前, 否则日期 */
export const relTime = (epochMs: number): string => {
  if (!epochMs) return '—';
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const date = new Date(epochMs);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

export const commitDate = (commit: Commit): string => relTime(commit.committedAt);

export const shortSha = (hash: string): string => hash.slice(0, 7);

export const baseName = (path: string): string => path.split('/').pop() ?? path;

export const dirName = (path: string): string => {
  const at = path.lastIndexOf('/');
  return at >= 0 ? path.slice(0, at) : '';
};

/** A stable key for a changes entry: the same file can be staged + unstaged. */
export const changeKey = (file: FileEntry): string => `${file.group}:${file.path}`;

export const statusLetter = (file: FileEntry): string => {
  if (file.conflict) return 'C';
  return file.status;
};

export const statusClass = (file: FileEntry): string => {
  if (file.conflict) return 'C';
  if (file.untracked) return 'A';
  return file.status;
};

export const stripAnsi = (text: string): string =>
  // eslint-disable-next-line no-control-regex
  text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');

export const relativeDraftTime = (ts: number): string => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const date = new Date(ts);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
};

/** Last path segments first, for rtl path ellipsis (docs/02 §3.4). */
export const rtlPath = (path: string): string => path;

export const addDel = (file: { additions: number; deletions: number }): string =>
  `<span class="sum"><i>+${file.additions >= 0 ? file.additions : 0}</i> <b>-${file.deletions >= 0 ? file.deletions : 0}</b></span>`;

export const hunkKey = (prefix: string, index: number): string => `${prefix}:hunk:${index}`;

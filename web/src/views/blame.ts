import type { BlameLine } from '../types';
import { basenameOf, dirnameOf, icon } from './icons';
import { esc, relTime } from './util';

const BLAME_TINTS = [
  'rgba(91,140,255,.16)',
  'rgba(193,141,242,.15)',
  'rgba(224,163,92,.15)',
  'rgba(92,195,143,.15)',
  'rgba(224,108,114,.15)',
  'rgba(95,168,201,.16)',
];

const BLAME_BORDERS = ['#5b8cff', '#c18df2', '#e0a35c', '#5cc38f', '#e06c72', '#5fa8c9'];

const colorIndex = (hash: string): number => {
  let acc = 0;
  for (let i = 0; i < Math.min(8, hash.length); i += 1) {
    acc = (acc * 31 + hash.charCodeAt(i)) >>> 0;
  }
  return acc % BLAME_TINTS.length;
};

export interface BlamePanelOptions {
  path: string;
  rev: string;
  lines: BlameLine[];
  loading: boolean;
  hasMore: boolean;
  ms: number;
}

export const renderBlamePanel = (opts: BlamePanelOptions): string => {
  const head = `
    <div class="diff-toolbar">
      <button class="diff-tool-btn active" type="button" data-act="blame-back">${icon('chevron-left')} 返回 Diff</button>
      <span class="diff-file" title="${esc(opts.path)}">
        ${icon('file')}
        <span class="dfdir">${esc(dirnameOf(opts.path))}</span>
        <span class="dfname">${esc(basenameOf(opts.path))}</span>
      </span>
      <span class="mbadge">blame@${esc(opts.rev || 'HEAD')}</span>
      <span style="font-size:9.5px;color:var(--muted-2);flex:none">${opts.lines.length} 行 · ${opts.ms} ms · -M -C</span>
    </div>`;

  if (opts.loading && !opts.lines.length) {
    return `${head}<div class="blamewrap"><div class="diff-empty"><span>正在计算 Blame…</span></div></div>`;
  }
  if (!opts.lines.length) {
    return `${head}<div class="blamewrap"><div class="diff-empty">${icon('file')}<span>没有可显示的 Blame 信息（文件可能是二进制或尚未提交）。</span></div></div>`;
  }

  let prevHash = '';
  const rows = opts.lines
    .map((row) => {
      const same = row.hash === prevHash;
      prevHash = row.hash;
      const ci = colorIndex(row.hash);
      const bg = BLAME_TINTS[ci];
      const border = BLAME_BORDERS[ci];
      const when = row.time ? relTime(row.time) : '';
      const tip = `${row.shortHash} · ${row.author} · ${when}\n${row.summary}`;
      return `
        <div class="bline">
          <div class="bgutter" data-blame-commit="${esc(row.hash)}" title="${esc(tip)}" style="background:${bg};border-left:2px solid ${border}">
            ${
              same
                ? '<span class="bcont"></span>'
                : `<span class="bhash">${esc(row.shortHash)}</span>
                   <span class="bau">${esc(row.author)}</span>
                   <span class="bdt">${esc(when)}</span>`
            }
          </div>
          <span class="bno">${row.line}</span>
          <span class="btx">${esc(row.text.length ? row.text : ' ')}</span>
        </div>`;
    })
    .join('');

  const more = opts.hasMore ? `<div class="logmore" data-act="blame-more">加载后续 2000 行…</div>` : '';

  return `${head}<div class="blamewrap">${rows}${more}</div>`;
};

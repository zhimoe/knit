import type { ConsoleEntry } from '../types';
import { icon } from './icons';
import { esc } from './util';

export const renderConsoleRows = (entries: ConsoleEntry[]): string =>
  entries.length
    ? entries
        .map((entry) => {
          const cls = entry.ok ? (entry.ms > 30 ? 'warn' : '') : 'bad';
          return `<div class="cmdrow"><span class="c">${esc(entry.cmd)}</span><span class="t ${cls}">${
            entry.ok ? '' : '✗ '
          }${Math.round(entry.ms)} ms</span></div>${
            !entry.ok && entry.detail ? `<div class="cmderr">↳ ${esc(entry.detail)}</div>` : ''
          }`;
        })
        .join('')
    : `<div class="cv-clean-state">${icon('terminal')}<strong>还没有 Git 命令记录</strong><span>执行提交、拉取、切换分支等操作后，所有命令和耗时都会出现在这里。</span></div>`;

export const renderConsole = (entries: ConsoleEntry[]): string => `
  <div class="aux-head">
    ${icon('terminal')}
    <span class="aux-title">Git Console</span>
    <span class="aux-sub">${entries.length} 条记录 · 读路径 in-process（libgit2），写路径走 git CLI</span>
    <span class="spacer"></span>
    <button class="btn" type="button" data-act="refresh-console">${icon('refresh')} 刷新</button>
  </div>
  <div class="aux-scroll" id="consoleList">${renderConsoleRows(entries)}</div>`;

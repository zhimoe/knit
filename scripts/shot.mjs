#!/usr/bin/env node
// UI 回归截图：用 headless Chrome 把页面渲染成 PNG，便于和原型并排比对。
//
//   node scripts/shot.mjs                       # 只截原型
//   node scripts/shot.mjs --target web/dist/index.html --out shots
//   node scripts/shot.mjs --hash changes --hash merge
//
// 依赖：本机安装了 Chrome / Edge（脚本自己找）。
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const argsAll = (name) => argv.reduce((acc, a, i) => (a === '--' + name ? [...acc, argv[i + 1]] : acc), []);

const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const chrome = candidates.find((p) => existsSync(p));
if (!chrome) {
  console.error('找不到 Chrome/Edge，请设置 CHROME_PATH');
  process.exit(1);
}

const target = resolve(repo, arg('target', 'knit-prototype/index.html'));
const outDir = resolve(repo, arg('out', 'shots'));
const size = arg('size', '1600,1000');
const hashes = argsAll('hash');
if (!hashes.length) hashes.push('', 'changes', 'merge');

mkdirSync(outDir, { recursive: true });

for (const h of hashes) {
  const name = h || 'log';
  const url = 'file://' + target + (h ? '#' + h : '');
  const out = resolve(outDir, `${name}.png`);
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--virtual-time-budget=2000',
    '--window-size=' + size,
    '--screenshot=' + out,
    url,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  console.log('✓', out);
}

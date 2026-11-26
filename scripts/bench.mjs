#!/usr/bin/env node
// 性能基线：对一棵目录下的所有 git 仓库量 status / log 的耗时，输出 p50/p95。
//
//   node scripts/bench.mjs                              # 默认根目录 ~/code
//   node scripts/bench.mjs --root C:/Users/zhimoe/code
//   node scripts/bench.mjs --root . --limit 30 --repeat 3
//
// 输出表用于 docs/01-product.md §4 的预算比对（目标值写在表右边的 budget 列）。

import { execFile } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};

const root = resolve(flag('root', join(homedir(), 'code')));
const limit = Number(flag('limit', '40'));
const repeat = Number(flag('repeat', '3'));
const globs = new Set(['node_modules', 'target', '.venv', 'vendor', 'dist', 'build', '.git']);

function discover(dir, depth = 4, out = []) {
  if (depth < 0 || out.length >= limit) return out;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= limit) break;
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || globs.has(entry.name)) continue;
    const child = join(dir, entry.name);
    if (existsSync(join(child, '.git'))) {
      out.push(child);
      continue;
    }
    discover(child, depth - 1, out);
  }
  return out;
}

const quantile = (values, q) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[index];
};

async function timeIt(args) {
  const started = process.hrtime.bigint();
  try {
    await exec('git', args, { maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  } catch {
    return null;
  }
  return Number(process.hrtime.bigint() - started) / 1e6;
}

const repos = discover(root);
if (!repos.length) {
  console.error(`在 ${root} 下没找到 git 仓库（--root 指定根目录）`);
  process.exit(1);
}

const rows = [];
const allStatus = [];
const allLog = [];

for (const repo of repos) {
  for (let i = 0; i < repeat; i += 1) {
    const statusMs = await timeIt(['-C', repo, 'status', '--porcelain=v2', '--branch', '-z']);
    const logMs = await timeIt(['-C', repo, 'log', '-n', '200', '-z',
      '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b']);
    if (statusMs !== null) allStatus.push(statusMs);
    if (logMs !== null) allLog.push(logMs);
  }
  rows.push({ repo: repo.slice(root.length + 1) || repo, status: allStatus.at(-1) ?? 0, log: allLog.at(-1) ?? 0 });
}

const pad = (value, width) => String(value).padEnd(width);
const num = (value) => value.toFixed(1).padStart(7);

console.log(`\nroot  : ${root}`);
console.log(`repos : ${repos.length}（每仓库重复 ${repeat} 次）\n`);
console.log(pad('仓库', 34) + pad('status ms', 11) + pad('log(200) ms', 12));
console.log('-'.repeat(57));
for (const row of rows) {
  console.log(pad(row.repo.slice(-33), 34) + pad(row.status.toFixed(1), 11) + pad(row.log.toFixed(1), 12));
}
console.log('-'.repeat(57));
console.log(`\n${pad('汇总', 34)}${pad('status', 11)}${pad('log', 12)}`);
console.log(`${pad('p50', 34)}${num(quantile(allStatus, 0.5))}${num(quantile(allLog, 0.5))}`);
console.log(`${pad('p95', 34)}${num(quantile(allStatus, 0.95))}${num(quantile(allLog, 0.95))}`);

// docs/01 §4 预算：30 仓库首轮全量 status ≤ 400 ms（in-process libgit2 目标）。
// 这里量的是 CLI 版本，作为 M0 基线；M1.1 换成 libgit2 后应显著下降。
const totalP50 = allStatus.reduce((a, b) => a + b, 0) / repeat;
console.log(`\nCLI 基线：${repos.length} 个仓库全量 status ≈ ${totalP50.toFixed(0)} ms（顺序执行）`);
console.log('M1.1 目标：in-process libgit2 + 8 路并发 ≤ 400 ms\n');

// Front-end build: bun bundles, then static files are copied next to the
// bundle so nimi's FileServer can serve `web/dist` as `nimi://app/`.
//
//   bun run build.mjs            # one-shot (minified)
//   bun run build.mjs --watch    # rebuild on change; pair with KNIT_DEV=1

import { watch } from 'node:fs';

const watching = process.argv.includes('--watch');

async function build() {
  const started = performance.now();
  const result = await Bun.build({
    entrypoints: ['src/main.ts'],
    outdir: 'dist',
    target: 'browser',
    format: 'iife',           // plain script: also works from file:// in the harness
    minify: !watching,
    sourcemap: watching ? 'inline' : 'none',
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exitCode = 1;
    return;
  }
  await Bun.write('dist/index.html', Bun.file('index.html'));
  await Bun.write('dist/styles/app.css', Bun.file('src/styles/app.css'));
  console.log(`✓ dist (${Math.round(performance.now() - started)} ms)`);
}

await build();

if (watching) {
  let timer;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      build().catch((error) => console.error(error));
    }, 80);
  };
  for (const path of ['src', 'index.html']) {
    watch(path, { recursive: true }, trigger);
  }
  console.log('… watching src/ (set KNIT_DEV=1 so the app reloads itself)');
}

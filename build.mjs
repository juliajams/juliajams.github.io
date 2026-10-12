// Usage:  node build.mjs        (no dependencies; Node 18+)

import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSite } from './src/render.js';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'docs');
const content = JSON.parse(await readFile(join(root, 'content/site.json'), 'utf8'));

// Rebuild from scratch so a renamed or deleted project never leaves a stale page.
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'work'), { recursive: true });

for (const { path, html } of renderSite(content)) {
  await writeFile(join(out, path), html);
  console.log('wrote docs/' + path);
}

for (const dir of ['css', 'js', 'fonts', 'images']) {
  await cp(join(root, dir), join(out, dir), { recursive: true });
}
await writeFile(join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n');
await writeFile(join(out, '.nojekyll'), '');
console.log('copied css/, js/, fonts/, images/ into docs/');
console.log('\nDone. docs/ is your finished website.');

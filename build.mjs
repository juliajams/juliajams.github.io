// build.mjs — compiles content/site.json into a self-contained, publishable
// dist/ folder. dist/ is the ONLY thing that should ever be deployed publicly
// — everything else in this repo (content/site.json, src/, admin/, raw
// uploads, this script) is source material and should stay in a private repo.
//
// Usage:  node build.mjs        (no dependencies; Node 18+)

import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSite } from './src/render.js';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const content = JSON.parse(await readFile(join(root, 'content/site.json'), 'utf8'));

// Start clean every time, so a renamed/deleted project never leaves a stale
// page behind in dist/.
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'work'), { recursive: true });

for (const { path, html } of renderSite(content)) {
  await writeFile(join(dist, path), html);
  console.log('wrote dist/' + path);
}

await cp(join(root, 'css'), join(dist, 'css'), { recursive: true });
await cp(join(root, 'js'), join(dist, 'js'), { recursive: true });
await cp(join(root, 'images'), join(dist, 'images'), { recursive: true });
await writeFile(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');
await writeFile(join(dist, '.nojekyll'), ''); // tells GitHub Pages not to run Jekyll on this
console.log('copied css/, js/, images/, robots.txt, .nojekyll into dist/');

console.log(`
dist/ is ready. This is the folder — and only this folder — that should be
deployed publicly. Nothing in the rest of the repo (content/site.json, src/,
admin/, this script, raw image uploads) should be reachable on the live site.
`);

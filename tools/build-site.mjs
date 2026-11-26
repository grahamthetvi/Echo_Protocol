#!/usr/bin/env node
// Copies only what the browser needs into _site/ and writes precache-manifest.json
// for the service worker. Used by the GitHub Pages workflow.
import { cp, mkdir, readdir, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');
const INCLUDE = ['index.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'LICENSE', 'src', 'data', 'assets'];

async function list(dir, base = dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await list(p, base, acc);
    else acc.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return acc;
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of INCLUDE) {
  const src = path.join(root, item);
  try {
    await stat(src);
  } catch {
    continue;
  }
  await cp(src, path.join(out, item), { recursive: true, filter: (p) => !p.endsWith('.wav') });
}
await writeFile(path.join(out, '.nojekyll'), '');
const files = (await list(out)).filter((f) => !f.startsWith('assets/audio/') || f === 'assets/audio/manifest.json').filter((f) => f !== 'sw.js' && f !== '.nojekyll');
await writeFile(path.join(out, 'precache-manifest.json'), JSON.stringify({ files }, null, 2));
console.log(`Built _site with ${files.length} precached files.`);

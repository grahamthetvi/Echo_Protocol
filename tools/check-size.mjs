#!/usr/bin/env node
// Fails CI when shipped audio or the site grows past GitHub Pages-safe limits.
//   audio total  : target  < 500 MB (fail above), hard cap 900 MB
//   any one file : < 100 MB (GitHub's per-file limit), warn above 25 MB
//   whole site   : < 900 MB (Pages sites are limited to about 1 GB)
// Usage: node tools/check-size.mjs [siteDir]
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MB = 1024 * 1024;
export const LIMITS = { audioTarget: 500 * MB, audioHard: 900 * MB, file: 100 * MB, fileWarn: 25 * MB, site: 900 * MB };
const SKIP = new Set(['.git', 'node_modules', '_site', 'tests', 'tools', 'docs', '.github']);
const AUDIO_EXT = new Set(['.ogg', '.webm', '.opus', '.mp3', '.wav', '.m4a', '.flac', '.aac']);

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push({ path: p, size: (await stat(p)).size });
  }
  return out;
}

export async function checkSize(root) {
  const files = await walk(root);
  const audio = files.filter((f) => AUDIO_EXT.has(path.extname(f.path).toLowerCase()));
  const audioTotal = audio.reduce((a, f) => a + f.size, 0);
  const siteTotal = files.reduce((a, f) => a + f.size, 0);
  const errors = [];
  const warnings = [];
  if (audioTotal > LIMITS.audioHard) errors.push(`Audio is ${(audioTotal / MB).toFixed(1)} MB, over the 900 MB hard cap.`);
  else if (audioTotal > LIMITS.audioTarget) errors.push(`Audio is ${(audioTotal / MB).toFixed(1)} MB, over the 500 MB target.`);
  if (siteTotal > LIMITS.site) errors.push(`Site is ${(siteTotal / MB).toFixed(1)} MB, over 900 MB.`);
  for (const f of files) {
    if (f.size > LIMITS.file) errors.push(`${path.relative(root, f.path)} is ${(f.size / MB).toFixed(1)} MB; files must be under 100 MB.`);
    else if (f.size > LIMITS.fileWarn) warnings.push(`${path.relative(root, f.path)} is ${(f.size / MB).toFixed(1)} MB; consider lower bitrate or splitting it.`);
  }
  for (const f of audio) {
    const ext = path.extname(f.path).toLowerCase();
    if (!['.ogg', '.webm', '.opus'].includes(ext) && !f.path.includes(`${path.sep}generated${path.sep}`)) warnings.push(`${path.relative(root, f.path)} is not Opus (.ogg/.webm).`);
  }
  return { audioTotal, siteTotal, fileCount: files.length, audioCount: audio.length, errors, warnings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const r = await checkSize(root);
  console.log(`Site: ${r.fileCount} files, ${(r.siteTotal / MB).toFixed(2)} MB. Audio: ${r.audioCount} files, ${(r.audioTotal / MB).toFixed(2)} MB.`);
  for (const w of r.warnings) console.warn(`warning: ${w}`);
  for (const e of r.errors) console.error(`error: ${e}`);
  process.exit(r.errors.length ? 1 : 0);
}

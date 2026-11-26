#!/usr/bin/env node
// Renders every synthesized sound recipe to files, using the exact DSP code the
// game runs in the browser. Useful as a starting point for sound designers, or to
// ship pre-rendered audio. The game already works without running this.
//
//   node tools/gen-placeholder-audio.mjs            -> WAV files in assets/audio/generated/
//   node tools/gen-placeholder-audio.mjs --opus     -> also Opus .ogg (needs ffmpeg with libopus)
//   node tools/gen-placeholder-audio.mjs --opus --manifest
//                                                   -> and register the .ogg files in assets/audio/manifest.json
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECIPES } from '../src/audio/recipes.js';
import { encodeWav } from '../src/audio/dsp.js';
import { Rng, hashString } from '../src/core/rng.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'audio', 'generated');
const args = new Set(process.argv.slice(2));
const SR = 48000;

const GROUP = (id) => {
  if (id.startsWith('amb_')) {
    const zone = { amb_monitor: 'ward', amb_fluorescent: 'ward', amb_drip: 'ward', amb_vent: 'ward', amb_hum: 'labs', amb_fans: 'labs', amb_freezer: 'labs', amb_boiler: 'maint', amb_electric: 'maint', amb_static: 'lobby', amb_alarm: 'lobby', amb_vending: 'lobby', amb_wind: 'forest', amb_forest: 'forest', amb_creek: 'forest' };
    return zone[id] || 'core';
  }
  return 'core';
};

function hasFfmpeg() {
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { stdio: 'pipe' }).toString().includes('libopus');
  } catch {
    return false;
  }
}

await mkdir(outDir, { recursive: true });
const opus = args.has('--opus') && hasFfmpeg();
if (args.has('--opus') && !opus) console.warn('ffmpeg with libopus not found: writing WAV only.');
const manifestPath = path.join(root, 'assets', 'audio', 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

let count = 0;
for (const [id, r] of Object.entries(RECIPES)) {
  const samples = r.gen(SR, new Rng(hashString(id)));
  const wav = path.join(outDir, `${id}.wav`);
  await writeFile(wav, encodeWav(samples, SR));
  if (opus) {
    const ogg = path.join(outDir, `${id}.ogg`);
    const kbps = r.bus === 'ambience' ? '32k' : '48k';
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-c:a', 'libopus', '-b:a', kbps, ogg]);
    await rm(wav);
    if (args.has('--manifest')) manifest.sounds[id] = { file: `generated/${id}.ogg`, group: GROUP(id) };
  }
  count++;
}
if (args.has('--manifest') && opus) await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Rendered ${count} sounds to ${path.relative(root, outDir)}${opus ? ' as Opus' : ' as WAV'}.`);

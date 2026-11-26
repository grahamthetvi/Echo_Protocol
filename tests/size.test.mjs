import { test } from 'node:test';
import assert from 'node:assert/strict';
import { root } from './helpers.mjs';
import { checkSize, LIMITS } from '../tools/check-size.mjs';
import { RECIPES } from '../src/audio/recipes.js';
import { Rng, hashString } from '../src/core/rng.js';

test('shipped audio and site stay inside GitHub Pages limits', async () => {
  const r = await checkSize(root);
  assert.deepEqual(r.errors, []);
  assert.ok(r.audioTotal < LIMITS.audioTarget);
  assert.ok(r.siteTotal < LIMITS.site);
});

test('every placeholder sound renders to valid audio', () => {
  for (const [id, rec] of Object.entries(RECIPES)) {
    const b = rec.gen(16000, new Rng(hashString(id)));
    let peak = 0;
    for (const v of b) {
      assert.ok(Number.isFinite(v), `${id} has NaN`);
      peak = Math.max(peak, Math.abs(v));
    }
    assert.ok(peak > 0.05 && peak <= 1, `${id} peak ${peak}`);
  }
});

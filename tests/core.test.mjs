import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, hashInts } from '../src/core/rng.js';
import { codeFromIndex, indexFromCode, SEED_SPACE, spokenCode } from '../src/core/seedcode.js';
import { GameClock, TimeAnnouncer } from '../src/core/clock.js';
import { chunkSentences, formatDuration, listWords } from '../src/core/format.js';
import { relativeWords, clockWords, turnLeft, turnRight, relativeSide } from '../src/core/dirs.js';

test('rng is deterministic', () => {
  const a = new Rng(hashInts(1, 2, 3));
  const b = new Rng(hashInts(1, 2, 3));
  for (let i = 0; i < 50; i++) assert.equal(a.float(), b.float());
  const r = new Rng(9);
  for (let i = 0; i < 200; i++) {
    const v = r.int(3, 7);
    assert.ok(v >= 3 && v <= 7 && Number.isInteger(v));
  }
});

test('seed codes round-trip and are speakable', () => {
  for (const i of [0, 1, 89, 90, 12345, SEED_SPACE - 1]) {
    const code = codeFromIndex(i);
    assert.equal(indexFromCode(code), i);
    assert.equal(indexFromCode(spokenCode(code).toUpperCase()), i);
  }
  assert.equal(indexFromCode('not a code'), null);
  assert.equal(indexFromCode('amber fox 9'), null);
});

test('clock holds pause the countdown', () => {
  const c = new GameClock(300);
  c.tick(10);
  assert.equal(c.remaining, 290);
  c.hold('pause');
  c.tick(50);
  assert.equal(c.remaining, 290);
  c.hold('desc');
  c.release('pause');
  c.tick(5);
  assert.equal(c.remaining, 290);
  c.release('desc');
  c.tick(5);
  assert.equal(c.remaining, 285);
  c.penalize(20);
  assert.equal(c.remaining, 265);
  c.extend(60);
  assert.equal(c.remaining, 325);
  const back = GameClock.fromJSON(JSON.parse(JSON.stringify(c)));
  assert.equal(back.remaining, 325);
});

test('time announcer fires 75/50/25/10 percent, 5 min, 1 min and final ten seconds once', () => {
  const total = 1800;
  const a = new TimeAnnouncer();
  const fired = [];
  let prev = total;
  for (let rem = total - 0.5; rem >= 0; rem -= 0.5) {
    for (const t of a.check(prev, rem, total)) fired.push(t.key);
    prev = rem;
  }
  for (const k of ['p75', 'p50', 'p25', 'p10', 'm5', 'm1', 's10', 's5', 's1']) assert.ok(fired.includes(k), k);
  assert.equal(new Set(fired).size, fired.length);
});

test('speech chunks are 1-3 sentences', () => {
  const chunks = chunkSentences('One. Two! Three? Four. Five.');
  assert.deepEqual(chunks, ['One. Two! Three?', 'Four. Five.']);
  assert.deepEqual(chunkSentences('No punctuation here'), ['No punctuation here']);
});

test('format helpers', () => {
  assert.equal(formatDuration(61), '1 minute 1 second');
  assert.equal(formatDuration(120), '2 minutes');
  assert.equal(listWords(['a', 'b', 'c']), 'a, b, and c');
});

test('relative directions follow facing', () => {
  assert.equal(relativeWords(0, -2, 'N'), 'ahead');
  assert.equal(relativeWords(2, 0, 'N'), 'to your right');
  assert.equal(relativeWords(2, 0, 'S'), 'to your left');
  assert.equal(relativeWords(0, 2, 'N'), 'behind you');
  assert.equal(clockWords(0, -1, 'E'), "at 9 o'clock");
  assert.equal(clockWords(1, 0, 'E'), "at 12 o'clock");
  assert.equal(turnLeft('N'), 'W');
  assert.equal(turnRight('W'), 'N');
  assert.equal(relativeSide('E', 'N'), 'right');
});

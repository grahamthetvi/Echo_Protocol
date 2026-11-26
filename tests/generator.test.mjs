import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeData } from './helpers.mjs';
import { generateFacility } from '../src/generator/generator.js';
import { analyzeRoutes, locksCutExit } from '../src/generator/routes.js';
import { fastestRouteBudget } from '../src/generator/costs.js';
import { LENGTHS, LENGTH_PROFILES } from '../src/generator/profiles.js';
import { interiorConnected } from '../src/generator/interior.js';

const data = await nodeData();
const SEEDS = 200;

const EXPECTED_ROOMS = { 5: [5, 7], 15: [10, 14], 30: [18, 24], 60: [28, 40] };

for (const len of LENGTHS) {
  test(`${len}-minute sessions: ${SEEDS} seeds obey the fastest-route rule and structure rules`, () => {
    const budget = fastestRouteBudget(len);
    let worst = 0;
    for (let i = 0; i < SEEDS; i++) {
      const seedIndex = i * 7919 + len;
      const f = generateFacility({ seedIndex, lengthMin: len, data });
      const r = analyzeRoutes(f);
      const ctx = `seed ${seedIndex} (${f.code}), ${len} min`;

      // The 25% rule, re-checked independently of the generator.
      assert.ok(r.ok, `${ctx}: exit must be reachable`);
      assert.ok(r.completeSec <= budget, `${ctx}: complete route ${r.completeSec}s exceeds ${budget}s`);
      assert.ok(r.directSec <= budget, `${ctx}: direct route ${r.directSec}s exceeds ${budget}s`);
      worst = Math.max(worst, r.completeSec / (len * 60));

      // Size scales with content.
      const [lo, hi] = EXPECTED_ROOMS[len];
      assert.ok(f.rooms.length >= lo && f.rooms.length <= hi, `${ctx}: ${f.rooms.length} rooms not in ${lo}-${hi}`);

      // At least one locked door on every route to the exit.
      assert.ok(f.locks.length >= 1, `${ctx}: needs a lock`);
      assert.ok(locksCutExit(f), `${ctx}: some route bypasses every lock`);

      // Keys and clues are reachable but off the fastest direct path.
      for (const l of f.locks) {
        assert.ok(l.clue.roomId && l.clue.fixtureUid, `${ctx}: lock ${l.id} has no clue location`);
        assert.ok(!r.directRooms.includes(l.clue.roomId), `${ctx}: clue for ${l.id} lies on the fastest path`);
        const room = f.rooms.find((x) => x.id === l.clue.roomId);
        assert.ok(room.fixtures.some((fx) => fx.uid === l.clue.fixtureUid), `${ctx}: clue fixture missing`);
      }

      // Every room interior is navigable.
      for (const room of f.rooms) {
        const reserved = room.start ? [room.start] : [];
        assert.ok(interiorConnected(room, reserved), `${ctx}: ${room.name} interior is blocked`);
      }

      // Zombie counts and safe start.
      const zp = LENGTH_PROFILES[len].zombies;
      assert.ok(f.zombies.length <= zp[1], `${ctx}: too many zombies`);
      assert.ok(!f.zombies.some((z) => z.room === f.start.room), `${ctx}: zombie in start room`);

      // One cure sample.
      const cures = f.rooms.flatMap((x) => x.fixtures).flatMap((fx) => fx.items || []).filter((it) => it === 'cure');
      assert.equal(cures.length, 1, `${ctx}: exactly one cure sample`);
    }
    // Leave a note in the test output for teachers/devs curious about the margin.
    assert.ok(worst <= 0.25);
  });
}

test('5-minute sessions have exactly one key puzzle and one or two zombies', () => {
  for (let i = 0; i < 50; i++) {
    const f = generateFacility({ seedIndex: i, lengthMin: 5, data });
    assert.equal(f.locks.length, 1);
    assert.ok(f.zombies.length >= 1 && f.zombies.length <= 2);
  }
});

test('generation is deterministic for a seed and length', () => {
  const a = generateFacility({ seedIndex: 12345, lengthMin: 30, data });
  const b = generateFacility({ seedIndex: 12345, lengthMin: 30, data });
  assert.deepEqual(a, b);
  const c = generateFacility({ seedIndex: 12346, lengthMin: 30, data });
  assert.notDeepEqual(a.rooms.map((r) => r.name), c.rooms.map((r) => r.name));
});

test('lock puzzles carry the parameters they need', () => {
  const kinds = new Set();
  for (let i = 0; i < 100; i++) {
    const f = generateFacility({ seedIndex: i * 31, lengthMin: 60, data });
    for (const l of f.locks) {
      kinds.add(l.kind);
      if (l.kind === 'keypad') assert.match(l.code, /^\d{4}$/);
      if (l.kind === 'sequence') assert.equal(l.melody.length, 6);
      if (l.kind === 'rhythm') assert.ok(l.rhythm.includes(1) && l.rhythm.includes(2));
      if (l.kind === 'power') assert.ok(l.answer >= 0 && l.answer < l.circuits.length);
      if (l.kind === 'pitch') assert.ok(Math.abs(l.target - l.startStep) >= 4);
      if (l.kind === 'keycard') assert.match(l.item, /^keycard_/);
    }
  }
  for (const k of ['keycard', 'keypad', 'sequence', 'pitch', 'rhythm', 'power']) assert.ok(kinds.has(k), `kind ${k} appears`);
});

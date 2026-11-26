import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeData } from './helpers.mjs';
import { generateFacility } from '../src/generator/generator.js';
import { fastestRouteBudget } from '../src/generator/costs.js';
import { makeGame, Autopilot } from './autopilot.mjs';

const data = await nodeData();

for (const len of [5, 15, 30, 60]) {
  test(`autopilot escapes ${len}-minute facilities through the real engine`, () => {
    const seeds = len === 60 ? 10 : 20;
    for (let i = 0; i < seeds; i++) {
      const f = generateFacility({ seedIndex: i * 101 + 3, lengthMin: len, data });
      const env = makeGame(f, data);
      env.game.start();
      const ap = new Autopilot(env);
      let ending = null;
      env.events.on('ending', (s) => { ending = s; });
      ap.run();
      assert.ok(ending, `seed ${f.code}: game should end`);
      assert.ok(ending.won, `seed ${f.code}: should escape, got ${ending.kind}`);
      // Played with real action durations, the greedy route stays inside the budget too.
      const used = env.game.clock.elapsed - env.game.clock.penalties;
      assert.ok(used <= fastestRouteBudget(len), `seed ${f.code}: autopilot used ${used.toFixed(1)}s > ${fastestRouteBudget(len)}s`);
    }
  });
}

test('save and restore keeps progress', () => {
  const f = generateFacility({ seedIndex: 77, lengthMin: 15, data });
  const env = makeGame(f, data);
  env.game.start();
  const ap = new Autopilot(env);
  ap.settle(30);
  env.game.press = null;
  ap.press('forward');
  ap.settle();
  env.game.addItem('bandage', 2, true);
  const saved = JSON.parse(JSON.stringify(env.game.serialize()));
  const env2 = makeGame(f, data, { saved });
  assert.equal(env2.game.player.room, env.game.player.room);
  assert.equal(env2.game.player.inventory.bandage, 2);
  assert.equal(Math.round(env2.game.clock.remaining), Math.round(env.game.clock.remaining));
  assert.deepEqual([...env2.game.visited], [...env.game.visited]);
});

test('every keypress gives feedback and unknown keys buzz', () => {
  const f = generateFacility({ seedIndex: 5, lengthMin: 5, data });
  const env = makeGame(f, data);
  env.game.start();
  const ap = new Autopilot(env);
  ap.settle(30);
  for (const a of ['where', 'compass', 'listen', 'status', 'time', 'ping', 'cane', 'help']) {
    const before = env.speech.history.length;
    ap.press(a);
    ap.settle();
    ap.tick(1);
    assert.ok(env.speech.history.length > before, `${a} speaks`);
  }
  const n = env.audio.played.length;
  env.stack.dispatch({ action: null, code: 'KeyJ' });
  assert.equal(env.audio.played[n], 'ui_error');
});

test('timer runs out to the sterilized ending', () => {
  const f = generateFacility({ seedIndex: 9, lengthMin: 5, data });
  const env = makeGame(f, data);
  env.game.start();
  let ending = null;
  env.events.on('ending', (s) => { ending = s; });
  const ap = new Autopilot(env);
  ap.settle(30);
  env.game.zombies.list.forEach((z) => env.game.zombies.kill(z));
  env.game.clock.penalize(299);
  ap.tick(2);
  assert.equal(ending?.kind, 'sterilized');
});

test('zombies hear noise and engage; fighting can kill them', () => {
  const f = generateFacility({ seedIndex: 21, lengthMin: 15, data });
  const env = makeGame(f, data);
  const g = env.game;
  g.start();
  const ap = new Autopilot(env);
  ap.settle(30);
  const z = g.zombies.alive[0];
  // Teleport the zombie next to the player.
  const p = g.player;
  const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).find((t) => g.world.isWalkable(p.room, t.x, t.y));
  Object.assign(z, { room: p.room, x: spot.x, y: spot.y });
  g.noise(5, p, 'player');
  ap.tick(0.2);
  assert.equal(z.state, 'chase');
  assert.ok(g.encounter, 'encounter starts');
  for (let i = 0; i < 30 && !z.dead && !g.ended; i++) {
    ap.press('fight');
    ap.settle();
  }
  assert.ok(z.dead || g.player.infection > 0, 'fight resolves');
});

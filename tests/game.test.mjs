import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeData } from './helpers.mjs';
import { generateFacility } from '../src/generator/generator.js';
import { fastestRouteBudget } from '../src/generator/costs.js';
import { makeGame, Autopilot } from './autopilot.mjs';
import { reachables } from '../src/game/describe.js';

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

/** Put the player next to a hiding spot with a zombie two steps away; returns null if no spot fits. */
function hideScenario(seedIndex, settings) {
  const f = generateFacility({ seedIndex, lengthMin: 15, data });
  const env = makeGame(f, data, { settings });
  const g = env.game;
  g.start();
  env.speech.tick();
  const z = g.zombies.alive[0];
  for (const r of g.world.rooms.values()) {
    if (!r.fixtures?.some((x) => x.type === 'hide')) continue;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        if (!g.world.isWalkable(r.id, x, y)) continue;
        Object.assign(g.player, { room: r.id, x, y });
        if (!reachables(g).some((q) => q.kind === 'fixture' && q.fixture.type === 'hide')) continue;
        for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
          if (!g.world.isWalkable(r.id, x + dx, y + dy)) continue;
          Object.assign(z, { room: r.id, x: x + dx, y: y + dy, state: 'idle', stunned: 0, target: null, path: null });
          g.zombies.startChase(z);
          return { env, g, z };
        }
      }
    }
  }
  return null;
}

test('a zombie that loses a hidden player gives up instead of waiting by the hiding spot', () => {
  let checked = 0;
  for (let seed = 0; seed < 60 && checked < 5; seed++) {
    const s = hideScenario(seed);
    if (!s) continue;
    const { env, g, z } = s;
    g.toggleHide();
    if (!g.player.hidden) continue; // the hide roll can fail mid-chase; try another layout
    checked++;
    let gaveUp = false;
    env.events.on('zombieGaveUp', () => { gaveUp = true; });
    for (let t = 0; t < 30 && !gaveUp; t += 0.1) g.update(0.1);
    assert.ok(gaveUp, `seed ${seed}: zombie still ${z.state} next to the hiding spot after 30 s`);
    assert.notEqual(z.state, 'chase');
    assert.notEqual(z.state, 'investigate');
    assert.match(env.speech.transcript, /loses interest/);
  }
  assert.ok(checked >= 3, 'found enough hiding layouts to test');
});

test('pausing the clock for descriptions can be turned off', () => {
  const run = (pause) => {
    const f = generateFacility({ seedIndex: 9, lengthMin: 5, data });
    const env = makeGame(f, data, { settings: { pauseClockForDescriptions: pause } });
    env.game.start();
    env.game.narrating = false; // skip the intro
    env.speech.stop();
    env.speech.tick = () => {}; // keep the description "speaking"
    env.speech.say('A long room description.', { category: 'desc' });
    const before = env.game.clock.remaining;
    for (let i = 0; i < 20; i++) env.game.update(0.1);
    return before - env.game.clock.remaining;
  };
  assert.ok(run(true) < 0.01, 'clock holds while a description plays');
  assert.ok(run(false) > 1.9, 'clock runs when the setting is off');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeData } from './helpers.mjs';
import { makeGame, Autopilot } from './autopilot.mjs';
import { buildTutorialFacility, Tutorial } from '../src/game/tutorial.js';
import { checkRhythm, checkSequence, checkKeypad, brailleDots, breakerAnswer, pitchFreq } from '../src/puzzles/checks.js';
import { Difficulty } from '../src/game/difficulty.js';
import { SessionLog } from '../src/state/sessionlog.js';
import { importText, exportText } from '../src/state/saves.js';
import { buildLookup, resolveAction } from '../src/input/input.js';
import { DEFAULT_KEYMAP } from '../src/state/settings.js';
import { scanDirection } from '../src/game/echo.js';

const data = await nodeData();

test('the tutorial teaches by doing and completes', () => {
  const env = makeGame(buildTutorialFacility(), data, { mode: 'tutorial' });
  const { game, events } = env;
  events.on('requestPause', () => {
    game.paused = true;
    events.emit('paused', {});
    game.paused = false;
    events.emit('resumed', {});
  });
  let done = false;
  const tut = new Tutorial(game, data, () => { done = true; });
  game.start();
  tut.start();
  const ap = new Autopilot(env);
  ap.settle();
  const do_ = (a, extra) => { ap.press(a, extra); ap.settle(); ap.tick(0.2); };
  for (const a of ['forward', 'turnRight', 'turnLeft', 'back', 'compass', 'where', 'ping', 'listen']) do_(a);
  assert.equal(tut.index, 8);
  // Search the cabinet in the corner.
  const cab = game.world.room('practice_a').fixtures[0];
  ap.goToFixture('practice_a', cab.uid);
  ap.face(['N', 'E', 'S', 'W'].find((d) => {
    const v = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[d];
    return game.player.x + v[0] === cab.x && game.player.y + v[1] === cab.y;
  }));
  do_('interact');
  ap.tick(3);
  assert.equal(tut.index, 9, 'search step done');
  do_('inventory');
  do_('inventory');
  assert.equal(tut.index, 10);
  do_('time');
  ap.walkTo({ room: 'practice_b', x: 0, y: 2 });
  assert.equal(tut.index, 12, 'entered room B');
  // The dummy comes to us; fight it.
  for (let i = 0; i < 200 && !game.zombies.list[0].dead; i++) {
    ap.tick(0.1);
    if (game.encounter || game.adjacentZombie()) do_('fight');
  }
  assert.ok(game.zombies.list[0].dead, 'dummy defeated');
  assert.equal(tut.index, 13);
  ap.walkTo({ room: 'practice_b', x: 1, y: 4 });
  do_('hide');
  assert.equal(tut.index, 14);
  do_('hide');
  do_('forward');
  do_('hint');
  do_('pauseHold');
  assert.equal(tut.index, 18);
  ap.walkTo({ room: 'practice_b', x: 4, y: 2 });
  ap.face('E');
  do_('forward');
  assert.ok(done, 'tutorial finished');
  assert.match(env.speech.transcript, /Tutorial complete/);
});

test('puzzle checks', () => {
  assert.ok(checkKeypad('4719', '4719'));
  assert.ok(!checkKeypad('4719', '4718'));
  assert.ok(checkSequence(['up', 'left'], ['up', 'left']));
  assert.ok(!checkSequence(['up', 'left'], ['left', 'up']));
  // gaps 1,1,2 at a 0.5 s unit, played slightly unevenly
  assert.ok(checkRhythm([1, 1, 2], [0, 0.52, 0.98, 2.01]));
  assert.ok(!checkRhythm([1, 1, 2], [0, 1, 1.5, 2]));
  assert.ok(!checkRhythm([1, 1, 2], [0, 0.5, 1]));
  assert.equal(brailleDots('40'), 'dots 1 4 5, dots 2 4 5');
  assert.equal(breakerAnswer([{ freq: 196 }, { freq: 110 }, { freq: 262 }], 'lowest'), 1);
  assert.equal(breakerAnswer([{ freq: 196 }, { freq: 110, pulse: true }], 'pulsing'), 1);
  assert.ok(Math.abs(pitchFreq(12) - 440) < 1e-9);
});

test('adaptive difficulty eases after deaths and tightens with clean progress', () => {
  const d = new Difficulty();
  const base = d.zombieSpeedMult;
  d.onDeath();
  assert.ok(d.zombieSpeedMult < base);
  assert.ok(d.windowSec > new Difficulty().windowSec);
  const e = new Difficulty();
  for (let i = 0; i < 9; i++) e.onProgress('room');
  assert.ok(e.pressure > 1);
  const a = new Difficulty({ assist: true });
  assert.ok(a.zombieSpeedMult < base && a.maxInfection > 3 && a.hintCost < 20);
});

test('session log exports CSV and JSON', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const log = new SessionLog(storage);
  log.startSession({ seed: 'amber-fox-42' });
  log.add('hint', { level: 1 });
  log.add('death', { zombie: 'runner, "fast"' });
  const csv = log.toCSV().split('\n');
  assert.equal(csv[0], 'time,session,type,elapsed,remaining,room,detail');
  assert.equal(csv.length, 4);
  assert.match(csv[3], /,death,.*,"\{""zombie"":/);
  assert.equal(log.toJSON().summary.deaths, 1);
});

test('save files round-trip and reject junk', () => {
  const save = { v: 1, seedIndex: 3, lengthMin: 15, player: {}, clock: { limit: 900, elapsed: 1, bonus: 0 } };
  assert.deepEqual(importText(exportText(save)).seedIndex, 3);
  assert.equal(importText('{"v":2}'), null);
  assert.equal(importText('nope'), null);
});

test('keymap resolves combos and falls back for modifiers', () => {
  const l = buildLookup(DEFAULT_KEYMAP);
  assert.equal(resolveAction(l, { code: 'KeyR', shiftKey: true }), 'repeatFull');
  assert.equal(resolveAction(l, { code: 'KeyR' }), 'repeat');
  assert.equal(resolveAction(l, { code: 'ArrowUp', shiftKey: true }), 'forward');
  assert.equal(resolveAction(l, { code: 'KeyW', ctrlKey: true }), 'forward');
  assert.equal(resolveAction(l, { code: 'ShiftLeft', shiftKey: true }), 'runHold');
});

test('echolocation scan finds walls and doorways', () => {
  const env = makeGame(buildTutorialFacility(), data, { mode: 'tutorial' });
  const w = env.game.world;
  const east = scanDirection(w, 'practice_a', 2, 2, 'E');
  assert.equal(east.kind, 'door');
  assert.equal(east.dist, 3);
  const north = scanDirection(w, 'practice_a', 2, 2, 'N');
  assert.deepEqual([north.kind, north.dist], ['wall', 3]);
});

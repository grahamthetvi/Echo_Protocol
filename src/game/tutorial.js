// The practice room and the by-doing tutorial. Two hand-built rooms that use the
// same structures as generated facilities, and a controller that waits for the
// player to actually perform each action before moving on.

import { CELL } from '../generator/interior.js';

export function buildTutorialFacility() {
  const room = (id, cx, name, extra) => ({
    id, cx, cy: 0, w: 5, h: 5, ox: cx * CELL + 2, oy: 2,
    doors: { N: null, E: null, S: null, W: null },
    fixtures: [], obstacles: [], exitSide: null,
    name, floor: 'Practice Wing', zone: 'ward', surface: 'tile', ambient: 'amb_hum',
    templateId: id, region: 0, onPath: true, pathIndex: cx,
    ...extra,
  });
  const a = room('practice_a', 0, 'Practice Room', {
    desc: ['A quiet practice room with smooth tile floors.', 'A low machine hum fills the air.'],
    fixtures: [{ uid: 't0', name: 'practice cabinet', type: 'container', x: 0, y: 0, items: ['bandage'] }],
    start: { x: 2, y: 3 }, startFacing: 'N',
  });
  const b = room('practice_b', 1, 'Practice Room B', {
    desc: ['The second practice room. A rubber training dummy shuffles around in here.', 'The beacon beeps beyond the doorway on the far side.'],
    fixtures: [{ uid: 't1', name: 'practice locker', type: 'hide', x: 0, y: 4 }],
    exitSide: 'E',
  });
  a.doors.E = 'd0';
  b.doors.W = 'd0';
  return {
    rooms: [a, b],
    doors: [{ id: 'd0', a: 'practice_a', b: 'practice_b', sideA: 'E', sideB: 'W', kind: 'door', state: 'closed', lock: null, jammed: false }],
    locks: [],
    zombies: [{ id: 'z0', type: 'dummy', room: 'practice_b', x: 3, y: 1 }],
    logs: [],
    cureRoom: null,
    start: { room: 'practice_a', x: 2, y: 3, facing: 'N' },
    exit: { room: 'practice_b', side: 'E' },
    mainPath: ['practice_a', 'practice_b'],
    seedIndex: 0,
    code: 'practice',
    lengthMin: 5,
    limitSec: 300,
  };
}

export class Tutorial {
  constructor(game, data, onDone) {
    this.game = game;
    this.steps = data.story.tutorial.steps;
    this.script = data.story.tutorial;
    this.index = 0;
    this.onDone = onDone;
    this.waitResume = false;
    this.off = game.events.on('*', (e) => this.onEvent(e));
  }
  start() {
    this.game.say(this.script.intro, { priority: 'normal' });
    this.prompt();
  }
  get step() {
    return this.steps[this.index];
  }
  prompt(delay = 0) {
    const s = this.step;
    if (!s) return;
    const doSay = () => this.game.say(s.say, { priority: 'normal' });
    if (delay) this.game.after(delay, doSay);
    else doSay();
  }
  matches(expect, e) {
    const [kind, name, arg] = expect.split(':');
    if (kind === 'action') return e.type === 'action' && e.payload?.name === name;
    if (e.type !== name) return false;
    if (name === 'enterRoom' && arg) return e.payload?.room === arg;
    return true;
  }
  onEvent(e) {
    const s = this.step;
    if (!s) return;
    if (this.waitResume) {
      if (e.type === 'resumed') {
        this.waitResume = false;
        this.advance();
      }
      return;
    }
    if (!this.matches(s.expect, e)) return;
    if (s.expect === 'event:paused') {
      this.waitResume = true;
      return;
    }
    this.advance();
  }
  advance() {
    this.index++;
    this.game.audio.play('ui_success', { bus: 'ui', gain: 0.5 });
    if (this.index >= this.steps.length) {
      this.finish();
      return;
    }
    // Let the response to the action finish speaking first.
    this.prompt(0.05);
  }
  finish() {
    this.off();
    this.game.say(this.script.done, { priority: 'urgent' });
    this.onDone?.();
  }
  destroy() {
    this.off();
  }
}

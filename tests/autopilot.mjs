// A scripted player that drives the real Game engine with the same actions a
// person would press. Used to prove every generated facility is completable.

import { DIRS, DVEC, OPP, turnRight } from '../src/core/dirs.js';
import { Game } from '../src/game/game.js';
import { UIStack } from '../src/ui/stack.js';
import { Emitter } from '../src/core/events.js';
import { NullSpeech } from '../src/audio/speech.js';
import { NullAudio } from '../src/audio/engine.js';
import { cloneDefaults } from '../src/state/settings.js';
import { nextObjective } from '../src/game/hints.js';
import { accessTiles } from '../src/generator/interior.js';

export function makeGame(facility, data, opts = {}) {
  const stack = new UIStack();
  const events = new Emitter();
  const speech = new NullSpeech();
  const audio = new NullAudio();
  const settings = { ...cloneDefaults(), ...(opts.settings || {}) };
  const game = new Game({ facility, data, settings, speech, audio, stack, events, mode: opts.mode, saved: opts.saved });
  stack.push(game);
  return { game, stack, events, speech, audio };
}

export class Autopilot {
  constructor(env) {
    Object.assign(this, env);
    this.dt = 1 / 30;
    this.steps = 0;
  }
  press(action, extra = {}) {
    this.stack.dispatch({ action, code: extra.code || null, key: extra.key, repeat: false });
  }
  code(code) {
    this.stack.dispatch({ action: null, code, repeat: false });
  }
  tick(sec = this.dt) {
    let t = 0;
    while (t < sec - 1e-9) {
      this.game.update(this.dt);
      t += this.dt;
    }
  }
  settle(max = 20) {
    let t = 0;
    while ((this.game.isBusy() || this.game.narrating || this.game.timers.length) && t < max) {
      this.tick();
      t += this.dt;
      if (this.game.ended) return;
    }
  }
  face(dir) {
    let guard = 0;
    while (this.game.player.facing !== dir && guard++ < 4) {
      this.press('turnRight');
      this.settle();
    }
  }
  /** Walk to a tile using the same moves a player makes. */
  walkTo(goal) {
    const g = this.game;
    const w = g.world;
    for (let guard = 0; guard < 400; guard++) {
      const p = g.player;
      if (p.room === goal.room && p.x === goal.x && p.y === goal.y) return true;
      const path = w.tilePath(p, goal, (d) => !w.doorBlocksPlayer(d));
      if (!path || !path.length) return false;
      const next = path[0];
      let dir;
      if (next.room === p.room) dir = DIRS.find((d) => p.x + DVEC[d][0] === next.x && p.y + DVEC[d][1] === next.y);
      else dir = DIRS.find((d) => w.tryStep(p.room, p.x, p.y, d).type === 'door' && w.tryStep(p.room, p.x, p.y, d).dest.room === next.room);
      this.face(dir);
      this.press('forward');
      this.settle();
      this.steps++;
      if (g.ended) return true;
    }
    return false;
  }
  goToFixture(roomId, uid) {
    const w = this.game.world;
    const room = w.room(roomId);
    const f = room.fixtures.find((x) => x.uid === uid);
    const tiles = accessTiles(room, f);
    for (const t of tiles) if (this.walkTo({ room: roomId, ...t })) return f;
    return null;
  }
  goToDoorTile(door, fromRoom) {
    const w = this.game.world;
    const side = w.sideOf(door, fromRoom);
    const t = w.doorTile(fromRoom, side);
    if (!this.walkTo({ room: fromRoom, ...t })) return false;
    this.face(side);
    return true;
  }
  run(maxObjectives = 40) {
    const g = this.game;
    g.zombies.list.forEach((z) => g.zombies.kill(z));
    this.settle(60);
    for (let i = 0; i < maxObjectives && !g.ended; i++) {
      const obj = nextObjective(g);
      if (obj.type === 'clue') this.getClue(obj.lock);
      else if (obj.type === 'lock') this.openLock(obj.lock, obj.door);
      else {
        const ex = g.world.f.exit;
        const t = g.world.doorTile(ex.room, ex.side);
        if (!this.walkTo({ room: ex.room, ...t })) throw new Error('cannot reach exit');
        this.face(ex.side);
        this.press('forward');
        this.settle();
      }
    }
    this.tick(1);
    return g.ended;
  }
  getClue(lock) {
    const g = this.game;
    const f = this.goToFixture(lock.clue.roomId, lock.clue.fixtureUid);
    if (!f) throw new Error(`cannot reach clue for ${lock.id}`);
    // Face the fixture, then interact.
    const p = g.player;
    const dir = DIRS.find((d) => p.x + DVEC[d][0] === f.x && p.y + DVEC[d][1] === f.y);
    this.face(dir);
    this.press('interact');
    this.settle(30);
    if (lock.clue.type === 'breaker') {
      const panel = this.stack.top;
      while (panel.index !== lock.answer) {
        this.press('turnRight');
        this.settle();
      }
      this.press('interact');
      this.settle();
    }
    if (lock.clue.type === 'container' && !g.player.inventory[lock.clue.item]) throw new Error('container clue missing item');
  }
  openLock(lock, door) {
    const g = this.game;
    const w = g.world;
    const a = w.room(door.a);
    const b = w.room(door.b);
    const near = [a, b].find((r) => w.roomRoute(g.player.room, r.id, { passLocked: false }));
    if (!this.goToDoorTile(door, near.id)) throw new Error('cannot reach lock');
    this.press('interact');
    this.settle();
    switch (lock.kind) {
      case 'keypad':
        for (const d of lock.code) this.code(`Digit${d}`);
        this.code('Enter');
        break;
      case 'sequence': {
        const act = { up: 'forward', right: 'turnRight', down: 'back', left: 'turnLeft' };
        for (const n of lock.melody) this.press(act[n]);
        break;
      }
      case 'pitch': {
        const pz = this.stack.top;
        while (pz.value < lock.target) this.press('forward');
        while (pz.value > lock.target) this.press('back');
        this.code('Enter');
        break;
      }
      case 'rhythm':
        this.code('Space');
        for (const gap of lock.rhythm) {
          this.tick(gap * 0.4);
          this.code('Space');
        }
        break;
      default:
        break;
    }
    this.settle(10);
    if (w.isLocked(door)) throw new Error(`lock ${lock.kind} still locked`);
  }
}

export { OPP, turnRight };

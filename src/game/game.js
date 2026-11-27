// The game itself: one run through a generated facility. DOM-free, so it runs in
// Node tests with silent audio and recorded speech. Acts as the bottom handler
// on the UI stack; menus, puzzles and dialogs sit on top of it.

import { DIRS, DVEC, OPP, DIR_NAME, turnLeft, turnRight, relativeWords, relativeSide } from '../core/dirs.js';
import { GameClock, TimeAnnouncer } from '../core/clock.js';
import { formatDuration, fill, listWords, plural, withArticle, capitalize } from '../core/format.js';
import { Rng, hashInts } from '../core/rng.js';
import { COST } from '../generator/costs.js';
import { World } from './world.js';
import { ZombieSystem } from './zombies.js';
import { Soundscape } from './soundscape.js';
import { Difficulty } from './difficulty.js';
import { playPing, pingSummary, scanDirection } from './echo.js';
import { hintText, nextObjective } from './hints.js';
import {
  roomDescription, reachables, whereAmI, compassText, statusText, listenText, lockName, doorStateWords,
} from './describe.js';
import { interactFeature } from '../puzzles/clues.js';
import { openLockPuzzle } from '../puzzles/locks.js';
import { InventoryMenu, MapView } from './overlays.js';

// Speech that pauses the countdown. 'desc' (room descriptions, Q, L, Shift+R) can be
// turned off with the pauseClockForDescriptions setting; logs and narration always pause it.
const HOLD_CATEGORIES = new Set(['desc', 'log', 'narration']);
const SURFACE_NOISE = { carpet: 0.7, grass: 0.8, tile: 1, wood: 1.1, gravel: 1.3, grating: 1.4 };
const MODE_NOISE = { sneak: 1, walk: 3, run: 7 };

export class Game {
  /**
   * @param o.facility generated facility
   * @param o.data loaded content
   * @param o.settings settings object (read live)
   * @param o.speech, o.audio, o.stack, o.events
   * @param o.mode 'normal' | 'tutorial'
   * @param o.saved serialized game to restore
   */
  constructor(o) {
    this.facility = o.facility;
    this.data = o.data;
    this.settings = o.settings;
    this.speech = o.speech;
    this.audio = o.audio;
    this.stack = o.stack;
    this.events = o.events;
    this.mode = o.mode || 'normal';
    this.input = o.input || null;
    this.assist = o.saved?.difficulty?.assist ?? !!o.settings.assist;
    this.rng = new Rng(hashInts(o.facility.seedIndex || 0, 77));

    this.world = new World(o.facility);
    this.difficulty = o.saved ? Difficulty.fromJSON(o.saved.difficulty) : new Difficulty({ assist: this.assist });
    const limit = o.facility.limitSec * (this.assist ? 1.5 : 1);
    this.clock = o.saved ? GameClock.fromJSON(o.saved.clock) : new GameClock(limit);
    this.announcer = o.saved ? TimeAnnouncer.fromJSON(o.saved.announcer) : new TimeAnnouncer();
    if (this.mode === 'tutorial') this.clock.hold('tutorial');

    const s = o.facility.start;
    this.player = {
      room: s.room, x: s.x, y: s.y, facing: s.facing,
      health: 100, exhaustion: 0, infection: 0, maxInfection: this.difficulty.maxInfection, skill: 0,
      inventory: { cane: 1, monocular: 1 },
      hidden: null, moveMode: 'walk', knowledge: {}, logsHeard: [], mapRead: false,
      radioStep: 0, radioCharge: 0, advocated: {}, lastSafeRoom: s.room,
    };
    this.visited = new Set();
    this.flags = {};
    this.stats = { deaths: 0, hints: 0, fights: 0, kills: 0, puzzles: 0, items: 0 };
    this.hintLevels = {};
    this.time = 0;
    this.busyUntil = 0;
    this.timers = [];
    this.noiseEvents = [];
    this.playerNoise = 0;
    this.lastNoiseWord = 'quiet';
    this.encounter = null;
    this.pendingMove = null;
    this.ended = false;
    this.paused = false;
    this.narrating = false;
    this.lastReach = new Set();
    this.intercomTimer = 150 + this.rng.range(0, 60);
    this.overlay = false;

    this.zombies = new ZombieSystem(this, o.saved?.zombies || o.facility.zombies, hashInts(o.facility.seedIndex || 0, 5));
    this.soundscape = new Soundscape(this);

    if (o.saved) this.restore(o.saved);
  }

  // ---------------------------------------------------------------- lifecycle

  start({ resumed = false } = {}) {
    if (resumed) {
      this.say('Game loaded.', { priority: 'urgent' });
      this.enterRoom(this.player.room, { quiet: false, force: true });
      return;
    }
    if (this.mode === 'tutorial') {
      this.enterRoom(this.player.room, { force: true });
      return;
    }
    const lines = this.data.story.intro.map((l) => (typeof l === 'string' ? { text: l } : l))
      .map((l) => ({ ...l, text: fill(l.text, { time: formatDuration(this.clock.total) }) }));
    this.narrate(lines, () => this.enterRoom(this.player.room, { force: true }));
  }

  /** Mandatory narration: the world and the clock pause until it ends (Enter skips). */
  narrate(lines, onDone) {
    this.narrating = true;
    const list = lines.map((l) => (typeof l === 'string' ? { text: l } : l));
    list.forEach((l, i) => {
      if (l.voice === 'intercom') this.audio.play('intercom_chime', { bus: 'ui', delay: 0 });
      this.speech.say(l.text, {
        category: 'narration', voice: l.voice || 'narrator',
        onEnd: i === list.length - 1 ? (r) => {
          if (!this.narrating) return;
          this.narrating = false;
          onDone?.(r);
        } : undefined,
      });
    });
    if (!list.length) {
      this.narrating = false;
      onDone?.();
    }
  }

  skipNarration() {
    if (!this.narrating) return;
    this.speech.stop(); // fires onEnd for the last line
  }

  say(text, opts = {}) {
    this.speech.say(text, opts);
  }

  after(sec, fn) {
    this.timers.push({ at: this.time + sec, fn });
  }

  isBusy() {
    return this.time < this.busyUntil;
  }
  busy(sec) {
    this.busyUntil = Math.max(this.busyUntil, this.time + sec);
  }

  update(dt) {
    if (this.ended) {
      this.speech.tick?.(dt);
      return;
    }
    this.speech.tick?.(dt);
    this.clock.setHold('speech', this.speechHoldsClock(this.speech.category));
    this.clock.setHold('pause', this.paused);
    if (this.paused) return;
    if (this.narrating) {
      this.clock.hold('narration');
      return;
    }
    this.clock.release('narration');

    this.time += dt;
    const due = this.timers.filter((t) => t.at <= this.time);
    if (due.length) {
      this.timers = this.timers.filter((t) => t.at > this.time);
      for (const t of due) t.fn();
      if (this.ended) return;
    }

    // Countdown and automatic time announcements.
    const prev = this.clock.remaining;
    this.clock.tick(dt);
    if (this.mode !== 'tutorial') {
      for (const a of this.announcer.check(prev, this.clock.remaining, this.clock.total)) this.announceTime(a);
      if (this.clock.expired) {
        this.finish('sterilized');
        return;
      }
    }

    // Movement: queued presses first, then held keys.
    if (!this.isBusy()) {
      if (this.pendingMove) {
        const m = this.pendingMove;
        this.pendingMove = null;
        this.step(m);
      } else if (this.input && !this.overlay && this.stack?.top === this) {
        if (this.input.isHeld('forward')) this.step('forward');
        else if (this.input.isHeld('back')) this.step('back');
      }
    }

    // Body.
    const p = this.player;
    if (!this.isBusy()) p.exhaustion = Math.max(0, p.exhaustion - dt * (p.hidden ? 4 : 2.5));
    this.playerNoise = Math.max(0, this.playerNoise - dt * 2);
    const nw = this.noiseWord();
    if (nw === 'quiet' && this.lastNoiseWord === 'loud' && this.settings.announceNoise) this.say('Quiet again.', { priority: 'ambient' });
    if (nw !== 'moderate') this.lastNoiseWord = nw;

    this.zombies.update(dt, this.noiseEvents);
    this.noiseEvents = [];
    this.updateEncounter(dt);
    this.soundscape.update(dt);

    if (!this.encounter && this.mode !== 'tutorial' && this.difficulty.tickStuck(dt)) {
      this.say('Feeling stuck? Press H for a hint.', { priority: 'ambient' });
      this.events.emit('stuckOffer', {});
    }
    if (this.mode !== 'tutorial') {
      this.intercomTimer -= dt;
      if (this.intercomTimer <= 0 && !this.encounter) {
        this.intercomTimer = 160 + this.rng.range(0, 80);
        const lines = this.data.story.intercom;
        const line = lines[(this.flags.intercomIdx = ((this.flags.intercomIdx ?? -1) + 1) % lines.length)];
        this.audio.play('intercom_chime', { bus: 'ui' });
        this.say(line, { voice: 'intercom', category: 'narration' });
      }
    }
  }

  speechHoldsClock(category) {
    if (!HOLD_CATEGORIES.has(category)) return false;
    return category !== 'desc' || this.settings.pauseClockForDescriptions !== false;
  }

  announceTime(a) {
    if (a.countdown) {
      this.say(String(a.at), { priority: 'urgent', category: 'alert', record: false });
      return;
    }
    this.audio.play('intercom_chime', { bus: 'ui' });
    this.say(fill(this.data.story.timeWarning, { time: formatDuration(this.clock.remaining) }), { priority: 'urgent', voice: 'intercom', category: 'alert' });
  }

  // ---------------------------------------------------------------- input

  onInput(inp) {
    const a = inp.action;
    if (this.ended) {
      if (a === 'interact') this.skipNarration();
      return;
    }
    if (this.narrating) {
      if (a === 'interact') this.skipNarration();
      else if (a === 'pauseHold') this.events.emit('requestPause');
      else this.audio.play('ui_hold', { bus: 'ui' });
      return;
    }
    if (a && !inp.repeat) this.events.emit('action', { name: a });
    switch (a) {
      case 'forward':
      case 'back':
        if (inp.repeat) return;
        if (this.isBusy()) this.pendingMove = a;
        else this.step(a);
        return;
      case 'turnLeft':
      case 'turnRight':
        if (inp.repeat) return;
        return this.turn(a === 'turnLeft' ? 'left' : 'right');
      case 'interact': return this.interact();
      case 'repeat': return this.say(this.speech.last || 'Nothing to repeat.', { priority: 'urgent', record: false });
      case 'repeatFull': return this.say(roomDescription(this, { full: true }), { priority: 'urgent', category: 'desc' });
      case 'listen': return this.say(listenText(this), { priority: 'urgent', category: 'desc' });
      case 'compass': return this.say(compassText(this), { priority: 'urgent' });
      case 'where': return this.say(whereAmI(this), { priority: 'urgent', category: 'desc' });
      case 'status': return this.say(statusText(this), { priority: 'urgent' });
      case 'time': return this.sayTime();
      case 'hint': return this.hint();
      case 'inventory': return this.openInventory();
      case 'map': return this.openMap();
      case 'fight': return this.fight();
      case 'hide': return this.toggleHide();
      case 'ping': return this.ping();
      case 'cane': return this.caneTap();
      case 'cycleMove': return this.cycleMove();
      case 'help': return this.say(this.data.story.controlsHelp.join(' '), { priority: 'urgent', category: 'desc' });
      case 'escTap':
        this.audio.play('ui_hold', { bus: 'ui' });
        return this.say('Hold Escape to pause.', { priority: 'ambient', record: false });
      case 'pauseHold': return this.events.emit('requestPause');
      case 'runHold':
      case 'sneakHold':
        return; // modifiers: feedback comes with the next step
      default:
        this.audio.play('ui_error', { bus: 'ui' });
    }
  }

  // ---------------------------------------------------------------- movement

  effectiveMode() {
    let m = this.player.moveMode;
    if (this.input?.isHeld('sneakHold')) m = 'sneak';
    else if (this.input?.isHeld('runHold')) m = 'run';
    if (m === 'run' && this.player.exhaustion > 80) {
      if (!this.flags.tooTiredSaid) this.say('Too exhausted to run. Walking.', { priority: 'normal' });
      this.flags.tooTiredSaid = true;
      return 'walk';
    }
    this.flags.tooTiredSaid = false;
    return m;
  }
  isSneaking() {
    return this.effectiveMode() === 'sneak';
  }
  moveModeWord() {
    return { walk: 'walking', sneak: 'sneaking', run: 'running' }[this.player.moveMode];
  }
  cycleMove() {
    const order = ['walk', 'sneak', 'run'];
    this.player.moveMode = order[(order.indexOf(this.player.moveMode) + 1) % 3];
    this.audio.play('ui_tick', { bus: 'ui' });
    this.say(capitalize(this.moveModeWord()) + '.', { priority: 'urgent' });
  }

  turn(which) {
    const p = this.player;
    p.facing = which === 'left' ? turnLeft(p.facing) : turnRight(p.facing);
    this.busy(COST.turn);
    this.audio.play('cane_sweep', { gain: 0.25 });
    const reach = reachables(this).filter((r) => r.side === p.facing && r.kind !== 'fixture');
    const extra = reach.length ? ` ${capitalize(reach[0].text)}.` : '';
    this.say(`${capitalize(DIR_NAME[p.facing])}.${extra}`, { priority: 'urgent', record: false });
    this.events.emit('turn', { facing: p.facing });
  }

  step(rel) {
    const p = this.player;
    if (p.hidden) {
      this.audio.play('ui_error', { bus: 'ui' });
      this.say(`You're hiding in the ${p.hidden.name}. Press E to come out.`, { priority: 'urgent' });
      return;
    }
    const dir = rel === 'forward' ? p.facing : OPP[p.facing];
    const res = this.world.tryStep(p.room, p.x, p.y, dir);
    const mode = this.effectiveMode();
    switch (res.type) {
      case 'move': return this.moveTo(res.room, res.x, res.y, mode);
      case 'blocked': return this.bumpInto(res.thing.name, rel, res);
      case 'wall': return this.bumpInto(this.world.room(p.room).zone === 'forest' ? 'thick trees' : 'wall', rel, null);
      case 'door': return this.walkIntoDoor(res, mode);
      case 'exit': return this.exitReached();
      default: return undefined;
    }
  }

  moveTo(room, x, y, mode) {
    const p = this.player;
    const prevRoom = p.room;
    p.room = room;
    p.x = x;
    p.y = y;
    let dur = COST.step[mode];
    if (p.exhaustion > 70) dur *= 1.2;
    this.busy(dur);
    const r = this.world.room(room);
    const pos = this.world.worldPos(room, x, y);
    this.soundscape.footstep(r.surface, mode, pos);
    this.noise(MODE_NOISE[mode] * (SURFACE_NOISE[r.surface] || 1), p, 'player');
    p.exhaustion = Math.min(100, Math.max(0, p.exhaustion + (mode === 'run' ? 2.5 : mode === 'sneak' ? -0.6 : -0.5)));
    // The cane taps whatever is directly ahead, so walls never come as a surprise.
    if (p.inventory.cane && this.world.tryStep(room, x, y, p.facing).type !== 'move') {
      const ahead = this.world.worldPos(room, x + DVEC[p.facing][0] * 0.8, y + DVEC[p.facing][1] * 0.8);
      this.audio.play('cane_tap', { pos: ahead, gain: 0.35 });
    }
    if (room !== prevRoom) this.enterRoom(room, { from: prevRoom });
    else this.announceReach();
    this.events.emit('moved', { room, x, y });
  }

  bumpInto(name, rel, res) {
    const p = this.player;
    this.busy(0.25);
    const where = rel === 'forward' ? 'ahead' : 'behind you';
    if (p.inventory.cane && rel === 'forward') {
      const pos = res ? this.world.worldPos(p.room, res.x, res.y) : this.world.worldPos(p.room, p.x + DVEC[p.facing][0] * 0.8, p.y + DVEC[p.facing][1] * 0.8);
      this.audio.play('cane_wall', { pos });
      this.say(`Cane: ${name}, ${where}.`, { priority: 'urgent', record: false });
    } else {
      this.audio.play('bump');
      this.noise(3, p, 'player');
      this.say(`You bump into ${name === 'wall' || name === 'thick trees' ? name : withArticle(name)}.`, { priority: 'urgent', record: false });
    }
  }

  walkIntoDoor(res, mode) {
    const door = res.door;
    if (!this.world.doorBlocksPlayer(door) && (door.kind === 'passage' || door.state === 'open')) {
      return this.moveTo(res.dest.room, res.dest.x, res.dest.y, mode);
    }
    if (this.world.doorBlocksPlayer(door)) {
      const lock = this.world.lockFor(door);
      if (lock?.kind === 'power' && door.powered && !door.jammed && !door.barricaded) {
        this.unlockDoor(door, 'Power is on. The door unlocks.');
        return;
      }
      this.audio.play('door_locked');
      this.noise(2, this.player, 'player');
      this.say(`The door is ${doorStateWords(this.world, door)}. Press Enter to try it.`, { priority: 'urgent' });
      return;
    }
    this.openDoor(door);
  }

  openDoor(door) {
    const p = this.player;
    door.state = 'open';
    this.world.invalidate();
    this.busy(COST.doorOpen);
    this.soundscape.doorSound(door, door.exterior ? 'door_heavy' : 'door_open', p.room);
    this.noise(4, p, 'player');
    this.say(door.exterior ? 'The heavy outside door groans open. Cold air rushes in.' : 'The door swings open.', { priority: 'urgent', record: false });
    this.events.emit('doorOpened', { door: door.id });
  }

  closeDoor(door) {
    door.state = 'closed';
    this.world.invalidate();
    this.busy(COST.doorClose);
    this.soundscape.doorSound(door, 'door_close', this.player.room);
    this.noise(3, this.player, 'player');
    this.say('You close the door.', { priority: 'urgent', record: false });
  }

  unlockDoor(door, text) {
    door.unlocked = true;
    this.world.invalidate();
    this.audio.play('door_unlock');
    this.stats.puzzles++;
    this.difficulty.onProgress('lock');
    this.say(text || 'The lock clicks open.', { priority: 'urgent' });
    this.events.emit('unlocked', { door: door.id, lock: door.lock });
  }

  enterRoom(id, { from = null, force = false } = {}) {
    const first = !this.visited.has(id);
    this.visited.add(id);
    const room = this.world.room(id);
    const floorChange = from ? this.world.room(from).floor !== room.floor : force;
    const text = roomDescription(this, { full: first || force, floorChange });
    this.say(text, { priority: 'urgent', category: 'desc' });
    this.lastReach = new Set(reachables(this).map((r) => r.key));
    const near = this.zombies.alive.filter((z) => z.room === id);
    if (near.length && !force) {
      this.audio.play('ui_alert', { bus: 'alerts' });
      this.say(`Careful. ${capitalize(near[0].def.signature)}, in this room.`, { priority: 'normal' });
    }
    const dists = this.world.roomDistances(id);
    if (!this.zombies.alive.some((z) => (dists.get(z.room)?.hops ?? 99) <= 1)) this.player.lastSafeRoom = id;
    if (first) this.difficulty.onProgress('room');
    this.events.emit('enterRoom', { room: id, templateId: room.templateId, first, zone: room.zone });
  }

  announceReach() {
    const reach = reachables(this);
    const keys = new Set(reach.map((r) => r.key));
    const fresh = reach.filter((r) => !this.lastReach.has(r.key));
    this.lastReach = keys;
    if (!fresh.length) return;
    this.say(`${capitalize(fresh.map((r) => r.text).join('; '))}.`, { priority: 'normal', category: 'reach', replace: true });
  }

  exitReached() {
    if (this.encounter) {
      this.say('You have to shake it off first!', { priority: 'urgent' });
      return;
    }
    if (this.mode === 'tutorial') {
      this.events.emit('exit', {});
      return;
    }
    const inv = this.player.inventory;
    const allLogs = this.facility.logs.every((id) => this.player.logsHeard.includes(id));
    const explored = this.visited.size / this.facility.rooms.length;
    let kind = inv.cure ? 'win' : 'partial';
    if (inv.cure && allLogs && explored >= 0.9) kind = 'secret';
    this.finish(kind);
  }

  // ---------------------------------------------------------------- noise

  noise(level, pos, source = 'player', from = null) {
    this.noiseEvents.push({ room: pos.room, x: pos.x, y: pos.y, level, source, from });
    if (source !== 'player') return;
    this.playerNoise = Math.max(this.playerNoise, level);
    const w = this.noiseWord();
    if (w === 'loud' && this.lastNoiseWord !== 'loud' && this.settings.announceNoise) {
      this.audio.play('ui_loud', { bus: 'alerts', gain: 0.6 });
      this.say('Loud.', { priority: 'normal', record: false });
      this.lastNoiseWord = 'loud';
    }
  }
  noiseWord() {
    if (this.playerNoise < 2.5) return 'quiet';
    if (this.playerNoise < 5.5) return 'moderate';
    return 'loud';
  }

  // ---------------------------------------------------------------- interaction

  interact() {
    const p = this.player;
    if (this.isBusy()) {
      this.audio.play('ui_hold', { bus: 'ui' });
      return;
    }
    if (p.hidden) {
      this.say(`You're inside the ${p.hidden.name}. Press E to come out.`, { priority: 'urgent' });
      return;
    }
    const reach = reachables(this);
    const pick = reach.find((r) => r.side === p.facing) || reach.find((r) => r.kind === 'door' || r.kind === 'exit')
      || reach.find((r) => r.kind === 'fixture' && r.fixture.type !== 'scenery') || reach[0];
    if (!pick) {
      this.audio.play('ui_error', { bus: 'ui' });
      this.say('Nothing within reach. Walk until something is announced, or press Q.', { priority: 'urgent', record: false });
      return;
    }
    if (pick.kind === 'exit') return this.exitReached();
    if (pick.kind === 'door') return this.interactDoor(pick.door);
    return this.interactFixture(pick.fixture);
  }

  interactDoor(door) {
    const p = this.player;
    const lock = this.world.lockFor(door);
    if (door.kind === 'passage') {
      this.say('An open path. Just walk through.', { priority: 'urgent' });
      return;
    }
    if (door.barricaded) {
      door.barricaded = false;
      this.world.invalidate();
      this.addItem('wedge', 1, true);
      this.audio.play('barricade');
      this.say('You pull the wedge out from under the door.', { priority: 'urgent' });
      return;
    }
    if (door.jammed) {
      if (p.inventory.crowbar) {
        this.busy(COST.pry);
        this.soundscape.doorSound(door, 'door_pry', p.room);
        this.noise(7, p, 'player');
        this.say('You jam the crowbar in and heave. Metal screeches...', { priority: 'urgent' });
        this.after(COST.pry, () => {
          door.jammed = false;
          door.state = 'open';
          this.world.invalidate();
          this.say('The door bursts open.', { priority: 'urgent' });
        });
      } else {
        this.audio.play('door_locked');
        this.say('The door is jammed in its frame. A crowbar could pry it open.', { priority: 'urgent' });
      }
      return;
    }
    if (this.world.isLocked(door)) {
      if (lock.kind === 'keycard') {
        if (p.inventory[lock.item]) {
          this.busy(COST.keycardSwipe);
          this.audio.play('card_swipe');
          this.after(COST.keycardSwipe * 0.6, () => this.unlockDoor(door, `You swipe the ${lock.color} keycard. The reader chirps and the lock clicks open.`));
        } else {
          this.audio.play('door_locked');
          this.say(`Locked. A ${lock.color} card reader. You need the ${lock.color} keycard.`, { priority: 'urgent' });
        }
        return;
      }
      if (lock.kind === 'power') {
        if (door.powered) this.unlockDoor(door, 'Power is on. The door unlocks.');
        else {
          this.audio.play('door_locked');
          this.say('The door panel is dark and silent. No power. A breaker somewhere must feed this door.', { priority: 'urgent' });
        }
        return;
      }
      openLockPuzzle(this, lock, door);
      return;
    }
    if (door.state === 'open') this.closeDoor(door);
    else this.openDoor(door);
  }

  interactFixture(f) {
    const p = this.player;
    const room = this.world.room(p.room);
    switch (f.type) {
      case 'container': return this.search(f);
      case 'hide':
        this.say(`${capitalize(withArticle(f.name))}. Press E to hide inside.`, { priority: 'urgent' });
        return;
      case 'scenery':
        this.say(f.text || `${capitalize(withArticle(f.name))}.`, { priority: 'urgent' });
        return;
      default:
        interactFeature(this, room, f);
    }
  }

  search(f) {
    const p = this.player;
    if (f.searched) {
      this.say(`You already searched the ${f.name}. It's empty now.`, { priority: 'urgent' });
      return;
    }
    this.busy(COST.search);
    const room = this.world.room(p.room);
    this.soundscape.playAt('search', room.id, f.x, f.y);
    this.noise(2, p, 'player');
    this.say(`You search the ${f.name}...`, { priority: 'urgent', record: false });
    this.after(COST.search, () => {
      f.searched = true;
      const items = f.items.splice(0);
      if (!items.length) {
        this.say(`Nothing useful in the ${f.name}.`, { priority: 'normal' });
      } else {
        const names = [];
        for (const id of items) {
          this.addItem(id, 1, true);
          names.push(id === 'cure' ? 'the antibody sample! A cold metal case labeled A-23. This is the cure' : withArticle(this.itemName(id)));
        }
        this.audio.play('ui_pickup', { bus: 'ui' });
        this.say(`You find ${listWords(names)}.`, { priority: 'normal' });
      }
      this.events.emit('search', { fixture: f.uid, items });
    });
  }

  itemName(id, n = 1) {
    const it = this.data.itemById.get(id);
    if (!it) return id;
    return n > 1 && it.plural ? it.plural : it.name;
  }

  addItem(id, n = 1, quiet = false) {
    const inv = this.player.inventory;
    inv[id] = (inv[id] || 0) + n;
    this.stats.items += n;
    const it = this.data.itemById.get(id);
    if (it && (it.kind === 'keycard' || it.kind === 'key' || it.kind === 'quest')) this.difficulty.onProgress('item');
    if (!quiet) this.say(`Got ${withArticle(this.itemName(id))}.`, { priority: 'normal' });
    this.events.emit('item', { id, n });
  }

  removeItem(id, n = 1) {
    const inv = this.player.inventory;
    inv[id] = Math.max(0, (inv[id] || 0) - n);
    if (!inv[id]) delete inv[id];
  }

  // ---------------------------------------------------------------- senses

  ping() {
    if (this.isBusy()) return this.audio.play('ui_hold', { bus: 'ui' });
    this.busy(COST.ping);
    const results = playPing(this);
    this.noise(4, this.player, 'player');
    if (this.settings.pingSpeech) {
      const room = this.world.room(this.player.room);
      this.after(0.7, () => this.say(pingSummary(results, room), { priority: 'urgent', record: true }));
    }
    return results;
  }

  caneTap() {
    const p = this.player;
    if (!p.inventory.cane) {
      this.audio.play('ui_error', { bus: 'ui' });
      return this.say("You don't have your cane.", { priority: 'urgent' });
    }
    this.busy(COST.caneTap);
    const r = scanDirection(this.world, p.room, p.x, p.y, p.facing);
    for (let i = 1; i < Math.min(r.dist, 6); i++) {
      const pos = this.world.worldPos(p.room, p.x + DVEC[p.facing][0] * i, p.y + DVEC[p.facing][1] * i);
      this.audio.play('cane_tap', { pos, delay: i * 0.12, gain: 0.4 });
    }
    this.audio.play(r.kind === 'opening' ? 'cane_sweep' : 'cane_wall', { pos: this.world.worldPos(p.room, r.x, r.y), delay: Math.min(r.dist, 6) * 0.12 });
    this.noise(1, p, 'player');
    const text = r.dist === 1 ? `${capitalize(r.name)}, right in front of you.` : `Clear for ${plural(r.dist - 1, 'step')}, then ${r.name}.`;
    this.say(text, { priority: 'urgent' });
  }

  sayTime() {
    this.audio.play('ui_time', { bus: 'ui' });
    if (this.mode === 'tutorial') return this.say('The clock is stopped in the practice room. In a real game you would hear how long is left before sterilization.', { priority: 'urgent' });
    return this.say(`${formatDuration(this.clock.remaining)} remaining.`, { priority: 'urgent' });
  }

  hint() {
    const obj = nextObjective(this);
    const key = obj.type + (obj.lock ? `:${obj.lock.id}` : '');
    const level = Math.min(3, (this.hintLevels[key] || 0) + 1);
    this.hintLevels[key] = level;
    let text;
    if (this.encounter) text = `${this.encounter.zombie.def.name}s ${this.encounter.zombie.def.chaseSpeed < 1.5 ? 'are slow, so walking away works' : 'are fast, so fight or hide'}. F fights, E hides if a hiding spot is in reach.`;
    else text = hintText(this, level);
    this.stats.hints++;
    this.audio.play('ui_hint', { bus: 'ui' });
    if (this.mode !== 'tutorial') {
      this.clock.penalize(this.difficulty.hintCost);
      this.say(`Hint. ${text} That hint cost ${this.difficulty.hintCost} seconds.`, { priority: 'urgent' });
    } else {
      this.say(`Hint. ${text} In a real game, hints cost a few seconds.`, { priority: 'urgent' });
    }
    this.difficulty.stuckFor = 0;
    this.events.emit('hint', { level, objective: obj.type });
  }

  openInventory() {
    this.stack.push(new InventoryMenu(this));
  }
  openMap() {
    this.stack.push(new MapView(this));
  }

  /** Close menus, puzzles and dialogs sitting on top of the game (e.g. when grabbed). */
  closeOverlays() {
    while (this.stack && this.stack.top && this.stack.top !== this && this.stack.top.gameOverlay) this.stack.pop();
  }

  // ---------------------------------------------------------------- encounters

  onZombieChase(z) {
    const hop = this.world.roomDistances(this.player.room).get(z.room)?.hops ?? 99;
    if (hop > 1) return;
    const here = this.world.worldPos(this.player.room, this.player.x, this.player.y);
    const zp = this.world.worldPos(z.room, z.x, z.y);
    this.audio.play('ui_alert', { bus: 'alerts' });
    this.say(`${z.def.name} heard you! ${capitalize(relativeWords(Math.round(zp.x - here.x), Math.round(zp.y - here.y), this.player.facing))}.`, { priority: 'urgent', record: false });
    this.events.emit('chase', { zombie: z.id, type: z.type });
  }

  /** A zombie that was searching for the player stops. Tell a hidden player it is safer now. */
  onZombieGaveUp(z) {
    const p = this.player;
    if (!p.hidden || this.ended) return;
    const hop = this.world.roomDistances(p.room).get(z.room)?.hops ?? 99;
    if (hop > 1) return;
    this.say(`The ${z.def.name} loses interest and wanders off.`, { priority: 'normal', record: false });
    this.events.emit('zombieGaveUp', { zombie: z.id, type: z.type });
  }

  announceScream(z) {
    this.say('A Screamer wails! Others will come running.', { priority: 'urgent' });
  }

  engage(z) {
    if (this.encounter || this.ended) return;
    this.closeOverlays();
    this.encounter = { zombie: z, timer: this.difficulty.windowSec, startHealth: this.player.health };
    const here = this.world.worldPos(this.player.room, this.player.x, this.player.y);
    const zp = this.world.worldPos(z.room, z.x, z.y);
    const dirWords = relativeWords(Math.round(zp.x - here.x), Math.round(zp.y - here.y), this.player.facing);
    this.audio.play('z_attack', { pos: zp, bus: 'alerts' });
    this.say(`${z.def.name} grabs at you, ${dirWords}! F to fight, E to hide, or walk away.`, { priority: 'urgent' });
    this.events.emit('encounter', { zombie: z.id, type: z.type });
  }

  adjacentZombie() {
    return this.zombies.alive.find((z) => this.zombies.adjacentToPlayer(z));
  }

  updateEncounter(dt) {
    const e = this.encounter;
    if (!e) return;
    const z = e.zombie;
    if (z.dead) {
      this.encounter = null;
      return;
    }
    if (!this.zombies.adjacentToPlayer(z) || this.player.hidden) {
      this.encounter = null;
      z.stunned = Math.max(z.stunned, 0.8);
      if (!this.player.hidden) this.say('You pull free!', { priority: 'urgent', record: false });
      if (this.player.health < 40) this.difficulty.onNearMiss();
      this.events.emit('escaped', { zombie: z.id });
      return;
    }
    if (z.stunned > 0) return;
    e.timer -= dt;
    if (e.timer <= 0) {
      e.timer = this.difficulty.windowSec;
      this.zombieAttack(z);
    }
  }

  zombieAttack(z) {
    const p = this.player;
    const zp = this.world.worldPos(z.room, z.x, z.y);
    this.audio.play('z_attack', { pos: zp, bus: 'alerts' });
    if (z.def.harmless) {
      this.say('The dummy bumps into you harmlessly. Press F to fight it.', { priority: 'urgent' });
      return;
    }
    const dmg = Math.round(z.def.damage * this.difficulty.damageMult);
    p.health -= dmg;
    this.audio.play('hurt');
    this.difficulty.onDamage();
    if (p.health <= 0) {
      this.downed(z);
      return;
    }
    this.say(`It bites you! Health ${Math.round(p.health)}.`, { priority: 'urgent' });
    this.events.emit('damage', { amount: dmg, health: p.health });
  }

  fight() {
    if (this.isBusy()) return this.audio.play('ui_hold', { bus: 'ui' });
    const p = this.player;
    if (p.hidden) return this.say('Come out of hiding first. Press E.', { priority: 'urgent' });
    let z = this.encounter?.zombie;
    if (!z) {
      z = this.adjacentZombie();
      if (!z) {
        this.audio.play('swing', { gain: 0.6 });
        this.audio.play('ui_error', { bus: 'ui' });
        return this.say('Nothing within reach to fight.', { priority: 'urgent', record: false });
      }
      this.encounter = { zombie: z, timer: this.difficulty.windowSec, startHealth: p.health };
    }
    this.stats.fights++;
    this.busy(COST.fightRound);
    this.audio.play('swing');
    this.noise(7, p, 'player');
    p.exhaustion = Math.min(100, p.exhaustion + 6);
    const crowbar = !!p.inventory.crowbar;
    let chance = 0.5 + (crowbar ? 0.2 : 0) + Math.min(0.15, p.skill * 0.03) + (this.assist ? 0.15 : 0);
    chance -= z.def.armor * (crowbar ? 0.5 : 1);
    if (p.exhaustion > 70) chance -= 0.15;
    if (z.def.harmless) chance = 1;
    const zp = this.world.worldPos(z.room, z.x, z.y);
    if (this.rng.chance(chance)) {
      z.hp -= crowbar ? 2 : 1;
      this.audio.play('z_hit', { pos: zp });
      if (z.hp <= 0) {
        this.zombies.kill(z);
        this.encounter = null;
        p.skill++;
        this.stats.kills++;
        this.audio.play('z_die', { pos: zp });
        this.say(`The ${z.def.name} collapses and goes still.`, { priority: 'urgent' });
        this.events.emit('zombieKilled', { zombie: z.id, type: z.type });
        return;
      }
      z.stunned = 1.2;
      if (this.encounter) this.encounter.timer = this.difficulty.windowSec;
      this.say(crowbar ? 'Your crowbar connects! It staggers.' : 'You shove it hard. It staggers.', { priority: 'urgent', record: false });
    } else {
      if (this.encounter) this.encounter.timer = Math.min(this.encounter.timer, 0.6);
      this.say('You miss!', { priority: 'urgent', record: false });
    }
  }

  toggleHide() {
    const p = this.player;
    if (p.hidden) {
      const fx = p.hidden;
      p.hidden = null;
      this.audio.play('hide_out');
      this.say(`You step out of the ${fx.name}.`, { priority: 'urgent' });
      this.events.emit('unhide', {});
      return;
    }
    const spot = reachables(this).find((r) => r.kind === 'fixture' && r.fixture.type === 'hide');
    if (!spot) {
      this.audio.play('ui_error', { bus: 'ui' });
      this.say('Nothing to hide in within reach.', { priority: 'urgent', record: false });
      return;
    }
    if (this.encounter && !this.encounter.zombie.def.harmless) {
      const chance = this.assist ? 0.75 : 0.45;
      if (!this.rng.chance(chance)) {
        this.encounter.timer -= 1;
        this.say("It's too close! You can't get inside.", { priority: 'urgent' });
        return;
      }
    }
    p.hidden = spot.fixture;
    this.busy(COST.hide);
    this.audio.play('hide_in');
    this.noise(1, p, 'player');
    if (this.encounter) this.encounter = null;
    for (const z of this.zombies.alive) {
      if (z.state === 'chase') {
        z.state = 'investigate';
        z.target = { room: p.room, x: p.x, y: p.y };
        z.path = null;
        z.linger = 3;
      }
    }
    this.say(`You hide in the ${spot.fixture.name}. Stay still and quiet. Press E to come out.`, { priority: 'urgent' });
    this.events.emit('hide', {});
  }

  downed(z) {
    const p = this.player;
    this.encounter = null;
    this.stats.deaths++;
    this.difficulty.onDeath();
    p.infection++;
    this.events.emit('death', { zombie: z.type, infection: p.infection });
    if (p.infection >= p.maxInfection) {
      this.finish('infected');
      return;
    }
    this.clock.penalize(COST.downedPenalty);
    z.state = 'idle';
    z.target = null;
    z.path = null;
    const home = this.world.randomFloorTile(z.home, this.rng);
    if (home && z.home !== p.lastSafeRoom) {
      z.room = z.home;
      z.x = home.x;
      z.y = home.y;
    } else {
      z.stunned = 8;
    }
    const safe = this.world.room(p.lastSafeRoom);
    const t = this.world.randomFloorTile(safe.id, this.rng);
    p.room = safe.id;
    p.x = t.x;
    p.y = t.y;
    p.health = 60;
    p.exhaustion = 30;
    p.hidden = null;
    const lines = this.data.story.downed.map((l) => fill(l, { room: safe.name, infection: p.infection, max: p.maxInfection }));
    this.audio.play('heartbeat', { bus: 'alerts' });
    this.narrate(lines, () => this.enterRoom(p.room, { force: true }));
  }

  // ---------------------------------------------------------------- endings

  finish(kind) {
    if (this.ended) return;
    this.ended = true;
    this.encounter = null;
    this.closeOverlays();
    this.soundscape.stopAll();
    this.speech.stop();
    if (kind === 'sterilized') this.audio.play('thunder');
    else if (kind !== 'infected') this.audio.play('ui_success', { bus: 'ui' });
    const summary = this.summary(kind);
    this.events.emit('ending', summary);
    const lines = this.data.story.endings[kind] || [];
    this.narrating = true;
    lines.forEach((l, i) => this.speech.say(l, {
      category: 'narration',
      onEnd: i === lines.length - 1 ? () => {
        this.narrating = false;
        this.events.emit('endingDone', summary);
      } : undefined,
    }));
  }

  summary(kind) {
    return {
      kind,
      won: ['win', 'partial', 'secret'].includes(kind),
      remaining: Math.round(this.clock.remaining),
      elapsed: Math.round(this.clock.elapsed),
      roomsVisited: this.visited.size,
      totalRooms: this.facility.rooms.length,
      logsHeard: this.player.logsHeard.length,
      totalLogs: this.facility.logs.length,
      cure: !!this.player.inventory.cure,
      ...this.stats,
    };
  }

  // ---------------------------------------------------------------- save

  serialize() {
    const p = this.player;
    return {
      v: 1,
      seedIndex: this.facility.seedIndex,
      lengthMin: this.facility.lengthMin,
      code: this.facility.code,
      savedAt: new Date().toISOString(),
      clock: this.clock.toJSON(),
      announcer: this.announcer.toJSON(),
      difficulty: this.difficulty.toJSON(),
      player: { ...p, hidden: p.hidden?.uid || null },
      world: this.world.serialize(),
      zombies: this.zombies.serialize(),
      visited: [...this.visited],
      flags: this.flags,
      stats: this.stats,
      hintLevels: this.hintLevels,
    };
  }

  restore(s) {
    this.world.restore(s.world);
    const hiddenUid = s.player.hidden;
    Object.assign(this.player, s.player, { hidden: null });
    if (hiddenUid) this.player.hidden = this.world.fixtureByUid(hiddenUid)?.fixture || null;
    this.visited = new Set(s.visited || []);
    this.flags = s.flags || {};
    this.stats = { ...this.stats, ...s.stats };
    this.hintLevels = s.hintLevels || {};
  }
}

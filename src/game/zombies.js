// Zombie AI: idle wandering, investigating noises, chasing, opening doors,
// and Screamers calling others. Each type has its own hearing, speed and voice.

import { Rng } from '../core/rng.js';

export class ZombieSystem {
  constructor(game, list, rngSeed = 1) {
    this.game = game;
    this.rng = new Rng(rngSeed);
    this.list = list.map((z) => this.make(z));
  }

  make(z) {
    const def = this.game.data.zombieById.get(z.type);
    return {
      id: z.id, type: z.type, def,
      room: z.room, x: z.x, y: z.y,
      home: z.home || z.room,
      hp: z.hp ?? def.hp,
      state: z.state || 'idle',
      target: z.target || null,
      path: null,
      stepAcc: 0,
      vocal: this.rng.range(1, def.vocalEvery[1]),
      idleTimer: this.rng.range(2, 6),
      linger: 0,
      doorWait: 0,
      stunned: 0,
      screamCooldown: 0,
      lostTimer: 0,
      lured: z.lured || false,
      dead: z.dead || false,
    };
  }

  get alive() {
    return this.list.filter((z) => !z.dead);
  }

  /** Zombies the player could plausibly hear (within three rooms). */
  audible() {
    const d = this.game.world.roomDistances(this.game.player.room);
    return this.alive.filter((z) => (d.get(z.room)?.hops ?? 99) <= 2);
  }

  adjacentToPlayer(z) {
    const p = this.game.player;
    if (z.room === p.room) return Math.abs(z.x - p.x) + Math.abs(z.y - p.y) === 1;
    // Across a doorway: both standing in the matching door tiles of an open door.
    const w = this.game.world;
    for (const s of w.sidesAt(p.room, p.x, p.y)) {
      const door = w.doorOn(p.room, s);
      if (!door || (door.kind !== 'passage' && door.state !== 'open')) continue;
      if (w.otherRoom(door, p.room) !== z.room) continue;
      const res = w.tryStep(p.room, p.x, p.y, s);
      if (res.type === 'door' && res.dest.x === z.x && res.dest.y === z.y) return true;
    }
    return false;
  }

  distanceTo(z, pos) {
    const w = this.game.world;
    const a = w.worldPos(z.room, z.x, z.y);
    const b = w.worldPos(pos.room, pos.x, pos.y);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  hears(z, n) {
    const w = this.game.world;
    const hop = w.roomDistances(n.room).get(z.room);
    if (!hop || hop.hops > 4) return false;
    const range = z.def.hearing * this.game.difficulty.hearingMult * (n.level / 4) - hop.hops * 1.5 - hop.closed * 2.5;
    return this.distanceTo(z, n) <= range;
  }

  canPass(z) {
    return (door) => {
      if (door.barricaded || door.jammed) return false;
      if (this.game.world.isLocked(door)) return false;
      if (door.kind === 'passage' || door.state === 'open') return true;
      return z.def.opensDoors;
    };
  }

  setTarget(z, pos, state) {
    z.state = state;
    if (!z.target || z.target.room !== pos.room || z.target.x !== pos.x || z.target.y !== pos.y) {
      z.target = { room: pos.room, x: pos.x, y: pos.y };
      z.path = null;
    }
  }

  update(dt, noises) {
    const g = this.game;
    const p = g.player;
    for (const z of this.list) {
      if (z.dead) continue;
      z.screamCooldown = Math.max(0, z.screamCooldown - dt);
      z.vocal -= dt;
      if (z.vocal <= 0) {
        g.soundscape.zombieVoice(z);
        const [a, b] = z.def.vocalEvery;
        z.vocal = this.rng.range(a, b) * (z.state === 'chase' ? 0.5 : 1);
      }
      if (z.stunned > 0) {
        z.stunned -= dt;
        continue;
      }
      if (g.encounter?.zombie === z) continue; // grappling

      // Hearing.
      for (const n of noises) {
        if (n.source === 'zombie' && n.from === z) continue;
        if (!this.hears(z, n)) continue;
        if (n.source === 'lure') {
          z.lured = true;
          this.setTarget(z, n, 'investigate');
        } else if (n.source === 'player' && !p.hidden && this.distanceTo(z, n) <= 4 && z.room === n.room) {
          this.startChase(z);
        } else if (z.state !== 'chase' && !(z.lured && n.source !== 'lure')) {
          this.setTarget(z, n, 'investigate');
        }
      }

      // Close-range sensing: same room and near, unless hidden or sneaking carefully.
      if (z.state !== 'chase' && !p.hidden && z.room === p.room) {
        const d = this.distanceTo(z, p);
        const sense = g.isSneaking() ? 1.5 : 3;
        if (d <= sense) this.startChase(z);
      }

      if (z.state === 'chase') {
        if (p.hidden && !this.adjacentToPlayer(z)) {
          z.state = 'investigate';
          z.linger = 4;
        } else {
          const hop = g.world.roomDistances(p.room).get(z.room)?.hops ?? 99;
          if (hop > 2) z.lostTimer += dt;
          else z.lostTimer = 0;
          if (z.lostTimer > 6) {
            z.state = 'investigate';
            z.lostTimer = 0;
          } else {
            this.setTarget(z, p, 'chase');
          }
        }
      }

      // Engage when adjacent.
      if (z.state === 'chase' && !p.hidden && this.adjacentToPlayer(z)) {
        g.engage(z);
        continue;
      }

      this.move(z, dt);
    }
  }

  startChase(z) {
    const g = this.game;
    if (z.state === 'chase') return;
    z.state = 'chase';
    z.lured = false;
    z.lostTimer = 0;
    g.onZombieChase(z);
    if (z.def.screams && z.screamCooldown <= 0) {
      z.screamCooldown = 20;
      g.soundscape.zombieVoice(z, true);
      g.noise(14, { room: z.room, x: z.x, y: z.y }, 'zombie', z);
      g.announceScream(z);
    }
  }

  move(z, dt) {
    const g = this.game;
    const mult = g.difficulty.zombieSpeedMult;
    let speed = z.def.speed * mult;
    if (z.state === 'chase') speed = z.def.chaseSpeed * mult;
    else if (z.state === 'idle') speed *= 0.5;

    if (z.state === 'idle') {
      z.idleTimer -= dt;
      if (z.idleTimer <= 0 && (!z.path || !z.path.length)) {
        z.idleTimer = this.rng.range(3, 8);
        const t = g.world.randomFloorTile(z.home, this.rng);
        if (t) z.target = { room: z.home, x: t.x, y: t.y };
        z.path = null;
      }
    }
    if (!z.target) return;
    if (z.room === z.target.room && z.x === z.target.x && z.y === z.target.y) {
      if (z.state === 'investigate') {
        z.linger -= dt;
        if (z.linger <= 0) {
          z.state = 'idle';
          z.lured = false;
          z.target = null;
          z.linger = 0;
        }
      }
      return;
    }
    if (z.state === 'investigate' && z.linger <= 0) z.linger = this.rng.range(3, 6);

    if (!z.path) {
      z.path = g.world.tilePath(z, z.target, this.canPass(z));
      if (!z.path) {
        // Can't get there (closed door for a Crawler, locked door...). Give up.
        z.target = null;
        z.state = z.state === 'chase' ? 'investigate' : 'idle';
        return;
      }
    }
    if (z.doorWait > 0) {
      z.doorWait -= dt;
      if (z.doorWait <= 0 && z.pendingDoor) {
        z.pendingDoor.state = 'open';
        g.world.invalidate();
        g.soundscape.doorSound(z.pendingDoor, 'door_open', z.room);
        z.pendingDoor = null;
      }
      return;
    }
    z.stepAcc += dt * speed;
    while (z.stepAcc >= 1 && z.path && z.path.length) {
      z.stepAcc -= 1;
      const next = z.path[0];
      // Never walk into the player's tile; adjacency triggers the encounter instead.
      if (next.room === g.player.room && next.x === g.player.x && next.y === g.player.y) {
        z.stepAcc = 0;
        break;
      }
      if (next.door && next.door.kind !== 'passage' && next.door.state !== 'open') {
        if (!this.canPass(z)(next.door)) {
          z.path = null;
          break;
        }
        z.doorWait = z.def.doorTime;
        z.pendingDoor = next.door;
        z.stepAcc = 0;
        break;
      }
      if (next.door && !this.canPass(z)(next.door)) {
        z.path = null;
        break;
      }
      z.path.shift();
      z.room = next.room;
      z.x = next.x;
      z.y = next.y;
      g.soundscape.zombieStep(z);
    }
  }

  kill(z) {
    z.dead = true;
    z.state = 'dead';
  }

  serialize() {
    return this.list.map((z) => ({
      id: z.id, type: z.type, room: z.room, x: z.x, y: z.y, home: z.home, hp: z.hp,
      state: z.state === 'chase' ? 'investigate' : z.state, target: z.target, lured: z.lured, dead: z.dead,
    }));
  }
}

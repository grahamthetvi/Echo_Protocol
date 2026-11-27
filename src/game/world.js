// Runtime world: the generated facility plus everything that changes while playing
// (door states, searched containers, solved locks). Pure logic, no DOM or audio.

import { DIRS, DVEC, OPP } from '../core/dirs.js';
import { MinHeap } from '../core/heap.js';
import { doorTile } from '../generator/interior.js';

const tk = (room, x, y) => `${room}:${x},${y}`;

export class World {
  constructor(facility) {
    this.f = JSON.parse(JSON.stringify(facility)); // private, mutable copy
    this.rooms = new Map(this.f.rooms.map((r) => [r.id, r]));
    this.doors = new Map(this.f.doors.map((d) => [d.id, d]));
    this.locks = new Map(this.f.locks.map((l) => [l.id, l]));
    for (const d of this.f.doors) {
      d.unlocked = !d.lock;
      d.powered = false;
      d.barricaded = false;
    }
    for (const r of this.f.rooms) {
      for (const fx of r.fixtures) {
        fx.searched = false;
        if (fx.items) fx.items = [...fx.items];
      }
    }
    this.blockedCache = new Map();
    this._distCache = new Map();
  }

  room(id) {
    return this.rooms.get(id);
  }
  door(id) {
    return this.doors.get(id);
  }
  lockFor(door) {
    return door?.lock ? this.locks.get(door.lock) : null;
  }
  doorOn(roomId, side) {
    const r = this.room(roomId);
    return r?.doors[side] ? this.door(r.doors[side]) : null;
  }
  sideOf(door, roomId) {
    return door.a === roomId ? door.sideA : door.sideB;
  }
  otherRoom(door, roomId) {
    return door.a === roomId ? door.b : door.a;
  }
  invalidate() {
    this._distCache.clear();
  }

  blocked(roomId) {
    let s = this.blockedCache.get(roomId);
    if (!s) {
      const r = this.room(roomId);
      s = new Map();
      for (const f of r.fixtures) s.set(`${f.x},${f.y}`, { kind: 'fixture', fixture: f, name: f.name });
      for (const o of r.obstacles) s.set(`${o.x},${o.y}`, { kind: 'obstacle', name: o.name });
      this.blockedCache.set(roomId, s);
    }
    return s;
  }
  inBounds(roomId, x, y) {
    const r = this.room(roomId);
    return x >= 0 && y >= 0 && x < r.w && y < r.h;
  }
  isWalkable(roomId, x, y) {
    return this.inBounds(roomId, x, y) && !this.blocked(roomId).has(`${x},${y}`);
  }
  thingAt(roomId, x, y) {
    return this.blocked(roomId).get(`${x},${y}`) || null;
  }

  doorTile(roomId, side) {
    return doorTile(this.room(roomId), side);
  }
  /** Sides whose doorway tile is (x, y): includes the exit gap. */
  sidesAt(roomId, x, y) {
    const r = this.room(roomId);
    const out = [];
    for (const s of DIRS) {
      if (!r.doors[s] && r.exitSide !== s) continue;
      const t = doorTile(r, s);
      if (t.x === x && t.y === y) out.push(s);
    }
    return out;
  }

  isLocked(door) {
    if (!door.lock) return false;
    return !door.unlocked;
  }
  /** Can a body pass through this doorway right now (ignoring "closed but openable")? */
  doorBlocksPlayer(door) {
    return door.jammed || door.barricaded || this.isLocked(door);
  }

  /**
   * Try to step from (x, y) in absolute direction dir.
   * Returns { type: 'move'|'blocked'|'wall'|'door'|'exit', ... }
   */
  tryStep(roomId, x, y, dir) {
    const [dx, dy] = DVEC[dir];
    const nx = x + dx;
    const ny = y + dy;
    if (this.inBounds(roomId, nx, ny)) {
      const thing = this.thingAt(roomId, nx, ny);
      if (thing) return { type: 'blocked', thing, x: nx, y: ny };
      return { type: 'move', room: roomId, x: nx, y: ny };
    }
    const r = this.room(roomId);
    const t = doorTile(r, dir);
    if (t.x === x && t.y === y) {
      if (r.exitSide === dir) return { type: 'exit' };
      if (r.doors[dir]) {
        const door = this.door(r.doors[dir]);
        const other = this.otherRoom(door, roomId);
        const dest = doorTile(this.room(other), OPP[dir]);
        return { type: 'door', door, side: dir, dest: { room: other, x: dest.x, y: dest.y } };
      }
    }
    return { type: 'wall' };
  }

  worldPos(roomId, x, y) {
    const r = this.room(roomId);
    return { x: r.ox + x + 0.5, y: r.oy + y + 0.5 };
  }
  roomCenter(roomId) {
    const r = this.room(roomId);
    return { x: r.ox + r.w / 2, y: r.oy + r.h / 2 };
  }
  /** World point in the middle of a doorway on the wall. */
  doorwayPos(roomId, side) {
    const t = this.doorTile(roomId, side);
    const p = this.worldPos(roomId, t.x, t.y);
    const [dx, dy] = DVEC[side];
    return { x: p.x + dx * 0.6, y: p.y + dy * 0.6 };
  }
  exitPos() {
    return this.doorwayPos(this.f.exit.room, this.f.exit.side);
  }

  neighbors(roomId) {
    const r = this.room(roomId);
    return DIRS.filter((s) => r.doors[s]).map((s) => {
      const door = this.door(r.doors[s]);
      return { side: s, door, room: this.otherRoom(door, roomId) };
    });
  }

  /**
   * Room-level distances from a room, for sound occlusion and hearing.
   * Returns Map roomId -> { hops, closed } where `closed` counts closed doors on the best route.
   */
  roomDistances(fromRoom) {
    const cached = this._distCache.get(fromRoom);
    if (cached) return cached;
    const out = new Map([[fromRoom, { hops: 0, closed: 0 }]]);
    const heap = new MinHeap();
    heap.push(0, fromRoom);
    const score = (v) => v.hops + v.closed * 1.5;
    while (heap.size) {
      const { value: rid } = heap.pop();
      const cur = out.get(rid);
      for (const n of this.neighbors(rid)) {
        const closed = cur.closed + (n.door.kind === 'passage' || n.door.state === 'open' ? 0 : 1);
        const cand = { hops: cur.hops + 1, closed };
        const prev = out.get(n.room);
        if (!prev || score(cand) < score(prev)) {
          out.set(n.room, cand);
          heap.push(score(cand), n.room);
        }
      }
    }
    this._distCache.set(fromRoom, out);
    return out;
  }

  /** Room route ignoring or honoring locks. Returns [{room, side, door}] steps (side = exit side from room). */
  roomRoute(fromRoom, toRoom, { passLocked = true } = {}) {
    const prev = new Map([[fromRoom, null]]);
    const q = [fromRoom];
    while (q.length) {
      const r = q.shift();
      if (r === toRoom) break;
      for (const n of this.neighbors(r)) {
        if (prev.has(n.room)) continue;
        if (n.door.jammed) continue;
        if (!passLocked && (this.isLocked(n.door) || n.door.barricaded)) continue;
        prev.set(n.room, { from: r, side: n.side, door: n.door });
        q.push(n.room);
      }
    }
    if (!prev.has(toRoom)) return null;
    const steps = [];
    let cur = toRoom;
    while (prev.get(cur)) {
      const p = prev.get(cur);
      steps.unshift({ room: p.from, side: p.side, door: p.door, to: cur });
      cur = p.from;
    }
    return steps;
  }

  /**
   * Tile path for zombies. canPass(door) decides doorways. Returns [{room,x,y}] excluding start.
   * avoid ({room,x,y}) is a tile the path must not cross, such as the player's, unless it is the goal.
   */
  tilePath(from, to, canPass, maxNodes = 4000, avoid = null) {
    const startK = tk(from.room, from.x, from.y);
    const goalK = tk(to.room, to.x, to.y);
    const avoidK = avoid ? tk(avoid.room, avoid.x, avoid.y) : null;
    if (startK === goalK) return [];
    const prev = new Map([[startK, null]]);
    const q = [from];
    let n = 0;
    while (q.length && n++ < maxNodes) {
      const c = q.shift();
      const ck = tk(c.room, c.x, c.y);
      if (ck === goalK) break;
      for (const d of DIRS) {
        const res = this.tryStep(c.room, c.x, c.y, d);
        let nxt = null;
        if (res.type === 'move') nxt = { room: c.room, x: res.x, y: res.y };
        else if (res.type === 'door' && canPass(res.door)) nxt = res.dest;
        else if (res.type === 'blocked' && res.x === to.x && res.y === to.y && c.room === to.room) nxt = null;
        if (!nxt) continue;
        const nk = tk(nxt.room, nxt.x, nxt.y);
        if (prev.has(nk) || (nk === avoidK && nk !== goalK)) continue;
        prev.set(nk, { k: ck, node: c, door: res.type === 'door' ? res.door : null });
        q.push(nxt);
      }
    }
    if (!prev.has(goalK)) return null;
    const out = [];
    let cur = goalK;
    let node = to;
    while (prev.get(cur)) {
      const p = prev.get(cur);
      out.unshift({ ...node, door: p.door });
      node = p.node;
      cur = p.k;
    }
    return out.map(({ room, x, y, door }) => ({ room, x, y, door }));
  }

  randomFloorTile(roomId, rng) {
    const r = this.room(roomId);
    const tiles = [];
    for (let x = 0; x < r.w; x++) for (let y = 0; y < r.h; y++) if (this.isWalkable(roomId, x, y)) tiles.push({ x, y });
    return rng.pick(tiles);
  }

  fixtureByUid(uid) {
    for (const r of this.f.rooms) {
      const f = r.fixtures.find((x) => x.uid === uid);
      if (f) return { room: r, fixture: f };
    }
    return null;
  }

  /** Dynamic state for saving. */
  serialize() {
    return {
      doors: this.f.doors.map((d) => ({ id: d.id, state: d.state, unlocked: d.unlocked, powered: d.powered, barricaded: d.barricaded, jammed: d.jammed })),
      fixtures: this.f.rooms.flatMap((r) => r.fixtures.map((f) => ({ uid: f.uid, searched: f.searched, items: f.items, answered: f.answered }))),
    };
  }
  restore(s) {
    for (const d of s.doors || []) Object.assign(this.door(d.id), d);
    const byUid = new Map(s.fixtures?.map((f) => [f.uid, f]) || []);
    for (const r of this.f.rooms) {
      for (const f of r.fixtures) {
        const st = byUid.get(f.uid);
        if (st) Object.assign(f, st);
      }
    }
    this.invalidate();
  }
}

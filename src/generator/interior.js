// Room interiors: tile grids, door tiles, fixtures and obstacles, plus exact
// in-room movement costs (steps and turns) used by the route analysis.

import { DIRS, DVEC, OPP, turnLeft, turnRight } from '../core/dirs.js';
import { COST } from './costs.js';
import { MinHeap } from '../core/heap.js';

export const CELL = 9; // world tiles per layout cell

export function doorTile(room, side) {
  const cx = (room.w - 1) / 2;
  const cy = (room.h - 1) / 2;
  switch (side) {
    case 'N': return { x: cx, y: 0 };
    case 'S': return { x: cx, y: room.h - 1 };
    case 'W': return { x: 0, y: cy };
    case 'E': return { x: room.w - 1, y: cy };
    default: throw new Error(`bad side ${side}`);
  }
}

export function usedSides(room) {
  const s = DIRS.filter((d) => room.doors[d]);
  if (room.exitSide) s.push(room.exitSide);
  return s;
}

export const key = (x, y) => `${x},${y}`;

export function inBounds(room, x, y) {
  return x >= 0 && y >= 0 && x < room.w && y < room.h;
}

/** Set of blocked tile keys (fixtures and obstacles). */
export function blockedSet(room) {
  const s = new Set();
  for (const f of room.fixtures) s.add(key(f.x, f.y));
  for (const o of room.obstacles) s.add(key(o.x, o.y));
  return s;
}

export function walkable(room, x, y, blocked = blockedSet(room)) {
  return inBounds(room, x, y) && !blocked.has(key(x, y));
}

export function accessTiles(room, fx, blocked = blockedSet(room)) {
  const out = [];
  for (const d of DIRS) {
    const [dx, dy] = DVEC[d];
    const x = fx.x + dx;
    const y = fx.y + dy;
    if (walkable(room, x, y, blocked)) out.push({ x, y });
  }
  return out;
}

function reachableFrom(room, start, blocked) {
  const seen = new Set([key(start.x, start.y)]);
  const q = [start];
  while (q.length) {
    const c = q.shift();
    for (const d of DIRS) {
      const [dx, dy] = DVEC[d];
      const x = c.x + dx;
      const y = c.y + dy;
      const k = key(x, y);
      if (!seen.has(k) && walkable(room, x, y, blocked)) {
        seen.add(k);
        q.push({ x, y });
      }
    }
  }
  return seen;
}

/** Every door tile, reserved tile and fixture access point must be mutually reachable. */
export function interiorConnected(room, reserved = []) {
  const blocked = blockedSet(room);
  const sides = usedSides(room);
  const anchors = sides.map((s) => doorTile(room, s)).concat(reserved);
  for (const a of anchors) if (blocked.has(key(a.x, a.y))) return false;
  if (anchors.length === 0) return true;
  const seen = reachableFrom(room, anchors[0], blocked);
  for (const a of anchors) if (!seen.has(key(a.x, a.y))) return false;
  for (const f of room.fixtures) {
    if (!accessTiles(room, f, blocked).some((t) => seen.has(key(t.x, t.y)))) return false;
  }
  return true;
}

/**
 * Place fixtures on edge tiles (never on door tiles) and maybe an obstacle inside.
 * `fixtures` must already exist on room.fixtures without coordinates.
 */
export function placeInterior(room, rng, { obstacleChance = 0.3, obstacleNames = [], startNear = null } = {}) {
  const sides = usedSides(room);
  const doorKeys = new Set(sides.map((s) => {
    const t = doorTile(room, s);
    return key(t.x, t.y);
  }));
  // Tiles directly inside each door stay clear too, so doorways never feel blocked.
  for (const s of sides) {
    const t = doorTile(room, s);
    const [dx, dy] = DVEC[OPP[s]];
    doorKeys.add(key(t.x + dx, t.y + dy));
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    const edge = [];
    for (let x = 0; x < room.w; x++) {
      for (let y = 0; y < room.h; y++) {
        const onEdge = x === 0 || y === 0 || x === room.w - 1 || y === room.h - 1;
        if (onEdge && !doorKeys.has(key(x, y))) edge.push({ x, y });
      }
    }
    const corners = edge.filter((t) => (t.x === 0 || t.x === room.w - 1) && (t.y === 0 || t.y === room.h - 1));
    const others = edge.filter((t) => !corners.includes(t));
    const pool = rng.shuffle(corners).concat(rng.shuffle(others));
    if (pool.length < room.fixtures.length) return false;
    room.fixtures.forEach((f, i) => {
      f.x = pool[i].x;
      f.y = pool[i].y;
    });
    room.obstacles = [];
    const big = room.w >= 5 && room.h >= 5;
    if (big && obstacleNames.length && rng.chance(attempt < 15 ? obstacleChance : 0)) {
      const used = new Set(room.fixtures.map((f) => key(f.x, f.y)));
      const inner = [];
      for (let x = 1; x < room.w - 1; x++) {
        for (let y = 1; y < room.h - 1; y++) {
          const k = key(x, y);
          if (!doorKeys.has(k) && !used.has(k)) inner.push({ x, y });
        }
      }
      if (inner.length) {
        const t = rng.pick(inner);
        room.obstacles.push({ x: t.x, y: t.y, name: rng.pick(obstacleNames) });
      }
    }
    const reserved = [];
    if (startNear) {
      const bed = room.fixtures[startNear.fixtureIndex];
      const blocked = blockedSet(room);
      const all = accessTiles(room, bed, blocked);
      const acc = all.filter((t) => !doorKeys.has(key(t.x, t.y)));
      if (!all.length) continue;
      room.start = rng.pick(acc.length ? acc : all);
      reserved.push(room.start);
    }
    if (interiorConnected(room, reserved)) return true;
  }
  return false;
}

// ---------- In-room movement costs ----------

const stateKey = (x, y, f) => `${x},${y},${f}`;

/** Dijkstra over (x, y, facing) inside one room. Returns Map stateKey -> seconds. */
export function roomDijkstra(room, starts, blocked = blockedSet(room)) {
  const dist = new Map();
  const heap = new MinHeap();
  for (const s of starts) {
    const k = stateKey(s.x, s.y, s.f);
    dist.set(k, 0);
    heap.push(0, s);
  }
  while (heap.size) {
    const { priority: d, value: s } = heap.pop();
    if (d > (dist.get(stateKey(s.x, s.y, s.f)) ?? Infinity)) continue;
    const moves = [
      { x: s.x, y: s.y, f: turnLeft(s.f), c: COST.turn },
      { x: s.x, y: s.y, f: turnRight(s.f), c: COST.turn },
    ];
    const [dx, dy] = DVEC[s.f];
    if (walkable(room, s.x + dx, s.y + dy, blocked)) moves.push({ x: s.x + dx, y: s.y + dy, f: s.f, c: COST.step.walk });
    if (walkable(room, s.x - dx, s.y - dy, blocked)) moves.push({ x: s.x - dx, y: s.y - dy, f: s.f, c: COST.step.walk });
    for (const m of moves) {
      const k = stateKey(m.x, m.y, m.f);
      const nd = d + m.c;
      if (nd < (dist.get(k) ?? Infinity)) {
        dist.set(k, nd);
        heap.push(nd, m);
      }
    }
  }
  return dist;
}

function exitCostFrom(room, dist, side) {
  const t = doorTile(room, side);
  const d = dist.get(stateKey(t.x, t.y, side));
  return d === undefined ? Infinity : d + COST.step.walk; // the step through the doorway
}

function fixtureCostFrom(room, dist, fx, blocked) {
  let best = Infinity;
  for (const t of accessTiles(room, fx, blocked)) {
    for (const f of DIRS) {
      const d = dist.get(stateKey(t.x, t.y, f));
      if (d !== undefined && d < best) best = d;
    }
  }
  return best;
}

/**
 * Port-to-port costs for one room. Ports are: entering through each door side,
 * the start position, and standing at each listed fixture.
 * Result: { [fromPort]: { exits: {side: sec}, fixtures: {uid: sec} } }
 */
export function roomPortCosts(room, fixtureUids) {
  const blocked = blockedSet(room);
  const sides = usedSides(room);
  const fixtures = room.fixtures.filter((f) => fixtureUids.includes(f.uid));
  const result = {};

  const summarize = (dist) => {
    const exits = {};
    for (const s of sides) exits[s] = exitCostFrom(room, dist, s);
    const fx = {};
    for (const f of fixtures) fx[f.uid] = fixtureCostFrom(room, dist, f, blocked);
    return { exits, fixtures: fx };
  };

  for (const s of DIRS.filter((d) => room.doors[d])) {
    const t = doorTile(room, s);
    result[`in:${s}`] = summarize(roomDijkstra(room, [{ x: t.x, y: t.y, f: OPP[s] }], blocked));
  }
  if (room.start) {
    result.start = summarize(roomDijkstra(room, [{ x: room.start.x, y: room.start.y, f: room.startFacing }], blocked));
  }
  for (const f of fixtures) {
    // Conservative: assume the worst arrival state next to the fixture.
    const per = [];
    for (const t of accessTiles(room, f, blocked)) {
      for (const dir of DIRS) per.push(summarize(roomDijkstra(room, [{ x: t.x, y: t.y, f: dir }], blocked)));
    }
    const merged = { exits: {}, fixtures: {} };
    const worst = (vals) => {
      const finite = vals.filter(Number.isFinite);
      return finite.length ? Math.max(...finite) : Infinity;
    };
    for (const s of sides) merged.exits[s] = worst(per.map((p) => p.exits[s]));
    for (const g of fixtures) merged.fixtures[g.uid] = worst(per.map((p) => p.fixtures[g.uid]));
    result[`fx:${f.uid}`] = merged;
  }
  return result;
}

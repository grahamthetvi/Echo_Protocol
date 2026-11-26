// Seeded procedural facility generator. Pure: (seedIndex, lengthMin, data) -> facility.
// Pre-authored templates + procedural assembly; never runtime AI text.

import { Rng, hashInts } from '../core/rng.js';
import { DIRS, DVEC, OPP } from '../core/dirs.js';
import { codeFromIndex } from '../core/seedcode.js';
import { fastestRouteBudget } from './costs.js';
import { profileFor } from './profiles.js';
import { CELL, placeInterior } from './interior.js';
import { analyzeRoutes, locksCutExit } from './routes.js';

const ckey = (x, y) => `${x},${y}`;
const BUILDING = new Set(['ward', 'labs', 'maint', 'lobby']);
const KEYCARD_COLORS = ['blue', 'red', 'green', 'yellow', 'violet'];
const NOTE_DIRS = ['up', 'right', 'down', 'left'];
const KEYPAD_CLUES = ['memo', 'phone', 'recorder_beeps', 'braille', 'largeprint'];
const CLUE_FIXTURE = {
  memo: 'notice board',
  phone: 'desk phone',
  recorder_beeps: 'voice recorder',
  braille: 'shelf with a braille label',
  largeprint: 'cabinet with a large-print sign',
  melody: 'music box',
  rhythm: 'voice recorder',
  breaker: 'breaker panel',
};

export function generateFacility({ seedIndex, lengthMin, data, maxAttempts = 80 }) {
  const profile = profileFor(lengthMin);
  const budget = fastestRouteBudget(lengthMin);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = new Rng(hashInts(seedIndex, lengthMin, attempt, 0xec4023));
    const f = buildFacility(rng, profile, lengthMin, data, attempt);
    if (!f) continue;
    const routes = analyzeRoutes(f);
    if (!routes.ok) continue;
    // Fastest-route rule: even the complete route (fetching every key) must fit in 25%.
    if (routes.completeSec > budget || routes.directSec > budget) continue;
    // Keys and clues must reward exploring: never on the fastest direct path.
    if (f.locks.some((l) => routes.directRooms.includes(l.clue.roomId))) continue;
    if (!locksCutExit(f)) continue;
    f.seedIndex = seedIndex;
    f.code = codeFromIndex(seedIndex);
    f.lengthMin = lengthMin;
    f.limitSec = lengthMin * 60;
    f.stats = {
      attempts: attempt + 1,
      budgetSec: budget,
      fastestDirectSec: round2(routes.directSec),
      fastestCompleteSec: round2(routes.completeSec),
      directRooms: routes.directRooms,
      ratio: round2(routes.completeSec / (lengthMin * 60)),
    };
    return f;
  }
  throw new Error(`Could not generate a valid facility for seed ${seedIndex}, ${lengthMin} min`);
}

const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------

function buildFacility(rng, profile, lengthMin, data, attempt) {
  const shrink = attempt >= 30;
  const cells = new Map(); // cell key -> room
  const reserved = new Set();
  const rooms = [];
  const doors = [];

  const freeNeighbors = (room) =>
    DIRS.filter((d) => {
      const k = ckey(room.cx + DVEC[d][0], room.cy + DVEC[d][1]);
      return !cells.has(k) && !reserved.has(k);
    });

  const newRoom = (cx, cy, props) => {
    const room = {
      id: `r${rooms.length}`,
      cx, cy,
      doors: { N: null, E: null, S: null, W: null },
      fixtures: [],
      obstacles: [],
      exitSide: null,
      ...props,
    };
    rooms.push(room);
    cells.set(ckey(cx, cy), room);
    return room;
  };

  const connect = (a, b, extra = {}) => {
    const side = DIRS.find((d) => a.cx + DVEC[d][0] === b.cx && a.cy + DVEC[d][1] === b.cy);
    if (!side) throw new Error('rooms not adjacent');
    const door = { id: `d${doors.length}`, a: a.id, b: b.id, sideA: side, sideB: OPP[side], lock: null, jammed: false, ...extra };
    doors.push(door);
    a.doors[side] = door.id;
    b.doors[OPP[side]] = door.id;
    return door;
  };

  // 1. Main path: a self-avoiding walk.
  const pathLen = shrink ? profile.path[0] : rng.int(profile.path[0], profile.path[1]);
  const pathCells = walkPath(rng, pathLen);
  if (!pathCells) return null;
  const path = pathCells.map(([x, y], i) => newRoom(x, y, { onPath: true, pathIndex: i, region: 0 }));
  for (let i = 0; i < path.length - 1; i++) connect(path[i], path[i + 1]);

  // Reserve an outside cell for the exit gap so nothing is built there.
  const exitRoom = path[path.length - 1];
  const exitChoices = freeNeighbors(exitRoom);
  if (!exitChoices.length) return null;
  const entrySide = DIRS.find((d) => exitRoom.doors[d]);
  exitRoom.exitSide = exitChoices.includes(OPP[entrySide]) ? OPP[entrySide] : rng.pick(exitChoices);
  reserved.add(ckey(exitRoom.cx + DVEC[exitRoom.exitSide][0], exitRoom.cy + DVEC[exitRoom.exitSide][1]));

  // 2. Locks on path edges (never the very first door).
  const numLocks = rng.int(profile.locks[0], profile.locks[1]);
  const candidates = [];
  for (let e = 1; e <= path.length - 2; e++) candidates.push(e);
  if (candidates.length < numLocks) return null;
  const lockEdges = rng.shuffle(candidates).slice(0, numLocks).sort((a, b) => a - b);
  path.forEach((r, j) => {
    r.region = lockEdges.filter((e) => e < j).length;
  });

  // 3. Zones along the path.
  const L = path.length;
  const forestCount = L >= 12 ? 3 : L >= 8 ? 2 : 1;
  path.forEach((r, j) => {
    if (j === 0) r.zone = 'ward';
    else if (j >= L - forestCount) r.zone = 'forest';
    else {
      const t = j / (L - forestCount);
      r.zone = t < 0.34 ? 'ward' : t < 0.67 ? 'labs' : 'lobby';
    }
  });

  const branchZone = (parent) => {
    if (parent.zone === 'forest') return 'forest';
    if (parent.zone === 'maint') return 'maint';
    return rng.chance(0.25) ? 'maint' : parent.zone;
  };

  const growBranch = (parent, depth, props) => {
    const made = [];
    let cur = parent;
    for (let i = 0; i < depth; i++) {
      const opts = freeNeighbors(cur);
      if (!opts.length) break;
      const d = rng.pick(opts);
      const room = newRoom(cur.cx + DVEC[d][0], cur.cy + DVEC[d][1], {
        onPath: false, region: parent.region, zone: branchZone(cur), parentId: cur.id, ...props,
      });
      connect(cur, room);
      made.push(room);
      cur = room;
    }
    return made;
  };

  // 4. A key branch for each lock, hanging off the region before that lock.
  const keyRooms = [];
  for (let i = 0; i < numLocks; i++) {
    const regionRooms = rng.shuffle(path.filter((r) => r.region === i && r !== exitRoom));
    const depth = shrink ? profile.keyDepth[0] : rng.int(profile.keyDepth[0], profile.keyDepth[1]);
    let made = null;
    for (const pr of regionRooms) {
      const m = growBranch(pr, depth, { keyBranch: i });
      if (m.length) {
        made = m;
        break;
      }
    }
    if (!made) return null;
    keyRooms.push(made[made.length - 1]);
  }

  // 5. Filler rooms up to the target count.
  const target = rng.int(profile.rooms[0], profile.rooms[1]);
  let guard = 0;
  while (rooms.length < target && guard++ < 500) {
    const parents = rooms.filter((r) => r !== exitRoom && freeNeighbors(r).length);
    if (!parents.length) break;
    const parent = rng.weighted(parents, (r) => (r.onPath ? 2 : 1));
    growBranch(parent, 1, { filler: true });
  }
  if (rooms.length < profile.rooms[0]) return null;

  // 6. Extra loops inside a region (never across a lock).
  let loops = profile.loops;
  if (loops > 0) {
    const pairs = [];
    for (const a of rooms) {
      for (const d of ['E', 'S']) {
        const b = cells.get(ckey(a.cx + DVEC[d][0], a.cy + DVEC[d][1]));
        if (!b || a.doors[d]) continue;
        if (a.region !== b.region || a === exitRoom || b === exitRoom) continue;
        if (BUILDING.has(a.zone) !== BUILDING.has(b.zone)) continue;
        if (a.pathIndex === 0 || b.pathIndex === 0) continue;
        pairs.push([a, b]);
      }
    }
    for (const [a, b] of rng.shuffle(pairs)) {
      if (loops-- <= 0) break;
      connect(a, b, { loop: true });
    }
  }

  // 7. Door kinds and states.
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  for (const d of doors) {
    const a = roomById.get(d.a);
    const b = roomById.get(d.b);
    const outA = !BUILDING.has(a.zone);
    const outB = !BUILDING.has(b.zone);
    if (outA && outB) {
      d.kind = 'passage';
      d.state = 'open';
    } else {
      d.kind = 'door';
      d.exterior = outA !== outB;
      d.state = d.exterior || rng.chance(0.65) ? 'closed' : 'open';
    }
  }

  // Jammed doors only lead to filler leaves.
  const degree = (r) => DIRS.filter((s) => r.doors[s]).length;
  const leaves = rng.shuffle(rooms.filter((r) => r.filler && degree(r) === 1 && BUILDING.has(r.zone)));
  for (const leaf of leaves.slice(0, profile.jammed)) {
    const side = DIRS.find((s) => leaf.doors[s]);
    const door = doors.find((d) => d.id === leaf.doors[side]);
    if (door.kind === 'door') {
      door.jammed = true;
      door.state = 'closed';
      leaf.jammedLeaf = true;
    }
  }

  // 8. Templates and sizes.
  if (!assignTemplates(rng, rooms, path, data)) return null;

  // 9. Locks and their clues.
  const locks = makeLocks(rng, profile, lengthMin, lockEdges, path, keyRooms, doors);
  let uid = 0;
  const nextUid = () => `f${uid++}`;
  for (const r of rooms) {
    r.fixtures = (r.template.fixtures || []).map((fx) => ({
      uid: nextUid(), name: fx.name, type: fx.type, text: fx.text, items: fx.type === 'container' ? [] : undefined,
    }));
  }
  const addFixture = (room, fx) => {
    const f = { uid: nextUid(), ...fx };
    room.fixtures.push(f);
    return f;
  };
  const containerIn = (room) => {
    const c = room.fixtures.filter((x) => x.type === 'container');
    if (c.length) return rng.pick(c);
    return addFixture(room, { name: 'storage cabinet', type: 'container', items: [] });
  };

  locks.forEach((lock, i) => {
    const room = keyRooms[i];
    lock.clue.roomId = room.id;
    if (lock.clue.type === 'container') {
      const c = containerIn(room);
      c.items.push(lock.clue.item);
      lock.clue.fixtureUid = c.uid;
    } else {
      const fx = addFixture(room, { name: CLUE_FIXTURE[lock.clue.type], type: 'clue', clue: { lockId: lock.id, type: lock.clue.type } });
      lock.clue.fixtureUid = fx.uid;
    }
  });

  // 10. Story, map, cure and loot.
  const nonExit = rooms.filter((r) => r !== exitRoom);
  if (profile.map) {
    const host = path.find((r) => r.pathIndex >= 1 && r.region === 0 && r !== exitRoom && BUILDING.has(r.zone)) || path[0];
    addFixture(host, { name: 'tactile wall map', type: 'map' });
  }
  const logs = pickLogs(data.story.logs, profile.logs);
  const logRooms = rng.shuffle(nonExit.filter((r) => r.pathIndex !== 0));
  logs.forEach((log, i) => {
    const room = logRooms[i % logRooms.length];
    addFixture(room, { name: 'audio recorder', type: 'log', logId: log.id });
  });
  const memoRooms = rng.shuffle(nonExit.filter((r) => BUILDING.has(r.zone)));
  const memoIdx = rng.shuffle([...data.story.memos.keys()]).slice(0, profile.memos);
  memoIdx.forEach((mi, i) => {
    if (memoRooms[i]) addFixture(memoRooms[i], { name: 'memo on the wall', type: 'memo', memo: mi });
  });

  const branchRooms = nonExit.filter((r) => !r.onPath && !r.jammedLeaf);
  const cureCandidates = branchRooms.filter((r) => r.zone === 'labs');
  const cureRoom = rng.pick(cureCandidates.length ? cureCandidates : branchRooms.length ? branchRooms : nonExit);
  containerIn(cureRoom).items.push('cure');

  const lootRooms = nonExit.filter((r) => BUILDING.has(r.zone) || r.template.fixtures.some((x) => x.type === 'container'));
  const placeItem = (itemId, pool) => {
    const room = rng.pick(pool.length ? pool : nonExit);
    containerIn(room).items.push(itemId);
  };
  placeItem('braille_card', nonExit.filter((r) => r.pathIndex !== 0));
  if (profile.radio) placeItem('radio', nonExit.filter((r) => r.region <= 1 && r.pathIndex !== 0 && !r.jammedLeaf));
  for (const [itemId, n] of Object.entries(profile.loot)) {
    for (let k = 0; k < n; k++) {
      placeItem(itemId, itemId === 'crowbar' ? lootRooms.filter((r) => !r.jammedLeaf) : lootRooms);
    }
  }
  // Something good behind each jammed door.
  for (const r of rooms.filter((x) => x.jammedLeaf)) containerIn(r).items.push(rng.pick(['bandage', 'juice', 'battery', 'lure']));

  // 11. Interiors.
  for (const r of rooms) {
    const isStart = r.pathIndex === 0;
    if (isStart) {
      // Face toward the first door so "forward" leads somewhere useful.
      r.startFacing = DIRS.find((d) => r.doors[d]);
    }
    const ok = placeInterior(r, rng, {
      obstacleChance: isStart ? 0 : profile.obstacleChance,
      obstacleNames: r.template.obstacles || [],
      startNear: isStart ? { fixtureIndex: 0 } : null,
    });
    if (!ok) return null;
  }

  // 12. Zombies.
  const startRoom = path[0];
  const nearStart = new Set([startRoom.id, ...DIRS.map((d) => startRoom.doors[d]).filter(Boolean).map((id) => {
    const d = doors.find((x) => x.id === id);
    return d.a === startRoom.id ? d.b : d.a;
  })]);
  const zRooms = rooms.filter((r) => !nearStart.has(r.id) && (lengthMin > 5 || r !== exitRoom));
  const zombies = [];
  const nz = rng.int(profile.zombies[0], profile.zombies[1]);
  const typeEntries = Object.entries(profile.zombieTypes);
  const guardRooms = locks.map((l) => {
    const d = doors.find((x) => x.id === l.doorId);
    return roomById.get(d.a).pathIndex < roomById.get(d.b).pathIndex ? roomById.get(d.a) : roomById.get(d.b);
  }).filter((r) => !nearStart.has(r.id));
  for (let i = 0; i < nz && zRooms.length; i++) {
    const room = guardRooms.length && rng.chance(0.3) ? rng.pick(guardRooms) : rng.pick(zRooms);
    const type = rng.weighted(typeEntries, ([, w]) => w)[0];
    const tile = randomFloorTile(rng, room);
    if (!tile) continue;
    zombies.push({ id: `z${i}`, type, room: room.id, x: tile.x, y: tile.y });
  }

  // World offsets (for audio and the visual map).
  for (const r of rooms) {
    r.ox = r.cx * CELL + (CELL - r.w) / 2;
    r.oy = r.cy * CELL + (CELL - r.h) / 2;
  }

  return {
    rooms: rooms.map(stripRoom),
    doors,
    locks,
    zombies,
    logs: logs.map((l) => l.id),
    cureRoom: cureRoom.id,
    start: { room: startRoom.id, x: startRoom.start.x, y: startRoom.start.y, facing: startRoom.startFacing },
    exit: { room: exitRoom.id, side: exitRoom.exitSide },
    mainPath: path.map((r) => r.id),
  };
}

function stripRoom(r) {
  const { template, ...rest } = r;
  return { ...rest, templateId: template.id, surface: template.surface, ambient: template.ambient, desc: template.desc };
}

function walkPath(rng, len) {
  for (let tries = 0; tries < 200; tries++) {
    const cells = [[0, 0]];
    const used = new Set([ckey(0, 0)]);
    let dir = rng.pick(DIRS);
    let ok = true;
    while (cells.length < len) {
      const [x, y] = cells[cells.length - 1];
      const opts = DIRS.filter((d) => !used.has(ckey(x + DVEC[d][0], y + DVEC[d][1])));
      // Leave room around the walk so branches can grow.
      if (!opts.length) {
        ok = false;
        break;
      }
      dir = opts.includes(dir) && rng.chance(0.5) ? dir : rng.pick(opts);
      const nx = x + DVEC[dir][0];
      const ny = y + DVEC[dir][1];
      cells.push([nx, ny]);
      used.add(ckey(nx, ny));
    }
    if (ok) return cells;
  }
  return null;
}

function assignTemplates(rng, rooms, path, data) {
  const T = data.rooms.templates;
  const used = new Set();
  const counts = new Map();
  const byRole = (zone, role) => T.filter((t) => t.zone === zone && t.roles.includes(role) && !(t.unique && used.has(t.id)));
  const pickT = (list) => rng.weighted(list, (t) => t.weight || 1);

  for (const r of rooms) {
    let t;
    if (r.pathIndex === 0) t = T.find((x) => x.roles.includes('start'));
    else if (r === path[path.length - 1]) t = T.find((x) => x.roles.includes('exit'));
    else if (r.onPath) {
      const prev = path[r.pathIndex - 1];
      const isTransition = prev && prev.zone !== r.zone && (r.zone === 'labs' || r.zone === 'lobby');
      const trans = isTransition ? byRole(r.zone, 'transition') : [];
      const list = trans.length ? trans : byRole(r.zone, 'path');
      t = list.length ? pickT(list) : pickT(byRole(r.zone, 'branch'));
    } else {
      const list = byRole(r.zone, 'branch');
      t = list.length ? pickT(list) : pickT(T.filter((x) => x.zone === r.zone && !x.roles.includes('start') && !x.roles.includes('exit')));
    }
    if (!t) return false;
    used.add(t.id);
    r.template = t;
    const n = (counts.get(t.id) || 0) + 1;
    counts.set(t.id, n);
    r.name = n === 1 ? t.name : `${t.name} ${n}`;
    r.floor = data.rooms.zones[r.zone].floor;
    let w = rng.pick(t.w);
    let h = rng.pick(t.h);
    if (t.shape === 'long' && rng.chance(0.5)) [w, h] = [h, w];
    r.w = w;
    r.h = h;
  }
  // First instance of a repeated template gets "1" only if a second exists — keep names simple.
  for (const r of rooms) {
    if (counts.get(r.template.id) > 1 && r.name === r.template.name) r.name = `${r.template.name} 1`;
  }
  return true;
}

function makeLocks(rng, profile, lengthMin, lockEdges, path, keyRooms, doors) {
  const kinds = [];
  const pool = profile.lockKinds;
  // First lock is a gentle one (keycard or keypad); the rest add variety.
  kinds.push(rng.pick(pool.filter((k) => k === 'keycard' || k === 'keypad')));
  let rest = rng.shuffle(pool.filter((k) => k !== kinds[0]));
  while (kinds.length < lockEdges.length) {
    if (!rest.length) rest = rng.shuffle(pool);
    kinds.push(rest.shift());
  }
  const colors = rng.shuffle(KEYCARD_COLORS);
  const melodyLen = lengthMin >= 60 ? 6 : lengthMin >= 30 ? 5 : 4;
  const tapCount = lengthMin >= 60 ? 6 : lengthMin >= 30 ? 5 : 4;

  return lockEdges.map((e, i) => {
    const a = path[e];
    const b = path[e + 1];
    const side = DIRS.find((d) => a.cx + DVEC[d][0] === b.cx && a.cy + DVEC[d][1] === b.cy);
    const door = doors.find((d) => d.id === a.doors[side]);
    door.state = 'closed';
    const lock = { id: `L${i}`, doorId: door.id, kind: kinds[i] };
    door.lock = lock.id;
    switch (lock.kind) {
      case 'keycard': {
        lock.color = colors[i % colors.length];
        lock.item = `keycard_${lock.color}`;
        lock.clue = { type: 'container', item: lock.item };
        break;
      }
      case 'keypad': {
        const digits = lengthMin <= 5 ? 3 : 4;
        let code = '';
        while (code.length < digits) code += String(rng.int(0, 9));
        lock.code = code;
        lock.clue = { type: rng.pick(KEYPAD_CLUES) };
        break;
      }
      case 'sequence': {
        const m = [];
        while (m.length < melodyLen) m.push(rng.pick(NOTE_DIRS));
        if (new Set(m).size === 1) m[m.length - 1] = NOTE_DIRS[(NOTE_DIRS.indexOf(m[0]) + 2) % 4];
        lock.melody = m;
        lock.clue = { type: 'melody' };
        break;
      }
      case 'pitch': {
        lock.target = rng.int(0, 11);
        let s = rng.int(0, 11);
        while (Math.abs(s - lock.target) < 4) s = rng.int(0, 11);
        lock.startStep = s;
        lock.item = 'tuning_fork';
        lock.clue = { type: 'container', item: 'tuning_fork' };
        break;
      }
      case 'rhythm': {
        const iv = [];
        while (iv.length < tapCount - 1) iv.push(rng.pick([1, 1, 2]));
        if (!iv.includes(2)) iv[rng.int(0, iv.length - 1)] = 2;
        if (!iv.includes(1)) iv[0] = 1;
        lock.rhythm = iv;
        lock.clue = { type: 'rhythm' };
        break;
      }
      case 'power': {
        const n = lengthMin >= 60 ? 4 : 3;
        const freqs = rng.shuffle([110, 147, 196, 262]).slice(0, n);
        const rule = rng.pick(['lowest', 'highest', 'pulsing']);
        const circuits = freqs.map((f) => ({ freq: f, pulse: false }));
        let answer;
        if (rule === 'lowest') answer = freqs.indexOf(Math.min(...freqs));
        else if (rule === 'highest') answer = freqs.indexOf(Math.max(...freqs));
        else {
          answer = rng.int(0, n - 1);
          circuits[answer].pulse = true;
        }
        lock.circuits = circuits;
        lock.rule = rule;
        lock.answer = answer;
        lock.clue = { type: 'breaker' };
        break;
      }
      default:
        break;
    }
    lock.clue.roomId = keyRooms[i]?.id;
    return lock;
  });
}

function pickLogs(all, n) {
  if (n >= all.length) return all.slice();
  // Evenly spread through the story, always ending with the last entry.
  const out = [];
  for (let i = 0; i < n; i++) out.push(all[Math.round((i * (all.length - 1)) / Math.max(1, n - 1))]);
  return [...new Map(out.map((l) => [l.id, l])).values()];
}

function randomFloorTile(rng, room) {
  const blocked = new Set(room.fixtures.map((f) => `${f.x},${f.y}`).concat(room.obstacles.map((o) => `${o.x},${o.y}`)));
  const tiles = [];
  for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) if (!blocked.has(`${x},${y}`)) tiles.push({ x, y });
  return tiles.length ? rng.pick(tiles) : null;
}

// Route analysis: Dijkstra over (port, keys-held) to find
//  - the fastest DIRECT route (start -> exit, paying mandatory unlock time, ignoring where keys are)
//  - the fastest COMPLETE route (must actually collect each key/clue before its lock)
// Both use the shared time-cost model, so the 25% rule is checked against real action costs.

import { OPP } from '../core/dirs.js';
import { MinHeap } from '../core/heap.js';
import { COST, unlockCost, clueCost } from './costs.js';
import { roomPortCosts } from './interior.js';

function buildPortGraph(f) {
  const lockByDoor = new Map(f.locks.map((l, i) => [l.doorId, { lock: l, bit: 1 << i }]));
  const clueByUid = new Map(f.locks.map((l, i) => [l.clue.fixtureUid, { lock: l, bit: 1 << i }]));
  const edges = new Map(); // node -> [{to, cost, need, grant}]
  const add = (from, e) => {
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from).push(e);
  };

  for (const room of f.rooms) {
    const clueUids = room.fixtures.filter((fx) => clueByUid.has(fx.uid)).map((fx) => fx.uid);
    const ports = roomPortCosts(room, clueUids);
    for (const [port, costs] of Object.entries(ports)) {
      const from = `${room.id}|${port}`;
      for (const [side, c] of Object.entries(costs.exits)) {
        if (!Number.isFinite(c)) continue;
        if (room.exitSide === side) {
          add(from, { to: 'GOAL', cost: c, need: 0, grant: 0 });
          continue;
        }
        const door = f.doors.find((d) => d.id === room.doors[side]);
        if (!door || door.jammed) continue;
        const other = door.a === room.id ? door.b : door.a;
        const lk = lockByDoor.get(door.id);
        let cost = c + COST.roomOverhead;
        if (door.kind !== 'passage' && door.state === 'closed') cost += COST.doorOpen;
        if (lk) cost += unlockCost(lk.lock);
        add(from, { to: `${other}|in:${OPP[side]}`, cost, need: lk ? lk.bit : 0, grant: 0, room: other });
      }
      for (const [uid, c] of Object.entries(costs.fixtures)) {
        if (!Number.isFinite(c) || port === `fx:${uid}`) continue;
        const ck = clueByUid.get(uid);
        add(from, { to: `${room.id}|fx:${uid}`, cost: c + clueCost(ck.lock), need: 0, grant: ck.bit, room: room.id });
      }
    }
  }
  return edges;
}

function search(f, edges, startMask, enforceLocks) {
  const startNode = `${f.start.room}|start`;
  const dist = new Map();
  const prev = new Map();
  const heap = new MinHeap();
  const sk = (n, m) => `${n}#${m}`;
  dist.set(sk(startNode, startMask), 0);
  heap.push(0, { node: startNode, mask: startMask });
  while (heap.size) {
    const { priority: d, value: s } = heap.pop();
    const k = sk(s.node, s.mask);
    if (d > dist.get(k)) continue;
    if (s.node === 'GOAL') {
      // reconstruct rooms visited
      const rooms = [];
      let cur = k;
      while (cur) {
        const node = cur.split('#')[0];
        const r = node.split('|')[0];
        if (r !== 'GOAL' && rooms[0] !== r) rooms.unshift(r);
        cur = prev.get(cur);
      }
      return { sec: d, rooms };
    }
    for (const e of edges.get(s.node) || []) {
      if (enforceLocks && e.need && !(s.mask & e.need)) continue;
      const mask = s.mask | e.grant;
      const nk = sk(e.to, mask);
      const nd = d + e.cost;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, k);
        heap.push(nd, { node: e.to, mask });
      }
    }
  }
  return { sec: Infinity, rooms: [] };
}

/** True when every start->exit route crosses at least one locked door. */
export function locksCutExit(f) {
  const lockedDoors = new Set(f.locks.map((l) => l.doorId));
  const seen = new Set([f.start.room]);
  const q = [f.start.room];
  while (q.length) {
    const r = q.shift();
    if (r === f.exit.room) return false;
    for (const d of f.doors) {
      if (lockedDoors.has(d.id) || (d.a !== r && d.b !== r)) continue;
      const o = d.a === r ? d.b : d.a;
      if (!seen.has(o)) {
        seen.add(o);
        q.push(o);
      }
    }
  }
  return true;
}

export function analyzeRoutes(f) {
  const edges = buildPortGraph(f);
  const all = (1 << f.locks.length) - 1;
  const direct = search(f, edges, all, false);
  const complete = search(f, edges, 0, true);
  return {
    ok: Number.isFinite(direct.sec) && Number.isFinite(complete.sec),
    directSec: direct.sec,
    directRooms: direct.rooms,
    completeSec: complete.sec,
    completeRooms: complete.rooms,
  };
}

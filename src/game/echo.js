// Echolocation: a click, then echoes from each direction. Delay and brightness tell
// distance; walls click back bright, objects dull, open doorways sound like open air.
// Pure scanning logic is separate so it can be tested.

import { DVEC, relativeSide, turnLeft, turnRight, OPP } from '../core/dirs.js';
import { plural } from '../core/format.js';

/** Scan from (x, y) in an absolute direction until something stops the sound. */
export function scanDirection(world, roomId, x, y, dir) {
  const [dx, dy] = DVEC[dir];
  let cx = x;
  let cy = y;
  let dist = 0;
  for (;;) {
    const res = world.tryStep(roomId, cx, cy, dir);
    if (res.type === 'move') {
      cx += dx;
      cy += dy;
      dist++;
      continue;
    }
    if (res.type === 'blocked') return { dist: dist + 1, kind: res.thing.kind, name: res.thing.name, x: cx + dx, y: cy + dy };
    if (res.type === 'exit') return { dist: dist + 1, kind: 'opening', name: 'the gap in the fence', x: cx + dx, y: cy + dy };
    if (res.type === 'door') {
      const open = res.door.kind === 'passage' || res.door.state === 'open';
      return { dist: dist + 1, kind: open ? 'opening' : 'door', name: open ? 'an open doorway' : 'a closed door', x: cx + dx, y: cy + dy };
    }
    return { dist: dist + 1, kind: 'wall', name: 'wall', x: cx + dx, y: cy + dy };
  }
}

export function scanAround(world, player) {
  const dirs = [player.facing, turnRight(player.facing), OPP[player.facing], turnLeft(player.facing)];
  return dirs.map((d) => ({ dir: d, rel: relativeSide(d, player.facing), ...scanDirection(world, player.room, player.x, player.y, d) }));
}

const REL = { ahead: 'Ahead', right: 'Right', behind: 'Behind', left: 'Left' };

export function pingSummary(results, room) {
  const parts = results.map((r) => `${REL[r.rel]}: ${r.name} at ${plural(r.dist, 'step')}`);
  const outside = room.zone === 'forest';
  const size = room.w * room.h;
  const feel = outside ? 'Open ground, soft echoes off the trees.' : size >= 35 ? 'A large, echoing room.' : size <= 12 ? 'A small, tight space.' : 'A medium room.';
  return `${feel} ${parts.join('. ')}.`;
}

/** Play the ping and its echoes through the positional audio engine. */
export function playPing(game) {
  const { world, player, audio } = game;
  const results = scanAround(world, player);
  const here = world.worldPos(player.room, player.x, player.y);
  audio.play('ping_click', { gain: 0.9 });
  const room = world.room(player.room);
  const outside = room.zone === 'forest';
  for (const r of results) {
    const pos = world.worldPos(player.room, r.x, r.y);
    // Exaggerated delay (about 60 ms per step) so distance is easy to hear.
    const delay = 0.08 + r.dist * 0.06;
    const lowpass = Math.max(1200, 9000 / (1 + r.dist * 0.35));
    const gain = (outside ? 0.35 : 0.9) / (1 + r.dist * 0.25);
    const id = r.kind === 'opening' ? 'echo_soft' : r.kind === 'wall' ? (outside ? 'echo_dull' : 'echo_hard') : 'echo_dull';
    audio.play(id, { pos, delay, gain, lowpass, rate: r.kind === 'door' ? 0.8 : 1 });
  }
  // A faint tail whose length follows the room size.
  if (!outside) {
    const tail = 0.05 + (room.w + room.h) * 0.02;
    audio.play('echo_soft', { pos: { x: here.x, y: here.y - 0.5 }, delay: 0.25 + tail, gain: 0.25 });
  }
  return results;
}

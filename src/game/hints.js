// Hints: figure out the next objective and describe it in escalating detail.
// Directions use compass words plus "left/right" from the current facing.

import { DIR_NAME, relativeSide } from '../core/dirs.js';
import { plural, listWords } from '../core/format.js';
import { doorLabel, lockName } from './describe.js';

const SIDE = { ahead: 'ahead of you', right: 'on your right', behind: 'behind you', left: 'on your left' };

export function hasKeyFor(game, lock) {
  const inv = game.player.inventory;
  switch (lock.kind) {
    case 'keycard': return !!inv[lock.item];
    case 'pitch': return !!inv.tuning_fork;
    case 'power': return !!game.world.door(lock.doorId).powered;
    default: return !!game.player.knowledge[lock.id];
  }
}

/** The next thing standing between the player and the exit. */
export function nextObjective(game) {
  const w = game.world;
  const route = w.roomRoute(game.player.room, w.f.exit.room, { passLocked: true }) || [];
  for (const step of route) {
    if (step.door.barricaded) return { type: 'barricade', door: step.door, route };
    if (w.isLocked(step.door)) {
      const lock = w.lockFor(step.door);
      if (lock.kind === 'power' && step.door.powered) continue;
      return hasKeyFor(game, lock) ? { type: 'lock', lock, door: step.door } : { type: 'clue', lock };
    }
  }
  return { type: 'exit' };
}

export function routeWords(steps, facing) {
  if (!steps || !steps.length) return 'You are already there.';
  const first = steps[0];
  const firstWord = `the ${DIR_NAME[first.side]} door, ${SIDE[relativeSide(first.side, facing)]}`;
  if (steps.length === 1) return `Go through ${firstWord}.`;
  const rest = steps.slice(1).map((s) => `${DIR_NAME[s.side]}`);
  return `Go through ${firstWord}, then ${listWords(rest)}. That's ${plural(steps.length, 'door')} in all.`;
}

function clueWhat(lock) {
  switch (lock.clue.type) {
    case 'container': return lock.kind === 'pitch' ? 'a tuning fork' : `the ${lock.color} keycard`;
    case 'memo': return 'a memo with the code';
    case 'phone': return 'a ringing telephone with the code';
    case 'recorder_beeps': return 'a voice recorder that beeps the code';
    case 'braille': return 'a braille label with the code';
    case 'largeprint': return 'a large-print sign with the code';
    case 'melody': return 'a music box that plays the chime';
    case 'rhythm': return 'a recorder with the secret knock';
    case 'breaker': return 'a breaker panel to route power';
    default: return 'a clue';
  }
}

/** Hint text for a level (1 vague, 2 directional, 3 exact). */
export function hintText(game, level) {
  const w = game.world;
  const p = game.player;
  const obj = nextObjective(game);
  if (obj.type === 'clue') {
    const label = doorLabel(w, obj.lock);
    const route = w.roomRoute(p.room, obj.lock.clue.roomId, { passLocked: false });
    const clueRoom = w.room(obj.lock.clue.roomId);
    if (level === 1) return `The ${label} is in your way. Somewhere off the main route there's ${clueWhat(obj.lock)}. Side rooms are worth exploring.`;
    if (level === 2 && route) return `Look for ${clueWhat(obj.lock)} in the ${clueRoom.name}, ${plural(route.length, 'room')} away. Start with the ${DIR_NAME[route[0]?.side] || 'nearest'} door.`;
    if (route) {
      const fx = clueRoom.fixtures.find((f) => f.uid === obj.lock.clue.fixtureUid);
      return `${clueWhat(obj.lock)} is in the ${clueRoom.name}, in the ${fx?.name || 'room'}. ${routeWords(route, p.facing)}`;
    }
    return `Look for ${clueWhat(obj.lock)}.`;
  }
  if (obj.type === 'lock') {
    const route = w.roomRoute(p.room, nearSide(w, obj.door), { passLocked: false });
    const how = howToUnlock(game, obj.lock);
    if (level === 1) return `You have what you need for the ${doorLabel(w, obj.lock)}. ${how}`;
    return `${how} ${route && route.length ? routeWords(route, p.facing) : 'The door is in this room.'}`;
  }
  if (obj.type === 'barricade') return 'A door on your route is wedged shut. Interact with it to pull the wedge out.';
  const route = w.roomRoute(p.room, w.f.exit.room, { passLocked: false });
  const cure = !p.inventory.cure && level === 1 && !game.flags.cureHinted;
  if (cure) {
    game.flags.cureHinted = true;
    return `The way out is open. Follow the beacon. If you have time, the antibody sample is somewhere in the building, worth finding. ${route ? routeWords(route, p.facing) : ''}`;
  }
  if (!route) return 'Follow the beacon sound to the exit.';
  if (route.length === 0) return 'The gap in the fence is in this clearing. Follow the beacon and walk through it.';
  return level === 1 ? `Follow the beacon. The next door is the ${DIR_NAME[route[0].side]} one, ${SIDE[relativeSide(route[0].side, p.facing)]}.` : routeWords(route, p.facing);
}

function nearSide(w, door) {
  const a = w.room(door.a);
  const b = w.room(door.b);
  return (a.pathIndex ?? 99) <= (b.pathIndex ?? 99) ? a.id : b.id;
}

export function howToUnlock(game, lock) {
  const k = game.player.knowledge[lock.id];
  switch (lock.kind) {
    case 'keycard': return `Walk up to the ${lockName(lock)} and press Enter; your keycard does the rest.`;
    case 'keypad': return `Type the code on the keypad: ${k ? spaced(lock.code) : 'the code from the clue'}, then Enter.`;
    case 'sequence': return `Play the chime with arrow keys: ${lock.melody.join(', ')}.`;
    case 'pitch': return 'Strike the fork with Space, then use Up and Down until the tones stop wobbling against each other, then Enter.';
    case 'rhythm': return `Tap the knock with Space: ${lock.rhythm.map((v) => (v === 1 ? 'short' : 'long')).join(', ')} gaps.`;
    case 'power': return 'The door has power now. Walk up and open it.';
    default: return '';
  }
}

export function spaced(code) {
  return code.split('').join(', ');
}

// Spoken descriptions built from game state. Short chunks, relative directions,
// and step counts, following orientation-and-mobility conventions.

import { DIRS, DVEC, DIR_NAME, relativeSide, directionWords, compassWords } from '../core/dirs.js';
import { capitalize, listWords, plural, withArticle } from '../core/format.js';

export const AMBIENT_WORDS = {
  amb_monitor: 'a heart monitor beeping',
  amb_fluorescent: 'fluorescent lights buzzing',
  amb_hum: 'machinery humming',
  amb_drip: 'water dripping',
  amb_vent: 'air moving through a vent',
  amb_fans: 'server fans roaring',
  amb_freezer: 'freezers humming',
  amb_boiler: 'a boiler rumbling',
  amb_electric: 'transformers buzzing',
  amb_static: 'radio static',
  amb_wind: 'wind',
  amb_forest: 'wind in the trees',
  amb_creek: 'a creek rushing',
  amb_alarm: 'distant alarms',
  amb_vending: 'a vending machine humming',
};

const SIDE_WORDS = { ahead: 'ahead', right: 'to your right', behind: 'behind you', left: 'to your left' };

export function distanceWord(d) {
  if (d <= 2) return 'very close';
  if (d <= 5) return 'close';
  if (d <= 10) return 'nearby';
  if (d <= 18) return 'far';
  return 'distant';
}

export function lockName(lock) {
  switch (lock?.kind) {
    case 'keycard': return `${lock.color} card reader`;
    case 'keypad': return 'keypad';
    case 'sequence': return 'chime lock';
    case 'pitch': return 'pitch lock';
    case 'rhythm': return 'knock lock';
    case 'power': return 'powered lock';
    default: return 'lock';
  }
}

/** "the keypad door in the Lab Corridor" — used by clues and hints. */
export function doorLabel(world, lock) {
  const door = world.door(lock.doorId);
  const a = world.room(door.a);
  const b = world.room(door.b);
  const near = (a.pathIndex ?? 99) <= (b.pathIndex ?? 99) ? a : b;
  return `${lockName(lock)} door in the ${near.name}`;
}

export function doorStateWords(world, door) {
  if (door.kind === 'passage') return 'an open path';
  if (door.barricaded) return 'wedged shut';
  if (door.jammed) return 'jammed';
  if (world.isLocked(door)) {
    const lock = world.lockFor(door);
    if (lock.kind === 'power' && door.powered) return 'a powered door, ready to open';
    return `locked with ${withArticle(lockName(lock))}`;
  }
  return door.state === 'open' ? 'open' : 'closed';
}

function relDir(game, tx, ty) {
  const p = game.player;
  return directionWords(tx - p.x, ty - p.y, p.facing, game.settings.directionStyle);
}

function stepsTo(game, tx, ty) {
  const p = game.player;
  return Math.abs(tx - p.x) + Math.abs(ty - p.y);
}

export function exitsText(game, brief = false) {
  const { world, player: p } = game;
  const r = world.room(p.room);
  const parts = [];
  for (const s of DIRS) {
    const rel = SIDE_WORDS[relativeSide(s, p.facing)];
    if (r.exitSide === s) {
      parts.push(`${rel}, the gap in the fence to safety`);
      continue;
    }
    const door = world.doorOn(p.room, s);
    if (!door) continue;
    const known = game.visited.has(world.otherRoom(door, p.room));
    const label = door.kind === 'passage' ? 'a path' : door.gate ? 'a gate' : 'a door';
    const tail = brief ? '' : known ? `, back to the ${world.room(world.otherRoom(door, p.room)).name}` : '';
    parts.push(`${rel}, ${label}, ${doorStateWords(world, door)}${tail}`);
  }
  if (!parts.length) return 'No exits.';
  return `${parts.length === 1 ? 'One way out' : `${parts.length} ways out`}: ${parts.join('; ')}.`;
}

function fixtureWord(f) {
  if (f.type === 'log') return 'an audio recorder';
  if (f.type === 'memo') return 'a memo on the wall';
  if (f.type === 'map') return 'a tactile wall map';
  return withArticle(f.name);
}

export function fixturesText(game) {
  const { world, player: p } = game;
  const r = world.room(p.room);
  const items = r.fixtures.map((f) => `${fixtureWord(f)}, ${relDir(game, f.x, f.y)}, ${plural(stepsTo(game, f.x, f.y), 'step')}`);
  const obs = r.obstacles.map((o) => `${withArticle(o.name)} in the way, ${relDir(game, o.x, o.y)}`);
  const all = items.concat(obs);
  if (!all.length) return '';
  return `You notice: ${all.join('; ')}.`;
}

function sizeText(game) {
  const r = game.world.room(game.player.room);
  const ns = game.player.facing === 'N' || game.player.facing === 'S';
  const wide = ns ? r.w : r.h;
  const deep = ns ? r.h : r.w;
  const outside = r.zone === 'forest';
  return outside ? `The open ground is about ${wide} steps across and ${deep} deep.` : `The room is about ${wide} steps wide and ${deep} deep.`;
}

export function roomDescription(game, { full = true, floorChange = false } = {}) {
  const { world, player: p } = game;
  const r = world.room(p.room);
  const head = floorChange ? `${r.floor}. ${r.name}.` : `${r.name}.`;
  if (!full) return `${head} ${exitsText(game, true)}`;
  return [head, ...r.desc, sizeText(game), exitsText(game), fixturesText(game)].filter(Boolean).join(' ');
}

/** Things within arm's reach: adjacent fixtures and the doorway you stand in. */
export function reachables(game) {
  const { world, player: p } = game;
  const r = world.room(p.room);
  const out = [];
  for (const s of world.sidesAt(p.room, p.x, p.y)) {
    const rel = SIDE_WORDS[relativeSide(s, p.facing)];
    if (r.exitSide === s) out.push({ key: `exit:${s}`, text: `the gap in the fence, ${rel}`, side: s, kind: 'exit' });
    else {
      const door = world.doorOn(p.room, s);
      out.push({ key: `door:${door.id}`, text: `${door.kind === 'passage' ? 'a path' : door.gate ? 'a gate' : 'a door'}, ${rel}, ${doorStateWords(world, door)}`, side: s, kind: 'door', door });
    }
  }
  for (const d of DIRS) {
    const [dx, dy] = DVEC[d];
    const f = r.fixtures.find((x) => x.x === p.x + dx && x.y === p.y + dy);
    if (f) out.push({ key: `fx:${f.uid}`, text: `${fixtureWord(f)}, ${SIDE_WORDS[relativeSide(d, p.facing)]}`, side: d, kind: 'fixture', fixture: f });
  }
  return out;
}

export function availableActions(game) {
  const acts = [];
  for (const r of reachables(game)) {
    if (r.kind === 'exit') acts.push('walk through the gap to escape');
    else if (r.kind === 'door') {
      const d = r.door;
      if (d.kind === 'passage') acts.push(`walk ${SIDE_WORDS[relativeSide(r.side, game.player.facing)]} along the path`);
      else if (game.world.isLocked(d) || d.jammed || d.barricaded) acts.push(`try the ${doorStateWords(game.world, d)} door`);
      else acts.push(d.state === 'open' ? 'walk through the open door, or close it' : 'open the door');
    } else {
      const f = r.fixture;
      if (f.type === 'container') acts.push(f.searched ? `the ${f.name} is already searched` : `search the ${f.name}`);
      else if (f.type === 'hide') acts.push(`hide in the ${f.name} with E`);
      else if (f.type === 'log') acts.push('play the audio recorder');
      else if (f.type === 'memo') acts.push('read the memo');
      else if (f.type === 'map') acts.push('read the tactile map');
      else if (f.type === 'clue') acts.push(`use the ${f.name}`);
      else acts.push(`examine the ${f.name}`);
    }
  }
  return acts;
}

export function whereAmI(game) {
  const { world, player: p } = game;
  const r = world.room(p.room);
  const parts = [`${r.name}, ${r.floor}. Facing ${DIR_NAME[p.facing]}.`];
  if (p.hidden) parts.push(`You are hiding in the ${p.hidden.name}.`);
  parts.push(exitsText(game, true));
  const reach = reachables(game);
  if (reach.length) parts.push(`Within reach: ${reach.map((x) => x.text).join('; ')}.`);
  const zs = game.zombies.audible();
  if (zs.length) parts.push(`You can hear ${zs.length === 1 ? 'one zombie' : `${zs.length} zombies`}. Press L to listen.`);
  const acts = availableActions(game);
  if (game.encounter) parts.push('A zombie has hold of you. F to fight, E to hide if a hiding spot is in reach, or walk away.');
  else if (acts.length) parts.push(`You can: ${listWords(acts, 'or')}.`);
  else parts.push('Nothing is within reach. Walk to explore, or press L to listen.');
  return parts.join(' ');
}

export function compassText(game) {
  const r = game.world.room(game.player.room);
  return `Facing ${DIR_NAME[game.player.facing]}. ${r.name}, ${r.floor}.`;
}

export function exhaustionWord(e) {
  if (e < 25) return 'rested';
  if (e < 50) return 'a little tired';
  if (e < 75) return 'tired';
  return 'exhausted';
}

export function statusText(game) {
  const p = game.player;
  const parts = [
    `Health ${Math.round(p.health)} of 100.`,
    `You feel ${exhaustionWord(p.exhaustion)}.`,
    `Infection ${p.infection} of ${p.maxInfection}.`,
    `Noise: ${game.noiseWord()}.`,
    `Moving: ${game.moveModeWord()}.`,
  ];
  if (p.hidden) parts.push(`Hiding in the ${p.hidden.name}.`);
  return parts.join(' ');
}

/** The L key: what you hear, where, how far. */
export function listenText(game) {
  const { world, player: p } = game;
  const here = world.worldPos(p.room, p.x, p.y);
  const dists = world.roomDistances(p.room);
  const sounds = [];
  for (const z of game.zombies.audible()) {
    const zp = world.worldPos(z.room, z.x, z.y);
    const d = Math.hypot(zp.x - here.x, zp.y - here.y);
    const hop = dists.get(z.room);
    const where = hop.hops === 0 ? '' : hop.closed ? ', muffled behind a door' : ', in the next room';
    const name = game.knownZombieType(z.type) ? `a ${z.def.name}: ${z.def.signature}` : z.def.signature;
    const state = z.state === 'chase' ? ', coming for you' : z.state === 'investigate' ? ', searching' : '';
    sounds.push({ d, text: `${name}, ${directionWords(zp.x - here.x, zp.y - here.y, p.facing, game.settings.directionStyle)}, ${distanceWord(d)}${where}${state}` });
  }
  for (const s of game.soundscape.listenSources()) {
    const d = Math.hypot(s.x - here.x, s.y - here.y);
    sounds.push({ d, text: `${s.name}, ${directionWords(s.x - here.x, s.y - here.y, p.facing, game.settings.directionStyle)}, ${distanceWord(d)}` });
  }
  sounds.sort((a, b) => a.d - b.d);
  const amb = AMBIENT_WORDS[world.room(p.room).ambient];
  const head = amb ? `Around you: ${amb}.` : '';
  if (!sounds.length) return `${head} No other sounds nearby.`.trim();
  return `${head} ${sounds.slice(0, 6).map((s) => `${capitalize(s.text)}.`).join(' ')}`.trim();
}

export function beaconDirection(game) {
  const { world, player: p } = game;
  const here = world.worldPos(p.room, p.x, p.y);
  const ex = world.exitPos();
  return compassWords(ex.x - here.x, ex.y - here.y);
}

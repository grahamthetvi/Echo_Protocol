// Overlays on top of gameplay: inventory with item use, the tactile map explorer,
// and the rescue radio dialog (self-advocacy with the extraction team).

import { DIRS, DVEC, DIR_NAME, relativeSide, compassWords } from '../core/dirs.js';
import { capitalize, withArticle, plural } from '../core/format.js';
import { Menu } from '../ui/menu.js';
import { COST } from '../generator/costs.js';
import { doorStateWords } from './describe.js';
import { hintText, nextObjective, routeWords } from './hints.js';

const SIDE = { ahead: 'ahead', right: 'on your right', behind: 'behind you', left: 'on your left' };

// ---------------------------------------------------------------- inventory

export class InventoryMenu extends Menu {
  constructor(game) {
    const items = () => Object.entries(game.player.inventory).filter(([, n]) => n > 0);
    super(game, { title: 'Inventory', items: [] });
    this.game = game;
    this.gameOverlay = true;
    this.build = () => {
      const list = items();
      this.rawItems = list.length
        ? list.map(([id, n]) => {
          const def = game.data.itemById.get(id);
          return {
            label: `${n > 1 ? `${n} ${def?.plural || def?.name}` : def?.name || id}`,
            hint: def?.use ? `Enter to ${def.use}. Right arrow to hear about it` : 'Right arrow to hear about it',
            onSelect: () => useItem(game, id, this),
            describeItem: () => def?.desc || '',
          };
        })
        : [{ label: 'Your pockets are empty', type: 'info' }];
    };
    this.build();
  }
  onEnter() {
    this.build();
    const n = this.rawItems.length;
    this.title = `Inventory, ${plural(n, 'item')}`;
    this.announce();
  }
  adjust(dir) {
    const it = this.items[this.index];
    if (dir > 0 && it?.describeItem) {
      this.say(it.describeItem());
      return;
    }
    super.adjust(dir);
  }
  onInput(inp) {
    if (inp.action === 'inventory') return this.close();
    if (inp.action === 'pauseHold') return this.game.events.emit('requestPause');
    return super.onInput(inp);
  }
  close() {
    super.close();
    this.game.events.emit('inventoryClosed', {});
  }
  back() {
    this.game.audio.play('ui_back', { bus: 'ui' });
    this.close();
  }
}

function adjacentDoor(game) {
  const p = game.player;
  const sides = game.world.sidesAt(p.room, p.x, p.y).filter((s) => game.world.doorOn(p.room, s));
  const s = sides.includes(p.facing) ? p.facing : sides[0];
  return s ? { side: s, door: game.world.doorOn(p.room, s) } : null;
}

export function useItem(game, id, menu) {
  const p = game.player;
  const def = game.data.itemById.get(id);
  const close = () => menu && game.stack.top === menu && menu.close();
  const say = (t) => game.say(t, { priority: 'urgent' });
  switch (id) {
    case 'bandage':
      if (p.health >= 100) return say('Your health is already full.');
      game.removeItem(id);
      p.health = Math.min(100, p.health + def.effect.health);
      game.busy(1.5);
      game.audio.play('bandage');
      close();
      return say(`You wrap the bandage tight. Health ${Math.round(p.health)}.`);
    case 'juice':
    case 'food':
      game.removeItem(id);
      p.exhaustion = Math.max(0, p.exhaustion + def.effect.exhaustion);
      if (def.effect.health) p.health = Math.min(100, p.health + def.effect.health);
      game.busy(1.2);
      game.audio.play(id === 'juice' ? 'drink' : 'eat');
      close();
      return say(`${id === 'juice' ? 'You drink the juice.' : 'You eat the granola bar.'} Your breathing steadies.`);
    case 'lure': {
      game.removeItem(id);
      close();
      game.busy(COST.lureThrow);
      let x = p.x;
      let y = p.y;
      for (let i = 0; i < 5; i++) {
        const nx = x + DVEC[p.facing][0];
        const ny = y + DVEC[p.facing][1];
        if (!game.world.isWalkable(p.room, nx, ny)) break;
        x = nx;
        y = ny;
      }
      game.audio.play('swing');
      game.soundscape.throwLure(p.room, x, y);
      game.noise(12, { room: p.room, x, y }, 'lure');
      if (game.encounter && game.rng.chance(0.7)) {
        const z = game.encounter.zombie;
        game.encounter = null;
        z.stunned = 0.5;
        z.state = 'investigate';
        z.lured = true;
        z.target = { room: p.room, x, y };
        z.path = null;
      }
      return say('You wind the alarm clock and toss it. It rings and rattles away from you.');
    }
    case 'wedge': {
      const d = adjacentDoor(game);
      if (!d || d.door.kind === 'passage') return say('Stand in a doorway first, then use the wedge to jam that door shut.');
      game.removeItem(id);
      d.door.state = 'closed';
      d.door.barricaded = true;
      game.world.invalidate();
      game.busy(COST.barricade);
      game.audio.play('barricade');
      close();
      return say(`You kick the wedge under the ${DIR_NAME[d.side]} door. Nothing gets through it now. Interact with the door to pull the wedge out later.`);
    }
    case 'monocular': return lookThroughMonocular(game, close);
    case 'radio': close(); return openRadio(game);
    case 'braille_card': {
      const lockId = Object.keys(p.knowledge).find((k) => game.world.locks.get(k)?.clue.type === 'braille');
      if (!lockId) return say(def.desc);
      const lock = game.world.locks.get(lockId);
      return say(`You check the braille against your card: number sign, then the letters for ${lock.code.split('').join(', ')}.`);
    }
    case 'cane': return say('Your cane taps ahead with every step. Press X to tap and measure the way ahead.');
    default:
      return say(def ? def.desc : 'Nothing happens.');
  }
}

function lookThroughMonocular(game, close) {
  const p = game.player;
  const w = game.world;
  const room = w.room(p.room);
  game.busy(1.5);
  close();
  if (room.zone === 'forest') {
    const here = w.worldPos(p.room, p.x, p.y);
    const ex = w.exitPos();
    return game.say(`No signs out here. Through the monocular you make out the beacon pole, to the ${compassWords(ex.x - here.x, ex.y - here.y)}.`, { priority: 'urgent' });
  }
  const route = w.roomRoute(p.room, w.f.exit.room, { passLocked: true });
  if (!route || !route.length) return game.say('You scan the room through the monocular but find no signs.', { priority: 'urgent' });
  const s = route[0].side;
  return game.say(`Through your monocular you read a large-print exit sign. Its arrow points to the ${DIR_NAME[s]} door, ${SIDE[relativeSide(s, p.facing)]}.`, { priority: 'urgent' });
}

// ---------------------------------------------------------------- radio

export function openRadio(game) {
  const p = game.player;
  const r = game.data.story.radio;
  if (!p.inventory.radio) return game.say(r.noRadio, { priority: 'urgent' });
  if (p.radioCharge <= 0) {
    if (!p.inventory.battery) {
      game.audio.play('ui_error', { bus: 'ui' });
      return game.say(r.noBattery, { priority: 'urgent' });
    }
    game.removeItem('battery');
    p.radioCharge = 2;
    game.say('You click a fresh battery into the radio.', { priority: 'urgent' });
  }
  p.radioCharge--;
  game.audio.play('radio_static');
  game.noise(3, p, 'player');
  return game.stack.push(new RadioDialog(game));
}

export class RadioDialog {
  constructor(game) {
    this.game = game;
    this.gameOverlay = true;
    this.menu = null;
  }
  onEnter() {
    const p = this.game.player;
    const steps = this.game.data.story.radio.steps;
    if (p.radioStep >= steps.length) {
      this.game.stack.pop(this);
      const text = `${this.game.data.story.radio.later} ${hintText(this.game, 2)}`;
      this.game.audio.play('radio_beep');
      this.game.say(text, { priority: 'urgent', voice: 'operator', category: 'narration' });
      return;
    }
    this.ask();
  }
  ask() {
    const g = this.game;
    const step = g.data.story.radio.steps[g.player.radioStep];
    const m = new Menu(g, {
      title: step.operator,
      items: step.choices.map((c) => ({ label: c.text, onSelect: () => this.choose(c, m) })),
      onBack: () => {
        g.stack.pop(m);
        g.stack.pop(this);
        g.say('You lower the radio.', { priority: 'urgent' });
      },
    });
    m.gameOverlay = true;
    m.say = (t) => g.say(t, { priority: 'urgent', voice: 'operator' });
    g.stack.push(m);
  }
  choose(c, m) {
    const g = this.game;
    const p = g.player;
    g.stack.pop(m);
    g.audio.play('radio_beep');
    let extra = '';
    if (c.advocate === 'route' && !p.advocated.route) {
      p.advocated.route = true;
      const obj = nextObjective(g);
      const route = g.world.roomRoute(p.room, g.world.f.exit.room, { passLocked: true });
      extra = ` ${route ? `To the exit: ${routeWords(route, p.facing)}` : ''} ${obj.type !== 'exit' ? hintText(g, 1) : ''}`;
    }
    if (c.advocate === 'time' && !p.advocated.time) {
      p.advocated.time = true;
      const bonus = g.facility.lengthMin >= 30 ? 120 : 60;
      g.clock.extend(bonus);
      extra = ` The clock is held for ${bonus === 120 ? 'two minutes' : 'one minute'}.`;
      g.events.emit('advocated', { kind: 'time', bonus });
    }
    if (c.end) {
      g.stack.pop(this);
      g.say(c.reply, { priority: 'urgent' });
      return;
    }
    p.radioStep++;
    g.events.emit('radio', { step: p.radioStep, good: !!c.good });
    g.say(`${c.reply}${extra}`, {
      priority: 'urgent',
      voice: 'operator',
      category: 'narration',
      onEnd: () => {
        if (g.stack.top !== this) return;
        if (p.radioStep < g.data.story.radio.steps.length && c.good) this.ask();
        else {
          g.stack.pop(this);
          g.say('Radio off.', { priority: 'normal', record: false });
        }
      },
    });
  }
  onInput(inp) {
    if (inp.action === 'escTap') {
      this.game.stack.pop(this);
      this.game.say('You lower the radio.', { priority: 'urgent' });
    }
  }
}

// ---------------------------------------------------------------- tactile map

export class MapView {
  constructor(game) {
    this.game = game;
    this.finger = game.player.room;
    this.gameOverlay = true;
  }
  known(id) {
    const g = this.game;
    if (g.player.mapRead || g.settings.visuals?.revealMap) return true;
    if (g.visited.has(id)) return true;
    // Rooms next to visited ones are "known" as doors, not by name.
    return false;
  }
  onEnter() {
    const g = this.game;
    const n = g.world.f.rooms.filter((r) => this.known(r.id)).length;
    g.say(`Tactile map. North is up. ${g.player.mapRead ? 'You read the full wall map.' : `You know ${plural(n, 'room')}.`} Arrow keys move your finger from room to room, by compass direction. Enter tells you the route there. Tap Escape or press M to close. ${this.describe()}`, { priority: 'urgent', category: 'desc' });
  }
  describe() {
    const g = this.game;
    const w = g.world;
    const r = w.room(this.finger);
    const here = this.finger === g.player.room ? 'You are here. ' : '';
    const visited = g.visited.has(r.id) ? '' : ' Not visited yet.';
    const exits = DIRS.filter((s) => r.doors[s] || r.exitSide === s).map((s) => {
      if (r.exitSide === s) return `${DIR_NAME[s]}, the exit`;
      const d = w.doorOn(r.id, s);
      const other = w.otherRoom(d, r.id);
      const name = this.known(other) ? w.room(other).name : 'unknown';
      const lock = w.isLocked(d) ? `, ${doorStateWords(w, d)}` : '';
      return `${DIR_NAME[s]} to ${name}${lock}`;
    });
    const items = [];
    if (r.id === w.f.exit.room) items.push('the exit');
    return `${here}${r.name}, ${r.floor}.${visited} Doors: ${exits.join('; ') || 'none'}.${items.length ? ` Marked: ${items.join(', ')}.` : ''}`;
  }
  onInput(inp) {
    const g = this.game;
    const a = inp.action;
    const dirMap = { forward: 'N', back: 'S', turnLeft: 'W', turnRight: 'E' };
    const codeMap = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E' };
    const d = dirMap[a] || codeMap[inp.code];
    if (d) {
      const door = g.world.doorOn(this.finger, d);
      if (!door) {
        g.audio.play('ui_error', { bus: 'ui' });
        g.say(`No door ${DIR_NAME[d]}.`, { priority: 'urgent', record: false });
        return;
      }
      const other = g.world.otherRoom(door, this.finger);
      if (!this.known(other)) {
        g.audio.play('ui_error', { bus: 'ui' });
        g.say(`A door ${DIR_NAME[d]}, to somewhere you haven't been.`, { priority: 'urgent', record: false });
        return;
      }
      this.finger = other;
      g.audio.play('ui_move', { bus: 'ui' });
      g.say(this.describe(), { priority: 'urgent', category: 'desc' });
      return;
    }
    if (a === 'interact') {
      const route = g.world.roomRoute(g.player.room, this.finger, { passLocked: true });
      g.say(route && route.length ? `Route to ${g.world.room(this.finger).name}: ${routeWords(route, g.player.facing)}` : 'That is where you are.', { priority: 'urgent', category: 'desc' });
      return;
    }
    if (a === 'escTap' || a === 'map') {
      g.stack.pop(this);
      g.say('Map closed.', { priority: 'urgent', record: false });
      return;
    }
    if (a === 'pauseHold') {
      g.events.emit('requestPause');
      return;
    }
    g.audio.play('ui_error', { bus: 'ui' });
  }
}

export { capitalize, withArticle };

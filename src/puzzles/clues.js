// Clue features and story objects found in rooms: memos, braille and large-print labels,
// ringing phones, beep-count recorders, music boxes, knock recordings, breaker panels,
// the tactile wall map and audio logs.

import { COST } from '../generator/costs.js';
import { fill } from '../core/format.js';
import { NOTE_FREQ, brailleDots, pitchFreq } from './checks.js';
import { doorLabel } from '../game/describe.js';
import { spaced } from '../game/hints.js';
import { compassWords } from '../core/dirs.js';

function learn(game, lock) {
  if (!game.player.knowledge[lock.id]) {
    game.player.knowledge[lock.id] = true;
    game.difficulty.onProgress('clue');
    game.events.emit('clue', { lock: lock.id, kind: lock.kind, type: lock.clue.type });
  }
}

export function interactFeature(game, room, f) {
  switch (f.type) {
    case 'memo': return readMemo(game, f);
    case 'map': return readMap(game, room);
    case 'log': return game.stack.push(new LogPlayer(game, f));
    case 'clue': return useClue(game, room, f);
    default:
      return game.say(`${f.name}.`, { priority: 'urgent' });
  }
}

function readMemo(game, f) {
  game.audio.play('page_turn');
  game.busy(COST.interact);
  game.say(game.data.story.memos[f.memo], { priority: 'urgent', category: 'narration' });
  game.events.emit('memo', { memo: f.memo });
}

function readMap(game, room) {
  const w = game.world;
  game.player.mapRead = true;
  game.busy(COST.interact);
  const here = w.roomCenter(room.id);
  const ex = w.exitPos();
  const floors = new Set(w.f.rooms.map((r) => r.floor)).size;
  game.say(
    `A tactile wall map. You trace the raised lines and read the raised lettering. You are here: ${room.name}. `
    + `The facility has ${w.f.rooms.length} rooms across ${floors} areas. The way out is marked at the forest edge, to the ${compassWords(ex.x - here.x, ex.y - here.y)}. `
    + 'Press M any time to explore the whole map by touch.',
    { priority: 'urgent', category: 'narration' },
  );
  game.events.emit('mapRead', {});
}

function lockOf(game, f) {
  return game.world.locks.get(f.clue.lockId);
}

function useClue(game, room, f) {
  const lock = lockOf(game, f);
  const story = game.data.story.clues;
  const door = doorLabel(game.world, lock);
  game.busy(COST.interact);
  switch (f.clue.type) {
    case 'memo':
      game.audio.play('page_turn');
      game.say(fill(story.memo, { door, code: spaced(lock.code) }), { priority: 'urgent', category: 'narration' });
      learn(game, lock);
      return;
    case 'largeprint':
      game.say(fill(story.largeprint, { door, code: spaced(lock.code), fixture: 'cabinet' }), { priority: 'urgent', category: 'narration' });
      learn(game, lock);
      return;
    case 'braille': {
      let text = fill(story.braille, { door, dots: brailleDots(lock.code), fixture: 'shelf' });
      text += ` ${game.player.inventory.braille_card ? fill(story.braille_card, { code: spaced(lock.code) }) : story.braille_nocard}`;
      game.say(text, { priority: 'urgent', category: 'narration' });
      learn(game, lock);
      return;
    }
    case 'phone':
      f.answered = true;
      game.audio.play('radio_static');
      game.say(fill(story.phone, { door, code: spaced(lock.code) }), { priority: 'urgent', category: 'narration', voice: game.data.story.phoneVoice });
      learn(game, lock);
      return;
    case 'recorder_beeps': return playBeeps(game, f, lock, fill(story.recorder_beeps, { door }));
    case 'melody': return playMelody(game, f, lock, fill(story.melody, { door }));
    case 'rhythm': return playKnock(game, f, lock, fill(story.rhythm, { door }));
    case 'breaker': return game.stack.push(new BreakerPanel(game, f, lock, fill(story.breaker, { door, rule: game.data.story.breakerRules[lock.rule] })));
    default:
      return game.say(`${f.name}.`, { priority: 'urgent' });
  }
}

function fixturePos(game, f) {
  const p = game.player;
  return game.world.worldPos(p.room, f.x, f.y);
}

function playBeeps(game, f, lock, intro) {
  game.audio.play('tape_click', { pos: fixturePos(game, f) });
  game.say(intro, {
    priority: 'urgent',
    category: 'narration',
    onEnd: () => {
      const pos = fixturePos(game, f);
      let t = 0.3;
      for (const ch of lock.code) {
        const d = Number(ch);
        if (d === 0) {
          game.audio.tone(600, COST.longTone, { delay: t, gain: 0.3, pos });
          t += COST.longTone;
        } else {
          for (let i = 0; i < d; i++) {
            game.audio.tone(1000, 0.12, { delay: t, gain: 0.3, pos });
            t += COST.beep;
          }
        }
        t += COST.beepGap;
      }
      game.busy(t);
      game.after(t, () => {
        learn(game, lock);
        game.audio.play('tape_click', { pos });
        game.say('The recorder clicks off. Interact again to replay it.', { priority: 'normal' });
      });
    },
  });
}

function playMelody(game, f, lock, intro) {
  game.say(intro, {
    priority: 'urgent',
    category: 'narration',
    onEnd: () => {
      const pos = fixturePos(game, f);
      lock.melody.forEach((n, i) => game.audio.tone(NOTE_FREQ[n], 0.4, { delay: 0.3 + i * COST.noteListen, gain: 0.3, type: 'triangle', pos }));
      const t = 0.3 + lock.melody.length * COST.noteListen;
      game.busy(t);
      game.after(t, () => {
        learn(game, lock);
        game.say('The music box winds down. Interact again to hear it again.', { priority: 'normal' });
      });
    },
  });
}

function playKnock(game, f, lock, intro) {
  game.audio.play('tape_click', { pos: fixturePos(game, f) });
  game.say(intro, {
    priority: 'urgent',
    category: 'narration',
    onEnd: () => {
      const pos = fixturePos(game, f);
      let t = 0.3;
      game.audio.play('door_close', { delay: t, pos, rate: 1.4, gain: 0.6 });
      for (const gap of lock.rhythm) {
        t += gap * COST.rhythmUnit;
        game.audio.play('door_close', { delay: t, pos, rate: 1.4, gain: 0.6 });
      }
      t += COST.rhythmUnit;
      game.busy(t);
      game.after(t, () => {
        learn(game, lock);
        game.say('End of recording. Interact again to replay it.', { priority: 'normal' });
      });
    },
  });
}

/** Power routing: choose the circuit whose hum matches the note's rule. */
export class BreakerPanel {
  constructor(game, f, lock, intro) {
    this.game = game;
    this.f = f;
    this.lock = lock;
    this.intro = intro;
    this.index = 0;
    this.hum = null;
    this.gameOverlay = true;
    this.pos = fixturePos(game, f);
  }
  onEnter() {
    this.game.say(`${this.intro} Left and Right arrows choose one of ${this.lock.circuits.length} circuits; listen to each hum. Press Enter to route power. Tap Escape to step away.`, { priority: 'urgent', category: 'narration' });
    this.select(0, true);
  }
  onExit() {
    this.hum?.stop();
  }
  select(i, quiet = false) {
    this.index = i;
    this.hum?.stop();
    const c = this.lock.circuits[i];
    this.hum = this.game.audio.startTone(c.freq, { type: 'sawtooth', gain: 0.07, pos: this.pos, pulse: c.pulse ? 3 : 0 });
    if (!quiet) this.game.say(`Circuit ${i + 1}.`, { priority: 'urgent', record: false });
  }
  onInput(inp) {
    const n = this.lock.circuits.length;
    const a = inp.action;
    if (a === 'turnLeft' || inp.code === 'ArrowLeft' || a === 'forward') return this.select((this.index + n - 1) % n);
    if (a === 'turnRight' || inp.code === 'ArrowRight' || a === 'back') return this.select((this.index + 1) % n);
    if (a === 'escTap') {
      this.game.stack.pop(this);
      return this.game.say('You step back from the breaker panel.', { priority: 'urgent' });
    }
    if (a === 'pauseHold') return this.game.events.emit('requestPause');
    if (a === 'repeat') return this.onEnter();
    if (a === 'hint') {
      if (this.game.mode !== 'tutorial') this.game.clock.penalize(this.game.difficulty.hintCost);
      this.game.stats.hints++;
      return this.game.say(`Hint. The note says ${this.game.data.story.breakerRules[this.lock.rule]}. That's circuit ${this.lock.answer + 1}.`, { priority: 'urgent' });
    }
    if (a === 'interact') {
      const g = this.game;
      g.busy(COST.interact);
      if (this.index === this.lock.answer) {
        const pd = g.world.door(this.lock.doorId);
        pd.powered = true;
        pd.unlocked = true;
        g.world.invalidate();
        g.audio.play('power_up', { pos: this.pos });
        g.stack.pop(this);
        learn(g, this.lock);
        g.events.emit('puzzleSolved', { lock: this.lock.id, kind: 'power' });
        g.say(`Power routed. Somewhere, a door panel chirps to life. The ${doorLabel(g.world, this.lock)} has power now.`, { priority: 'urgent' });
      } else {
        g.audio.play('spark', { pos: this.pos });
        g.noise(8, g.player, 'player');
        g.events.emit('puzzleFailed', { lock: this.lock.id, kind: 'power' });
        g.say('Sparks crack from the panel! Wrong circuit, and loud.', { priority: 'urgent' });
      }
      return undefined;
    }
    this.game.audio.play('ui_error', { bus: 'ui' });
    return undefined;
  }
}

/** Audio logs: choose to hear one in full; the clock pauses while it plays. */
export class LogPlayer {
  constructor(game, f) {
    this.game = game;
    this.f = f;
    this.log = game.data.logById.get(f.logId);
    this.playing = false;
    this.gameOverlay = true;
  }
  onEnter() {
    const heard = this.game.player.logsHeard.includes(this.log.id);
    this.game.audio.play('tape_click');
    this.game.say(`An audio recorder labeled: ${this.log.title}.${heard ? ' You have heard this one.' : ''} Press Enter to play it in full; the clock pauses while it plays. Tap Escape or walk away to leave it.`, { priority: 'urgent' });
  }
  onExit() {
    if (this.playing) this.game.speech.stop();
  }
  onInput(inp) {
    const a = inp.action;
    if (a === 'interact' && !this.playing) {
      this.playing = true;
      const lines = this.log.lines;
      lines.forEach((l, i) => this.game.speech.say(l, {
        category: 'log',
        voice: this.log.voice,
        onEnd: i === lines.length - 1 ? ({ canceled }) => {
          this.playing = false;
          if (!canceled) {
            if (!this.game.player.logsHeard.includes(this.log.id)) this.game.player.logsHeard.push(this.log.id);
            this.game.audio.play('tape_click');
            this.game.events.emit('logHeard', { log: this.log.id });
            this.game.say(`End of recording. ${this.game.player.logsHeard.length} of ${this.game.facility.logs.length} logs found.`, { priority: 'normal' });
          }
          if (this.game.stack.top === this) this.game.stack.pop(this);
        } : undefined,
      }));
      return;
    }
    if (a === 'pauseHold') return this.game.events.emit('requestPause');
    // Anything else leaves the recorder (and moving passes through to the game).
    this.game.stack.pop(this);
    if (a !== 'escTap' && a !== 'interact') this.game.onInput(inp);
    else this.game.say('You leave the recorder.', { priority: 'urgent', record: false });
    return undefined;
  }
}

export { pitchFreq };

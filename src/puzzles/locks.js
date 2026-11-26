// Interactive lock puzzles at doors: keypad, chime (sound-sequence memory),
// pitch matching against a tuning fork, and rhythm-tap knock locks.
// Each is a handler pushed on top of the game; the world keeps running.

import { COST } from '../generator/costs.js';
import { checkKeypad, checkSequence, checkPitch, checkRhythm, NOTE_FREQ, pitchFreq } from './checks.js';
import { lockName } from '../game/describe.js';
import { spaced } from '../game/hints.js';

const ARROWS = { forward: 'up', turnRight: 'right', back: 'down', turnLeft: 'left' };
const ARROW_CODES = { ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left' };

class LockPuzzle {
  constructor(game, lock, door) {
    this.game = game;
    this.lock = lock;
    this.door = door;
    this.gameOverlay = true;
    this.attempts = 0;
    this.pos = game.world.worldPos(game.player.room, game.player.x, game.player.y);
  }
  say(t, o = {}) {
    this.game.say(t, { priority: 'urgent', ...o });
  }
  close() {
    this.game.stack.pop(this);
  }
  solved(text) {
    this.close();
    this.game.busy(COST.keypadSubmit);
    this.game.unlockDoor(this.door, text);
    this.game.events.emit('puzzleSolved', { lock: this.lock.id, kind: this.lock.kind, attempts: this.attempts });
  }
  failed(text) {
    this.attempts++;
    this.game.audio.play('keypad_bad');
    this.game.noise(4, this.game.player, 'player');
    this.game.events.emit('puzzleFailed', { lock: this.lock.id, kind: this.lock.kind });
    this.say(text);
  }
  hintCost() {
    if (this.game.mode !== 'tutorial') this.game.clock.penalize(this.game.difficulty.hintCost);
    this.game.stats.hints++;
    this.game.audio.play('ui_hint', { bus: 'ui' });
  }
  common(inp) {
    const a = inp.action;
    if (a === 'escTap') {
      this.close();
      this.say('You step back from the lock.');
      return true;
    }
    if (a === 'pauseHold') {
      this.game.events.emit('requestPause');
      return true;
    }
    if (['time', 'status', 'listen', 'compass'].includes(a)) {
      this.game.onInput(inp);
      return true;
    }
    if (a === 'hint') {
      this.hintCost();
      this.say(`Hint. ${this.hint()}`);
      return true;
    }
    if (a === 'repeat') {
      this.onEnter();
      return true;
    }
    return false;
  }
  hint() {
    return '';
  }
}

export class KeypadPuzzle extends LockPuzzle {
  constructor(...a) {
    super(...a);
    this.entry = '';
  }
  onEnter() {
    this.say(`Keypad. Type the ${this.lock.code.length}-digit code with the number keys, then press Enter. Backspace clears. Tap Escape to step away.`);
  }
  hint() {
    if (this.game.player.knowledge[this.lock.id]) return `The clue said: ${spaced(this.lock.code)}.`;
    return 'You have not found the code yet. It is written, spoken or beeped somewhere in a side room. Tap Escape and explore.';
  }
  onInput(inp) {
    if (this.common(inp)) return;
    const m = /^(?:Digit|Numpad)(\d)$/.exec(inp.code || '');
    if (m) {
      if (this.entry.length >= this.lock.code.length) {
        this.game.audio.play('ui_error', { bus: 'ui' });
        return;
      }
      this.entry += m[1];
      this.game.audio.tone(700 + Number(m[1]) * 60, 0.09, { gain: 0.25, pos: this.pos });
      this.say(m[1], { record: false });
      return;
    }
    if (inp.code === 'Backspace') {
      this.entry = '';
      this.game.audio.play('ui_back', { bus: 'ui' });
      this.say('Cleared.');
      return;
    }
    if (inp.code === 'Enter' || inp.code === 'NumpadEnter' || inp.action === 'interact') {
      if (this.entry.length < this.lock.code.length) {
        this.game.audio.play('ui_error', { bus: 'ui' });
        this.say(`That's only ${this.entry.length} digits. The code has ${this.lock.code.length}.`);
        return;
      }
      if (checkKeypad(this.lock.code, this.entry)) {
        this.game.audio.play('keypad_ok');
        this.solved('Correct code. The lock clicks open.');
      } else {
        this.entry = '';
        this.failed('Wrong code. The keypad buzzes. Try again.');
      }
      return;
    }
    this.game.audio.play('ui_error', { bus: 'ui' });
  }
}

export class SequencePuzzle extends LockPuzzle {
  constructor(...a) {
    super(...a);
    this.entry = [];
  }
  onEnter() {
    this.say(`Chime lock. ${this.lock.melody.length} notes. Up, Right, Down and Left arrows each play a different note. Play the chime to open it. Backspace starts over. Tap Escape to step away.`);
  }
  hint() {
    if (this.game.player.knowledge[this.lock.id]) return `The music box played: ${this.lock.melody.join(', ')}.`;
    return 'A music box somewhere off the main route plays this chime. Find it and listen.';
  }
  onInput(inp) {
    if (this.common(inp)) return;
    const note = ARROWS[inp.action] || ARROW_CODES[inp.code];
    if (note) {
      if (inp.repeat) return;
      this.entry.push(note);
      this.game.audio.tone(NOTE_FREQ[note], 0.35, { gain: 0.3, type: 'triangle', pos: this.pos });
      if (this.entry.length === this.lock.melody.length) {
        const ok = checkSequence(this.lock.melody, this.entry);
        this.entry = [];
        if (ok) this.game.after(0.4, () => this.solved('The chime rings true. The lock opens.'));
        else this.game.after(0.4, () => this.failed('A sour buzz. Wrong chime. Start again.'));
      }
      return;
    }
    if (inp.code === 'Backspace') {
      this.entry = [];
      this.say('Starting over.');
      return;
    }
    this.game.audio.play('ui_error', { bus: 'ui' });
  }
}

export class PitchPuzzle extends LockPuzzle {
  constructor(...a) {
    super(...a);
    this.value = this.lock.startStep;
    this.toneH = null;
  }
  onEnter() {
    if (!this.game.player.inventory.tuning_fork) {
      this.game.audio.play('door_locked');
      this.say('A pitch lock. It hums one note, waiting for a reference tone. You need a tuning fork to set it.');
      this.game.after(0, () => this.close());
      return;
    }
    this.toneH = this.game.audio.startTone(pitchFreq(this.value), { gain: 0.12, pos: this.pos });
    this.say('Pitch lock. Space strikes your tuning fork. Up and Down arrows raise and lower the lock tone. When the two tones match and stop wobbling, press Enter. Tap Escape to step away.');
  }
  onExit() {
    this.toneH?.stop();
  }
  hint() {
    const d = this.lock.target - this.value;
    if (d === 0) return 'They match now. Press Enter.';
    return `Go ${d > 0 ? 'higher' : 'lower'} by ${Math.abs(d)} ${Math.abs(d) === 1 ? 'step' : 'steps'}.`;
  }
  onInput(inp) {
    if (this.common(inp)) return;
    if (inp.code === 'Space') {
      this.game.audio.tone(pitchFreq(this.lock.target), 2.2, { gain: 0.18, release: 1.6, pos: this.pos });
      return;
    }
    const dir = inp.action === 'forward' || inp.code === 'ArrowUp' ? 1 : inp.action === 'back' || inp.code === 'ArrowDown' ? -1 : 0;
    if (dir) {
      const nv = Math.min(11, Math.max(0, this.value + dir));
      if (nv === this.value) {
        this.game.audio.play('ui_error', { bus: 'ui' });
        this.say(dir > 0 ? 'Highest setting.' : 'Lowest setting.', { record: false });
        return;
      }
      this.value = nv;
      this.toneH?.setFreq(pitchFreq(nv));
      return;
    }
    if (inp.code === 'Enter' || inp.code === 'NumpadEnter') {
      if (checkPitch(this.lock.target, this.value)) {
        this.game.audio.play('keypad_ok');
        this.solved('The tones lock together. The door releases.');
      } else this.failed('The lock grinds. Not matched yet.');
      return;
    }
    this.game.audio.play('ui_error', { bus: 'ui' });
  }
}

export class RhythmPuzzle extends LockPuzzle {
  constructor(...a) {
    super(...a);
    this.taps = [];
    this.idle = 0;
  }
  onEnter() {
    this.say(`Knock lock. Tap the secret knock with the Space bar, ${this.lock.rhythm.length + 1} knocks. Tap Escape to step away.`);
  }
  hint() {
    if (this.game.player.knowledge[this.lock.id]) return `The knock is ${this.lock.rhythm.length + 1} knocks with ${this.lock.rhythm.map((v) => (v === 1 ? 'short' : 'long')).join(', ')} gaps.`;
    return "Officer Ortiz recorded the knock. Find the voice recorder off the main route.";
  }
  update(dt) {
    if (!this.taps.length) return;
    this.idle += dt;
    if (this.idle > 2.5) {
      this.taps = [];
      this.failed('Too slow. The lock resets. Start the knock again.');
    }
  }
  onInput(inp) {
    if (this.common(inp)) return;
    if (inp.code === 'Space' || inp.code === 'Enter') {
      if (inp.repeat) return;
      this.taps.push(this.game.time);
      this.idle = 0;
      this.game.audio.play('door_close', { pos: this.pos, gain: 0.5, rate: 1.4 });
      if (this.taps.length === this.lock.rhythm.length + 1) {
        const tol = this.game.assist ? 0.5 : 0.35;
        const ok = checkRhythm(this.lock.rhythm, this.taps, tol);
        this.taps = [];
        if (ok) this.game.after(0.3, () => this.solved('The bolt slides back. That was the knock.'));
        else this.game.after(0.3, () => this.failed('Nothing happens. The rhythm was off. Try again.'));
      }
      return;
    }
    this.game.audio.play('ui_error', { bus: 'ui' });
  }
}

export function openLockPuzzle(game, lock, door) {
  const P = { keypad: KeypadPuzzle, sequence: SequencePuzzle, pitch: PitchPuzzle, rhythm: RhythmPuzzle }[lock.kind];
  if (!P) {
    game.say(`A ${lockName(lock)}.`, { priority: 'urgent' });
    return null;
  }
  return game.stack.push(new P(game, lock, door));
}

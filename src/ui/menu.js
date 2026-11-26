// Spoken menus. Up/Down move, Enter/Space select, Left/Right adjust sliders and
// choices, Escape tap or Backspace goes back. Everything is announced.

const UP = new Set(['forward', 'ArrowUp']);
const DOWN = new Set(['back', 'ArrowDown']);
const LEFT = new Set(['turnLeft', 'ArrowLeft']);
const RIGHT = new Set(['turnRight', 'ArrowRight']);

export class Menu {
  /**
   * @param ctx { speech, audio, stack }
   * @param opts { title, items, intro, onBack, closeOnBack=true, announceCount=true }
   * item: { label, type: 'action'|'toggle'|'slider'|'choice'|'info', onSelect, get, set,
   *         min, max, step, format, options:[{value,label}], hint, hidden() }
   */
  constructor(ctx, opts) {
    this.ctx = ctx;
    this.title = opts.title;
    this.rawItems = opts.items;
    this.intro = opts.intro;
    this.onBack = opts.onBack;
    this.closeOnBack = opts.closeOnBack !== false;
    this.index = opts.startIndex || 0;
    this.modal = true;
  }
  get items() {
    return this.rawItems.filter((it) => !it.hidden?.());
  }
  say(text, interrupt = true) {
    this.ctx.speech.say(text, { priority: interrupt ? 'urgent' : 'normal', category: 'ui' });
  }
  sound(id) {
    this.ctx.audio.play(id, { bus: 'ui' });
  }
  label(it) {
    return typeof it.label === 'function' ? it.label() : it.label;
  }
  valueText(it) {
    switch (it.type) {
      case 'toggle': return it.get() ? 'on' : 'off';
      case 'slider': return it.format ? it.format(it.get()) : String(Math.round(it.get() * 100) / 100);
      case 'choice': {
        const v = it.get();
        return (it.options.find((o) => o.value === v) || it.options[0]).label;
      }
      default: return '';
    }
  }
  describe(it, withPosition = true) {
    const items = this.items;
    let s = this.label(it);
    if (it.type === 'toggle' || it.type === 'slider' || it.type === 'choice') s += `, ${this.valueText(it)}`;
    if (withPosition) s += `. ${items.indexOf(it) + 1} of ${items.length}`;
    if (it.type === 'slider' || it.type === 'choice') s += '. Left and right arrows change it';
    if (it.hint) s += `. ${it.hint}`;
    return `${s}.`;
  }
  onEnter() {
    this.announce();
  }
  onResume() {
    this.clampIndex();
    this.say(this.describe(this.items[this.index]));
  }
  announce() {
    this.clampIndex();
    const it = this.items[this.index];
    const head = [this.title, this.intro].filter(Boolean).join('. ');
    this.say(`${head ? `${head}. ` : ''}${it ? this.describe(it) : ''}`);
  }
  clampIndex() {
    const n = this.items.length;
    if (this.index >= n) this.index = Math.max(0, n - 1);
  }
  move(delta) {
    const n = this.items.length;
    if (!n) return;
    this.index = (this.index + delta + n) % n;
    this.sound('ui_move');
    this.say(this.describe(this.items[this.index]));
  }
  adjust(dir) {
    const it = this.items[this.index];
    if (!it) return;
    if (it.type === 'slider') {
      const v = Math.min(it.max, Math.max(it.min, Math.round((it.get() + dir * it.step) * 1000) / 1000));
      it.set(v);
      this.sound('ui_tick');
      this.say(this.valueText(it));
    } else if (it.type === 'choice') {
      const i = it.options.findIndex((o) => o.value === it.get());
      const o = it.options[(i + dir + it.options.length) % it.options.length];
      it.set(o.value);
      this.sound('ui_tick');
      this.say(o.label);
    } else if (it.type === 'toggle') {
      this.activate();
    } else {
      this.sound('ui_error');
    }
  }
  activate() {
    const it = this.items[this.index];
    if (!it) return;
    if (it.type === 'toggle') {
      it.set(!it.get());
      this.sound('ui_select');
      this.say(`${this.label(it)}, ${this.valueText(it)}.`);
      return;
    }
    if (it.type === 'slider' || it.type === 'choice') {
      this.say(this.describe(it, false));
      return;
    }
    if (it.type === 'info') {
      this.say(this.label(it));
      return;
    }
    this.sound('ui_select');
    it.onSelect?.(this);
  }
  back() {
    this.sound('ui_back');
    if (this.onBack) this.onBack(this);
    else if (this.closeOnBack) this.ctx.stack.pop(this);
  }
  close() {
    this.ctx.stack.pop(this);
  }
  onInput({ action, code }) {
    if (UP.has(action) || code === 'ArrowUp') return this.move(-1);
    if (DOWN.has(action) || code === 'ArrowDown') return this.move(1);
    if (LEFT.has(action) || code === 'ArrowLeft') return this.adjust(-1);
    if (RIGHT.has(action) || code === 'ArrowRight') return this.adjust(1);
    if (code === 'Home') { this.index = 0; return this.move(0); }
    if (code === 'End') { this.index = this.items.length - 1; return this.move(0); }
    if (action === 'interact') return this.activate();
    if (action === 'escTap' || code === 'Backspace') return this.back();
    if (action === 'repeat' || action === 'repeatFull') return this.announce();
    if (action === 'pauseHold') return this.back();
    // Jump by first letter.
    if (code?.startsWith('Key')) {
      const letter = code.slice(3).toLowerCase();
      const items = this.items;
      for (let k = 1; k <= items.length; k++) {
        const it = items[(this.index + k) % items.length];
        if (this.label(it).toLowerCase().startsWith(letter)) {
          this.index = items.indexOf(it);
          return this.move(0);
        }
      }
    }
    this.sound('ui_error');
    return undefined;
  }
}

/** Simple yes/no confirmation. */
export function confirmMenu(ctx, question, onYes, onNo) {
  const m = new Menu(ctx, {
    title: question,
    items: [
      { label: 'Yes', onSelect: () => { ctx.stack.pop(m); onYes(); } },
      { label: 'No', onSelect: () => { ctx.stack.pop(m); onNo?.(); } },
    ],
    onBack: () => { ctx.stack.pop(m); onNo?.(); },
  });
  return m;
}

/** Spoken text entry (teacher seed codes). Letters, digits, space and hyphen. */
export class TextEntry {
  constructor(ctx, { prompt, onDone, onCancel, initial = '' }) {
    this.ctx = ctx;
    this.prompt = prompt;
    this.onDone = onDone;
    this.onCancel = onCancel;
    this.value = initial;
    this.modal = true;
  }
  onEnter() {
    this.ctx.speech.say(`${this.prompt}. Type, then press Enter. Backspace deletes. Escape cancels.`, { priority: 'urgent' });
  }
  onInput({ action, code, key }) {
    if (code === 'Enter' || code === 'NumpadEnter') {
      this.ctx.stack.pop(this);
      this.onDone(this.value.trim());
      return;
    }
    if (action === 'escTap') {
      this.ctx.stack.pop(this);
      this.onCancel?.();
      return;
    }
    if (code === 'Backspace') {
      const removed = this.value.slice(-1);
      this.value = this.value.slice(0, -1);
      this.ctx.speech.say(removed ? `deleted ${removed === ' ' ? 'space' : removed}` : 'empty', { priority: 'urgent' });
      return;
    }
    if (key && key.length === 1 && /[a-z0-9 \-]/i.test(key)) {
      this.value += key.toLowerCase();
      this.ctx.speech.say(key === ' ' ? 'space' : key === '-' ? 'dash' : key, { priority: 'urgent' });
      return;
    }
    if (action === 'repeat') this.ctx.speech.say(this.value ? `You typed: ${this.value}` : 'Nothing typed yet.', { priority: 'urgent' });
  }
}

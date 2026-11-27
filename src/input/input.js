// Keyboard input: maps physical keys (event.code) to actions through a remappable
// keymap, tracks held keys, and implements "hold Escape 1.5 s to pause".

const MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);
export const ESC_HOLD_MS = 1500;
export const TEACHER_HOLD_MS = 3000;
const ZOOM_CODES = new Set(['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0']);

/** Ctrl (or Cmd) with plus, minus or zero: the browser's own zoom keys. */
export function isZoomKey(e) {
  return (e.ctrlKey || e.metaKey) && !e.altKey && ZOOM_CODES.has(e.code);
}

export function comboFor(e) {
  if (MODIFIER_CODES.has(e.code)) return e.code;
  let c = '';
  if (e.ctrlKey) c += 'Ctrl+';
  if (e.altKey) c += 'Alt+';
  if (e.shiftKey) c += 'Shift+';
  return c + e.code;
}

/** Build combo -> action lookup. */
export function buildLookup(keymap) {
  const map = new Map();
  for (const [action, keys] of Object.entries(keymap)) for (const k of keys) if (!map.has(k)) map.set(k, action);
  return map;
}

/** Resolve an action for a key event: exact combo first, then the bare key (so Shift+Up still moves). */
export function resolveAction(lookup, e) {
  const exact = lookup.get(comboFor(e));
  if (exact) return exact;
  if (MODIFIER_CODES.has(e.code)) return null;
  return lookup.get(e.code) || null;
}

export class Input {
  constructor({ target = globalThis.window, keymap, onInput, onRelease, allowZoom = () => true }) {
    this.target = target;
    this.allowZoom = allowZoom;
    this.onInput = onInput;
    this.onRelease = onRelease;
    this.held = new Set();
    this.setKeymap(keymap);
    this.escTimer = null;
    this.escFired = false;
    this.teacherTimer = null;
    this.capture = null; // one-shot raw key capture (remapping)
    this._down = (e) => this.keydown(e);
    this._up = (e) => this.keyup(e);
    this._blur = () => this.releaseAll();
    target.addEventListener('keydown', this._down, { capture: true });
    target.addEventListener('keyup', this._up, { capture: true });
    target.addEventListener('blur', this._blur);
  }
  setKeymap(keymap) {
    this.keymap = keymap;
    this.lookup = buildLookup(keymap);
  }
  isHeld(action) {
    return (this.keymap[action] || []).some((k) => this.held.has(k.split('+').pop()));
  }
  releaseAll() {
    for (const code of [...this.held]) this.onRelease?.({ code, action: this.lookup.get(code) });
    this.held.clear();
    clearTimeout(this.escTimer);
    clearTimeout(this.teacherTimer);
  }
  keydown(e) {
    // Low-vision players need the browser's zoom: let Ctrl+Plus/Minus/0 through untouched.
    if (!this.capture && isZoomKey(e) && this.allowZoom()) return;
    // Stop the browser from scrolling, opening find bars, reloading, etc.
    e.preventDefault();
    e.stopPropagation();
    if (this.capture) {
      if (MODIFIER_CODES.has(e.code) && !this.capture.allowModifiers) return;
      const cb = this.capture.fn;
      this.capture = null;
      cb(e);
      return;
    }
    const repeat = e.repeat || this.held.has(e.code);
    this.held.add(e.code);

    // Teacher panel: hold Ctrl + Shift + Backquote for 3 seconds.
    if (e.code === 'Backquote' && e.ctrlKey && e.shiftKey && !repeat) {
      clearTimeout(this.teacherTimer);
      this.teacherTimer = setTimeout(() => this.onInput({ action: 'teacherHold', code: e.code, event: e }), TEACHER_HOLD_MS);
      return;
    }

    if (e.code === 'Escape') {
      if (repeat) return;
      this.escFired = false;
      clearTimeout(this.escTimer);
      this.escTimer = setTimeout(() => {
        this.escFired = true;
        this.onInput({ action: 'pauseHold', code: 'Escape', event: e });
      }, ESC_HOLD_MS);
      return;
    }
    const action = resolveAction(this.lookup, e);
    this.onInput({ action, code: e.code, key: e.key, repeat, shift: e.shiftKey, ctrl: e.ctrlKey, event: e });
  }
  keyup(e) {
    if (isZoomKey(e) && this.allowZoom()) return;
    e.preventDefault();
    this.held.delete(e.code);
    if (e.code === 'Backquote') clearTimeout(this.teacherTimer);
    if (e.code === 'Escape') {
      clearTimeout(this.escTimer);
      if (!this.escFired) this.onInput({ action: 'escTap', code: 'Escape', event: e });
      this.escFired = false;
    }
    this.onRelease?.({ code: e.code, action: this.lookup.get(e.code) });
  }
  /** Capture the very next key press (used when remapping controls). */
  captureNext(fn, allowModifiers = false) {
    this.capture = { fn, allowModifiers };
  }
  destroy() {
    this.target.removeEventListener('keydown', this._down, { capture: true });
    this.target.removeEventListener('keyup', this._up, { capture: true });
    this.target.removeEventListener('blur', this._blur);
  }
}

/** Speakable name for a key code, e.g. "KeyR" -> "R", "Shift+KeyR" -> "Shift plus R". */
export function keyName(combo) {
  return combo.split('+').map((p) => {
    if (p.startsWith('Key')) return p.slice(3);
    if (p.startsWith('Digit')) return p.slice(5);
    if (p.startsWith('Arrow')) return `${p.slice(5)} arrow`;
    if (p.startsWith('Numpad')) return `keypad ${p.slice(6)}`;
    return { Space: 'Space', Enter: 'Enter', ShiftLeft: 'left Shift', ShiftRight: 'right Shift', ControlLeft: 'left Control', ControlRight: 'right Control', Slash: 'Slash', Ctrl: 'Control', Backquote: 'back quote' }[p] || p;
  }).join(' plus ');
}

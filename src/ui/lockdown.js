// Fullscreen "lockdown" play mode: fullscreen + Keyboard Lock (Chromium) + Pointer Lock,
// with the mouse, right-click, selection, drag and zoom neutralized.
// Browsers always let a user leave fullscreen (held Escape), and no web page can block
// the Windows key or Ctrl+Alt+Del, so the game autosaves and pauses when that happens.

export class Lockdown {
  constructor({ element, onLost }) {
    this.el = element;
    this.onLost = onLost;
    this.wanted = false;
    this.blockers = [];
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.wanted) this.onLost?.('fullscreen');
    });
    document.addEventListener('pointerlockchange', () => {
      document.body.classList.toggle('pointer-locked', document.pointerLockElement === this.el);
    });
  }
  get active() {
    return !!document.fullscreenElement;
  }
  /** Must be called from a user gesture (key press). */
  async enter() {
    this.wanted = true;
    this.block(true);
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch { /* not allowed: carry on windowed */ }
    try {
      if (navigator.keyboard?.lock) await navigator.keyboard.lock();
    } catch { /* Keyboard Lock only works in fullscreen on Chromium browsers */ }
    try {
      const r = this.el.requestPointerLock?.();
      if (r?.catch) r.catch(() => {});
    } catch { /* ignore */ }
    document.body.classList.add('lockdown');
  }
  exit() {
    this.wanted = false;
    this.block(false);
    try { navigator.keyboard?.unlock?.(); } catch { /* ignore */ }
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* ignore */ }
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ignore */ }
    document.body.classList.remove('lockdown');
  }
  block(on) {
    for (const [t, ev, fn, o] of this.blockers) t.removeEventListener(ev, fn, o);
    this.blockers = [];
    if (!on) return;
    const stop = (e) => {
      if (!e.isTrusted) return; // let the game's own file picker and downloads through
      e.preventDefault();
      e.stopPropagation();
    };
    const add = (t, ev, fn, o = { passive: false, capture: true }) => {
      t.addEventListener(ev, fn, o);
      this.blockers.push([t, ev, fn, o]);
    };
    for (const ev of ['contextmenu', 'selectstart', 'dragstart', 'drop', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'gesturestart', 'touchmove']) add(document, ev, stop);
    add(document, 'wheel', stop);
  }
}

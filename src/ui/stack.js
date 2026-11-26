// A stack of input handlers. The top handler receives every action, so menus,
// puzzles and dialogs can sit on top of gameplay. Pure (no DOM), testable in Node.

export class UIStack {
  constructor() {
    this.stack = [];
  }
  get top() {
    return this.stack[this.stack.length - 1] || null;
  }
  push(h) {
    this.stack.push(h);
    h.onEnter?.();
    return h;
  }
  pop(h) {
    if (h && this.top !== h) {
      const i = this.stack.indexOf(h);
      if (i >= 0) {
        this.stack.splice(i, 1);
        h.onExit?.();
      }
      return;
    }
    const out = this.stack.pop();
    out?.onExit?.();
    this.top?.onResume?.();
    return out;
  }
  replace(h) {
    const old = this.stack.pop();
    old?.onExit?.();
    return this.push(h);
  }
  clear() {
    while (this.stack.length) this.stack.pop().onExit?.();
  }
  contains(pred) {
    return this.stack.some(pred);
  }
  dispatch(input) {
    const t = this.top;
    if (t?.onInput) return t.onInput(input);
    return false;
  }
  release(input) {
    this.top?.onRelease?.(input);
  }
  update(dt) {
    for (const h of [...this.stack]) h.update?.(dt);
  }
}

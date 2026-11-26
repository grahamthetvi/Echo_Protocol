// The sterilization countdown. Real time while playing, with named "holds"
// (pause menu, chosen audio logs, mandatory narration, room-description speech).

export class GameClock {
  constructor(limitSec) {
    this.limit = limitSec;
    this.elapsed = 0;
    this.bonus = 0;
    this.penalties = 0;
    this.holds = new Set();
  }
  hold(reason) {
    this.holds.add(reason);
  }
  release(reason) {
    this.holds.delete(reason);
  }
  setHold(reason, on) {
    if (on) this.hold(reason);
    else this.release(reason);
  }
  get running() {
    return this.holds.size === 0;
  }
  tick(dt) {
    if (this.running) this.elapsed += dt;
  }
  penalize(sec) {
    this.elapsed += sec;
    this.penalties += sec;
  }
  extend(sec) {
    this.bonus += sec;
  }
  get total() {
    return this.limit + this.bonus;
  }
  get remaining() {
    return Math.max(0, this.total - this.elapsed);
  }
  get expired() {
    return this.remaining <= 0;
  }
  toJSON() {
    return { limit: this.limit, elapsed: this.elapsed, bonus: this.bonus, penalties: this.penalties };
  }
  static fromJSON(o) {
    const c = new GameClock(o.limit);
    c.elapsed = o.elapsed || 0;
    c.bonus = o.bonus || 0;
    c.penalties = o.penalties || 0;
    return c;
  }
}

/**
 * Decides when to announce the remaining time automatically:
 * 75%, 50%, 25%, 10% remaining, 5 minutes, 1 minute, and each of the final 10 seconds.
 */
export class TimeAnnouncer {
  constructor() {
    this.fired = new Set();
  }
  thresholds(total) {
    const list = [
      { at: total * 0.75, key: 'p75' },
      { at: total * 0.5, key: 'p50' },
      { at: total * 0.25, key: 'p25' },
      { at: total * 0.1, key: 'p10' },
    ];
    if (total > 300 + 5) list.push({ at: 300, key: 'm5' });
    if (total > 60 + 5) list.push({ at: 60, key: 'm1' });
    for (let s = 10; s >= 1; s--) list.push({ at: s, key: `s${s}`, countdown: true });
    return list;
  }
  /** Returns announcements crossed between prev and now (both "remaining" seconds). */
  check(prevRemaining, remaining, total) {
    const out = [];
    for (const t of this.thresholds(total)) {
      if (this.fired.has(t.key)) continue;
      if (prevRemaining > t.at && remaining <= t.at) {
        this.fired.add(t.key);
        // Skip a percentage marker if it is within 3 s of an absolute one already queued.
        if (!t.countdown && out.some((o) => !o.countdown && Math.abs(o.at - t.at) < 3)) continue;
        out.push(t);
      }
    }
    return out;
  }
  toJSON() {
    return [...this.fired];
  }
  static fromJSON(list) {
    const a = new TimeAnnouncer();
    for (const k of list || []) a.fired.add(k);
    return a;
  }
}

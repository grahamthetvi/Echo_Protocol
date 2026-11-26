// Adaptive difficulty. "Pressure" drifts between 0.6 (gentle) and 1.4 (tense)
// based on deaths, near-misses and time stuck. Assist mode shifts everything easier.

export class Difficulty {
  constructor({ assist = false, pressure = 1 } = {}) {
    this.assist = assist;
    this.pressure = pressure;
    this.deaths = 0;
    this.nearMisses = 0;
    this.cleanRooms = 0;
    this.stuckFor = 0;
    this.lastProgressAt = 0;
  }
  clamp() {
    this.pressure = Math.min(1.4, Math.max(0.6, this.pressure));
  }
  get zombieSpeedMult() {
    return (this.assist ? 0.7 : 1) * (0.85 + 0.15 * this.pressure);
  }
  get hearingMult() {
    return (this.assist ? 0.8 : 1) * (0.8 + 0.2 * this.pressure);
  }
  get windowSec() {
    return (3.5 * (this.assist ? 1.6 : 1)) / (0.8 + 0.2 * this.pressure);
  }
  get damageMult() {
    return (this.assist ? 0.6 : 1) * (0.8 + 0.2 * this.pressure);
  }
  /** Seconds without progress before a hint is offered. */
  get stuckThreshold() {
    return (this.assist ? 45 : 90) * (0.6 + 0.4 * this.pressure);
  }
  get maxInfection() {
    return this.assist ? 5 : 3;
  }
  get hintCost() {
    return this.assist ? 10 : 20;
  }
  onDeath() {
    this.deaths++;
    this.pressure -= 0.2;
    this.cleanRooms = 0;
    this.clamp();
  }
  onNearMiss() {
    this.nearMisses++;
    this.pressure -= 0.05;
    this.clamp();
  }
  onDamage() {
    this.cleanRooms = 0;
  }
  /** Called on meaningful progress (new room, key found, lock opened). */
  onProgress(kind) {
    this.stuckFor = 0;
    if (kind === 'room') {
      this.cleanRooms++;
      if (this.cleanRooms >= 3) {
        this.cleanRooms = 0;
        this.pressure += 0.05;
      }
    }
    this.clamp();
  }
  /** Returns true when a hint should be offered. */
  tickStuck(dt) {
    this.stuckFor += dt;
    if (this.stuckFor >= this.stuckThreshold) {
      this.stuckFor = 0;
      this.pressure -= 0.05;
      this.clamp();
      return true;
    }
    return false;
  }
  toJSON() {
    return { assist: this.assist, pressure: this.pressure, deaths: this.deaths, nearMisses: this.nearMisses };
  }
  static fromJSON(o) {
    const d = new Difficulty(o);
    d.deaths = o.deaths || 0;
    d.nearMisses = o.nearMisses || 0;
    return d;
  }
}

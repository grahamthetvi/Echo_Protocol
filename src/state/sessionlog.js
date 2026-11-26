// Session log for teachers: time, rooms, deaths, hints, puzzles. Exported as JSON or CSV.

const KEY = 'echo.sessionlog.v1';
const MAX = 5000;

export class SessionLog {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.entries = [];
    this.session = null;
    try {
      const raw = storage?.getItem(KEY);
      if (raw) this.entries = JSON.parse(raw);
    } catch {
      this.entries = [];
    }
  }
  startSession(meta) {
    this.session = `${new Date().toISOString().slice(0, 19)}-${Math.floor(Math.random() * 1e4)}`;
    this.add('session_start', meta);
    return this.session;
  }
  add(type, detail = {}, game = null) {
    const e = {
      time: new Date().toISOString(),
      session: this.session,
      type,
      elapsed: game ? Math.round(game.clock.elapsed) : null,
      remaining: game ? Math.round(game.clock.remaining) : null,
      room: game ? game.world.room(game.player.room)?.name : null,
      detail,
    };
    this.entries.push(e);
    if (this.entries.length > MAX) this.entries.splice(0, this.entries.length - MAX);
    this.persist();
    return e;
  }
  persist() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.entries));
    } catch { /* ignore quota */ }
  }
  clear() {
    this.entries = [];
    this.persist();
  }
  toJSON() {
    return { app: 'echo-protocol', exported: new Date().toISOString(), entries: this.entries, summary: this.summary() };
  }
  summary() {
    const by = (t) => this.entries.filter((e) => e.type === t).length;
    return {
      sessions: by('session_start'),
      roomsEntered: by('room'),
      deaths: by('death'),
      hints: by('hint'),
      puzzlesSolved: by('puzzle_solved'),
      endings: this.entries.filter((e) => e.type === 'ending').map((e) => e.detail.kind),
    };
  }
  toCSV() {
    const cols = ['time', 'session', 'type', 'elapsed', 'remaining', 'room', 'detail'];
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.join(','), ...this.entries.map((e) => cols.map((c) => esc(e[c])).join(','))].join('\n');
  }
}

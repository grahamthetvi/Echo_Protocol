// Self-voicing speech queue built on the Web Speech API.
// Priorities: 'urgent' interrupts everything; 'normal' queues; 'ambient' is dropped when busy.
// Categories ('desc', 'log', 'narration') let the game pause the countdown while they play.

import { chunkSentences } from '../core/format.js';

export const VOICE_PROFILES = {
  narrator: { pitch: 1, rate: 1, alt: 0 },
  intercom: { pitch: 0.8, rate: 0.95, alt: 1 },
  operator: { pitch: 0.95, rate: 1.05, alt: 2 },
  hale: { pitch: 1.15, rate: 0.95, alt: 3 },
  das: { pitch: 1.3, rate: 1.0, alt: 4 },
  ortiz: { pitch: 0.7, rate: 1.0, alt: 1 },
  voss: { pitch: 0.85, rate: 0.9, alt: 2 },
  ui: { pitch: 1, rate: 1, alt: 0 },
};

let nextGroup = 1;

class SpeechBase {
  constructor() {
    this.queue = [];
    this.current = null;
    this.last = '';
    this.listeners = new Set();
    this.settings = { rate: 1.3, pitch: 1, volume: 1, voiceURI: null, enabled: true };
  }
  onSpoken(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  configure(s) {
    Object.assign(this.settings, s);
  }
  get busy() {
    return !!this.current || this.queue.length > 0;
  }
  /** The category of what is speaking right now (or queued next), for clock holds. */
  get category() {
    return this.current?.category ?? null;
  }
  say(text, opts = {}) {
    if (!text) return;
    const { priority = 'normal', category = 'ui', voice = 'narrator', record = true, onEnd } = opts;
    if (priority === 'ambient' && this.busy) return;
    if (priority === 'urgent' || opts.interrupt) this.stop();
    else if (opts.replace) {
      // Replace earlier messages of the same kind (e.g. "within reach" updates while walking).
      this.queue = this.queue.filter((q) => q.category !== category);
      if (this.current?.category === category) {
        const c = this.current;
        this.current = null;
        this._cancel();
        c.onEnd?.({ canceled: true });
      }
    }
    const chunks = chunkSentences(text);
    if (!chunks.length) return;
    const group = nextGroup++;
    chunks.forEach((c, i) => {
      this.queue.push({ text: c, priority, category, voice, group, onEnd: i === chunks.length - 1 ? onEnd : null });
    });
    if (record && category !== 'ambient') this.last = text;
    for (const fn of this.listeners) fn({ text, priority, category });
    if (!this.current) this._next();
  }
  stop() {
    const pending = [this.current, ...this.queue].filter(Boolean);
    this.queue = [];
    this.current = null;
    this._cancel();
    for (const item of pending) item.onEnd?.({ canceled: true });
  }
  _finish(item) {
    if (this.current !== item) return;
    this.current = null;
    item.onEnd?.({ canceled: false });
    this._next();
  }
  _next() {
    const item = this.queue.shift();
    if (!item) return;
    this.current = item;
    this._speak(item);
  }
  _speak() {}
  _cancel() {}
  tick() {}
}

export class WebSpeech extends SpeechBase {
  constructor() {
    super();
    this.synth = globalThis.speechSynthesis || null;
    this.voices = [];
    this.loadVoices();
    if (this.synth) this.synth.onvoiceschanged = () => this.loadVoices();
    this.watchdog = null;
  }
  get available() {
    return !!this.synth;
  }
  loadVoices() {
    this.voices = this.synth ? this.synth.getVoices() : [];
  }
  /** Voices in the base voice's language, so character voices sound distinct but understandable. */
  voiceFor(profile) {
    if (!this.voices.length) return null;
    const base = this.voices.find((v) => v.voiceURI === this.settings.voiceURI)
      || this.voices.find((v) => v.default) || this.voices[0];
    if (!profile.alt) return base;
    const lang = (base.lang || 'en').slice(0, 2);
    const same = this.voices.filter((v) => (v.lang || '').startsWith(lang));
    if (same.length < 2) return base;
    const i = same.indexOf(base);
    return same[(i + profile.alt) % same.length];
  }
  _speak(item) {
    if (!this.synth || !this.settings.enabled) {
      // Not voicing: finish immediately (screen reader mode reads the aria-live region instead).
      setTimeout(() => this._finish(item), 0);
      return;
    }
    // Chrome can drop an utterance queued in the same instant as cancel(); wait a beat.
    if (performance.now() - (this.lastCancel || 0) < 60) {
      setTimeout(() => {
        if (this.current === item) this._utter(item);
      }, 60);
      return;
    }
    this._utter(item);
  }
  _utter(item) {
    const profile = VOICE_PROFILES[item.voice] || VOICE_PROFILES.narrator;
    const u = new SpeechSynthesisUtterance(item.text);
    const v = this.voiceFor(profile);
    if (v) u.voice = v;
    u.rate = Math.min(3, Math.max(0.5, this.settings.rate * profile.rate));
    u.pitch = Math.min(2, Math.max(0, this.settings.pitch * profile.pitch));
    u.volume = this.settings.volume;
    u.onend = () => this._finish(item);
    u.onerror = () => this._finish(item);
    clearTimeout(this.watchdog);
    // Some browsers occasionally never fire onend; don't let the queue (or the clock hold) hang.
    const ms = 2500 + (item.text.length * 95) / u.rate;
    this.watchdog = setTimeout(() => {
      if (this.current === item) {
        this.synth.cancel();
        this._finish(item);
      }
    }, ms);
    this.synth.speak(u);
    if (this.synth.paused) this.synth.resume();
  }
  _cancel() {
    clearTimeout(this.watchdog);
    this.lastCancel = performance.now();
    if (this.synth) this.synth.cancel();
  }
}

/** Headless speech for Node tests: records text, finishes on the next tick. */
export class NullSpeech extends SpeechBase {
  constructor() {
    super();
    this.history = [];
  }
  _speak(item) {
    this.history.push(item.text);
  }
  tick() {
    let guard = 0;
    while (this.current && guard++ < 200) this._finish(this.current);
  }
  get available() {
    return false;
  }
  /** All speech so far as one string, handy for assertions. */
  get transcript() {
    return this.history.join(' \n');
  }
}

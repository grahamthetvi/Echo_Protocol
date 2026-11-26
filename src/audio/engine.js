// Web Audio engine: buses (effects, ambience/music, zombie alerts, UI), HRTF
// positional sources that rotate with the listener, occlusion via low-pass,
// mono downmix, and lazy loading of recorded Opus assets with synth fallback.

import { RECIPES } from './recipes.js';
import { Rng, hashString } from '../core/rng.js';

const FORWARD = { N: [0, 0, -1], E: [1, 0, 0], S: [0, 0, 1], W: [-1, 0, 0] };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.ready = false;
    this.mix = { master: 0.9, effects: 0.8, ambience: 0.5, alerts: 0.9, ui: 0.7 };
    this.mono = false;
    this.listener = { x: 0, y: 0, facing: 'N' };
    this.loaded = new Set();
  }

  async init() {
    if (this.ctx) return;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.ratio.value = 4;
    this.master.connect(this.comp).connect(ctx.destination);
    this.buses = {};
    for (const name of ['effects', 'ambience', 'alerts', 'ui']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[name] = g;
    }
    this.applyMix();
    this.setMono(this.mono);
    // Render the sounds needed first, then the rest in small slices so the page stays responsive.
    const first = ['ui_move', 'ui_select', 'ui_back', 'ui_error', 'ui_success', 'ui_hold', 'ui_tick', 'step_tile'];
    for (const id of first) this.renderRecipe(id);
    this.ready = true;
    const rest = Object.keys(RECIPES).filter((id) => !this.buffers.has(id));
    await new Promise((resolve) => {
      const tick = () => {
        const t0 = performance.now();
        while (rest.length && performance.now() - t0 < 12) this.renderRecipe(rest.shift());
        if (rest.length) setTimeout(tick, 0);
        else resolve();
      };
      tick();
    });
  }

  /** True when a sound id has audio available (recorded or synthesized). */
  has(id) {
    return this.buffers.has(id) || !!RECIPES[id];
  }

  renderRecipe(id) {
    const r = RECIPES[id];
    if (!r || this.buffers.has(id)) return;
    const sr = this.ctx.sampleRate;
    const data = r.gen(sr, new Rng(hashString(id)));
    const buf = this.ctx.createBuffer(1, data.length, sr);
    buf.copyToChannel(data, 0);
    this.buffers.set(id, buf);
  }

  /** Load recorded assets for a group ("core", "ward", ...) from the manifest; synth stays as fallback. */
  async loadGroup(manifest, group, base = 'assets/audio/') {
    if (!this.ctx || !manifest?.sounds) return;
    const jobs = Object.entries(manifest.sounds)
      .filter(([, s]) => s.file && (s.group || 'core') === group && !this.loaded.has(s.file))
      .map(async ([id, s]) => {
        try {
          const res = await fetch(base + s.file);
          if (!res.ok) return;
          const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(id, buf);
          this.loaded.add(s.file);
        } catch {
          // keep the synthesized placeholder
        }
      });
    await Promise.all(jobs);
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }
  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  setMix(mix) {
    Object.assign(this.mix, mix);
    this.applyMix();
  }
  applyMix() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.mix.master, t, 0.02);
    for (const [k, g] of Object.entries(this.buses)) g.gain.setTargetAtTime(this.mix[k] ?? 0.8, t, 0.02);
  }

  /** Mono downmix for single-sided hearing or one earbud. */
  setMono(on) {
    this.mono = !!on;
    if (!this.master) return;
    this.master.channelCount = on ? 1 : 2;
    this.master.channelCountMode = 'explicit';
    this.master.channelInterpretation = 'speakers';
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setListener(x, y, facing) {
    this.listener = { x, y, facing };
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const [fx, fy, fz] = FORWARD[facing] || FORWARD.N;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(x, t, 0.03);
      L.positionY.setTargetAtTime(0, t, 0.03);
      L.positionZ.setTargetAtTime(y, t, 0.03);
      L.forwardX.setTargetAtTime(fx, t, 0.05);
      L.forwardY.setTargetAtTime(fy, t, 0.05);
      L.forwardZ.setTargetAtTime(fz, t, 0.05);
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      L.setPosition(x, 0, y);
      L.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  _chain(src, { pos, bus = 'effects', gain = 1, lowpass = null, refDistance = 1.5, rolloff = 1 }) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lowpass ?? 20000;
    src.connect(g).connect(lp);
    let panner = null;
    if (pos) {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = refDistance;
      panner.rolloffFactor = rolloff;
      panner.maxDistance = 80;
      setPannerPos(panner, pos.x, pos.y, ctx.currentTime, true);
      lp.connect(panner).connect(this.buses[bus] || this.buses.effects);
    } else {
      lp.connect(this.buses[bus] || this.buses.effects);
    }
    const handle = {
      src, gainNode: g, lowpassNode: lp, panner, stopped: false,
      setPosition: (x, y) => panner && setPannerPos(panner, x, y, ctx.currentTime),
      setGain: (v, tc = 0.05) => g.gain.setTargetAtTime(v, ctx.currentTime, tc),
      setOcclusion: (cutoff, v) => {
        lp.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.08);
        if (v !== undefined) g.gain.setTargetAtTime(v, ctx.currentTime, 0.08);
      },
      stop: (fade = 0.05) => {
        if (handle.stopped) return;
        handle.stopped = true;
        try {
          g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
          src.stop(ctx.currentTime + fade + 0.05);
        } catch {
          /* already stopped */
        }
      },
    };
    src.onended = () => {
      handle.stopped = true;
      handle.onEnded?.();
      try {
        (panner || lp).disconnect();
      } catch { /* ignore */ }
    };
    return handle;
  }

  play(id, opts = {}) {
    if (!this.ctx) return NULL_HANDLE;
    if (!this.buffers.has(id)) this.renderRecipe(id);
    const buf = this.buffers.get(id);
    if (!buf) return NULL_HANDLE;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!(opts.loop ?? RECIPES[id]?.loop);
    src.playbackRate.value = opts.rate ?? 1;
    if (opts.detune) src.detune.value = opts.detune;
    const bus = opts.bus || RECIPES[id]?.bus || 'effects';
    const h = this._chain(src, { ...opts, bus });
    const when = this.ctx.currentTime + (opts.delay || 0);
    src.start(when, opts.offset ? opts.offset % buf.duration : 0);
    return h;
  }

  tone(freq, dur, opts = {}) {
    if (!this.ctx) return NULL_HANDLE;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = opts.type || 'sine';
    osc.frequency.value = freq;
    const env = ctx.createGain();
    const t0 = ctx.currentTime + (opts.delay || 0);
    const a = opts.attack ?? 0.01;
    const r = opts.release ?? 0.05;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(1, t0 + a);
    env.gain.setValueAtTime(1, t0 + Math.max(a, dur - r));
    env.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(env);
    const h = this._chain(env, { gain: opts.gain ?? 0.3, bus: opts.bus || 'effects', pos: opts.pos });
    h.src = osc;
    h.stop = () => { try { osc.stop(); } catch { /* ignore */ } };
    osc.onended = () => { try { env.disconnect(); } catch { /* ignore */ } };
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return h;
  }

  /** A sustained tone whose pitch can be changed live (pitch puzzle, breaker hum). */
  startTone(freq, opts = {}) {
    if (!this.ctx) return NULL_TONE;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = opts.type || 'sine';
    osc.frequency.value = freq;
    let src = osc;
    let lfo = null;
    if (opts.pulse) {
      const am = ctx.createGain();
      am.gain.value = 0.5;
      lfo = ctx.createOscillator();
      lfo.frequency.value = opts.pulse;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(am.gain);
      osc.connect(am);
      src = am;
      lfo.start();
    }
    const h = this._chain(src, { gain: 0, bus: opts.bus || 'effects', pos: opts.pos });
    h.gainNode.gain.setTargetAtTime(opts.gain ?? 0.2, ctx.currentTime, 0.05);
    osc.start();
    return {
      setFreq: (f) => osc.frequency.setTargetAtTime(f, ctx.currentTime, 0.02),
      setGain: (g) => h.gainNode.gain.setTargetAtTime(g, ctx.currentTime, 0.05),
      setPosition: h.setPosition,
      stop: () => {
        h.gainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        try {
          osc.stop(ctx.currentTime + 0.2);
          lfo?.stop(ctx.currentTime + 0.2);
        } catch { /* ignore */ }
      },
    };
  }
}

function setPannerPos(p, x, y, t, immediate = false) {
  if (p.positionX) {
    if (immediate) {
      p.positionX.value = x;
      p.positionY.value = 0;
      p.positionZ.value = y;
    } else {
      p.positionX.setTargetAtTime(x, t, 0.05);
      p.positionY.setTargetAtTime(0, t, 0.05);
      p.positionZ.setTargetAtTime(y, t, 0.05);
    }
  } else {
    p.setPosition(x, 0, y);
  }
}

export const NULL_HANDLE = {
  stopped: true, setPosition() {}, setGain() {}, setOcclusion() {}, stop() {},
};
export const NULL_TONE = { setFreq() {}, setGain() {}, setPosition() {}, stop() {} };

/** Silent stand-in used in Node tests and when Web Audio is unavailable. */
export class NullAudio {
  constructor() {
    this.played = [];
    this.listener = { x: 0, y: 0, facing: 'N' };
    this.now = 0;
  }
  async init() {}
  resume() {}
  suspend() {}
  setMix() {}
  setMono() {}
  async loadGroup() {}
  setListener(x, y, facing) { this.listener = { x, y, facing }; }
  has() { return false; }
  play(id, opts) { this.played.push(id); return { ...NULL_HANDLE, stopped: false, id, opts }; }
  tone() { return NULL_HANDLE; }
  startTone() { return NULL_TONE; }
}

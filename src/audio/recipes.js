// Procedural placeholder sounds. Every sound in the game has a recipe here, so the
// game is fully playable before any recorded audio exists. Real Opus files listed
// in assets/audio/manifest.json replace these automatically when present.

import { Biquad, Osc, noise, ad, ahr, normalize, fadeEdges, loopify, render, addAt, buffer, TAU } from './dsp.js';

// ---- building blocks -------------------------------------------------------

function click(sr, rng, { freq = 3000, q = 2, dur = 0.03, decay = 0.006 } = {}) {
  const n = noise(rng);
  const bp = new Biquad(sr, 'bandpass', freq, q);
  return render(sr, dur, (t) => bp.process(n()) * ad(t, 0.0005, decay) * 3);
}

function thump(sr, { freq = 90, dur = 0.15, decay = 0.05, drop = 0.5 } = {}) {
  const o = new Osc(sr);
  return render(sr, dur, (t) => o.next(freq * (1 - drop * Math.min(1, t / dur))) * ad(t, 0.002, decay));
}

function noiseBurst(sr, rng, { type = 'bandpass', freq = 1000, q = 1, dur = 0.2, attack = 0.01, decay = 0.08 } = {}) {
  const n = noise(rng);
  const f = new Biquad(sr, type, freq, q);
  return render(sr, dur, (t) => f.process(n()) * ad(t, attack, decay));
}

function bell(sr, freq, dur, partials = [[1, 1], [2.01, 0.4], [3.02, 0.2]], decay = 0.3) {
  const oscs = partials.map(() => new Osc(sr));
  return render(sr, dur, (t) => {
    let s = 0;
    partials.forEach(([m, g], i) => { s += oscs[i].next(freq * m) * g * ad(t, 0.002, decay / m ** 0.5); });
    return s;
  });
}

function tone(sr, freq, dur, type = 'sine', attack = 0.005, release = 0.03) {
  const o = new Osc(sr, type);
  return render(sr, dur, (t) => o.next(freq) * ahr(t, attack, release, dur));
}

function seq(sr, total, parts) {
  const out = buffer(sr, total);
  for (const [at, b, g = 1] of parts) addAt(out, b, sr, at, g);
  return out;
}

function metal(sr, base, dur, decay = 0.25) {
  return bell(sr, base, dur, [[1, 1], [2.76, 0.6], [5.4, 0.35], [8.93, 0.2]], decay);
}

function groan(sr, rng, { f0 = 90, dur = 1.4, formants = [500, 1100], vib = 4, fall = 0.25, rough = 0.3, type = 'saw' } = {}) {
  const o = new Osc(sr, type);
  const n = noise(rng);
  const fs = formants.map((f) => new Biquad(sr, 'bandpass', f, 4));
  return render(sr, dur, (t) => {
    const f = f0 * (1 - fall * (t / dur)) * (1 + 0.04 * Math.sin(TAU * vib * t));
    const src = o.next(f) + n() * rough;
    let s = 0;
    for (const fl of fs) s += fl.process(src);
    return s * ahr(t, dur * 0.25, dur * 0.35, dur);
  });
}

const fin = (b, sr, peak = 0.8) => fadeEdges(normalize(b, peak), sr);
const loop = (b, sr, peak = 0.6) => loopify(normalize(b, peak), sr, 0.3);

// ---- recipes ---------------------------------------------------------------

export const RECIPES = {
  // UI earcons
  ui_move: { bus: 'ui', gen: (sr) => fin(tone(sr, 880, 0.04, 'sine', 0.002, 0.03), sr, 0.4) },
  ui_tick: { bus: 'ui', gen: (sr) => fin(tone(sr, 1500, 0.02, 'sine', 0.001, 0.015), sr, 0.3) },
  ui_select: { bus: 'ui', gen: (sr) => fin(seq(sr, 0.16, [[0, tone(sr, 660, 0.07)], [0.07, tone(sr, 990, 0.09)]]), sr, 0.5) },
  ui_back: { bus: 'ui', gen: (sr) => fin(seq(sr, 0.16, [[0, tone(sr, 990, 0.07)], [0.07, tone(sr, 660, 0.09)]]), sr, 0.5) },
  ui_error: {
    bus: 'ui',
    gen: (sr) => {
      const lp = new Biquad(sr, 'lowpass', 900);
      const o = new Osc(sr, 'square');
      return fin(render(sr, 0.25, (t) => lp.process(o.next(130)) * ahr(t, 0.005, 0.05, 0.25)), sr, 0.5);
    },
  },
  ui_success: { bus: 'ui', gen: (sr) => fin(seq(sr, 0.5, [[0, bell(sr, 523, 0.3)], [0.08, bell(sr, 659, 0.3)], [0.16, bell(sr, 784, 0.34)]]), sr, 0.55) },
  ui_pickup: { bus: 'ui', gen: (sr) => fin(seq(sr, 0.35, [[0, bell(sr, 1200, 0.2, undefined, 0.1)], [0.06, bell(sr, 1600, 0.25, undefined, 0.12)]]), sr, 0.5) },
  ui_hold: { bus: 'ui', gen: (sr) => fin(tone(sr, 330, 0.16, 'sine', 0.03, 0.08), sr, 0.3) },
  ui_alert: {
    bus: 'alerts',
    gen: (sr) => fin(seq(sr, 0.5, [[0, tone(sr, 880, 0.11, 'tri')], [0.12, tone(sr, 660, 0.11, 'tri')], [0.24, tone(sr, 880, 0.11, 'tri')], [0.36, tone(sr, 660, 0.11, 'tri')]]), sr, 0.6),
  },
  ui_hint: { bus: 'ui', gen: (sr) => fin(seq(sr, 0.6, [[0, bell(sr, 784, 0.4)], [0.12, bell(sr, 1175, 0.45)]]), sr, 0.45) },
  ui_time: { bus: 'ui', gen: (sr) => fin(bell(sr, 523, 0.9, [[1, 1], [2.4, 0.5], [4.1, 0.25]], 0.45), sr, 0.45) },
  ui_loud: { bus: 'alerts', gen: (sr) => fin(seq(sr, 0.25, [[0, thump(sr, { freq: 220, dur: 0.1 })], [0.12, thump(sr, { freq: 220, dur: 0.1 })]]), sr, 0.4) },
  intercom_chime: { bus: 'ui', gen: (sr) => fin(seq(sr, 1.1, [[0, bell(sr, 659, 0.6, undefined, 0.4)], [0.35, bell(sr, 523, 0.7, undefined, 0.45)]]), sr, 0.5) },

  // Footsteps by surface
  step_tile: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.12, [[0, click(sr, rng, { freq: 3200, decay: 0.008 })], [0, thump(sr, { freq: 140, dur: 0.06, decay: 0.02 }), 0.6]]), sr, 0.6) },
  step_carpet: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.14, [[0, noiseBurst(sr, rng, { type: 'lowpass', freq: 450, dur: 0.12, attack: 0.01, decay: 0.03 })], [0, thump(sr, { freq: 80, dur: 0.08, decay: 0.03 }), 0.5]]), sr, 0.45) },
  step_grating: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.35, [[0, click(sr, rng, { freq: 2500 })], [0, metal(sr, 520, 0.33, 0.08), 0.5]]), sr, 0.6) },
  step_grass: { bus: 'effects', gen: (sr, rng) => fin(noiseBurst(sr, rng, { type: 'bandpass', freq: 2600, q: 0.7, dur: 0.18, attack: 0.04, decay: 0.05 }), sr, 0.4) },
  step_gravel: {
    bus: 'effects',
    gen: (sr, rng) => {
      const out = buffer(sr, 0.16);
      for (let k = 0; k < 9; k++) addAt(out, click(sr, rng, { freq: 1500 + rng.float() * 2500, q: 1.5, dur: 0.02, decay: 0.004 }), sr, rng.float() * 0.12, 0.4 + rng.float() * 0.6);
      return fin(out, sr, 0.55);
    },
  },
  step_wood: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.2, [[0, thump(sr, { freq: 180, dur: 0.12, decay: 0.04, drop: 0.2 })], [0, click(sr, rng, { freq: 1200, decay: 0.01 }), 0.4]]), sr, 0.55) },
  z_step: { bus: 'effects', gen: (sr, rng) => fin(noiseBurst(sr, rng, { type: 'lowpass', freq: 320, dur: 0.3, attack: 0.08, decay: 0.1 }), sr, 0.5) },
  bump: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.2, [[0, thump(sr, { freq: 70, dur: 0.18, decay: 0.06 })], [0, noiseBurst(sr, rng, { type: 'lowpass', freq: 700, dur: 0.08, attack: 0.001, decay: 0.02 }), 0.6]]), sr, 0.7) },
  cane_tap: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.12, [[0, click(sr, rng, { freq: 2200, decay: 0.004 })], [0, bell(sr, 820, 0.1, [[1, 1], [2.3, 0.4]], 0.03), 0.3]]), sr, 0.5) },
  cane_wall: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.2, [[0, click(sr, rng, { freq: 3000, decay: 0.006 })], [0, bell(sr, 1200, 0.18, [[1, 1], [2.7, 0.5]], 0.05), 0.5]]), sr, 0.6) },
  cane_sweep: { bus: 'effects', gen: (sr, rng) => fin(noiseBurst(sr, rng, { type: 'highpass', freq: 3500, dur: 0.2, attack: 0.06, decay: 0.06 }), sr, 0.2) },

  // Doors and locks
  door_open: {
    bus: 'effects',
    gen: (sr, rng) => {
      const o = new Osc(sr, 'saw');
      const bp = new Biquad(sr, 'bandpass', 800, 5);
      const n = noise(rng);
      const creak = render(sr, 0.8, (t) => bp.process(o.next(200 + 150 * (t / 0.8) + 30 * Math.sin(TAU * 13 * t)) + n() * 0.2) * ahr(t, 0.1, 0.2, 0.8));
      return fin(seq(sr, 0.9, [[0, click(sr, rng, { freq: 1800 })], [0.05, creak, 0.8]]), sr, 0.6);
    },
  },
  door_close: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.45, [[0, thump(sr, { freq: 90, dur: 0.3, decay: 0.08 })], [0.02, click(sr, rng, { freq: 2000 }), 0.7]]), sr, 0.7) },
  door_heavy: {
    bus: 'effects',
    gen: (sr, rng) => {
      const o = new Osc(sr, 'saw');
      const bp = new Biquad(sr, 'bandpass', 500, 5);
      const creak = render(sr, 1.0, (t) => bp.process(o.next(110 + 60 * t + 20 * Math.sin(TAU * 9 * t))) * ahr(t, 0.1, 0.3, 1.0));
      return fin(seq(sr, 1.4, [[0, creak], [0.95, thump(sr, { freq: 60, dur: 0.4, decay: 0.12 }), 1.2], [0.95, click(sr, rng, { freq: 900 }), 0.5]]), sr, 0.75);
    },
  },
  door_locked: {
    bus: 'effects',
    gen: (sr, rng) => {
      const parts = [];
      for (let k = 0; k < 4; k++) parts.push([k * 0.08, metal(sr, 900 + rng.float() * 200, 0.12, 0.03)]);
      return fin(seq(sr, 0.45, parts), sr, 0.6);
    },
  },
  door_unlock: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.5, [[0, tone(sr, 1200, 0.07)], [0.07, tone(sr, 1800, 0.09)], [0.22, thump(sr, { freq: 120, dur: 0.2 })], [0.22, click(sr, rng, { freq: 1500 }), 0.6]]), sr, 0.6) },
  card_swipe: {
    bus: 'effects',
    gen: (sr, rng) => {
      const n = noise(rng);
      const hp = new Biquad(sr, 'bandpass', 4000, 1);
      const sw = render(sr, 0.2, (t) => { hp.set(2500 + 6000 * t); return hp.process(n()) * ahr(t, 0.02, 0.05, 0.2); });
      return fin(seq(sr, 0.35, [[0, sw], [0.21, tone(sr, 1000, 0.1)]]), sr, 0.5);
    },
  },
  keypad_beep: { bus: 'effects', gen: (sr) => fin(tone(sr, 1400, 0.08, 'sine', 0.002, 0.02), sr, 0.5) },
  keypad_ok: { bus: 'effects', gen: (sr) => fin(seq(sr, 0.35, [[0, tone(sr, 1046, 0.12)], [0.13, tone(sr, 1318, 0.2)]]), sr, 0.55) },
  keypad_bad: {
    bus: 'effects',
    gen: (sr) => {
      const o = new Osc(sr, 'square');
      const lp = new Biquad(sr, 'lowpass', 1200);
      return fin(render(sr, 0.4, (t) => lp.process(o.next(300)) * ahr(t, 0.005, 0.05, 0.4)), sr, 0.5);
    },
  },
  door_pry: {
    bus: 'effects',
    gen: (sr, rng) => {
      const a = new Osc(sr, 'saw');
      const b = new Osc(sr, 'saw');
      const bp = new Biquad(sr, 'bandpass', 1500, 3);
      const scr = render(sr, 1.2, (t) => bp.process(a.next(600 + 200 * Math.sin(TAU * 3 * t)) + b.next(910 + 150 * Math.sin(TAU * 5 * t))) * ahr(t, 0.1, 0.2, 1.2));
      return fin(seq(sr, 1.6, [[0, scr], [1.2, thump(sr, { freq: 80, dur: 0.3 }), 1.2], [1.2, click(sr, rng, { freq: 1200 })]]), sr, 0.7);
    },
  },
  barricade: { bus: 'effects', gen: (sr) => fin(seq(sr, 0.5, [[0, thump(sr, { freq: 150, dur: 0.15, drop: 0.2 })], [0.22, thump(sr, { freq: 140, dur: 0.2, drop: 0.2 })]]), sr, 0.6) },

  // Zombie signatures (each type distinct)
  z_shambler: { bus: 'alerts', gen: (sr, rng) => fin(groan(sr, rng, { f0: 85, dur: 1.5, formants: [450, 1000], vib: 3, fall: 0.3, rough: 0.5 }), sr, 0.8) },
  z_crawler: {
    bus: 'alerts',
    gen: (sr, rng) => {
      const n = noise(rng);
      const bp = new Biquad(sr, 'bandpass', 300, 2);
      const g = new Osc(sr, 'saw');
      const lp = new Biquad(sr, 'lowpass', 200);
      return fin(render(sr, 1.3, (t) => (bp.process(n()) * (0.5 + 0.5 * Math.sin(TAU * 4 * t)) * 2 + lp.process(g.next(55)) * 0.6) * ahr(t, 0.15, 0.3, 1.3)), sr, 0.75);
    },
  },
  z_runner: {
    bus: 'alerts',
    gen: (sr, rng) => {
      const n = noise(rng);
      const bp = new Biquad(sr, 'bandpass', 1800, 1.5);
      const breath = (len) => render(sr, len, (t) => bp.process(n()) * Math.sin((Math.PI * t) / len) ** 2);
      return fin(seq(sr, 1.0, [[0, breath(0.22)], [0.25, breath(0.18), 0.8], [0.5, breath(0.22)], [0.75, breath(0.18), 0.8]]), sr, 0.8);
    },
  },
  z_screamer: {
    bus: 'alerts',
    gen: (sr, rng) => {
      const o = new Osc(sr, 'saw');
      const bp = new Biquad(sr, 'bandpass', 2400, 3);
      const n = noise(rng);
      return fin(render(sr, 1.3, (t) => bp.process(o.next(600 + 650 * Math.min(1, t / 0.8)) + n() * 0.3) * (0.6 + 0.4 * Math.sin(TAU * 12 * t)) * ahr(t, 0.05, 0.4, 1.3)), sr, 0.85);
    },
  },
  z_armored: {
    bus: 'alerts',
    gen: (sr, rng) => fin(seq(sr, 1.2, [[0, metal(sr, 300, 0.6, 0.15)], [0.3, metal(sr, 330, 0.6, 0.15), 0.8], [0.1, groan(sr, rng, { f0: 70, dur: 1.0, formants: [400, 800], rough: 0.4 }), 0.5]]), sr, 0.8),
  },
  z_hit: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.3, [[0, thump(sr, { freq: 100, dur: 0.2, decay: 0.05 })], [0, click(sr, rng, { freq: 1500, decay: 0.01 }), 0.8]]), sr, 0.8) },
  z_die: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 1.6, [[0, groan(sr, rng, { f0: 110, dur: 1.1, fall: 0.6, rough: 0.4 })], [1.05, thump(sr, { freq: 60, dur: 0.4, decay: 0.1 }), 1.2]]), sr, 0.8) },
  z_attack: { bus: 'alerts', gen: (sr, rng) => fin(seq(sr, 0.6, [[0, noiseBurst(sr, rng, { type: 'bandpass', freq: 900, dur: 0.3, attack: 0.05, decay: 0.08 })], [0.05, groan(sr, rng, { f0: 140, dur: 0.5, fall: 0.1, rough: 0.6 }), 0.8]]), sr, 0.85) },

  // Player
  hurt: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.45, [[0, thump(sr, { freq: 90, dur: 0.15 })], [0.02, groan(sr, rng, { f0: 180, dur: 0.35, formants: [700, 1200], fall: 0.25, rough: 0.2 }), 0.9]]), sr, 0.8) },
  heartbeat: { bus: 'alerts', gen: (sr) => fin(seq(sr, 0.7, [[0, thump(sr, { freq: 55, dur: 0.15, decay: 0.04 })], [0.22, thump(sr, { freq: 50, dur: 0.15, decay: 0.04 }), 0.7]]), sr, 0.7) },
  breath: {
    bus: 'effects',
    gen: (sr, rng) => {
      const n = noise(rng);
      const bp = new Biquad(sr, 'bandpass', 1100, 0.8);
      const b = (len) => render(sr, len, (t) => bp.process(n()) * Math.sin((Math.PI * t) / len) ** 2);
      return fin(seq(sr, 1.6, [[0, b(0.6)], [0.75, b(0.75), 0.8]]), sr, 0.5);
    },
  },
  swing: {
    bus: 'effects',
    gen: (sr, rng) => {
      const n = noise(rng);
      const bp = new Biquad(sr, 'bandpass', 600, 1);
      return fin(render(sr, 0.25, (t) => { bp.set(500 + 3000 * t); return bp.process(n()) * Math.sin((Math.PI * t) / 0.25); }), sr, 0.5);
    },
  },
  hide_in: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.6, [[0, noiseBurst(sr, rng, { freq: 700, dur: 0.3, decay: 0.1 })], [0.3, metal(sr, 420, 0.3, 0.06), 0.6]]), sr, 0.5) },
  hide_out: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.6, [[0, metal(sr, 420, 0.3, 0.06), 0.6], [0.15, noiseBurst(sr, rng, { freq: 700, dur: 0.3, decay: 0.1 })]]), sr, 0.5) },
  eat: {
    bus: 'effects',
    gen: (sr, rng) => {
      const out = buffer(sr, 0.5);
      for (let k = 0; k < 6; k++) addAt(out, click(sr, rng, { freq: 1200 + rng.float() * 1500, q: 1, dur: 0.05, decay: 0.012 }), sr, k * 0.07);
      return fin(out, sr, 0.5);
    },
  },
  drink: {
    bus: 'effects',
    gen: (sr) => {
      const parts = [];
      for (let k = 0; k < 5; k++) parts.push([k * 0.09, tone(sr, 500 + k * 90, 0.05, 'sine', 0.005, 0.03), 0.6]);
      return fin(seq(sr, 0.5, parts), sr, 0.45);
    },
  },
  bandage: {
    bus: 'effects',
    gen: (sr, rng) => {
      const n = noise(rng);
      const hp = new Biquad(sr, 'highpass', 2000);
      return fin(render(sr, 0.45, (t) => hp.process(n()) * (0.6 + 0.4 * Math.sin(TAU * 40 * t)) * ahr(t, 0.02, 0.1, 0.45)), sr, 0.45);
    },
  },

  // Environment loops (ambience bus)
  amb_monitor: {
    bus: 'ambience', loop: true,
    gen: (sr, rng) => {
      const n = noise(rng);
      const lp = new Biquad(sr, 'lowpass', 300);
      const base = render(sr, 2.3, () => lp.process(n()) * 0.05);
      return loop(seq(sr, 2.3, [[0, base], [0.3, tone(sr, 1000, 0.1), 0.5], [1.3, tone(sr, 1000, 0.1), 0.5]]), sr, 0.4);
    },
  },
  amb_fluorescent: {
    bus: 'ambience', loop: true,
    gen: (sr) => {
      const os = [120, 240, 360, 480].map(() => new Osc(sr, 'saw'));
      return loop(render(sr, 3, () => os.reduce((s, o, i) => s + o.next(120 * (i + 1)) / (i + 2), 0) * 0.3), sr, 0.25);
    },
  },
  amb_hum: {
    bus: 'ambience', loop: true,
    gen: (sr, rng) => {
      const a = new Osc(sr); const b = new Osc(sr); const n = noise(rng); const lp = new Biquad(sr, 'lowpass', 250);
      return loop(render(sr, 3, () => a.next(60) * 0.5 + b.next(120) * 0.3 + lp.process(n()) * 0.4), sr, 0.4);
    },
  },
  amb_drip: {
    bus: 'ambience', loop: true,
    gen: (sr, rng) => {
      const out = buffer(sr, 3.2);
      const drip = () => { const o = new Osc(sr); return render(sr, 0.08, (t) => o.next(1800 - 9000 * t) * ad(t, 0.001, 0.02)); };
      for (const at of [0.4, 1.3, 2.1, 2.8]) addAt(out, drip(), sr, at + rng.float() * 0.1);
      const n = noise(rng); const lp = new Biquad(sr, 'lowpass', 200);
      for (let i = 0; i < out.length; i++) out[i] += lp.process(n()) * 0.03;
      return loop(out, sr, 0.5);
    },
  },
  amb_vent: {
    bus: 'ambience', loop: true,
    gen: (sr, rng) => { const n = noise(rng); const lp = new Biquad(sr, 'lowpass', 500); return loop(render(sr, 3, (t) => lp.process(n()) * (0.8 + 0.2 * Math.sin(TAU * 0.33 * t))), sr, 0.4); },
  },
  amb_fans: {
    bus: 'ambience', loop: true,
    gen: (sr, rng) => { const n = noise(rng); const bp = new Biquad(sr, 'bandpass', 1200, 0.6); const o = new Osc(sr); return loop(render(sr, 3, () => bp.process(n()) + o.next(300) * 0.15), sr, 0.5); },
  },
  amb_freezer: {
    bus: 'ambience', loop: true,
    gen: (sr, rng) => { const n = noise(rng); const lp = new Biquad(sr, 'lowpass', 220); const o = new Osc(sr, 'saw'); const lp2 = new Biquad(sr, 'lowpass', 160); return loop(render(sr, 3, () => lp.process(n()) * 0.6 + lp2.process(o.next(50)) * 0.5), sr, 0.5); },
  },
  amb_boiler: {
    bus: 'ambience', loop: true,
    gen: (sr, rng) => {
      const n = noise(rng); const lp = new Biquad(sr, 'lowpass', 120);
      const out = render(sr, 4, () => lp.process(n()) * 1.5);
      addAt(out, metal(sr, 180, 0.4, 0.1), sr, 1.1, 0.4);
      addAt(out, metal(sr, 160, 0.4, 0.1), sr, 2.9, 0.3);
      return loop(out, sr, 0.55);
    },
  },
  amb_electric: {
    bus: 'ambience', loop: true,
    gen: (sr) => { const os = [60, 180, 300].map(() => new Osc(sr, 'square')); const lp = new Biquad(sr, 'lowpass', 700); return loop(render(sr, 3, () => lp.process(os[0].next(60) * 0.5 + os[1].next(180) * 0.25 + os[2].next(300) * 0.12)), sr, 0.35); },
  },
  amb_static: {
    bus: 'ambience', loop: true,
    gen: (sr, rng) => { const n = noise(rng); const bp = new Biquad(sr, 'bandpass', 2500, 0.5); return loop(render(sr, 3, () => bp.process(n()) * (rng.float() < 0.002 ? 3 : 0.7)), sr, 0.35); },
  },
  amb_wind: {
    bus: 'ambience', loop: true,
    gen: (sr, rng) => { const n = noise(rng); const lp = new Biquad(sr, 'lowpass', 400, 1.5); return loop(render(sr, 4, (t) => { if ((t * sr) % 64 === 0) lp.set(300 + 250 * Math.sin(TAU * 0.25 * t)); return lp.process(n()) * (0.7 + 0.3 * Math.sin(TAU * 0.5 * t)); }), sr, 0.55); },
  },
  amb_forest: {
    bus: 'ambience', loop: true,
    gen: (sr, rng) => {
      const n = noise(rng); const lp = new Biquad(sr, 'lowpass', 600);
      const out = render(sr, 4, (t) => lp.process(n()) * (0.5 + 0.3 * Math.sin(TAU * 0.5 * t)));
      const chirp = () => { const o = new Osc(sr); return render(sr, 0.12, (t) => o.next(3200 + 1500 * Math.sin(TAU * 25 * t)) * ahr(t, 0.01, 0.04, 0.12)); };
      addAt(out, chirp(), sr, 1.2, 0.15); addAt(out, chirp(), sr, 1.4, 0.12); addAt(out, chirp(), sr, 3.1, 0.1);
      return loop(out, sr, 0.5);
    },
  },
  amb_creek: {
    bus: 'ambience', loop: true,
    gen: (sr, rng) => { const n = noise(rng); const bp = new Biquad(sr, 'bandpass', 1200, 0.7); const bp2 = new Biquad(sr, 'bandpass', 500, 1); return loop(render(sr, 3, (t) => bp.process(n()) * (0.6 + 0.4 * Math.sin(TAU * 7.3 * t)) + bp2.process(n()) * 0.6), sr, 0.55); },
  },
  amb_alarm: {
    bus: 'ambience', loop: true,
    gen: (sr) => { const o = new Osc(sr, 'tri'); const lp = new Biquad(sr, 'lowpass', 900); return loop(render(sr, 4, (t) => lp.process(o.next(650 + 250 * Math.sin(TAU * 0.5 * t))) * 0.6), sr, 0.3); },
  },
  amb_vending: {
    bus: 'ambience', loop: true,
    gen: (sr, rng) => { const o = new Osc(sr, 'saw'); const lp = new Biquad(sr, 'lowpass', 250); const n = noise(rng); const lp2 = new Biquad(sr, 'lowpass', 900); return loop(render(sr, 3, () => lp.process(o.next(100)) * 0.6 + lp2.process(n()) * 0.1), sr, 0.4); },
  },
  music_drone: {
    bus: 'ambience', loop: true,
    gen: (sr) => { const a = new Osc(sr, 'saw'); const b = new Osc(sr, 'saw'); const lp = new Biquad(sr, 'lowpass', 300); return loop(render(sr, 6, (t) => lp.process(a.next(55) + b.next(55.4)) * (0.7 + 0.3 * Math.sin(TAU * 0.166 * t))), sr, 0.3); },
  },

  // Features and story
  phone_ring: {
    bus: 'effects',
    gen: (sr) => { const a = new Osc(sr); const b = new Osc(sr); const ring = (len) => render(sr, len, (t) => (a.next(440) + b.next(480)) * (Math.sin(TAU * 20 * t) > 0 ? 1 : 0.2) * ahr(t, 0.01, 0.03, len)); return fin(seq(sr, 1.3, [[0, ring(0.45)], [0.6, ring(0.45)]]), sr, 0.7); },
  },
  beacon: { bus: 'alerts', gen: (sr) => fin(bell(sr, 1000, 0.45, [[1, 1], [1.5, 0.5], [2, 0.25]], 0.12), sr, 0.7) },
  spark: {
    bus: 'effects',
    gen: (sr, rng) => { const out = buffer(sr, 0.6); for (let k = 0; k < 14; k++) addAt(out, click(sr, rng, { freq: 4000, q: 0.8, dur: 0.02, decay: 0.003 }), sr, rng.float() * 0.5, rng.float()); return fin(out, sr, 0.8); },
  },
  power_up: { bus: 'effects', gen: (sr) => { const o = new Osc(sr, 'saw'); const lp = new Biquad(sr, 'lowpass', 600); return fin(render(sr, 1.0, (t) => lp.process(o.next(80 + 160 * t)) * ahr(t, 0.2, 0.2, 1.0)), sr, 0.6); } },
  lure_ring: {
    bus: 'effects',
    gen: (sr) => { const o = new Osc(sr, 'square'); const bp = new Biquad(sr, 'bandpass', 2500, 4); return fin(render(sr, 1.6, (t) => bp.process(o.next(2500)) * (Math.sin(TAU * 25 * t) > 0 ? 1 : 0) * ahr(t, 0.01, 0.1, 1.6)), sr, 0.7); },
  },
  radio_static: { bus: 'effects', gen: (sr, rng) => fin(noiseBurst(sr, rng, { type: 'bandpass', freq: 2000, q: 0.6, dur: 0.5, attack: 0.02, decay: 0.2 }), sr, 0.4) },
  radio_beep: { bus: 'effects', gen: (sr) => fin(tone(sr, 1000, 0.15), sr, 0.4) },
  ping_click: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.05, [[0, click(sr, rng, { freq: 3500, q: 1.2, dur: 0.03, decay: 0.003 })], [0, tone(sr, 2800, 0.012, 'sine', 0.0005, 0.008), 0.6]]), sr, 0.8) },
  echo_hard: { bus: 'effects', gen: (sr, rng) => fin(click(sr, rng, { freq: 3000, q: 1.5, dur: 0.04, decay: 0.006 }), sr, 0.7) },
  echo_soft: { bus: 'effects', gen: (sr, rng) => fin(noiseBurst(sr, rng, { type: 'lowpass', freq: 700, dur: 0.12, attack: 0.01, decay: 0.04 }), sr, 0.5) },
  echo_dull: { bus: 'effects', gen: (sr, rng) => fin(click(sr, rng, { freq: 900, q: 1.5, dur: 0.05, decay: 0.01 }), sr, 0.6) },
  page_turn: { bus: 'effects', gen: (sr, rng) => fin(noiseBurst(sr, rng, { type: 'highpass', freq: 1500, dur: 0.3, attack: 0.05, decay: 0.08 }), sr, 0.4) },
  tape_click: { bus: 'effects', gen: (sr, rng) => fin(seq(sr, 0.2, [[0, click(sr, rng, { freq: 1500 })], [0.09, click(sr, rng, { freq: 1100 })]]), sr, 0.5) },
  search: {
    bus: 'effects',
    gen: (sr, rng) => { const out = buffer(sr, 1.2); for (let k = 0; k < 7; k++) addAt(out, noiseBurst(sr, rng, { freq: 1200 + rng.float() * 1500, dur: 0.12, attack: 0.01, decay: 0.04 }), sr, k * 0.15 + rng.float() * 0.05, 0.5 + rng.float() * 0.5); return fin(out, sr, 0.45); },
  },
  thunder: {
    bus: 'effects',
    gen: (sr, rng) => { const n = noise(rng); const lp = new Biquad(sr, 'lowpass', 90); return fin(render(sr, 4, (t) => lp.process(n()) * ad(t, 0.3, 1.2)), sr, 0.9); },
  },
};

export const SOUND_IDS = Object.keys(RECIPES);

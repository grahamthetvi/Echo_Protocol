// Tiny offline DSP toolkit. Pure functions producing Float32Array sample buffers,
// so the same sound recipes run in the browser (into AudioBuffers) and in Node
// (tools/gen-placeholder-audio.mjs writes them to WAV / Opus).

export const TAU = Math.PI * 2;

export function buffer(sr, seconds) {
  return new Float32Array(Math.max(1, Math.ceil(sr * seconds)));
}

/** RBJ biquad filter. type: lowpass | highpass | bandpass | peak */
export class Biquad {
  constructor(sr, type, freq, q = 0.707, gainDb = 0) {
    this.sr = sr;
    this.type = type;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(freq, q, gainDb);
  }
  set(freq, q = this.q, gainDb = this.gainDb) {
    this.q = q;
    this.gainDb = gainDb;
    const w0 = (TAU * Math.min(freq, this.sr * 0.45)) / this.sr;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case 'highpass':
        b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha; b1 = 0; b2 = -alpha;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case 'peak': {
        const A = 10 ** (gainDb / 40);
        b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
        break;
      }
      default: // lowpass
        b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
        a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export function noise(rng) {
  return () => rng.float() * 2 - 1;
}

/** Phase-accumulating oscillator; freq may change every sample. */
export class Osc {
  constructor(sr, type = 'sine', phase = 0) {
    this.sr = sr;
    this.type = type;
    this.phase = phase;
  }
  next(freq) {
    this.phase = (this.phase + freq / this.sr) % 1;
    const p = this.phase;
    switch (this.type) {
      case 'saw': return 2 * p - 1;
      case 'square': return p < 0.5 ? 1 : -1;
      case 'tri': return 1 - 4 * Math.abs(p - 0.5);
      default: return Math.sin(TAU * p);
    }
  }
}

/** Attack/decay envelope (seconds). Exponential decay feels natural for hits. */
export function ad(t, attack, decay) {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / Math.max(1e-4, decay));
}

/** Linear attack, hold, linear release, total length `len`. */
export function ahr(t, attack, release, len) {
  if (t < 0 || t > len) return 0;
  if (t < attack) return t / attack;
  if (t > len - release) return Math.max(0, (len - t) / release);
  return 1;
}

export function normalize(buf, peak = 0.8) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) {
    const g = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  }
  return buf;
}

export function fadeEdges(buf, sr, inSec = 0.003, outSec = 0.01) {
  const ni = Math.floor(inSec * sr);
  const no = Math.floor(outSec * sr);
  for (let i = 0; i < ni && i < buf.length; i++) buf[i] *= i / ni;
  for (let i = 0; i < no && i < buf.length; i++) buf[buf.length - 1 - i] *= i / no;
  return buf;
}

/** Make a seamless loop by cross-fading the tail into the head. */
export function loopify(buf, sr, xfadeSec = 0.25) {
  const n = Math.floor(xfadeSec * sr);
  if (buf.length <= n * 2) return buf;
  const out = buf.slice(0, buf.length - n);
  for (let i = 0; i < n; i++) {
    const g = i / n;
    out[i] = out[i] * g + buf[buf.length - n + i] * (1 - g);
  }
  return out;
}

/** Render `seconds` of audio by calling fn(t, i) per sample. */
export function render(sr, seconds, fn) {
  const b = buffer(sr, seconds);
  for (let i = 0; i < b.length; i++) b[i] = fn(i / sr, i);
  return b;
}

export function mix(...bufs) {
  const len = Math.max(...bufs.map((b) => b.length));
  const out = new Float32Array(len);
  for (const b of bufs) for (let i = 0; i < b.length; i++) out[i] += b[i];
  return out;
}

/** Place `src` into `dst` starting at time `at` (seconds) with gain. */
export function addAt(dst, src, sr, at, gain = 1) {
  const o = Math.floor(at * sr);
  for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * gain;
  return dst;
}

/** Encode mono float samples as a 16-bit PCM WAV file (Uint8Array). */
export function encodeWav(samples, sr) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Uint8Array(buf);
}

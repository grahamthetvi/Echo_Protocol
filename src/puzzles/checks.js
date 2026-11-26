// Pure puzzle logic, shared by the game and the tests.

export const NOTE_FREQ = { up: 880, right: 660, down: 440, left: 550 };
export const PITCH_BASE = 220;

export function pitchFreq(step) {
  return PITCH_BASE * 2 ** (step / 12);
}

export function checkKeypad(code, input) {
  return String(input) === String(code);
}

export function checkSequence(melody, input) {
  return melody.length === input.length && melody.every((n, i) => n === input[i]);
}

export function checkPitch(target, value) {
  return target === value;
}

/**
 * Rhythm check: compare tap intervals to the pattern after normalizing tempo.
 * pattern: relative gaps, e.g. [1, 1, 2]; taps: tap times in seconds.
 */
export function checkRhythm(pattern, taps, tolerance = 0.35) {
  if (taps.length !== pattern.length + 1) return false;
  const gaps = [];
  for (let i = 1; i < taps.length; i++) gaps.push(taps[i] - taps[i - 1]);
  const unit = gaps.reduce((a, b) => a + b, 0) / pattern.reduce((a, b) => a + b, 0);
  if (unit <= 0.05) return false;
  return gaps.every((g, i) => Math.abs(g / unit - pattern[i]) / pattern[i] <= tolerance);
}

// Braille numbers: number sign, then letters a-j for digits 1-9 and 0.
export const BRAILLE_DIGIT_DOTS = {
  1: '1', 2: '1-2', 3: '1-4', 4: '1-4-5', 5: '1-5', 6: '1-2-4', 7: '1-2-4-5', 8: '1-2-5', 9: '2-4', 0: '2-4-5',
};
export const BRAILLE_DIGIT_LETTER = { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e', 6: 'f', 7: 'g', 8: 'h', 9: 'i', 0: 'j' };

export function brailleDots(code) {
  return code.split('').map((d) => `dots ${BRAILLE_DIGIT_DOTS[d].replace(/-/g, ' ')}`).join(', ');
}

/** The breaker answer for a rule over circuits. */
export function breakerAnswer(circuits, rule) {
  if (rule === 'pulsing') return circuits.findIndex((c) => c.pulse);
  const freqs = circuits.map((c) => c.freq);
  return freqs.indexOf(rule === 'lowest' ? Math.min(...freqs) : Math.max(...freqs));
}

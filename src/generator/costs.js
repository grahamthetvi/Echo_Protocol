// The game-time cost model. These numbers are used BOTH by the generator's
// fastest-route assertion AND by the runtime (how long each action keeps the player busy),
// so the 25% rule describes the game that is actually played.

export const COST = {
  step: { walk: 0.45, run: 0.28, sneak: 0.8 },
  turn: 0.15,
  doorOpen: 1.2,
  doorClose: 0.8,
  /** Orientation time on entering a room (deciding where to go). */
  roomOverhead: 1.5,
  search: 2.5,
  interact: 0.8,
  keycardSwipe: 1.5,
  keypadDigit: 0.6,
  keypadSubmit: 1.0,
  noteInput: 0.45,
  noteListen: 0.5,
  pitchMatch: 8,
  rhythmUnit: 0.4,
  breakerPuzzle: 6,
  beep: 0.22,
  beepGap: 0.8,
  longTone: 0.7,
  pry: 2.0,
  barricade: 1.5,
  lureThrow: 1.0,
  hide: 1.0,
  fightRound: 1.5,
  ping: 0.3,
  caneTap: 0.3,
  hint: 20,
  hintAssist: 10,
  downedPenalty: 20,
};

/** Seconds of game time the fastest route may use, for a session length in minutes. */
export function fastestRouteBudget(lengthMin) {
  return lengthMin * 60 * 0.25;
}

/** Mandatory time to get through a lock once you hold its key or clue. */
export function unlockCost(lock) {
  if (!lock) return 0;
  switch (lock.kind) {
    case 'keycard': return COST.keycardSwipe;
    case 'keypad': return COST.keypadDigit * lock.code.length + COST.keypadSubmit;
    case 'sequence': return COST.noteInput * lock.melody.length + COST.keypadSubmit;
    case 'pitch': return COST.pitchMatch;
    case 'rhythm': return lock.rhythm.reduce((a, b) => a + b, 0) * COST.rhythmUnit + COST.keypadSubmit + COST.rhythmUnit;
    case 'power': return 0;
    default: return 0;
  }
}

/** Duration of a beep-count playback for a keypad code. */
export function beepPlaybackCost(code) {
  let t = 0;
  for (const ch of code) {
    const d = Number(ch);
    t += d === 0 ? COST.longTone : d * COST.beep;
    t += COST.beepGap;
  }
  return t;
}

/** Mandatory time at the clue (getting the key / learning the code). */
export function clueCost(lock) {
  if (!lock) return 0;
  const c = lock.clue;
  switch (c.type) {
    case 'container': return COST.search; // keycard or tuning fork inside a container
    case 'memo':
    case 'braille':
    case 'largeprint':
    case 'phone':
      return COST.interact; // the spoken text itself is narration and does not consume time
    case 'recorder_beeps': return COST.interact + beepPlaybackCost(lock.code);
    case 'melody': return COST.interact + COST.noteListen * lock.melody.length;
    case 'rhythm': return COST.interact + lock.rhythm.reduce((a, b) => a + b, 0) * COST.rhythmUnit + COST.rhythmUnit;
    case 'breaker': return COST.interact + COST.breakerPuzzle;
    default: return COST.interact;
  }
}

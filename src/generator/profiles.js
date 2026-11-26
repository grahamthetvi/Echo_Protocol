// How each session length scales: by content, not just the clock.

export const LENGTHS = [5, 15, 30, 60];

export const LENGTH_PROFILES = {
  5: {
    rooms: [5, 7], path: [4, 5], locks: [1, 1], zombies: [1, 2], logs: 1, memos: 1,
    keyDepth: [1, 1], loops: 0, jammed: 0, obstacleChance: 0.15,
    lockKinds: ['keycard', 'keypad'],
    zombieTypes: { shambler: 3, crawler: 1 },
    loot: { bandage: 1, juice: 1, lure: 1 },
    radio: false, map: false,
  },
  15: {
    rooms: [10, 14], path: [6, 7], locks: [2, 2], zombies: [3, 4], logs: 3, memos: 2,
    keyDepth: [1, 2], loops: 1, jammed: 1, obstacleChance: 0.3,
    lockKinds: ['keycard', 'keypad', 'sequence', 'power'],
    zombieTypes: { shambler: 3, crawler: 2, runner: 1 },
    loot: { bandage: 2, juice: 2, lure: 1, wedge: 1, battery: 2, food: 1, crowbar: 1 },
    radio: true, map: true,
  },
  30: {
    rooms: [18, 24], path: [8, 10], locks: [3, 3], zombies: [6, 8], logs: 6, memos: 3,
    keyDepth: [1, 2], loops: 2, jammed: 2, obstacleChance: 0.4,
    lockKinds: ['keycard', 'keypad', 'sequence', 'pitch', 'rhythm', 'power'],
    zombieTypes: { shambler: 3, crawler: 2, runner: 2, screamer: 1 },
    loot: { bandage: 3, juice: 3, lure: 2, wedge: 2, battery: 3, food: 2, crowbar: 1 },
    radio: true, map: true,
  },
  60: {
    rooms: [28, 40], path: [12, 15], locks: [4, 5], zombies: [10, 14], logs: 12, memos: 6,
    keyDepth: [1, 3], loops: 4, jammed: 3, obstacleChance: 0.45,
    lockKinds: ['keycard', 'keypad', 'sequence', 'pitch', 'rhythm', 'power'],
    zombieTypes: { shambler: 3, crawler: 2, runner: 2, screamer: 1, armored: 1 },
    loot: { bandage: 5, juice: 4, lure: 3, wedge: 3, battery: 4, food: 3, crowbar: 1 },
    radio: true, map: true,
  },
};

export function profileFor(lengthMin) {
  const p = LENGTH_PROFILES[lengthMin];
  if (!p) throw new Error(`Unsupported session length: ${lengthMin}`);
  return p;
}

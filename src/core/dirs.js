// Compass helpers. World y grows to the south, x grows to the east.

export const DIRS = ['N', 'E', 'S', 'W'];
export const DVEC = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
export const DIR_NAME = { N: 'north', E: 'east', S: 'south', W: 'west' };

export function turnLeft(d) {
  return DIRS[(DIRS.indexOf(d) + 3) % 4];
}
export function turnRight(d) {
  return DIRS[(DIRS.indexOf(d) + 1) % 4];
}

/** Number of 90-degree turns between two facings (0, 1 or 2). */
export function turnsBetween(a, b) {
  const diff = Math.abs(DIRS.indexOf(a) - DIRS.indexOf(b));
  return diff === 3 ? 1 : diff;
}

/**
 * Express a world-space offset relative to the facing direction.
 * Returns { forward, right } where forward > 0 is ahead and right > 0 is to the right.
 */
export function toRelative(dx, dy, facing) {
  switch (facing) {
    case 'N': return { forward: -dy, right: dx };
    case 'S': return { forward: dy, right: -dx };
    case 'E': return { forward: dx, right: dy };
    case 'W': return { forward: -dx, right: -dy };
    default: return { forward: -dy, right: dx };
  }
}

/** Which relative side ('ahead' | 'right' | 'behind' | 'left') an absolute direction is. */
export function relativeSide(absDir, facing) {
  const i = (DIRS.indexOf(absDir) - DIRS.indexOf(facing) + 4) % 4;
  return ['ahead', 'right', 'behind', 'left'][i];
}

/** Words like "ahead", "ahead and to the left", "behind you". */
export function relativeWords(dx, dy, facing) {
  if (dx === 0 && dy === 0) return 'right here';
  const { forward, right } = toRelative(dx, dy, facing);
  const af = Math.abs(forward);
  const ar = Math.abs(right);
  const fwd = forward > 0 ? 'ahead' : 'behind you';
  const side = right > 0 ? 'to your right' : 'to your left';
  if (ar <= af * 0.414) return fwd;
  if (af <= ar * 0.414) return side;
  return forward > 0 ? `ahead and ${side}` : `behind you and ${side}`;
}

/** Clock-face positions (12 = straight ahead), an orientation-and-mobility convention. */
export function clockWords(dx, dy, facing) {
  if (dx === 0 && dy === 0) return 'right here';
  const { forward, right } = toRelative(dx, dy, facing);
  let angle = Math.atan2(right, forward); // 0 ahead, +pi/2 right
  if (angle < 0) angle += Math.PI * 2;
  let hour = Math.round(angle / (Math.PI / 6)) % 12;
  if (hour === 0) hour = 12;
  return `at ${hour} o'clock`;
}

export function directionWords(dx, dy, facing, style = 'words') {
  return style === 'clock' ? clockWords(dx, dy, facing) : relativeWords(dx, dy, facing);
}

/** Absolute compass direction (8-way) for an offset, e.g. "north-east". */
export function compassWords(dx, dy) {
  if (dx === 0 && dy === 0) return 'here';
  const angle = Math.atan2(dx, -dy); // 0 = north
  const idx = Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][idx];
}

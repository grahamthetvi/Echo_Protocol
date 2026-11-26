// Short, speakable seed codes such as "amber fox 42" so a teacher can replay a layout.
// Words are short, common and distinct when spoken aloud.

export const WORDS_A = [
  'amber', 'brave', 'calm', 'dusty', 'eager', 'fuzzy', 'gentle', 'happy',
  'icy', 'jolly', 'kind', 'lucky', 'misty', 'noble', 'odd', 'proud',
  'quick', 'rusty', 'silver', 'tiny', 'urban', 'velvet', 'windy', 'young',
  'bold', 'cozy', 'daring', 'early', 'fancy', 'golden', 'hollow', 'jumpy',
  'lively', 'mellow', 'nimble', 'orange', 'polite', 'quiet', 'rapid', 'sunny',
];

export const WORDS_B = [
  'fox', 'owl', 'pine', 'river', 'stone', 'cloud', 'maple', 'otter',
  'badger', 'comet', 'drum', 'eagle', 'fern', 'gecko', 'harbor', 'island',
  'jacket', 'kettle', 'lantern', 'meadow', 'nugget', 'orbit', 'pepper', 'quilt',
  'rocket', 'salmon', 'tiger', 'violin', 'walrus', 'yak', 'zebra', 'acorn',
  'bison', 'canyon', 'dolphin', 'falcon', 'garden', 'hammer', 'igloo', 'koala',
];

const NUM_MIN = 10;
const NUM_COUNT = 90; // 10..99

export const SEED_SPACE = WORDS_A.length * WORDS_B.length * NUM_COUNT;

export function codeFromIndex(index) {
  const i = ((index % SEED_SPACE) + SEED_SPACE) % SEED_SPACE;
  const num = i % NUM_COUNT;
  const rest = Math.floor(i / NUM_COUNT);
  const b = rest % WORDS_B.length;
  const a = Math.floor(rest / WORDS_B.length);
  return `${WORDS_A[a]}-${WORDS_B[b]}-${num + NUM_MIN}`;
}

/** Parse "Amber Fox 42", "amber-fox-42", etc. Returns an index or null. */
export function indexFromCode(code) {
  if (typeof code !== 'string') return null;
  const parts = code.toLowerCase().trim().split(/[\s\-_,.]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const a = WORDS_A.indexOf(parts[0]);
  const b = WORDS_B.indexOf(parts[1]);
  const n = Number.parseInt(parts[2], 10);
  if (a < 0 || b < 0 || !Number.isFinite(n) || n < NUM_MIN || n >= NUM_MIN + NUM_COUNT) return null;
  return (a * WORDS_B.length + b) * NUM_COUNT + (n - NUM_MIN);
}

export function spokenCode(code) {
  return code.replace(/-/g, ' ');
}

export function randomSeedIndex(random = Math.random) {
  return Math.floor(random() * SEED_SPACE);
}

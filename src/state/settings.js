// Player and teacher settings, persisted in localStorage.

export const DEFAULT_KEYMAP = {
  forward: ['ArrowUp', 'KeyW'],
  back: ['ArrowDown', 'KeyS'],
  turnLeft: ['ArrowLeft', 'KeyA'],
  turnRight: ['ArrowRight', 'KeyD'],
  interact: ['Space', 'Enter', 'NumpadEnter'],
  repeat: ['KeyR'],
  repeatFull: ['Shift+KeyR'],
  listen: ['KeyL'],
  inventory: ['KeyI'],
  hint: ['KeyH'],
  time: ['KeyT'],
  compass: ['KeyC'],
  map: ['KeyM'],
  fight: ['KeyF'],
  hide: ['KeyE'],
  ping: ['KeyP'],
  where: ['KeyQ'],
  cane: ['KeyX'],
  status: ['KeyZ'],
  cycleMove: ['KeyV'],
  help: ['Slash', 'F1'],
  runHold: ['ShiftLeft', 'ShiftRight'],
  sneakHold: ['ControlLeft', 'ControlRight'],
};

export const ACTION_LABELS = {
  forward: 'Step forward', back: 'Step back', turnLeft: 'Turn left', turnRight: 'Turn right',
  interact: 'Interact', repeat: 'Repeat last message', repeatFull: 'Repeat room description',
  listen: 'Listen around', inventory: 'Inventory', hint: 'Hint', time: 'Time remaining',
  compass: 'Compass', map: 'Tactile map', fight: 'Fight', hide: 'Hide', ping: 'Echolocation ping',
  where: 'Where am I', cane: 'Cane tap', status: 'Health and noise', cycleMove: 'Switch walk, sneak, run',
  help: 'Controls help', runHold: 'Run (hold)', sneakHold: 'Sneak (hold)',
};

export const DEFAULT_SETTINGS = {
  speech: { rate: 1.3, pitch: 1, volume: 1, voiceURI: null },
  mix: { master: 0.9, effects: 0.8, ambience: 0.45, alerts: 0.9, ui: 0.7 },
  mono: false,
  pingSpeech: true,
  directionStyle: 'words', // or 'clock'
  announceNoise: true,
  assist: false,
  selfVoicing: true,
  lockdown: true,
  visuals: { enabled: false, highContrast: false, largeSprites: false, captions: true, revealMap: false },
  keymap: DEFAULT_KEYMAP,
  tutorialDone: false,
  defaultLength: 15,
  teacherSeed: null,
};

const KEY = 'echo.settings.v1';

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && v && typeof v === 'object' && !Array.isArray(v)
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

export function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    const merged = deepMerge(cloneDefaults(), raw ? JSON.parse(raw) : {});
    // New actions added in later versions get their default keys.
    merged.keymap = { ...DEFAULT_KEYMAP, ...merged.keymap };
    return merged;
  } catch {
    return cloneDefaults();
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

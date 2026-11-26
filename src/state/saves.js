// Save slots in localStorage (3 manual slots + autosave) and file export/import.

const PREFIX = 'echo.save.';
export const SLOTS = ['auto', '1', '2', '3'];

export class Saves {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }
  save(slot, data) {
    try {
      this.storage.setItem(PREFIX + slot, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }
  load(slot) {
    try {
      const raw = this.storage.getItem(PREFIX + slot);
      return raw ? validate(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  remove(slot) {
    try {
      this.storage.removeItem(PREFIX + slot);
    } catch { /* ignore */ }
  }
  list() {
    return SLOTS.map((slot) => ({ slot, data: this.load(slot) }));
  }
}

export function validate(d) {
  if (!d || d.v !== 1 || !Number.isInteger(d.seedIndex) || ![5, 15, 30, 60].includes(d.lengthMin) || !d.player || !d.clock) return null;
  return d;
}

export function exportText(data) {
  return JSON.stringify({ app: 'echo-protocol', ...data }, null, 2);
}

export function importText(text) {
  try {
    return validate(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Short spoken label for a slot. */
export function slotLabel(slot, d, roomName) {
  const name = slot === 'auto' ? 'Autosave' : `Slot ${slot}`;
  if (!d) return `${name}: empty`;
  const left = Math.max(0, Math.round((d.clock.limit + d.clock.bonus - d.clock.elapsed) / 60));
  const when = d.savedAt ? new Date(d.savedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  return `${name}: ${d.lengthMin}-minute game, ${roomName || 'in the facility'}, about ${left} ${left === 1 ? 'minute' : 'minutes'} left${when ? `, saved ${when}` : ''}`;
}

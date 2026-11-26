// Loads the JSON content files. In the browser this uses fetch; tests pass a reader.

export const DATA_FILES = ['rooms', 'items', 'zombies', 'story'];

export async function loadData(read = defaultFetch) {
  const out = {};
  await Promise.all(DATA_FILES.map(async (name) => {
    out[name] = await read(`data/${name}.json`);
  }));
  out.itemById = new Map(out.items.items.map((i) => [i.id, i]));
  out.zombieById = new Map(out.zombies.types.map((z) => [z.id, z]));
  out.logById = new Map(out.story.logs.map((l) => [l.id, l]));
  return out;
}

async function defaultFetch(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
}

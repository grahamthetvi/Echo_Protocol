import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadData } from '../src/data/load.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function nodeData() {
  return loadData(async (p) => JSON.parse(await readFile(path.join(root, p), 'utf8')));
}
export { root };

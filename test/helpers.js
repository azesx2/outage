import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const fixturesDir = new URL('./fixtures/', import.meta.url).pathname;

/** Returns [name, parsedJson] pairs for every *.json file in a fixtures subdirectory. */
export function loadJsonDir(subdir) {
  const dir = join(fixturesDir, subdir);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, f), 'utf8'))]);
}

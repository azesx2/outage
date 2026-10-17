// Protects the published latest.json: a new snapshot only replaces it when that is safe.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ValidationError } from './errors.js';
import { fetchJson } from './fetch.js';
import { kyivDate } from './kyiv-time.js';
import { assertSchema } from './snapshot.js';

/** Returns the value if it is a valid snapshot, otherwise null: an invalid file is never worth protecting. */
function validOrNull(value) {
  try {
    assertSchema(value);
    return value;
  } catch {
    return null;
  }
}

/** Reads a local snapshot; returns null if absent or invalid. */
export async function readPrevious(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return validOrNull(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Downloads the snapshot currently published on GitHub Pages.
 * Returns null when nothing is published yet (404) or the file is invalid. Any other failure throws,
 * so the last-known-good protection is never skipped silently.
 */
export async function downloadPrevious(url, options) {
  const busted = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`; // bypass the Pages CDN cache
  try {
    return validOrNull(await fetchJson(busted, { ...options, allowNotFound: true }));
  } catch (error) {
    throw new ValidationError(
      'previous-unavailable',
      `Could not download the published snapshot ${url}: ${error.message}`,
    );
  }
}

/**
 * Throws ValidationError when `next` must not replace `previous`:
 * - next publishes no days while previous still has a current or future day;
 * - the source went backwards (older "станом на") for a date both snapshots contain.
 */
export function assertCanReplace(previous, next, now) {
  if (!previous) return;
  const today = kyivDate(now);
  if (next.days.length === 0 && previous.days.some((d) => d.date >= today)) {
    throw new ValidationError(
      'empty-would-overwrite',
      'Source returned no schedule while the published data still covers today or later; keeping it',
    );
  }
  for (const day of next.days) {
    const old = previous.days.find((d) => d.date === day.date);
    if (old && Date.parse(day.sourceUpdatedAt) < Date.parse(old.sourceUpdatedAt)) {
      throw new ValidationError(
        'source-regressed',
        `Schedule for ${day.date} is older (${day.sourceUpdatedAt}) than the published one (${old.sourceUpdatedAt})`,
      );
    }
  }
}

/** Writes JSON atomically (temp file + rename) so readers never see a partial file. */
export async function writeJsonAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, path);
}

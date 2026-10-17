import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCanReplace, readPrevious, writeJsonAtomic } from '../src/last-known-good.js';
import { loadJsonDir } from './helpers.js';

const valid = Object.fromEntries(loadJsonDir('output/valid'));
const current = valid['current-one-day'];
const empty = valid['no-data-published'];
const at = (iso) => Date.parse(iso);

test('allows any valid snapshot when nothing is published yet', () => {
  assert.doesNotThrow(() => assertCanReplace(null, empty, at('2026-10-17T20:00:00+03:00')));
});

test('refuses to replace a current schedule with an empty one', () => {
  assert.throws(() => assertCanReplace(current, empty, at('2026-10-17T20:00:00+03:00')), {
    reason: 'empty-would-overwrite',
  });
});

test('allows an empty snapshot once the published days are in the past', () => {
  assert.doesNotThrow(() => assertCanReplace(current, empty, at('2026-10-18T09:00:00+03:00')));
});

test('refuses an older publication for the same date', () => {
  const older = structuredClone(current);
  older.days[0].sourceUpdatedAt = '2026-10-17T16:00:00+03:00';
  assert.throws(() => assertCanReplace(current, older, at('2026-10-17T20:00:00+03:00')), {
    reason: 'source-regressed',
  });
  assert.doesNotThrow(() => assertCanReplace(older, current, at('2026-10-17T20:00:00+03:00')));
});

test('readPrevious returns null for missing or invalid files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lkg-'));
  assert.equal(await readPrevious(join(dir, 'missing.json')), null);
  await writeFile(join(dir, 'broken.json'), '{"schemaVersion":');
  assert.equal(await readPrevious(join(dir, 'broken.json')), null);
  await writeFile(join(dir, 'wrong.json'), JSON.stringify({ ...current, schemaVersion: 2 }));
  assert.equal(await readPrevious(join(dir, 'wrong.json')), null);
});

test('writeJsonAtomic round-trips through readPrevious', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'lkg-')), 'nested', 'latest.json');
  await writeJsonAtomic(path, current);
  assert.deepEqual(await readPrevious(path), current);
  assert.ok((await readFile(path, 'utf8')).endsWith('}\n'));
});

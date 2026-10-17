// Live-source check: contacts the official API. Run with `npm run test:live`; not part of `npm test`.
// Fails with the validation reason and saves the raw responses so a layout change can be diagnosed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fetchSchedule } from '../src/fetch.js';
import { buildSnapshot } from '../src/snapshot.js';
import { KNOWN_GROUPS } from '../src/source.js';

test('live source parses into a valid snapshot', async (t) => {
  const { responses, items, warning } = await fetchSchedule();
  if (warning) t.diagnostic(warning);
  let snapshot;
  try {
    snapshot = buildSnapshot(responses, Date.now(), items);
  } catch (error) {
    await mkdir('diagnostics', { recursive: true });
    await writeFile('diagnostics/live-responses.json', JSON.stringify(responses, null, 2));
    throw new Error(`${error.message}\nRaw responses saved to diagnostics/live-responses.json`, {
      cause: error,
    });
  }
  t.diagnostic(
    `days: ${snapshot.days.map((d) => d.date).join(', ') || 'none'}; source updated ${snapshot.sourceUpdatedAt}`,
  );
  assert.deepEqual(snapshot.groups, KNOWN_GROUPS);
  for (const day of snapshot.days) assert.deepEqual(Object.keys(day.groups), KNOWN_GROUPS);
  if (snapshot.days.length === 0) t.diagnostic('Source currently publishes no schedule.');
});

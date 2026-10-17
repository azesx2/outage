#!/usr/bin/env node
// Fetches the official schedule, validates it and updates docs/data/latest.json.
// On any failure the published file is left untouched, diagnostics are saved and the exit code is 1.
//
// Usage: node scripts/update.js [--out <path>] [--diagnostics <dir>] [--fixture <source fixture>]

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ValidationError } from '../src/errors.js';
import { fetchSchedule } from '../src/fetch.js';
import { assertCanReplace, readPrevious, writeJsonAtomic } from '../src/last-known-good.js';
import { buildSnapshot } from '../src/snapshot.js';
import { ITEMS } from '../src/source.js';

const HINTS = {
  'fetch-failed':
    'The source did not respond. Usually temporary; if it persists, check whether api.loe.lviv.ua is blocking GitHub runners.',
  'unexpected-response-shape':
    'The API response format changed. Compare diagnostics/*/response-*.json with test/fixtures/source/normal-live-*.json.',
  'item-identity-mismatch':
    'The Today/Tomorrow items moved and menu discovery failed. Inspect the photo-grafic menu and update ITEMS in src/source.js.',
  'unknown-line':
    'The schedule wording changed. Update PATTERNS in src/parse.js and add a fixture for the new wording.',
  'missing-groups':
    'Some groups are missing. If the source really changed its groups, update KNOWN_GROUPS in src/source.js.',
  'unknown-group':
    'A new group appeared. If it is genuine, add it to KNOWN_GROUPS in src/source.js and to the frontend.',
  'empty-would-overwrite':
    'The source is empty while our data still covers today. The published data was kept; this clears once the source republishes or the day passes.',
  'source-regressed':
    'The source served an older publication than the one already published (cache or rollback). The newer data was kept.',
};

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: 'docs/data/latest.json' },
    diagnostics: { type: 'string', default: 'diagnostics' },
    fixture: { type: 'string' },
  },
});

/** Schedule content without fetchedAt, used to decide whether anything really changed. */
const content = (s) => s && JSON.stringify({ ...s, fetchedAt: undefined });

async function saveDiagnostics(error, responses, now) {
  const dir = join(args.diagnostics, new Date(now).toISOString().replace(/[:.]/g, '-'));
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'error.json'),
    `${JSON.stringify(
      {
        at: new Date(now).toISOString(),
        reason: error.reason ?? 'internal-error',
        message: error.message,
        details: error.details,
        stack: error instanceof ValidationError ? undefined : error.stack,
      },
      null,
      2,
    )}\n`,
  );
  for (const [key, body] of Object.entries(responses ?? {})) {
    await writeFile(join(dir, `response-${key}.json`), `${JSON.stringify(body, null, 2)}\n`);
  }
  return dir;
}

async function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  let now = Date.now();
  let responses;
  try {
    let items = ITEMS;
    if (args.fixture) {
      const fixture = JSON.parse(await readFile(args.fixture, 'utf8'));
      now = Date.parse(fixture.now);
      responses = fixture.responses;
    } else {
      const fetched = await fetchSchedule();
      ({ responses, items } = fetched);
      if (fetched.warning) console.warn(`::warning::${fetched.warning}`);
    }

    const snapshot = buildSnapshot(responses, now, items);
    const previous = await readPrevious(args.out);
    assertCanReplace(previous, snapshot, now);
    await writeJsonAtomic(args.out, snapshot);

    const changed = content(previous) !== content(snapshot);
    const summary = snapshot.days.map((d) => d.date).join(', ') || 'none published';
    await setOutput('changed', changed);
    await setOutput('days', summary);
    await setOutput('source-updated', snapshot.sourceUpdatedAt ?? 'n/a');
    console.log(
      `OK: wrote ${args.out} (days: ${summary}; source updated ${snapshot.sourceUpdatedAt ?? 'n/a'}; schedule ${changed ? 'changed' : 'unchanged'})`,
    );
  } catch (error) {
    const dir = await saveDiagnostics(error, responses, now);
    const reason = error.reason ?? 'internal-error';
    console.error(`::error::${error.message}`);
    if (HINTS[reason]) console.error(`Hint: ${HINTS[reason]}`);
    console.error(`Published data left unchanged. Diagnostics: ${dir}`);
    process.exitCode = 1;
  }
}

await main();

// End to end without the network: source fixture -> scripts/update.js -> latest.json -> page logic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { computeView } from '../docs/schedule.js';
import { fixturesDir } from './helpers.js';

const exec = promisify(execFile);
const script = new URL('../scripts/update.js', import.meta.url).pathname;

async function update(dir, fixture) {
  const githubOutput = join(dir, 'github-output');
  await writeFile(githubOutput, '');
  try {
    const { stdout } = await exec(
      process.execPath,
      [
        script,
        '--out',
        join(dir, 'latest.json'),
        '--diagnostics',
        join(dir, 'diagnostics'),
        '--fixture',
        join(fixturesDir, 'source', `${fixture}.json`),
      ],
      { env: { ...process.env, GITHUB_OUTPUT: githubOutput } },
    );
    return { code: 0, stdout, outputs: await readFile(githubOutput, 'utf8') };
  } catch (error) {
    return { code: error.code, stderr: error.stderr };
  }
}

test('a valid source produces latest.json that the page can render', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-'));
  const result = await update(dir, 'cross-midnight-two-days');
  assert.equal(result.code, 0);
  assert.match(result.outputs, /^changed=true$/m);
  assert.match(result.outputs, /^days=2026-02-11, 2026-02-12$/m);

  const data = JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8'));
  const view = computeView(data, '1.1', Date.parse('2026-02-11T23:00:00+02:00'));
  assert.equal(view.status, 'off');
  assert.equal(view.today.published, true);
  assert.equal(view.tomorrow.published, true);
});

test('re-running with the same source reports "unchanged"', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-'));
  await update(dir, 'normal-live-2026-10-17');
  const again = await update(dir, 'normal-live-2026-10-17');
  assert.equal(again.code, 0);
  assert.match(again.outputs, /^changed=false$/m);
});

test('a broken source leaves the published file untouched and saves diagnostics', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-'));
  await update(dir, 'normal-live-2026-10-17');
  const before = await readFile(join(dir, 'latest.json'), 'utf8');

  const result = await update(dir, 'reject-layout-change-wording');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\[unknown-line\]/);
  assert.match(result.stderr, /Hint: /);
  assert.match(result.stderr, /Published data left unchanged/);
  assert.equal(await readFile(join(dir, 'latest.json'), 'utf8'), before);

  const [run] = await readdir(join(dir, 'diagnostics'));
  const files = await readdir(join(dir, 'diagnostics', run));
  assert.deepEqual(files.sort(), ['error.json', 'response-today.json', 'response-tomorrow.json']);
  const error = JSON.parse(await readFile(join(dir, 'diagnostics', run, 'error.json'), 'utf8'));
  assert.equal(error.reason, 'unknown-line');
});

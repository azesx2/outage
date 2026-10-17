// End to end without the network: source fixture -> scripts/update.js -> latest.json -> page logic.
// A local HTTP server stands in for GitHub Pages as the last-known-good baseline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { access, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { computeView } from '../docs/schedule.js';
import { fixturesDir, loadJsonDir } from './helpers.js';

const exec = promisify(execFile);
const script = new URL('../scripts/update.js', import.meta.url).pathname;
const sourceFixture = (name) => join(fixturesDir, 'source', `${name}.json`);

async function update(dir, fixturePath, previousUrl) {
  const args = [
    script,
    '--out',
    join(dir, 'latest.json'),
    '--diagnostics',
    join(dir, 'diagnostics'),
  ];
  if (previousUrl) args.push('--previous-url', previousUrl);
  try {
    const { stdout } = await exec(process.execPath, [...args, '--fixture', fixturePath]);
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code, stderr: error.stderr };
  }
}

/** Serves `latest.json` with the given status and body, like GitHub Pages would. */
async function fakePages(status, body = '') {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/data/latest.json`;
  return { url, requests, close: () => server.close() };
}

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

test('a valid source produces latest.json that the page can render', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-'));
  const result = await update(dir, sourceFixture('cross-midnight-two-days'));
  assert.equal(result.code, 0);

  const data = JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8'));
  const view = computeView(data, '1.1', Date.parse('2026-02-11T23:00:00+02:00'));
  assert.equal(view.status, 'off');
  assert.equal(view.today.published, true);
  assert.equal(view.tomorrow.published, true);
});

test('first deploy: a 404 from Pages means no baseline yet', async () => {
  const pages = await fakePages(404, 'Not found');
  try {
    const dir = await mkdtemp(join(tmpdir(), 'e2e-'));
    const result = await update(dir, sourceFixture('normal-live-2026-10-17'), pages.url);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /nothing published yet/);
    assert.match(pages.requests[0], /^\/data\/latest\.json\?t=\d+$/, 'bypasses the CDN cache');
  } finally {
    pages.close();
  }
});

test('the published snapshot from Pages protects against an empty source', async () => {
  const [, published] = loadJsonDir('output/valid').find(([n]) => n === 'current-one-day');
  const pages = await fakePages(200, JSON.stringify(published));
  try {
    const dir = await mkdtemp(join(tmpdir(), 'e2e-'));
    const live = JSON.parse(await readFile(sourceFixture('normal-live-2026-10-17'), 'utf8'));
    live.responses.today = { ...live.responses.today, rawHtml: '', rawMobileHtml: '' };
    const emptyFixture = join(dir, 'empty-source.json');
    await writeFile(emptyFixture, JSON.stringify(live));

    const result = await update(dir, emptyFixture, pages.url);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /\[empty-would-overwrite\]/);
    assert.equal(await exists(join(dir, 'latest.json')), false, 'nothing is written');
  } finally {
    pages.close();
  }
});

test('an unreachable baseline stops the run instead of skipping protection', async () => {
  const pages = await fakePages(403, 'Forbidden');
  try {
    const dir = await mkdtemp(join(tmpdir(), 'e2e-'));
    const result = await update(dir, sourceFixture('normal-live-2026-10-17'), pages.url);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /\[previous-unavailable\]/);
    assert.match(result.stderr, /Hint: .*GitHub Pages/);
    assert.equal(await exists(join(dir, 'latest.json')), false);
  } finally {
    pages.close();
  }
});

test('a broken source leaves the existing file untouched and saves diagnostics', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-'));
  await update(dir, sourceFixture('normal-live-2026-10-17'));
  const before = await readFile(join(dir, 'latest.json'), 'utf8');

  const result = await update(dir, sourceFixture('reject-layout-change-wording'));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\[unknown-line\]/);
  assert.match(result.stderr, /Hint: /);
  assert.match(result.stderr, /published data left unchanged/);
  assert.equal(await readFile(join(dir, 'latest.json'), 'utf8'), before);

  const [run] = await readdir(join(dir, 'diagnostics'));
  const files = await readdir(join(dir, 'diagnostics', run));
  assert.deepEqual(files.sort(), ['error.json', 'response-today.json', 'response-tomorrow.json']);
  const error = JSON.parse(await readFile(join(dir, 'diagnostics', run, 'error.json'), 'utf8'));
  assert.equal(error.reason, 'unknown-line');
});

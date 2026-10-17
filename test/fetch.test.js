import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, fetchSchedule } from '../src/fetch.js';
import { SCHEDULE_MENU_URL } from '../src/source.js';
import { loadJsonDir } from './helpers.js';

const fast = { delays: [0, 0] };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Fake fetch that serves queued responses per URL and records calls. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const queue = routes[url];
    if (!queue?.length) throw new TypeError(`unexpected URL ${url}`);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next();
  };
  return { impl, calls };
}

test('retries network errors and 5xx, then succeeds', async () => {
  const { impl, calls } = fakeFetch({
    u: [new TypeError('fetch failed'), () => json({}, 503), () => json({ ok: 1 })],
  });
  assert.deepEqual(await fetchJson('u', { ...fast, fetchImpl: impl }), { ok: 1 });
  assert.equal(calls.length, 3);
});

test('does not retry 404 and reports fetch-failed', async () => {
  const { impl, calls } = fakeFetch({ u: [() => json({}, 404)] });
  await assert.rejects(fetchJson('u', { ...fast, fetchImpl: impl }), {
    reason: 'fetch-failed',
    message: /HTTP 404/,
  });
  assert.equal(calls.length, 1);
});

test('gives up after limited retries', async () => {
  const { impl, calls } = fakeFetch({ u: [() => json({}, 500)] });
  await assert.rejects(fetchJson('u', { ...fast, fetchImpl: impl }), { reason: 'fetch-failed' });
  assert.equal(calls.length, 3);
});

test('rejects non-JSON responses (e.g. a Cloudflare challenge page)', async () => {
  const { impl } = fakeFetch({ u: [() => new Response('<!doctype html><title>Just a moment')] });
  await assert.rejects(fetchJson('u', { ...fast, fetchImpl: impl }), {
    reason: 'unexpected-response-shape',
  });
});

const [, live] = loadJsonDir('source').find(([n]) => n === 'normal-live-2026-10-17');
const { today, tomorrow } = live.responses;
const itemRoutes = (t, m) => ({
  'https://api.loe.lviv.ua/api/menu_items/238': [() => json(t)],
  'https://api.loe.lviv.ua/api/menu_items/256': [() => json(m)],
});

test('fetchSchedule reads the two fixed items', async () => {
  const { impl, calls } = fakeFetch(itemRoutes(today, tomorrow));
  const result = await fetchSchedule({ ...fast, fetchImpl: impl });
  assert.deepEqual(result.responses, { today, tomorrow });
  assert.equal(result.warning, null);
  assert.equal(calls.length, 2);
});

test('fetchSchedule falls back to menu discovery when item IDs move', async () => {
  const moved = { ...today, id: 238, name: 'Something else' };
  const menu = {
    'hydra:member': [
      {
        id: 9,
        menuItems: [
          { ...today, id: 900, name: 'Today' },
          { ...tomorrow, id: 901, name: 'Tomorrow' },
        ],
      },
    ],
  };
  const { impl } = fakeFetch({
    ...itemRoutes(moved, tomorrow),
    [SCHEDULE_MENU_URL]: [() => json(menu)],
  });
  const result = await fetchSchedule({ ...fast, fetchImpl: impl });
  assert.deepEqual(result.items, {
    today: { id: 900, name: 'Today' },
    tomorrow: { id: 901, name: 'Tomorrow' },
  });
  assert.equal(result.responses.today.rawHtml, today.rawHtml);
  assert.match(result.warning, /Update ITEMS/);
});

test('fetchSchedule fails clearly when discovery cannot find the items', async () => {
  const moved = { ...today, name: 'Something else' };
  const { impl } = fakeFetch({
    ...itemRoutes(moved, tomorrow),
    [SCHEDULE_MENU_URL]: [() => json({ 'hydra:member': [{ id: 9, menuItems: [] }] })],
  });
  await assert.rejects(fetchSchedule({ ...fast, fetchImpl: impl }), {
    reason: 'item-identity-mismatch',
  });
});

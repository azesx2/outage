import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJob, syncJob } from '../scripts/sync-cron.js';

const job = buildJob({ repository: 'azesx2/outage', token: 'secret-token' });

/** Fake cron-job.org API: records calls and answers from `existing` jobs. */
function fakeApi(existing) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ path: url.replace('https://api.cron-job.org', ''), ...init });
    const body =
      init.method === 'GET' ? { jobs: existing } : init.method === 'PUT' ? { jobId: 42 } : {};
    return { ok: true, status: 200, json: async () => body };
  };
  return { calls, fetchImpl };
}

test('job dispatches the update workflow on main at minutes 17 and 47', () => {
  assert.equal(
    job.url,
    'https://api.github.com/repos/azesx2/outage/actions/workflows/update.yml/dispatches',
  );
  assert.equal(job.requestMethod, 1);
  assert.deepEqual(job.schedule.minutes, [17, 47]);
  assert.deepEqual(job.schedule.hours, [-1]);
  assert.equal(job.extendedData.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(job.extendedData.body), { ref: 'main' });
  assert.throws(() => buildJob({ repository: undefined, token: 'x' }), /GITHUB_REPOSITORY/);
});

test('creates the job when none has the title', async () => {
  const api = fakeApi([{ jobId: 7, title: 'something else' }]);
  assert.deepEqual(await syncJob({ apiKey: 'k', job, fetchImpl: api.fetchImpl }), {
    action: 'created',
    jobId: 42,
  });
  assert.deepEqual(
    api.calls.map((c) => `${c.method} ${c.path}`),
    ['GET /jobs', 'PUT /jobs'],
  );
  assert.equal(api.calls[0].headers.Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(api.calls[1].body), { job });
});

test('updates the existing job instead of creating a duplicate', async () => {
  const api = fakeApi([{ jobId: 9, title: job.title }]);
  assert.deepEqual(await syncJob({ apiKey: 'k', job, fetchImpl: api.fetchImpl }), {
    action: 'updated',
    jobId: 9,
  });
  assert.equal(api.calls[1].method, 'PATCH');
  assert.equal(api.calls[1].path, '/jobs/9');
});

test('refuses to pick between duplicate jobs', async () => {
  const api = fakeApi([
    { jobId: 1, title: job.title },
    { jobId: 2, title: job.title },
  ]);
  await assert.rejects(syncJob({ apiKey: 'k', job, fetchImpl: api.fetchImpl }), /1, 2/);
});

test('errors report only the status, never the response body', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ echoed: 'secret-token' }),
  });
  await assert.rejects(syncJob({ apiKey: 'k', job, fetchImpl }), (error) => {
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /secret-token/);
    return true;
  });
});

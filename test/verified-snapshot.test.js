import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildVerifiedSnapshot } from '../src/verified-snapshot.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/source/normal-live-2026-10-17.json', import.meta.url)),
);
const now = Date.parse(fixture.now);
const run = (responses, imageReader) =>
  buildVerifiedSnapshot(responses, now, undefined, { imageReader });

test('compares every group and keeps text when the representations disagree', async () => {
  const matching = await run(fixture.responses, async (response) => response);
  assert.equal(matching.verification[0].status, 'agree');
  const different = await run(fixture.responses, async (response) => ({
    ...response,
    rawHtml: response.rawHtml.replace('20:00', '20:30'),
  }));
  assert.equal(different.verification[0].status, 'disagree');
  assert.deepEqual(different.verification[0].differingGroups, ['1.1']);
  assert.deepEqual(different.days, matching.days);
});

test('falls back to validated image when text wording changes', async () => {
  const responses = structuredClone(fixture.responses);
  responses.today.rawHtml = '<p>New wording</p>';
  const snapshot = await run(responses, async () => fixture.responses.today);
  assert.equal(snapshot.verification[0].source, 'image');
  assert.equal(snapshot.verification[0].status, 'image-only');
  assert.ok(snapshot.verification[0].textError);
  assert.equal(snapshot.days.length, 1);
});

test('retains valid text when OCR fails; unpublished is distinct from all-clear', async () => {
  const snapshot = await run(fixture.responses, async () => {
    throw new Error('OCR failed');
  });
  assert.equal(snapshot.verification[0].status, 'text-only');
  assert.equal(snapshot.verification[1].status, 'unavailable');
  assert.equal(snapshot.verification[1].source, 'none');
});

test('rejects incomplete image fallback and identity errors', async () => {
  const responses = structuredClone(fixture.responses);
  responses.today.rawHtml = 'Changed';
  await assert.rejects(run(responses, async () => ({ ...responses.today, rawHtml: 'Unreadable' })));
  responses.today.name = 'Archive';
  await assert.rejects(
    run(responses, async () => fixture.responses.today),
    { reason: 'item-identity-mismatch' },
  );
});

test('compares publication timestamp as well as intervals', async () => {
  const snapshot = await run(fixture.responses, async (response) => ({
    ...response,
    rawHtml: response.rawHtml.replace('18:56', '18:55'),
  }));
  assert.equal(snapshot.verification[0].status, 'disagree');
  assert.deepEqual(snapshot.verification[0].differingGroups, []);
});

test('falls back independently for Tomorrow and preserves half-hour boundaries', async () => {
  const responses = structuredClone(fixture.responses);
  const tomorrow = {
    ...responses.tomorrow,
    rawHtml: responses.today.rawHtml
      .replaceAll('17.10.2026', '18.10.2026')
      .replace('18:56 18.10.2026', '18:56 17.10.2026')
      .replace('20:00', '20:30'),
  };
  responses.tomorrow.rawHtml = 'Changed format';
  const snapshot = await run(responses, async (_response, key) =>
    key === 'today' ? responses.today : tomorrow,
  );
  assert.equal(snapshot.days.length, 2);
  assert.equal(snapshot.verification[1].source, 'image');
  assert.match(snapshot.days[1].groups['1.1'][0].start, /T20:30:00/);
});

test('does not treat a published but unreadable image as unpublished', async () => {
  const responses = structuredClone(fixture.responses);
  responses.tomorrow.imageUrl = '/media/schedule.png';
  await assert.rejects(
    run(responses, async () => {
      throw new Error('unreadable');
    }),
    /unreadable/,
  );
});

test('can use the image when the API stops exposing text, while retaining item identity checks', async () => {
  const responses = structuredClone(fixture.responses);
  delete responses.today.rawHtml;
  const snapshot = await run(responses, async () => fixture.responses.today);
  assert.equal(snapshot.verification[0].source, 'image');
});

test('a malformed image URL does not prevent publishing valid text', async () => {
  const responses = structuredClone(fixture.responses);
  responses.today.imageUrl = 'http://[';
  const snapshot = await buildVerifiedSnapshot(responses, now);
  assert.equal(snapshot.verification[0].status, 'text-only');
  assert.equal(snapshot.verification[0].imageUrl, null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStubSnapshot } from '../scripts/stub.js';
import { assertSchema } from '../src/snapshot.js';
import { computeView } from '../docs/schedule.js';

test('stub dates follow Kyiv today, including after UTC midnight and DST transitions', async () => {
  for (const [now, today, tomorrow] of [
    ['2026-10-17T22:30:00Z', '2026-10-18', '2026-10-19'],
    ['2026-10-25T09:00:00Z', '2026-10-25', '2026-10-26'],
    ['2027-03-28T09:00:00Z', '2027-03-28', '2027-03-29'],
  ]) {
    const snapshot = await createStubSnapshot(Date.parse(now));
    assertSchema(snapshot);
    assert.deepEqual(
      snapshot.days.map((day) => day.date),
      [today, tomorrow],
    );
    assert.equal(snapshot.days[0].groups['1.1'].length, 0);
    assert.equal(snapshot.days[0].groups['1.2'].length, 2);
    assert.equal(computeView(snapshot, '2.1', Date.parse(now)).today.published, true);
    assert.ok(snapshot.verification.every((result) => result.status === 'agree'));
  }
});

test('preview scenarios exercise the actual comparison and fallback paths', async () => {
  const now = Date.parse('2026-10-18T12:00:00+03:00');
  for (const [scenario, status, source] of [
    ['disagree', 'disagree', 'text'],
    ['fallback', 'image-only', 'image'],
    ['unverified', 'text-only', 'text'],
    ['unpublished', 'unavailable', 'none'],
  ]) {
    const snapshot = await createStubSnapshot(now, scenario);
    assertSchema(snapshot);
    assert.ok(
      snapshot.verification.every((result) => result.status === status && result.source === source),
    );
    assert.equal(snapshot.days.length, scenario === 'unpublished' ? 0 : 2);
  }
  await assert.rejects(createStubSnapshot(now, 'typo'), /Unknown scenario/);
  await assert.rejects(createStubSnapshot(NaN), /Invalid --now/);
});

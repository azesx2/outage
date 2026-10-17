import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isValidDate, kyivDate, kyivWallToEpoch, toKyivIso } from '../src/kyiv-time.js';

const wall = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return toKyivIso(kyivWallToEpoch(date, h * 60 + m));
};

test('uses +03:00 in summer and +02:00 in winter', () => {
  assert.equal(wall('2026-07-01', '12:00'), '2026-07-01T12:00:00+03:00');
  assert.equal(wall('2026-12-01', '12:00'), '2026-12-01T12:00:00+02:00');
});

test('24:00 is midnight of the next day', () => {
  assert.equal(wall('2026-10-17', '24:00'), '2026-10-18T00:00:00+03:00');
  assert.equal(wall('2026-12-31', '24:00'), '2027-01-01T00:00:00+02:00');
});

test('fall back: ambiguous 03:00-03:59 resolves to the earlier instant', () => {
  assert.equal(wall('2026-10-25', '02:30'), '2026-10-25T02:30:00+03:00');
  assert.equal(wall('2026-10-25', '03:00'), '2026-10-25T03:00:00+03:00');
  assert.equal(wall('2026-10-25', '03:30'), '2026-10-25T03:30:00+03:00');
  assert.equal(wall('2026-10-25', '04:00'), '2026-10-25T04:00:00+02:00');
  // 03:00 to 04:00 on that day lasts two real hours.
  const ms = kyivWallToEpoch('2026-10-25', 240) - kyivWallToEpoch('2026-10-25', 180);
  assert.equal(ms, 2 * 3_600_000);
});

test('spring forward: nonexistent 03:00-03:59 moves forward by the gap', () => {
  assert.equal(wall('2027-03-28', '02:30'), '2027-03-28T02:30:00+02:00');
  assert.equal(wall('2027-03-28', '03:00'), '2027-03-28T04:00:00+03:00');
  assert.equal(wall('2027-03-28', '03:30'), '2027-03-28T04:30:00+03:00');
  assert.equal(wall('2027-03-28', '04:00'), '2027-03-28T04:00:00+03:00');
});

test('kyivDate uses the Kyiv calendar day, not UTC', () => {
  assert.equal(kyivDate(Date.parse('2026-10-17T21:30:00Z')), '2026-10-18');
  assert.equal(kyivDate(Date.parse('2026-10-17T20:59:00Z')), '2026-10-17');
});

test('date helpers', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.ok(isValidDate('2028-02-29'));
  assert.ok(!isValidDate('2026-02-29'));
  assert.ok(!isValidDate('2026-13-01'));
});

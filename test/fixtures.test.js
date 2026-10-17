import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJsonDir } from './helpers.js';

// Guards the fixture contract that the Stage 2 parser tests will rely on.
const REASONS = new Set([
  'unexpected-response-shape',
  'item-identity-mismatch',
  'unknown-line',
  'missing-groups',
  'duplicate-group',
  'invalid-time',
  'off-grid-time',
  'empty-or-reversed-interval',
  'overlapping-intervals',
  'date-out-of-range',
  'updated-at-in-future',
]);
const OFFSET_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+0[23]:00$/;

const fixtures = loadJsonDir('source');

test('source fixtures cover accepted and rejected scenarios', () => {
  const results = fixtures.map(([, f]) => f.expect.result);
  assert.ok(results.filter((r) => r === 'accept').length >= 5);
  assert.ok(results.filter((r) => r === 'reject').length >= 10);
});

for (const [name, f] of fixtures) {
  test(`source fixture ${name} is well-formed`, () => {
    assert.equal(typeof f.description, 'string');
    assert.match(f.origin, /^(real|synthetic): /);
    assert.match(f.now, OFFSET_TIME, 'now must be a Kyiv time with explicit offset');
    assert.ok(f.responses.today && f.responses.tomorrow, 'needs today and tomorrow responses');
    assert.equal(
      name.startsWith('reject-'),
      f.expect.result === 'reject',
      'name prefix matches result',
    );

    if (f.expect.result === 'accept') {
      assert.ok(Array.isArray(f.expect.days) && f.expect.days.length > 0);
      for (const day of Object.values(f.expect.spotChecks ?? {})) {
        for (const intervals of Object.values(day)) {
          for (const [start, end] of intervals) {
            assert.match(start, OFFSET_TIME);
            assert.match(end, OFFSET_TIME);
            assert.ok(Date.parse(start) < Date.parse(end), `${start} < ${end}`);
          }
        }
      }
    } else {
      assert.ok(f.expect.reasons.length > 0);
      for (const r of f.expect.reasons) assert.ok(REASONS.has(r), `unknown reason ${r}`);
    }
  });
}

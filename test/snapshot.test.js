import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../src/errors.js';
import { buildSnapshot } from '../src/snapshot.js';
import { KNOWN_GROUPS } from '../src/source.js';
import { loadJsonDir } from './helpers.js';

const run = (f) => buildSnapshot(f.responses, Date.parse(f.now));

for (const [name, f] of loadJsonDir('source')) {
  if (f.expect.result === 'accept') {
    test(`accepts ${name}`, () => {
      const snapshot = run(f);
      assert.deepEqual(
        snapshot.days.map((d) => d.date),
        f.expect.days,
      );
      assert.equal(snapshot.fetchedAt, new Date(Date.parse(f.now)).toISOString());
      for (const day of snapshot.days) assert.deepEqual(Object.keys(day.groups), KNOWN_GROUPS);
      if (f.expect.allGroupsEmpty) {
        for (const day of snapshot.days) {
          for (const intervals of Object.values(day.groups)) assert.deepEqual(intervals, []);
        }
      }
      for (const [date, groups] of Object.entries(f.expect.spotChecks ?? {})) {
        const day = snapshot.days.find((d) => d.date === date);
        for (const [group, expected] of Object.entries(groups)) {
          assert.deepEqual(
            day.groups[group].map((iv) => [iv.start, iv.end]),
            expected,
            `${date} group ${group}`,
          );
        }
      }
    });
  } else {
    test(`rejects ${name} (${f.expect.reasons.join(' | ')})`, () => {
      assert.throws(
        () => run(f),
        (err) =>
          err instanceof ValidationError &&
          f.expect.reasons.includes(err.reason) &&
          err.message.length > 20,
      );
    });
  }
}

const [, live] = loadJsonDir('source').find(([n]) => n === 'normal-live-2026-10-17');

test('live fixture produces the exact expected output', () => {
  const [, expected] = loadJsonDir('output/valid').find(([n]) => n === 'current-one-day');
  const snapshot = buildSnapshot(live.responses, Date.parse('2026-10-17T19:47:12.345Z'));
  assert.deepEqual(snapshot, expected);
});

test('empty Today and Tomorrow mean "data unavailable", not "no outages"', () => {
  const empty = (r) => ({ ...r, rawHtml: '', rawMobileHtml: '' });
  const snapshot = buildSnapshot(
    { today: empty(live.responses.today), tomorrow: live.responses.tomorrow },
    Date.parse(live.now),
  );
  assert.deepEqual(snapshot.days, []);
  assert.equal(snapshot.sourceUpdatedAt, null);
});

test('rejects Tomorrow dated before Today', () => {
  const [, two] = loadJsonDir('source').find(([n]) => n === 'cross-midnight-two-days');
  assert.throws(
    () =>
      buildSnapshot(
        {
          today: { ...two.responses.today, rawHtml: two.responses.tomorrow.rawHtml },
          tomorrow: { ...two.responses.tomorrow, rawHtml: two.responses.today.rawHtml },
        },
        Date.parse(two.now),
      ),
    { reason: 'inconsistent-days' },
  );
});

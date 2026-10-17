import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createI18n } from '../docs/i18n.js';
import { assertSupported, computeView, kyivMidnight, overview } from '../docs/schedule.js';
import { loadJsonDir } from './helpers.js';

const valid = Object.fromEntries(loadJsonDir('output/valid'));
const at = (iso) => Date.parse(iso);
const withGroup = (data, date, group, intervals) => {
  const copy = structuredClone(data);
  copy.days.find((d) => d.date === date).groups[group] = intervals.map(([start, end]) => ({
    start,
    end,
    status: 'off',
  }));
  return copy;
};

test('during an outage: off, with the restoration time', () => {
  const view = computeView(valid['current-one-day'], '1.1', at('2026-10-17T20:30:00+03:00'));
  assert.equal(view.status, 'off');
  assert.deepEqual(view.next, { type: 'on', at: at('2026-10-17T22:00:00+03:00'), known: true });
});

test('before an outage: on, with the next outage start', () => {
  const view = computeView(valid['current-one-day'], '1.1', at('2026-10-17T19:00:00+03:00'));
  assert.equal(view.status, 'on');
  assert.deepEqual(view.next, { type: 'off', at: at('2026-10-17T20:00:00+03:00'), known: true });
});

test('after the last outage: on, nothing more until end of published data', () => {
  const view = computeView(valid['current-one-day'], '1.2', at('2026-10-17T20:30:00+03:00'));
  assert.equal(view.status, 'on');
  assert.deepEqual(view.next, { type: 'none', until: at('2026-10-18T00:00:00+03:00') });
});

test('boundaries: outage starts inclusive, ends exclusive', () => {
  const data = valid['current-one-day'];
  assert.equal(computeView(data, '1.1', at('2026-10-17T20:00:00+03:00')).status, 'off');
  assert.equal(computeView(data, '1.1', at('2026-10-17T22:00:00+03:00')).status, 'on');
});

test('an outage continuing past midnight is merged across days', () => {
  let data = withGroup(valid['two-days'], '2026-10-17', '1.1', [
    ['2026-10-17T22:00:00+03:00', '2026-10-18T00:00:00+03:00'],
  ]);
  data = withGroup(data, '2026-10-18', '1.1', [
    ['2026-10-18T00:00:00+03:00', '2026-10-18T02:30:00+03:00'],
  ]);
  const view = computeView(data, '1.1', at('2026-10-17T23:00:00+03:00'));
  assert.equal(view.status, 'off');
  assert.deepEqual(view.next, { type: 'on', at: at('2026-10-18T02:30:00+03:00'), known: true });
});

test('an outage running to the end of published data has an unknown end', () => {
  const data = withGroup(valid['current-one-day'], '2026-10-17', '1.1', [
    ['2026-10-17T22:00:00+03:00', '2026-10-18T00:00:00+03:00'],
  ]);
  const view = computeView(data, '1.1', at('2026-10-17T23:00:00+03:00'));
  assert.equal(view.status, 'off');
  assert.equal(view.next.known, false);
});

test('next outage tomorrow is found when tomorrow is published', () => {
  const view = computeView(valid['two-days'], '1.1', at('2026-10-17T23:00:00+03:00'));
  assert.equal(view.status, 'on');
  assert.deepEqual(view.next, { type: 'off', at: at('2026-10-18T00:00:00+03:00'), known: true });
  assert.equal(view.tomorrow.published, true);
});

test('no outages scheduled is "on", not "unknown"', () => {
  const view = computeView(valid['no-outages'], '3.1', at('2026-10-17T12:00:00+03:00'));
  assert.equal(view.status, 'on');
  assert.equal(view.today.published, true);
  assert.deepEqual(view.today.intervals, []);
});

test('no published data is "unknown", not "on"', () => {
  const view = computeView(valid['no-data-published'], '1.1', at('2026-10-17T12:00:00+03:00'));
  assert.equal(view.status, 'unknown');
  assert.equal(view.next, null);
  assert.equal(view.today.published, false);
  assert.equal(overview(valid['no-data-published'], '2026-10-17'), null);
});

test('after midnight with only yesterday published: unknown', () => {
  const view = computeView(valid['current-one-day'], '1.1', at('2026-10-18T00:20:00+03:00'));
  assert.equal(view.status, 'unknown');
  assert.equal(view.today.date, '2026-10-18');
  assert.equal(view.today.published, false);
});

test('stale after 75 minutes without a successful check', () => {
  assert.equal(
    computeView(valid['current-one-day'], '1.1', at('2026-10-17T19:57:00Z')).stale,
    false,
  );
  assert.equal(
    computeView(valid['stale-fetched-at'], '1.1', at('2026-10-17T20:00:00+03:00')).stale,
    true,
  );
});

test('day lengths across DST: 25 h on 2026-10-25, 23 h on 2027-03-28', () => {
  const hours = (a, b) => (kyivMidnight(b) - kyivMidnight(a)) / 3_600_000;
  assert.equal(hours('2026-10-25', '2026-10-26'), 25);
  assert.equal(hours('2027-03-28', '2027-03-29'), 23);
  assert.equal(hours('2026-10-17', '2026-10-18'), 24);
});

test('overview lists every group for the date', () => {
  const rows = overview(valid['current-one-day'], '2026-10-17');
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.at(-1), { group: '6.2', intervals: [] });
});

test('rejects unsupported data formats', () => {
  assert.throws(() => assertSupported({ ...valid['current-one-day'], schemaVersion: 2 }));
  assert.throws(() => assertSupported(null));
  assert.doesNotThrow(() => assertSupported(valid['current-one-day']));
});

test('formats times in Kyiv regardless of the machine time zone', () => {
  const i18n = createI18n('uk');
  assert.equal(i18n.time(at('2026-10-17T17:00:00Z')), '20:00');
  assert.equal(i18n.time(at('2026-12-17T17:00:00Z')), '19:00');
  assert.equal(i18n.endTime(at('2026-10-18T00:00:00+03:00'), '2026-10-17'), '24:00');
  assert.equal(i18n.endTime(at('2026-10-17T22:00:00+03:00'), '2026-10-17'), '22:00');
});

test('relative and elapsed durations', () => {
  const i18n = createI18n('uk');
  const now = at('2026-10-17T20:00:00+03:00');
  assert.equal(i18n.relative(now + 80 * 60_000, now), 'через 1 год 20 хв');
  assert.equal(i18n.relative(now + 5 * 60_000, now), 'через 5 хв');
  assert.equal(i18n.relative(now + 120 * 60_000, now), 'через 2 год');
  assert.equal(i18n.ago(now - 130 * 60_000, now), '2 год 10 хв тому');
  assert.equal(i18n.ago(now - 20_000, now), 'щойно');
});

test('every string used by the page exists', () => {
  const i18n = createI18n('uk');
  for (const key of [
    'title',
    'loading',
    'groupLegend',
    'statusOff',
    'statusOn',
    'statusUnknown',
    'statusUnknownHint',
    'today',
    'tomorrow',
    'noOutages',
    'notPublished',
    'allGroups',
    'groupColumn',
    'outagesColumn',
    'sourceUpdated',
    'lastChecked',
    'notAvailable',
    'errorTitle',
    'errorBody',
    'retry',
    'disclaimer',
    'officialSource',
    'rawData',
    'timezoneNote',
  ]) {
    assert.equal(typeof i18n.t(key), 'string', key);
  }
});

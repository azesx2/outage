// Turns the Today/Tomorrow API responses into a validated latest.json snapshot.

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ValidationError } from './errors.js';
import { addDays, kyivDate, kyivWallToEpoch, TIME_ZONE, toKyivIso } from './kyiv-time.js';
import { checkItem, parseScheduleHtml } from './parse.js';
import { ITEMS, KNOWN_GROUPS, SOURCE_URL } from './source.js';

/** Allowed clock difference between the source's "станом на" and our fetch time. */
const FUTURE_SKEW_MS = 10 * 60_000;

const schema = JSON.parse(readFileSync(new URL('../schema/latest.schema.json', import.meta.url)));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

/** Throws ValidationError unless `snapshot` satisfies schema/latest.schema.json. */
export function assertSchema(snapshot) {
  if (!validateSchema(snapshot)) {
    throw new ValidationError('schema-violation', ajv.errorsText(validateSchema.errors));
  }
}

function toDay(parsed, now) {
  const today = kyivDate(now);
  if (parsed.date < addDays(today, -1) || parsed.date > addDays(today, 1)) {
    throw new ValidationError(
      'date-out-of-range',
      `Schedule date ${parsed.date} is outside ${addDays(today, -1)}..${addDays(today, 1)} (Kyiv today ${today})`,
    );
  }
  const updatedAt = kyivWallToEpoch(parsed.updatedDate, parsed.updatedMinutes);
  if (updatedAt > now + FUTURE_SKEW_MS) {
    throw new ValidationError(
      'updated-at-in-future',
      `"Інформація станом на" ${toKyivIso(updatedAt)} is after fetch time ${toKyivIso(now)}`,
    );
  }
  const groups = {};
  for (const group of KNOWN_GROUPS) {
    groups[group] = parsed.groups[group].map(([startMin, endMin]) => {
      const start = kyivWallToEpoch(parsed.date, startMin);
      const end = kyivWallToEpoch(parsed.date, endMin);
      // Can only happen when a DST gap shift collapses an interval.
      if (start >= end) {
        throw new ValidationError(
          'empty-or-reversed-interval',
          `Group ${group}: interval collapses across DST change on ${parsed.date}`,
        );
      }
      return { start: toKyivIso(start), end: toKyivIso(end), status: 'off' };
    });
  }
  return { date: parsed.date, sourceUpdatedAt: toKyivIso(updatedAt), updatedAt, groups };
}

/**
 * Builds a snapshot from raw API responses.
 * @param {{today: unknown, tomorrow: unknown}} responses bodies of /api/menu_items/238 and /256
 * @param {number} now epoch ms of the fetch
 * @param {typeof ITEMS} items identities the responses must match (overridden after discovery)
 */
export function buildSnapshot(responses, now, items = ITEMS) {
  const days = [];
  for (const key of ['today', 'tomorrow']) {
    const parsed = parseScheduleHtml(checkItem(responses[key], items[key]));
    if (parsed) days.push(toDay(parsed, now));
  }

  if (days.length === 2 && days[0].date >= days[1].date) {
    const same =
      days[0].date === days[1].date &&
      JSON.stringify(days[0].groups) === JSON.stringify(days[1].groups);
    if (!same) {
      throw new ValidationError(
        'inconsistent-days',
        `Today item is for ${days[0].date} but Tomorrow item is for ${days[1].date}`,
      );
    }
    days.splice(1, 1);
  }

  const latest = days.reduce((max, d) => Math.max(max, d.updatedAt), -Infinity);
  const snapshot = {
    schemaVersion: 1,
    sourceUrl: SOURCE_URL,
    timezone: TIME_ZONE,
    fetchedAt: new Date(now).toISOString(),
    sourceUpdatedAt: days.length > 0 ? toKyivIso(latest) : null,
    groups: KNOWN_GROUPS,
    days: days.map(({ date, sourceUpdatedAt, groups }) => ({ date, sourceUpdatedAt, groups })),
  };
  assertSchema(snapshot);
  return snapshot;
}

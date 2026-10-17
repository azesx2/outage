// Parses one /api/menu_items/{id} response into a day schedule in Kyiv wall-clock minutes.
// Every line must match a known pattern; anything else fails (layout-change detection).

import { ValidationError } from './errors.js';
import { isValidDate } from './kyiv-time.js';
import { KNOWN_GROUPS, MAX_INTERVALS_PER_GROUP, SCHEDULE_MENU } from './source.js';

const TIME = String.raw`(\d{1,2}):(\d{2})`;
const RANGE = String.raw`з \d{1,2}:\d{2} до \d{1,2}:\d{2}`;
const PATTERNS = {
  title: /^Графік погодинних відключень на (\d{2})\.(\d{2})\.(\d{4})$/,
  updated: /^Інформація станом на (\d{2}):(\d{2}) (\d{2})\.(\d{2})\.(\d{4})$/,
  powerOn: /^Група (\d+\.\d+)\. Електроенергія є\.$/,
  powerOff: new RegExp(
    String.raw`^Група (\d+\.\d+)\. Електроенергії немає (${RANGE}(?:, ${RANGE})*)\.$`,
  ),
  range: new RegExp(String.raw`з ${TIME} до ${TIME}`, 'g'),
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Splits the source HTML into trimmed text lines (one per paragraph). */
export function htmlToLines(html) {
  return html
    .split(/<\/p>|<br\s*\/?>|\n/i)
    .map((chunk) =>
      chunk
        .replace(/<[^>]*>/g, '')
        .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
          if (e[0] === '#') {
            const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
            return String.fromCodePoint(code);
          }
          return ENTITIES[e.toLowerCase()] ?? m;
        })
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

/** Checks that the response is the expected schedule item and returns its HTML. */
export function checkItem(response, expected) {
  if (
    response === null ||
    typeof response !== 'object' ||
    typeof response.id !== 'number' ||
    typeof response.name !== 'string' ||
    typeof response.rawHtml !== 'string'
  ) {
    throw new ValidationError(
      'unexpected-response-shape',
      `Item ${expected.id}: expected an object with numeric id, string name and string rawHtml`,
    );
  }
  if (
    response.id !== expected.id ||
    response.name !== expected.name ||
    response.menu !== SCHEDULE_MENU
  ) {
    throw new ValidationError(
      'item-identity-mismatch',
      `Item ${expected.id}: expected "${expected.name}" in ${SCHEDULE_MENU}, got "${response.name}" in ${response.menu}`,
    );
  }
  return response.rawHtml;
}

function parseClock(hh, mm, line) {
  const h = Number(hh);
  const m = Number(mm);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) {
    throw new ValidationError('invalid-time', `Invalid time ${hh}:${mm} in "${line}"`);
  }
  if (m !== 0 && m !== 30) {
    throw new ValidationError(
      'off-grid-time',
      `Time ${hh}:${mm} is not on the 30-minute grid in "${line}"`,
    );
  }
  return h * 60 + m;
}

function parseRanges(text, group, line) {
  const intervals = [...text.matchAll(PATTERNS.range)].map((r) => {
    const start = parseClock(r[1], r[2], line);
    const end = parseClock(r[3], r[4], line);
    if (start >= end) {
      throw new ValidationError(
        'empty-or-reversed-interval',
        `Group ${group}: interval ${r[1]}:${r[2]}–${r[3]}:${r[4]} is empty or reversed`,
      );
    }
    return [start, end];
  });
  if (intervals.length > MAX_INTERVALS_PER_GROUP) {
    throw new ValidationError(
      'implausible-interval-count',
      `Group ${group}: ${intervals.length} intervals (max ${MAX_INTERVALS_PER_GROUP})`,
    );
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of intervals) {
    const last = merged.at(-1);
    if (last && iv[0] < last[1]) {
      throw new ValidationError(
        'overlapping-intervals',
        `Group ${group}: overlapping intervals in "${line}"`,
      );
    }
    if (last && iv[0] === last[1]) last[1] = iv[1];
    else merged.push(iv);
  }
  return merged;
}

/**
 * Parses schedule HTML. Returns null when nothing is published (empty rawHtml), otherwise
 * { date: 'YYYY-MM-DD', updatedDate, updatedMinutes, groups: { '1.1': [[startMin, endMin]] } }.
 */
export function parseScheduleHtml(html) {
  const lines = htmlToLines(html);
  if (lines.length === 0) return null;

  const [titleLine, updatedLine, ...groupLines] = lines;
  const title = PATTERNS.title.exec(titleLine ?? '');
  if (!title)
    throw new ValidationError('unknown-line', `Expected schedule title, got "${titleLine}"`);
  const updated = PATTERNS.updated.exec(updatedLine ?? '');
  if (!updated)
    throw new ValidationError(
      'unknown-line',
      `Expected "Інформація станом на", got "${updatedLine}"`,
    );

  const date = `${title[3]}-${title[2]}-${title[1]}`;
  const updatedDate = `${updated[5]}-${updated[4]}-${updated[3]}`;
  if (!isValidDate(date) || !isValidDate(updatedDate)) {
    throw new ValidationError('invalid-date', `Invalid date in "${titleLine}" / "${updatedLine}"`);
  }
  const updatedMinutes = Number(updated[1]) * 60 + Number(updated[2]);
  if (Number(updated[1]) > 23 || Number(updated[2]) > 59) {
    throw new ValidationError('invalid-time', `Invalid time in "${updatedLine}"`);
  }

  const groups = {};
  for (const line of groupLines) {
    const on = PATTERNS.powerOn.exec(line);
    const off = on ? null : PATTERNS.powerOff.exec(line);
    if (!on && !off) throw new ValidationError('unknown-line', `Unrecognised line "${line}"`);
    const group = (on ?? off)[1];
    if (!KNOWN_GROUPS.includes(group)) {
      throw new ValidationError(
        'unknown-group',
        `Group ${group} is not one of ${KNOWN_GROUPS.join(', ')}`,
      );
    }
    if (group in groups)
      throw new ValidationError('duplicate-group', `Group ${group} appears twice`);
    groups[group] = on ? [] : parseRanges(off[2], group, line);
  }

  const missing = KNOWN_GROUPS.filter((g) => !(g in groups));
  if (missing.length > 0) {
    throw new ValidationError('missing-groups', `Missing groups: ${missing.join(', ')}`, {
      missing,
    });
  }
  return { date, updatedDate, updatedMinutes, groups };
}

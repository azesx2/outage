// Europe/Kyiv wall-clock <-> instant conversion without external libraries.
// DST resolution follows Temporal's "compatible" mode: an ambiguous time (fall back)
// resolves to the earlier instant, a nonexistent time (spring forward) moves forward by the gap.

export const TIME_ZONE = 'Europe/Kyiv';

const MINUTE = 60_000;
const DAY = 86_400_000;

const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  timeZoneName: 'longOffset',
});
const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Kyiv UTC offset in minutes at the given instant (e.g. 180 for +03:00). */
export function offsetMinutesAt(epochMs) {
  const name = offsetFormat.formatToParts(epochMs).find((p) => p.type === 'timeZoneName').value;
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
  if (!m) throw new Error(`Unexpected offset format: ${name}`);
  return m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** Kyiv calendar date (YYYY-MM-DD) of an instant. */
export function kyivDate(epochMs) {
  return dateFormat.format(epochMs);
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Returns true when YYYY-MM-DD names a real calendar date. */
export function isValidDate(isoDate) {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === isoDate;
}

/**
 * Converts a Kyiv wall-clock time to an epoch instant.
 * `minutes` may be 0..1440; 1440 (24:00) is midnight of the following day.
 */
export function kyivWallToEpoch(isoDate, minutes) {
  const date = minutes === 1440 ? addDays(isoDate, 1) : isoDate;
  const wallAsUtc = Date.parse(`${date}T00:00:00Z`) + (minutes % 1440) * MINUTE;
  // Every offset in effect within a day either side covers any DST transition.
  const offsets = [
    ...new Set([offsetMinutesAt(wallAsUtc - DAY), offsetMinutesAt(wallAsUtc + DAY)]),
  ].sort((a, b) => b - a); // Larger offset means an earlier instant.
  for (const offset of offsets) {
    const candidate = wallAsUtc - offset * MINUTE;
    if (offsetMinutesAt(candidate) === offset) return candidate;
  }
  // Nonexistent wall time: interpret it with the offset in effect before the gap.
  return wallAsUtc - offsetMinutesAt(wallAsUtc - DAY) * MINUTE;
}

/** Formats an instant as Kyiv local ISO-8601 with explicit offset, e.g. 2026-10-17T20:00:00+03:00. */
export function toKyivIso(epochMs) {
  const offset = offsetMinutesAt(epochMs);
  const local = new Date(epochMs + offset * MINUTE).toISOString().slice(0, 19);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local}${sign}${hh}:${mm}`;
}

// Pure schedule logic for the page: no DOM access, so it is unit-tested under Node.

export const TIME_ZONE = 'Europe/Kyiv';
export const SUPPORTED_SCHEMA = 1;
/** Two missed 30-minute runs plus typical GitHub cron delay. */
export const STALE_AFTER_MS = 75 * 60_000;

const HOUR = 3_600_000;

const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  timeZoneName: 'longOffset',
});

/** Kyiv calendar date (YYYY-MM-DD) of an instant. */
export function kyivDate(ms) {
  return dateFormat.format(ms);
}

function offsetMs(ms) {
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(
    offsetFormat.formatToParts(ms).find((p) => p.type === 'timeZoneName').value,
  );
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000 : 0;
}

/** Instant of Kyiv midnight starting `date`. Kyiv DST changes at 03:00/04:00, never at midnight. */
export function kyivMidnight(date) {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  return utcMidnight - offsetMs(utcMidnight - 2 * HOUR);
}

/**
 * Instant of a Kyiv wall-clock time (minutes since midnight) on `date`. Used to place hour labels;
 * exact on normal days and within the DST hour on the two transition days.
 */
export function kyivWallInstant(date, minutes) {
  const guess = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  return guess - offsetMs(guess - offsetMs(guess));
}

export function nextDate(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 24 * HOUR).toISOString().slice(0, 10);
}

/** Throws unless the payload looks like a schema-1 snapshot this page understands. */
export function assertSupported(data) {
  if (
    !data ||
    data.schemaVersion !== SUPPORTED_SCHEMA ||
    !Array.isArray(data.groups) ||
    !Array.isArray(data.days) ||
    !Number.isFinite(Date.parse(data.fetchedAt))
  ) {
    throw new Error(`Unsupported data format (schemaVersion ${data?.schemaVersion})`);
  }
}

/** Merged [start, end] outage spans for a group across all published days. */
function outageSpans(data, group) {
  const spans = data.days
    .flatMap((d) => d.groups[group] ?? [])
    .map((iv) => [Date.parse(iv.start), Date.parse(iv.end)])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

/** Published coverage as [start, end] instants, assuming days are consecutive and ascending. */
function coverage(data) {
  if (data.days.length === 0) return null;
  return [kyivMidnight(data.days[0].date), kyivMidnight(nextDate(data.days.at(-1).date))];
}

function dayView(data, group, date) {
  const day = data.days.find((d) => d.date === date);
  if (!day) return { date, published: false, intervals: [] };
  return {
    date,
    published: true,
    sourceUpdatedAt: Date.parse(day.sourceUpdatedAt),
    intervals: (day.groups[group] ?? []).map((iv) => ({
      start: Date.parse(iv.start),
      end: Date.parse(iv.end),
    })),
  };
}

/**
 * Everything the page shows for one group at one moment.
 * status: 'off' | 'on' | 'unknown' (no published data covers `now`).
 * next: { type: 'on'|'off', at, known } — `known` is false when the change lies at the end of
 *   published data (e.g. outage runs until 24:00 and tomorrow is not published).
 *   { type: 'none', until } when no further outage is scheduled within published data.
 */
export function computeView(data, group, now) {
  const fetchedAt = Date.parse(data.fetchedAt);
  const today = kyivDate(now);
  const range = coverage(data);
  const covered = range !== null && now >= range[0] && now < range[1];
  const spans = outageSpans(data, group);

  let status = 'unknown';
  let next = null;
  if (covered) {
    const current = spans.find(([s, e]) => s <= now && now < e);
    if (current) {
      status = 'off';
      next = { type: 'on', at: current[1], known: current[1] < range[1] };
    } else {
      status = 'on';
      const upcoming = spans.find(([s]) => s > now);
      next = upcoming
        ? { type: 'off', at: upcoming[0], known: true }
        : { type: 'none', until: range[1] };
    }
  }

  return {
    group,
    now,
    status,
    next,
    stale: now - fetchedAt > STALE_AFTER_MS,
    fetchedAt,
    sourceUpdatedAt: data.sourceUpdatedAt ? Date.parse(data.sourceUpdatedAt) : null,
    today: dayView(data, group, today),
    tomorrow: dayView(data, group, nextDate(today)),
  };
}

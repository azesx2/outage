// Retrieves the schedule items from the official API with timeouts and limited retries.

import { ValidationError } from './errors.js';
import { ITEMS, itemUrl, SCHEDULE_MENU, SCHEDULE_MENU_URL } from './source.js';

const TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [3_000, 10_000];
const MAX_BYTES = 8 * 1024 * 1024; // The fallback menu is ~3.2 MB; items are ~3 KB.

const userAgent = () =>
  `loe-outage-schedule/0.1 (+https://github.com/${process.env.GITHUB_REPOSITORY ?? 'unknown'})`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isRetryable = (status) => status === 429 || status >= 500;

/**
 * GETs JSON with a per-attempt timeout; retries network errors, 429 and 5xx only.
 * With `allowNotFound`, a 404 returns null instead of failing.
 */
export async function fetchJson(
  url,
  { fetchImpl = fetch, delays = RETRY_DELAYS_MS, allowNotFound = false } = {},
) {
  let lastError;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { Accept: 'application/ld+json', 'User-Agent': userAgent() },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastError = `${err.name}: ${err.message}`;
      continue;
    }
    if (res.status === 404 && allowNotFound) return null;
    if (!res.ok) {
      lastError = `HTTP ${res.status} ${res.statusText}`;
      if (isRetryable(res.status)) continue;
      break;
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) {
      throw new ValidationError(
        'unexpected-response-shape',
        `${url} returned ${text.length} bytes`,
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ValidationError(
        'unexpected-response-shape',
        `${url} did not return JSON (starts with ${JSON.stringify(text.slice(0, 80))})`,
      );
    }
  }
  throw new ValidationError('fetch-failed', `GET ${url} failed: ${lastError}`);
}

/**
 * Finds the Today/Tomorrow items by name in the schedule menu. Used only when the fixed item IDs
 * no longer point at them. The menu is CDN-cached for up to two hours, so it is not the default.
 */
export async function discoverItems(options) {
  const body = await fetchJson(SCHEDULE_MENU_URL, options);
  const menu = (Array.isArray(body) ? body : body?.['hydra:member'])?.find?.(
    (m) => `/api/menus/${m.id}` === SCHEDULE_MENU,
  );
  const responses = {};
  const items = {};
  for (const [key, { name }] of Object.entries(ITEMS)) {
    const found = menu?.menuItems?.find?.((i) => i.name === name);
    if (!found) {
      throw new ValidationError(
        'item-identity-mismatch',
        `"${name}" not found in ${SCHEDULE_MENU_URL}; the source structure has changed`,
      );
    }
    responses[key] = { ...found, menu: found.menu ?? SCHEDULE_MENU };
    items[key] = { id: found.id, name };
  }
  return { responses, items };
}

/**
 * Fetches the Today and Tomorrow items. Returns the raw responses plus the item identities
 * they must match, and a warning when the fallback discovery was used.
 */
export async function fetchSchedule(options) {
  const responses = {};
  for (const [key, { id }] of Object.entries(ITEMS)) {
    responses[key] = await fetchJson(itemUrl(id), options);
  }
  const moved = Object.entries(ITEMS).filter(
    ([key, { id, name }]) => responses[key]?.id !== id || responses[key]?.name !== name,
  );
  if (moved.length === 0) return { responses, items: ITEMS, warning: null };

  const discovered = await discoverItems(options);
  const ids = Object.entries(discovered.items).map(([k, v]) => `${k}=${v.id}`);
  return {
    ...discovered,
    warning: `Fixed item IDs no longer match (${moved.map(([k]) => k).join(', ')}); used menu discovery (${ids.join(', ')}). Update ITEMS in src/source.js.`,
  };
}

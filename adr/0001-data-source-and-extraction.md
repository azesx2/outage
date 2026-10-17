# ADR 0001 — Data source and extraction strategy

- Status: accepted and implemented (Stage 5)
- Date: 2026-10-17

## Context

We need to publish hourly-outage schedules from the official Львівобленерго page
<https://poweron.loe.lviv.ua/> as a static JSON file plus a static page. The pipeline
must never publish incorrect data, and stale data is preferable to wrong data.

## Findings

### The source is a React SPA backed by a public JSON API

`https://poweron.loe.lviv.ua/` returns an empty `<div id="root">` shell. The bundle
(`/static/js/main.*.js`) calls two API Platform (Hydra/JSON-LD) backends using plain,
unauthenticated GET requests:

| Purpose                                  | Endpoint                                                                    | Size                                   | Caching                                       |
| ---------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| Schedule menu (Today, Tomorrow, Archive) | `https://api.loe.lviv.ua/api/menus?page=1&type=photo-grafic`                | ~3.2 MB (includes 734 archive entries) | Cloudflare, `max-age=3600, s-maxage=7200`     |
| One schedule item                        | `https://api.loe.lviv.ua/api/menu_items/{id}`                               | ~3 KB                                  | `no-cache, private` (served by origin, fresh) |
| Last sync time                           | `https://power-api.loe.lviv.ua/api/options?option_key=successful_last_synk` | <1 KB                                  | —                                             |

Inside the `photo-grafic` menu (id 9): item **238 "Today"**, item **256 "Tomorrow"**,
item **241 "Arhiv"**. Each schedule item has:

- `rawHtml` / `rawMobileHtml`: identical text schedules;
- `imageUrl`: a PNG rendering of the same data (checked visually against the text for 17.10.2026; they match).

Example `rawHtml` (live, 17.10.2026):

```html
<div>
  <p><b>Графік погодинних відключень на 17.10.2026</b></p>
  <p><b>Інформація станом на 18:56 17.10.2026</b></p>
  <p>Група 1.1. Електроенергії немає з 20:00 до 22:00.</p>
  ...
  <p>Група 6.2. Електроенергія є.</p>
</div>
```

When no schedule is published (for example, "Tomorrow" before the evening publication),
`rawHtml` is an empty string.

### The text format has been stable across 526 archived publications

I analysed every archived item that has `rawHtml` (30.10.2025 to 17.10.2026, 94 distinct
dates). Only these line shapes occur:

- `Графік погодинних відключень на DD.MM.YYYY`
- `Інформація станом на HH:MM DD.MM.YYYY`
- `Група G.G. Електроенергії немає з HH:MM до HH:MM[, з HH:MM до HH:MM]{0..4}.`
- `Група G.G. Електроенергія є.`

Other observations:

- Always exactly 12 groups, `1.1`–`6.2`, in that order. (The site's separate `power-group`
  menu lists only 6 groups and is outdated, so it must **not** be used to validate groups.)
- Times are always on a 30-minute grid. End times include `24:00`.
- No interval crosses midnight inside one publication. Overnight outages appear as
  `… до 24:00` on day D plus `з 00:00 …` on day D+1.
- There were no overlapping intervals and 5 touching ones (end == next start), which should be merged.
- About 19% of publications are for the next day (the schedule date is after the "станом на" date).
- **There is one real malformed publication** (item 540, 30.10.2025): every group shows
  `з 00:00 до 00:00`. This proves the source can publish garbage, and we will turn it into a rejection fixture.
- The archive has no publication for a DST transition date, so DST handling has to be covered by synthetic fixtures. The next transition is **2026-10-25**, eight days from now.

### Search for a fully structured schedule API (none found)

I checked whether any endpoint returns the group schedule as structured intervals rather than text:

- **Hydra entrypoints** (`/api/index.jsonld`) list every resource on both backends.
  - `api.loe.lviv.ua` serves CMS content: menus, menu items, pages, news, forms, options.
  - `power-api.loe.lviv.ua` exposes `blog_gpvs`, `city_gpvs`, `street_gpvs` and `blog_podiis`. All four are empty (`totalItems: 0`).
  - `pw_accident_planeds` is structured, but it lists address-level planned maintenance work, not hourly group schedules. So do `pw_accidents` and the xlsx files under `pw_accident_planed_history_media`.
  - `pw_accounts` maps an address to its group number (`chergGpv`). It doesn't return the schedule.
  - The API documentation pages (`/api`, `/api_documentation`) redirect to a login page.
- **Web search**: I found no public or documented API and no open-data feed for Львівобленерго schedules.
- **Community projects**: `adroush/loe_outages` and `fastiuk/loe-energy-monitor` (both MIT) and `Tusko/tuya-smart-plug-notification` all read `menus?type=photo-grafic` and parse `rawHtml`. `Baskerville42/outage-data-ua` aggregates other regions (Kyiv, Dnipro, Odesa) and has no Lviv data.

Conclusion: the `rawHtml` field of the `photo-grafic` menu items is the most structured source available. All known consumers use it.

### Robots and usage restrictions

- `robots.txt`: `User-agent: * / Disallow:` (everything allowed).
- I found no terms of use for the API. The page carries ads and analytics, which we won't load.
- Load is 2 requests of ~3 KB every 30 minutes (Today and Tomorrow items), identified by a
  `User-Agent` naming this project. That is far below what one visitor's browser makes when it opens the site.
  (Conditional requests with ETags were considered and skipped: at 3 KB they would save almost nothing.)

### Existing project: aliend/loe-poweroff

- Active (commits on 2026-10-17), 16 stars.
- **It has no LICENSE**, so by default all rights are reserved. **We will not copy or adapt its code.** Ideas only.
- Approach: headless Chrome (Puppeteer) renders the SPA, then Cheerio reads
  `.power-off__text p`, which is the same text the API returns directly. That means a full browser plus about 30 apt packages per run for data you can get with one `fetch`.
- It runs on GitHub Actions every 30 minutes and commits data to the repo. This is useful evidence that the source **is reachable from GitHub-hosted runners** (no Cloudflare challenge).
- Reliability gaps compared with our requirements: limited plausibility validation, cron at `*/30` (the congested minute 0), no concurrency guard, unpinned actions, `contents: write` for the whole job.

## Decision

1. **Extraction method: structured JSON (tier 1), with text parsing of an embedded HTML field.**
   - Fetch `menu_items/238` and `menu_items/256` with Node's built-in `fetch`, a timeout, and limited retries.
   - Verify the identity of each item (`name` is `Today` or `Tomorrow`, `menu` is `/api/menus/9`). If the IDs ever change, fall back once to the menu endpoint to find the items by name. If that also fails, stop with a clear error.
   - Parse `rawHtml` with a small built-in HTML-to-text step (the markup is only `<div>`, `<p>` and `<b>`, so no parser dependency) and strict, anchored regular expressions. Any line that matches no known pattern fails the run (layout-change detection). It is never silently skipped.
   - The schedule date always comes from the text (`на DD.MM.YYYY`), **never** from the item name. "Today" may still hold yesterday's schedule shortly after midnight.
2. **No browser, no OCR, no LLM.** The PNG is a rendering of the same data and is not used. It may be linked as the official visual reference. We don't need Puppeteer or Playwright at all.
3. **Validation (any failure means the previous `latest.json` is kept and the run fails):**
   - the group set equals exactly `1.1…6.2`, each group appears once;
   - times are `HH:MM` on a 30-minute grid, `00:00 ≤ start < end ≤ 24:00`, no overlaps (touching intervals are merged);
   - the schedule date is within [Kyiv today − 1, Kyiv today + 1], and "станом на" is not more than 10 minutes in the future;
   - reject degenerate publications such as the all-`00:00–00:00` one;
   - empty Today means "unavailable", never "no outages". Only an explicit `Електроенергія є` means no outages.
4. **Time handling:** source times are Europe/Kyiv wall-clock times. We convert to ISO-8601 with the correct offset for each instant (`+03:00` in summer, `+02:00` in winter), and `24:00` becomes `00:00` of the next day. DST rules follow the `compatible` disambiguation used by `Temporal`. On the fall-back day (2026-10-25, 03:00–04:00 occurs twice), an ambiguous wall-clock time resolves to the **earlier** instant. On the spring-forward day (2027-03-28, 03:00–04:00 does not exist), a nonexistent time moves **forward** by the gap, so 03:00 becomes 04:00+03:00. If that makes an interval empty or reversed, the interval is rejected. Both days are covered by synthetic fixtures.
5. **Runtime:** Node.js 24 LTS. The only runtime dependency is Ajv (schema validation). Tests use the built-in `node:test`.
6. **Last-known-good protection:** a valid snapshot still does not replace the published one when the source turns empty while published data covers today, or when a date's "станом на" goes backwards.
7. **Data persistence (Stage 5):** every successful run deploys `docs/` to GitHub Pages, so `fetchedAt` stays fresh. `docs/data/latest.json` is committed only when the schedule content changes. That gives a small history, counts as repository activity, and gives the next run its last-known-good baseline. On failure nothing is deployed, so the page shows the stale warning.

## Schema (`docs/data/latest.json`, version 1)

I changed the suggested schema in one way: data is grouped **by day**. The source publishes each day separately, each with its own "станом на" time, and Tomorrow may be absent while Today is present. A single flat `groups` map couldn't tell "tomorrow not published yet" apart from "no outages tomorrow".

```json
{
  "schemaVersion": 1,
  "sourceUrl": "https://poweron.loe.lviv.ua/",
  "timezone": "Europe/Kyiv",
  "fetchedAt": "2026-10-17T19:47:12.345Z",
  "sourceUpdatedAt": "2026-10-17T18:56:00+03:00",
  "groups": ["1.1", "1.2", "2.1", "2.2", "3.1", "3.2", "4.1", "4.2", "5.1", "5.2", "6.1", "6.2"],
  "days": [
    {
      "date": "2026-10-17",
      "sourceUpdatedAt": "2026-10-17T18:56:00+03:00",
      "groups": {
        "1.1": [
          {
            "start": "2026-10-17T20:00:00+03:00",
            "end": "2026-10-17T22:00:00+03:00",
            "status": "off"
          }
        ],
        "6.2": []
      }
    }
  ]
}
```

Semantics:

- `fetchedAt` (UTC): the last time our pipeline successfully fetched **and validated** the source. If a run fails, the file is not touched, so `fetchedAt` ages. That is how the frontend detects stale data (warning after about 75 minutes, which covers two missed runs plus cron delay).
- `sourceUpdatedAt` (top level) is the latest of the per-day "станом на" times.
- `days` holds 0–2 entries, sorted by date. If a date is **missing** from `days`, its data is **unavailable**. If a group in a present day has `[]`, it has **no outage scheduled**.
- `status` is always `"off"` in v1. It exists so a future "possible outage" state doesn't need a schema bump.
- `days` with 0 entries is valid only when both items are empty. The frontend then shows "немає даних" (no data), not "світло є" (power is on).
- The schema will be written as JSON Schema and enforced by the pipeline and the tests.

## Risks

| Risk                                                                                               | Mitigation                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wording or markup change on the source                                                             | Strict line grammar: unknown lines fail the run, last-known-good is kept, diagnostics (raw JSON) are uploaded as an Actions artifact                                              |
| Item IDs 238/256 change                                                                            | Identity check plus fallback discovery via the menu endpoint                                                                                                                      |
| Malformed publications (seen in the wild)                                                          | Plausibility validation and a fixture from item 540                                                                                                                               |
| Cloudflare starts challenging runners                                                              | Currently reachable (evidence from aliend). On failure, keep stale data and show a clear warning. Do not add workarounds                                                          |
| GitHub cron delays and skipped runs (often 5–20 minutes, sometimes more)                           | Minutes 17/47, stale threshold accounts for delays, manual `workflow_dispatch`                                                                                                    |
| **Scheduled workflows are auto-disabled after 60 days without repository activity** (public repos) | Commit `latest.json` whenever the schedule changes. If an outage-free period lasts over 60 days, GitHub emails a warning and the workflow must be re-enabled (see README runbook) |
| DST transitions (next one: 2026-10-25)                                                             | Offsets computed per instant, synthetic DST fixtures                                                                                                                              |
| "Today" lags after midnight                                                                        | Date taken from the text, and the frontend shows "no data for today" rather than yesterday's schedule                                                                             |

## Out of scope

iCalendar export, history pages, notifications, and English UI (strings are structured for it, but no translation yet).

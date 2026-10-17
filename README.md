# Графік відключень Львівобленерго (неофіційний)

An unofficial static page that shows the current hourly electricity-outage schedule (графік
погодинних відключень) published by Львівобленерго at <https://poweron.loe.lviv.ua/>.

> The official source is always authoritative. This project only repackages what the source
> publishes. If anything looks wrong, it keeps the last good data and shows a stale-data warning
> rather than guessing.

## Architecture

```
GitHub Actions (cron :17 and :47, manual run, push to main)
  │  GET <pages-site>/data/latest.json          (published snapshot = last-known-good baseline)
  │  GET api.loe.lviv.ua/api/menu_items/238     (Today)
  │  GET api.loe.lviv.ua/api/menu_items/256     (Tomorrow)
  ▼
parse rawHtml text → validate (schema + plausibility + last-known-good) → docs/data/latest.json
  │                                    │
  │                                    └─ any failure: run fails, nothing is deployed,
  │                                       diagnostics uploaded as an artifact
  ▼
deploy docs/ to GitHub Pages (data is never committed)
```

Visitors only download static files from GitHub Pages. They never contact the source.

- **Source:** the official site is a React app backed by a public JSON API. Each schedule item has
  a `rawHtml` field with one line per group, for example
  `Група 1.1. Електроенергії немає з 20:00 до 22:00.` The PNG on the site is drawn from the same
  data, so there is no browser, no OCR and no LLM. See
  [ADR 0001](adr/0001-data-source-and-extraction.md) for the investigation and alternatives.
- **Extraction** ([src/parse.js](src/parse.js)): strict line patterns. Any unrecognised line fails
  the run, which is how layout changes are detected.
- **Validation** ([src/snapshot.js](src/snapshot.js)):
  - exactly the 12 known groups (1.1–6.2), each once;
  - times on a 30-minute grid, `start < end`, no overlaps, at most 8 intervals per group;
  - schedule date within ±1 day of Kyiv today;
  - "станом на" not in the future;
  - the result must match [schema/latest.schema.json](schema/latest.schema.json).
- **Last-known-good** ([src/last-known-good.js](src/last-known-good.js)): the baseline is the
  snapshot currently live on GitHub Pages, downloaded at the start of each run.
  - an empty source never replaces data that still covers today;
  - an older publication never replaces a newer one;
  - a 404 means nothing is published yet; any other download failure stops the run, so protection
    is never skipped silently.
- **No data commits:** `docs/data/` is ignored by git. The repository history only contains code.
- **Time** ([src/kyiv-time.js](src/kyiv-time.js)):
  - source times are Europe/Kyiv wall-clock times;
  - output intervals carry explicit offsets (`+02:00` or `+03:00`);
  - `24:00` becomes `00:00` of the next day;
  - DST edge cases follow the rules in the ADR.
- **Frontend** ([docs/](docs/)): plain HTML, CSS and ES modules with no framework and no build step.
  [docs/schedule.js](docs/schedule.js) holds the pure status and next-event logic, which is
  unit-tested. [docs/i18n.js](docs/i18n.js) holds the Ukrainian strings; add a dictionary to support
  another language. The page shows only the groups in `DISPLAY_GROUPS` in [docs/app.js](docs/app.js)
  (2.1 as «Квартира» on the left, 3.2 as «Будинок» on the right); `latest.json` still contains every
  group. Each group gets a status card and a vertical 48-hour bar (today and tomorrow) around a
  shared hour axis: green means power, graphite means an outage, amber marks the current time, and
  stripes mark a day whose schedule is not published yet.

## Data format

`docs/data/latest.json` follows [schema/latest.schema.json](schema/latest.schema.json)
(`schemaVersion: 1`):

```json
{
  "schemaVersion": 1,
  "sourceUrl": "https://poweron.loe.lviv.ua/",
  "timezone": "Europe/Kyiv",
  "fetchedAt": "2026-10-17T19:47:12.345Z",
  "sourceUpdatedAt": "2026-10-17T18:56:00+03:00",
  "groups": ["1.1", "1.2", "…", "6.2"],
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

| Field                   | Meaning                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `fetchedAt`             | When our pipeline last fetched **and validated** the source (UTC). Old value means stale data. |
| `sourceUpdatedAt`       | The source's own "Інформація станом на" time (latest across days).                             |
| `days[]`                | 0–2 published days. **A missing date means data is unavailable.**                              |
| `days[].groups[g] = []` | **No outage scheduled** for group `g` that day.                                                |

## Repository layout

| Path                 | Contents                                                               |
| -------------------- | ---------------------------------------------------------------------- |
| `src/`               | Pipeline: fetch, parse, validate, time conversion, last-known-good     |
| `scripts/update.js`  | Pipeline entry point used by the workflow                              |
| `scripts/serve.js`   | Local static server for previewing `docs/`                             |
| `docs/`              | The published site; `docs/data/` is generated and not committed        |
| `schema/`            | JSON Schema for the published data                                     |
| `test/`              | Deterministic tests with committed [fixtures](test/fixtures/README.md) |
| `live/`              | Live-source check (network), run separately                            |
| `adr/`               | Architecture decision records                                          |
| `.github/workflows/` | Scheduled update and Pages deployment                                  |

## Local development

Requires Node.js 24 or newer (`.nvmrc`).

```sh
npm ci
npm run check        # lint + format check + deterministic tests
npm run test:live    # contacts the official API once and validates the live data
npm run update       # fetch the live source into docs/data/latest.json
npm run serve        # preview docs/ at http://localhost:8080/
```

Test the pipeline against a fixture without the network:

```sh
node scripts/update.js --fixture test/fixtures/source/cross-midnight-two-days.json --out /tmp/latest.json
```

`npm test` never contacts the source. `npm run test:live` is the only test that does. On failure it
saves the raw responses to `diagnostics/live-responses.json` and reports the validation reason.

## GitHub setup

1. **Make the repository public.** Free GitHub Pages requires it, unless you are on a paid plan.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.** Do this before the first
   push: each run looks up the site URL to download the published baseline and fails without it.
3. **Settings → Actions → General:**
   - "Allow all actions" or allow `actions/*`.
   - The workflow token's default permission can stay "Read repository contents". The workflow
     grants itself only what it needs per job:
     - `update` job: `contents: read` and `pages: read` (to find the site URL);
     - `deploy` job: `pages: write` and `id-token: write`;
     - `keepalive` job: `actions: write` (see below).
4. Push to `main`. The workflow runs on the push, then at minutes 17 and 47 of every hour.
   Scheduled runs only happen on the default branch.
5. The site is published at `https://<user>.github.io/<repo>/`.

The workflow is [.github/workflows/update.yml](.github/workflows/update.yml):

- actions are pinned to commit SHAs;
- top-level permissions are empty;
- concurrency allows one run at a time;
- the job has a 10-minute timeout and the fetch step 3 minutes;
- HTTP requests retry twice on network errors, 429 and 5xx;
- npm downloads are cached;
- the `keepalive` job re-enables the workflow through the API on scheduled runs. GitHub disables
  scheduled workflows after 60 days without repository activity, and this project makes no data
  commits.

## Operations runbook

| Symptom                                              | What to do                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page shows the stale-data warning                    | Open **Actions → Update schedule**, read the failed run's error line and hint, and download the `diagnostics-*` artifact.                                                                                                                                   |
| `[fetch-failed]`                                     | Usually temporary. If it persists for hours, check whether `api.loe.lviv.ua` blocks GitHub runners (HTTP 403, or an HTML challenge page shows up as `unexpected-response-shape`).                                                                           |
| `[unknown-line]`, `[missing-groups]`, …              | The source changed. Compare `response-today.json` in the artifact with [the live fixture](test/fixtures/source/normal-live-2026-10-17.json). Add a fixture for the new format, update `src/parse.js` or `src/source.js`, then run `npm run check` and push. |
| `[item-identity-mismatch]` or warning "Update ITEMS" | The Today/Tomorrow item IDs moved. Find the new IDs in the warning and update `ITEMS` in `src/source.js`.                                                                                                                                                   |
| `[empty-would-overwrite]`                            | The source is temporarily empty. Published data is kept and this clears once the source republishes or the day passes.                                                                                                                                      |
| `[source-regressed]`                                 | The source served an older publication. Published data is kept and this usually clears on the next run.                                                                                                                                                     |
| `[previous-unavailable]`                             | The published `latest.json` could not be downloaded. Check that GitHub Pages is enabled and the site loads. The run stops rather than publishing without protection.                                                                                        |
| Workflow stopped running on schedule                 | The `keepalive` job should prevent this. If GitHub still disabled it, re-enable it under **Actions → Update schedule → Enable workflow** and check the `keepalive` job's log.                                                                               |
| Need fresh data now                                  | **Actions → Update schedule → Run workflow.**                                                                                                                                                                                                               |

Reason codes are listed in [src/errors.js](src/errors.js).

## Data limitations

- This page is informational. Львівобленерго can change schedules at any time, and emergency
  outages (аварійні відключення) are not part of the hourly schedule.
- Freshness depends on GitHub Actions, whose scheduled runs can start 5–20 minutes late or
  occasionally be skipped. The page warns once the last successful check is more than 75 minutes
  old.
- Only the published Today and Tomorrow schedules are available. After midnight the page shows
  "no data" until the source publishes the new day.
- Groups are validated against the 12 groups the source has always used (1.1–6.2). A new group
  stops updates until `KNOWN_GROUPS` is reviewed. This is deliberate.

## License and attribution

Code is released under the [MIT License](LICENSE). The license covers this project's code only,
not the source's schedule data.

Schedule data © ПрАТ «Львівобленерго», <https://poweron.loe.lviv.ua/>. This project is not
affiliated with or endorsed by Львівобленерго.

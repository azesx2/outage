# Графік відключень Львівобленерго (неофіційний)

## Image fallback and comparison

Each update also downloads the `imageUrl` from each official Today/Tomorrow API item.
The image reader uses Pillow and Ukrainian Tesseract OCR to read the current twelve-card
visualization. It reads group labels, explicit time ranges,
the schedule date and publication timestamp independently of `rawHtml`. The old
colored hourly-grid format is not supported.

Valid text remains primary. When text parsing fails, a complete, independently validated
image schedule is used for that publication. Both paths retain the existing group, time,
date, schema and last-known-good checks. If neither succeeds, no replacement is published.
An empty image/card is never treated as an all-clear; that requires an explicit status.

The page always shows the source used and whether the representations agree. Agreement
requires all twelve groups, schedule date and publication timestamp to match. A mismatch
keeps valid text and displays a warning; unavailable OCR is labeled unverified. The optional
`verification` array in schema version 1 records these outcomes and parser errors; older
snapshots display an unavailable-comparison message until the next update. Agreement checks
published representations, not actual electricity availability.

The existing Actions workflow installs Tesseract and Pillow and runs both parsers in the
same update. For local updates, install `tesseract` with Ukrainian language data and run:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-image.txt
PYTHON=.venv/bin/python npm run update
.venv/bin/python -m unittest discover -s test -p '*_test.py'
```

Without image dependencies, valid text still publishes with an unverified-image status.
Fixture runs do not access the network; optional `imageResponses` provide OCR results for
fallback integration tests. The checked-in PNG is an official source capture for OCR regression.

An unofficial static page that shows the current hourly electricity-outage schedule (графік
погодинних відключень) published by Львівобленерго at <https://poweron.loe.lviv.ua/>.

> The official source is always authoritative. This project only repackages what the source
> publishes. If anything looks wrong, it keeps the last good data and shows a stale-data warning
> rather than guessing.

## Architecture

```
GitHub Actions (dispatched by cron-job.org at :17 and :47, manual run, push to main)
  │  GET <pages-site>/data/latest.json          (published snapshot = last-known-good baseline)
  │  GET api.loe.lviv.ua/api/menu_items/238     (Today)
  │  GET api.loe.lviv.ua/api/menu_items/256     (Tomorrow)
  ▼
parse text + image → compare, select text or image fallback → validate → docs/data/latest.json
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
  data. The primary parser reads text; the secondary parser independently OCRs that PNG. See
  [ADR 0001](adr/0001-data-source-and-extraction.md) for the investigation and alternatives.
- **Extraction** ([src/parse.js](src/parse.js)): strict line patterns. An unrecognised line fails
  text parsing and triggers the validated image fallback. A run fails if neither parser succeeds.
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
  stripes mark a day whose schedule is not published yet. A button at the top switches to a horizontal
  layout (one strip per day, Квартира above the hours and Будинок below); the choice is remembered in
  the browser.

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
npm run stub         # generate offline preview data for Kyiv today and tomorrow
npm run serve        # preview docs/ at http://localhost:8080/
```

`npm run stub` writes synthetic data to `docs/data/latest.json`, replacing any local live
snapshot. It needs no network, Python, Tesseract or credentials. The output is ignored by git;
do not publish it as a real schedule. Run `npm run update` to restore live data.

The default scenario simulates text/image agreement. Preview other states with:

```sh
npm run stub -- --scenario fallback
npm run stub -- --scenario disagree
npm run stub -- --scenario unverified
npm run stub -- --scenario unpublished
```

Optional `--now 2026-10-18T12:00:00+03:00` fixes the preview clock used to generate dates and
timestamps (the page still uses your actual clock). `--out /tmp/latest.json` writes elsewhere.
Agreement statuses in stub data are simulated using the real comparison pipeline, without OCR.

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
     - `cron` job: `contents: read`.
4. **Trigger.** The workflow has no GitHub schedule, because GitHub often delays or skips
   scheduled runs. cron-job.org dispatches it at minutes 17 and 47 of every hour instead. Add two
   repository secrets (Settings → Secrets and variables → Actions):
   - `CRONJOB_API_KEY`: cron-job.org Console → Settings → API keys;
   - `DISPATCH_TOKEN`: a fine-grained GitHub token for this repository only, with
     **Actions: Read and write**.

   The `cron` job ([scripts/sync-cron.js](scripts/sync-cron.js)) then creates or updates the job
   on every push to `main`, or on **Run workflow** with "sync cron-job.org" ticked. The token is
   stored in the cron-job.org job's request headers. To rotate it, update the secret and push or
   run the workflow with that option. Without the secrets, the job is skipped with a warning
   and the site only updates on push or manual runs.

5. Push to `main`. The workflow runs on the push and creates the cron-job.org job.
6. The site is published at `https://<user>.github.io/<repo>/`.

The workflow is [.github/workflows/update.yml](.github/workflows/update.yml):

- actions are pinned to commit SHAs;
- top-level permissions are empty;
- concurrency allows one run at a time;
- the job has a 10-minute timeout and the fetch step 3 minutes;
- HTTP requests retry twice on network errors, 429 and 5xx;
- npm downloads are cached.

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
| No runs every 30 minutes                             | Check the job's history on cron-job.org. A 401 or 403 means `DISPATCH_TOKEN` expired or lacks Actions write: replace the secret, then **Run workflow** with the cron-job.org option. If the job is missing or disabled, do the same.                        |
| Need fresh data now                                  | **Actions → Update schedule → Run workflow.**                                                                                                                                                                                                               |

Reason codes are listed in [src/errors.js](src/errors.js).

## Data limitations

- This page is informational. Львівобленерго can change schedules at any time, and emergency
  outages (аварійні відключення) are not part of the hourly schedule.
- Freshness depends on cron-job.org dispatching the workflow and on GitHub Actions starting it,
  usually within a minute or two. The page warns once the last successful check is more than 75
  minutes old.
- Only the published Today and Tomorrow schedules are available. After midnight the page shows
  "no data" until the source publishes the new day.
- Groups are validated against the 12 groups the source has always used (1.1–6.2). A new group
  stops updates until `KNOWN_GROUPS` is reviewed. This is deliberate.

## License and attribution

Code is released under the [MIT License](LICENSE). The license covers this project's code only,
not the source's schedule data.

Schedule data © ПрАТ «Львівобленерго», <https://poweron.loe.lviv.ua/>. This project is not
affiliated with or endorsed by Львівобленерго.

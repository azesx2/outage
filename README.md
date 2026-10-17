# Графік відключень Львівобленерго (неофіційний)

An unofficial static page that shows the current hourly electricity-outage schedule (графік
погодинних відключень) published by Львівобленерго at <https://poweron.loe.lviv.ua/>.

> The official source is always authoritative. This project only repackages what the source
> publishes. If anything looks wrong, it keeps the last good data and shows a stale-data warning
> rather than guessing.

**Status:** under construction. Done so far: source investigation and project foundation (schema,
fixtures, tooling). Parser, live fetch, frontend and deployment come next.

## Architecture

```
GitHub Actions (cron :17 and :47, plus manual run)
  │  GET api.loe.lviv.ua/api/menu_items/238  (Today)
  │  GET api.loe.lviv.ua/api/menu_items/256  (Tomorrow)
  ▼
parse rawHtml text  →  validate (schema + plausibility)  →  docs/data/latest.json
  │                         │
  │                         └─ any failure: keep previous latest.json, fail the run, upload diagnostics
  ▼
GitHub Pages serves docs/ (static HTML + JSON). Visitors never contact the source.
```

- **Source:** the official site is a React app backed by a public JSON API. Each schedule item
  has a `rawHtml` field with one line per group, for example
  `Група 1.1. Електроенергії немає з 20:00 до 22:00.` The PNG on the site is drawn from the same
  data, so we need no browser, no OCR and no LLM. See
  [ADR 0001](adr/0001-data-source-and-extraction.md) for the investigation and alternatives.
- **Extraction:** strict line patterns. Any unrecognised line fails the run, which is how we detect
  layout changes.
- **Validation:**
  - exactly the 12 known groups (1.1–6.2);
  - times on a 30-minute grid;
  - `start < end`, no overlaps;
  - schedule date within ±1 day of Kyiv today;
  - "updated at" not in the future.
- **Time:** source times are Europe/Kyiv wall-clock times. Output intervals carry explicit offsets
  (`+02:00` or `+03:00`), `24:00` becomes `00:00` of the next day, and DST edge cases follow the
  rules in the ADR.
- **No server, no database.** Data is regenerated about every 30 minutes by GitHub Actions.

## Data format

`docs/data/latest.json` follows [`schema/latest.schema.json`](schema/latest.schema.json)
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

| Path             | Contents                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `adr/`           | Architecture decision records                                                            |
| `schema/`        | JSON Schema for the published data                                                       |
| `test/`          | Deterministic tests (`node:test`)                                                        |
| `test/fixtures/` | Real and synthetic API responses and output examples ([README](test/fixtures/README.md)) |

## Local development

Requires Node.js 24 or newer (`.nvmrc`).

```sh
npm ci
npm run check         # lint + format check + tests
npm test              # tests only
npm run format        # apply Prettier
```

Tests use committed fixtures only and never contact the source.

## License and attribution

Code is released under the [MIT License](LICENSE). The license covers this project's code only,
not the source's schedule data.

Schedule data © ПрАТ «Львівобленерго», <https://poweron.loe.lviv.ua/>. This project is not
affiliated with or endorsed by Львівобленерго.

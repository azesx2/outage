# Test fixtures

## `source/` — API responses

Each file is one scenario:

| Field | Meaning |
|---|---|
| `description` | What the scenario represents |
| `origin` | `real:` (captured from the live API or its archive) or `synthetic:` (edited from a real capture) |
| `now` | Clock the pipeline must use for this scenario (Kyiv time with offset) |
| `responses.today` / `responses.tomorrow` | Body of `GET https://api.loe.lviv.ua/api/menu_items/238` / `/256`, as served |
| `expect` | `accept` with expected `days` (and optional `spotChecks` of exact intervals), or `reject` with the acceptable `reasons` |

Archive publications are wrapped in the live Today/Tomorrow envelope. Only `rawHtml`/`rawMobileHtml` come from the archive item named in `origin`.

| Scenario | Origin | Expect |
|---|---|---|
| `normal-live-2026-10-17` | live | accept, Tomorrow unavailable |
| `cross-midnight-two-days` | archive 987 + 990 | accept, `24:00` → next day `00:00` |
| `max-intervals-per-group` | archive 975 | accept, 5 intervals in one group |
| `no-outages` | archive 1045 | accept, every group `[]` |
| `after-midnight-lag` | live, later clock | accept, yesterday's day only |
| `dst-fall-back-2026-10-25` | synthetic | accept, ambiguous 03:00–03:59 → earlier instant |
| `dst-spring-forward-2027-03-28` | synthetic | accept, nonexistent 03:00–03:59 → shifted forward |
| `reject-malformed-zero-length` | archive 540 | reject, every interval `00:00–00:00` |
| `reject-partial-missing-groups` | synthetic | reject |
| `reject-duplicate-group` | synthetic | reject |
| `reject-layout-change-wording` | synthetic | reject, unknown lines |
| `reject-api-shape-change` | synthetic | reject, `rawHtml` missing |
| `reject-item-identity-mismatch` | synthetic | reject, item 238 is not "Today" |
| `reject-overlapping-intervals` | synthetic | reject |
| `reject-invalid-time` | synthetic | reject, `25:00` |
| `reject-off-grid-time` | synthetic | reject, `20:15` |
| `reject-reversed-interval` | synthetic | reject, `22:00–20:00` |
| `reject-stale-schedule-date` | archive 1045, later clock | reject |
| `reject-updated-at-in-future` | live, earlier clock | reject |

## `output/` — `docs/data/latest.json` examples

- `valid/` must pass `schema/latest.schema.json`. These files will also drive frontend tests (`stale-fetched-at`, `no-data-published`, `no-outages`).
- `invalid/`: each file is `valid/current-one-day.json` with exactly one defect and must fail the schema.

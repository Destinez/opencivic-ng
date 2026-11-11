# OpenCivic NG

Unofficial civic tools for Nigerian elections: look up a polling unit, read sourced guidance, and publish a crowdsourced tally only after a second person has reviewed it.

OpenCivic is not the Independent National Electoral Commission. It does not announce official results and it does not declare a winner. The geography shipped in the repo is **sample data** for Lagos and Edo. Sample codes start with `SAMPLE/`. Nothing in that set is an official polling unit.

Built by Obaro Destiny Udurie.

![CI](https://github.com/Destinez/opencivic-ng/actions/workflows/ci.yml/badge.svg)

## What you can do

1. **Find a polling unit** by searching or browsing state, local government, ward, and unit. A map (Leaflet, OpenStreetMap tiles) draws pins for the current ward or search, not for a whole state.
2. **Read election guidance.** The 2027 dates are copied from [INEC’s election calendar](https://inecnigeria.org/elections/calendar). Voting steps are copied from [INEC’s voter-education page](https://inecnigeria.org/voters/education). PVC collection logistics are marked **Unverified**.
3. **File an observation** on the fictional demonstration poll: accredited voters, party figures, rejected ballots, and an optional photo of the result sheet. A reviewer who did not file it approves or flags it. The public tally uses the newest approved sheet per unit.
4. **Call a small HTTP API** documented at `/v1/openapi.json` and on the in-app API page.

To find the unit printed on a real PVC, use [INEC’s portal](https://cvr.inecnigeria.org/pu). This app only searches the dataset you loaded.

## Screenshots

Sample data, desktop and a phone-sized viewport.

| | Desktop | Phone |
| --- | --- | --- |
| Lookup | ![Lookup on a desktop](docs/screenshots/lookup-desktop.png) | ![Lookup on a phone](docs/screenshots/lookup-mobile.png) |
| Map | ![Map on a desktop](docs/screenshots/map-desktop.png) | ![Map on a phone](docs/screenshots/map-mobile.png) |
| Election guidance | ![Election guidance on a desktop](docs/screenshots/election-desktop.png) | ![Election guidance on a phone](docs/screenshots/election-mobile.png) |
| File an observation | ![Observation form on a desktop](docs/screenshots/submit-desktop.png) | ![Observation form on a phone](docs/screenshots/submit-mobile.png) |
| Review queue | ![Review queue on a desktop](docs/screenshots/review-desktop.png) | ![Review queue on a phone](docs/screenshots/review-mobile.png) |
| Unofficial tally | ![Tally on a desktop](docs/screenshots/aggregate-desktop.png) | ![Tally on a phone](docs/screenshots/aggregate-mobile.png) |

## Run it

Node 22 and pnpm 10. Docker is the path that matches production-shaped Postgres. Without Docker, the API falls back to an embedded Postgres-compatible database so the UI can still be tried.

### Docker Compose

```bash
docker compose up --build
```

- Web: http://localhost:3000
- API: http://localhost:4000
- API docs: http://localhost:4000/docs
- OpenAPI: http://localhost:4000/v1/openapi.json

The API waits for Postgres, applies `packages/db/migrations/0001_init.sql`, and seeds the sample dataset. Restarting does not duplicate observations.

### Without Docker

```bash
pnpm install
pnpm dev
```

`pnpm dev` uses `pglite:./.data/opencivic` and seeds on boot. For a real Postgres, start only the database and point the API at it:

```bash
docker compose up db
DATABASE_URL=postgres://opencivic:opencivic@localhost:5432/opencivic \
  SEED_ON_BOOT=true \
  pnpm --filter @opencivic/api dev
```

In another shell, `pnpm --filter @opencivic/web dev`.

### Demo accounts

These passwords are public. They exist so the review flow can be tried. Do not expose them on the internet. Override them with `SEED_OBSERVER_PASSWORD`, `SEED_REVIEWER_PASSWORD`, and `SEED_ADMIN_PASSWORD` before any shared deployment, and set `SEED_ON_BOOT=false` once you have real accounts.

| Role | Email | Password |
| --- | --- | --- |
| Observer | ada.okonkwo@example.com | observer-demo-pass |
| Reviewer | chidi.bello@example.com | reviewer-demo-pass |
| Admin | amina.yusuf@example.com | admin-demo-pass |

Signing in on a second browser does not sign the first one out. Deleting an account replaces the name and email, ends sessions, and leaves the audit log in place without the email address.

## Architecture

```mermaid
flowchart TB
  browser[Phone or desktop browser]
  web[Next.js server and pages]
  proxy["Same-origin /backend proxy"]
  api[Hono API]
  db[(Postgres)]
  files[Sheet photos on disk]
  osm[OpenStreetMap tiles]

  browser --> web
  browser --> proxy
  browser --> osm
  web --> api
  proxy --> api
  api --> db
  api --> files
```

| Piece | Role |
| --- | --- |
| `apps/web` | Mobile-first Next.js UI. Public pages are server-rendered. The browser talks to `/backend`, which proxies to the API at runtime, so the session cookie stays on the site origin. |
| `apps/api` | Hono HTTP API. Public reads for geography, elections, and approved aggregates. Cookie sessions for everything else. |
| `packages/db` | Drizzle schema, SQL migration, sample seed, and the CSV importer. |
| `packages/shared` | Party list, Zod validation, and the rollup used by the API and the unit tests. |

The audit table has a trigger that raises on `UPDATE` and `DELETE`. Decisions are new rows, not edits. A reviewer cannot decide a sheet they filed. Approving a second time is rejected. If two approved sheets exist for one unit, the newer one is the one that counts, which is why the seed includes an older Ikeja sheet of 1 accredited voter that does not appear in the Lagos total.

Party rows are alphabetical by code, drawn in one colour. The list is a data-entry convenience, not a ballot paper and not a ranking. The bar repeats the number. The page does not name a winner.

Coverage is “of the polling units in this database”. The sample is 36 units. It is not the national list.

Photos are JPEG, PNG, or WebP, at most 2 MB, checked by magic bytes, and stored outside the web root. The tally does not embed them. A seeded pending sheet uses a generated placeholder image and says so.

## Trade-offs

- **Sample poll vs the real 2027 elections.** INEC’s calendar, as read for this dataset, lists a presidential and National Assembly election on 16 January 2027 and a governorship and House of Assembly election on 6 February 2027. Those pages are information only. Seeded numbers are attached to a fictional poll so a practice tally cannot be mistaken for a real one. `accepts_submissions` is the switch for a later deployment.
- **Newest approved sheet wins.** Keeping every approved sheet visible would double-count. Replacing the old row would hide history. The public number uses the latest approval; the audit log keeps both.
- **In-memory rollup.** Fine for a state extract and for the sample. A full national file wants the sum done in SQL. Search is `ILIKE` without `pg_trgm` for the same reason: one migration has to run on Postgres and on the embedded database used in unit tests.
- **Embedded database in tests and in `pnpm dev`.** CI’s browser run uses Postgres 16. Unit and API tests use PGlite so they do not need Docker. The SQL file is the migration both of them apply.
- **Session cookie through a proxy, not a token in `localStorage`.** The cookie is `HttpOnly` and `SameSite=Lax`. `COOKIE_SECURE` must be turned on behind HTTPS. Direct callers can still use the API port; CORS allows the configured web origins.
- **Rate limits live in the process.** Enough to slow a single-node credential stuffing attempt. A second instance does not share the counter.
- **Every page is dynamic.** The web build does not need a database. The cost is that the homepage is not cached as a static file.
- **English only.** The first audience is a phone on a slow network, so the map stays unloaded until a wide screen or an explicit “Show map”, and the lookup list is a normal form and links.
- **No live INEC feed, no USSD, no offline sync.** Import is a CSV you prepare. Official coordinates are often missing from published lists; leave latitude and longitude blank and the UI says the pin is missing.

## Import an INEC list

INEC publishes polling-unit lists and a lookup at [cvr.inecnigeria.org/pu](https://cvr.inecnigeria.org/pu). This repo does not download that list. Formats change, and you should confirm you are allowed to reuse a given file.

1. Save the extract as UTF-8 CSV with this header (see `packages/db/fixtures/inec-import-template.csv`):

```text
state_code,state_name,lga_code,lga_name,ward_code,ward_name,pu_code,pu_name,address,latitude,longitude,registered_voters
```

2. Delete the `EXAMPLE-` row. Rows whose unit code starts with `EXAMPLE` are skipped.
3. Import:

```bash
pnpm import:inec ./your-polling-units.csv
```

Imported rows are stored separately from the sample (`dataset = imported`). The UI says to confirm them against the current INEC list. They are still not presented as an official OpenCivic publication.

Remove the sample when you no longer want it mixed in:

```bash
pnpm db:clear-sample
```

That deletes sample geography and the observations attached to it. It does not delete the audit log, and it does not delete imported rows.

## API

Public reads:

- `GET /v1/states`
- `GET /v1/states/:stateId/lgas`
- `GET /v1/lgas/:lgaId/wards`
- `GET /v1/polling-units?q=&stateId=&lgaId=&wardId=&limit=&offset=`
- `GET /v1/polling-units/:id`
- `GET /v1/elections`
- `GET /v1/elections/:slug`
- `GET /v1/aggregates?election=&level=state|lga|ward&parentId=`

Every geography and tally payload includes `official: false` and a disclaimer string. `parentId` is a state id when `level=lga`, and a local-government id when `level=ward`.

Authenticated routes (cookie `oc_session`) cover registration, observations, review, account deletion, and the admin audit log. They are in the same OpenAPI document.

```bash
curl 'http://localhost:4000/v1/polling-units?q=Ikeja'
```

## Tests and CI

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm e2e
```

- Unit tests cover the rollup (latest sheet per unit, places with zero reports still listed) and form validation.
- API tests run against PGlite: sample labelling, the seeded Lagos and Edo totals, role checks, a private photo, account deletion without writing the email into the audit log, and the append-only trigger.
- Playwright loads the home page, a sample search, the 2027 guidance page, the tally, and the reviewer queue, and runs axe for serious and critical issues.
- GitHub Actions runs lint, typecheck, unit tests, the production web build, and the browser smoke test against Postgres 16.

## Legal and product limits

The Electoral Act 2022 is the statute. A copy hosted by PLAC is linked from the guidance page; the gazette controls if they differ. This README is not legal advice. Official results are announced by INEC.

Personal data is a name, an email, a password hash, the observations that person files, and a session cookie. Consent is collected at registration. The privacy page points at the [Nigeria Data Protection Commission](https://ndpc.gov.ng/). The demo has no separate data controller. Do not upload voter registers or photographs of people.

Guidance text was checked against INEC’s public pages while this dataset was written. If those pages change, the pages win. Blocks that could not be confirmed are marked unverified.

## License

MIT. See [LICENSE](LICENSE).

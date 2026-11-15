# OpenCivic NG — Sheet Match

Find a polling unit, file the figures on a result sheet, and compare them with a manually attached reference. Independently checked document differences appear on a discrepancy board with downloadable evidence packs.

**OpenCivic is unofficial.** It is not the Independent National Electoral Commission, does not announce official results and does not declare a winner. INEC alone declares results. All shipped polling units and result documents are fictional samples; codes start with `SAMPLE/`. Sourced voting guidance is separate from the fictional demonstration poll.

Built by Obaro Destiny Udurie.

## Try the demo

Install Node 22 and pnpm 10.33.4, and start Docker. From the repository root:

```bash
docker compose up --build -d
pnpm demo:sheetmatch
```

Open http://localhost:3000/cases. The command seeds the fictional poll, a manually cited sample reference, an independently reviewed case at Anifowoshe and a hash-sealed evidence pack. Repeating the command reuses that case. It detects a running Compose API and runs the seed inside its photo volume; when no Compose API is running it uses the local database configured through environment variables.

API: http://localhost:4000. Interactive documentation: http://localhost:4000/docs. OpenAPI: http://localhost:4000/v1/openapi.json.

The ready case leaves Ikeja GRA sample unit 3 available for the two-minute walkthrough:

1. Search **Ikeja GRA**. Check the SAMPLE notice; this is not an official polling unit.
2. Sign in as the observer. Download the [fictional observer sheet](apps/web/public/samples/observer-sheet.png), open **Report**, choose Ikeja GRA sample unit 3 and enter accredited **120**, rejected **2**, APC **112**, all other party figures **0**. The fictional capture date is 20 February 2027. Attach the sample image.
3. After the page has loaded online, switch the browser offline and save. The phone says **Saved on phone**. Reloading preserves the draft. Reconnect and it becomes **Sent ✓** without a duplicate.
4. Sign in as the first reviewer, open the sheet and claim it. The seeded SAMPLE reference shows APC **142** and total accounted ballots **144**, above accreditation **120**. Mark **Discrepancy likely**, provide a document-based note, open a case and start investigation.
5. The second reviewer verifies the reference transcription, opens the case and independently confirms it. Confirmation publishes immediately.
6. Sign in as desk, filter the board by Lagos and Ikeja, open the case and download its evidence pack. The public tally remains unofficial and names no winner.

Demo accounts use public passwords and example.com addresses:

- Observer: `ada.okonkwo@example.com` / `observer-demo-pass`
- Reviewer: `chidi.bello@example.com` / `reviewer-demo-pass`
- Second reviewer: `zainab.ali@example.com` / `reviewer-two-demo-pass`
- Desk: `femi.adeyemi@example.com` / `desk-demo-pass`
- Admin: `amina.yusuf@example.com` / `admin-demo-pass`

Do not expose these defaults on a public hostname. The demo remains fictional; a real-election pilot requires a partner controller and legal review. Account deletion is supported; a deleted demo account requires a fresh demo database rather than silently restoring its identity.

## Demo captures

![Sheet Match walkthrough](docs/screenshots/sheetmatch-demo.gif)

![Discrepancy board with sample map pins](docs/screenshots/sheetmatch-board-desktop.png)

![Two fictional documents and their field comparison](docs/screenshots/sheetmatch-case-desktop.png)

[Phone outbox](docs/screenshots/sheetmatch-offline-mobile.png), [sent receipt](docs/screenshots/sheetmatch-sent-mobile.png), [phone case](docs/screenshots/sheetmatch-case-mobile.png) and [phone board](docs/screenshots/sheetmatch-board-mobile.png) show the same sample flow. Earlier lookup, guidance and tally captures remain in `docs/screenshots`.

To regenerate the Sheet Match captures after a web build:

```bash
pnpm demo:captures
pnpm demo:gif # requires ffmpeg
```

If bundled Chromium cannot launch, set `PLAYWRIGHT_CHROME_PATH` to the installed Chrome executable. On macOS:

```bash
PLAYWRIGHT_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' pnpm e2e
```

## Local development

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The API defaults to PGlite at `apps/api/.data/opencivic`, applies all numbered migrations and seeds fictional data. The photo store is outside the web root. `pnpm demo:sheetmatch` prepares the full case in the same local store. Both apps run at ports 3000 and 4000.

For Postgres with apps running on the host:

```bash
docker compose up -d db
DATABASE_URL=postgres://opencivic:opencivic@localhost:5432/opencivic SEED_ON_BOOT=true pnpm --filter @opencivic/api dev
```

In another terminal, run `pnpm --filter @opencivic/web dev`. Use the same `DATABASE_URL` and `UPLOAD_DIR` with the demo, migration, retention and audit commands. `.env.example` contains placeholders; supply real configuration through environment variables.

## How Sheet Match works

```mermaid
sequenceDiagram
  participant Phone as Observer phone
  participant API as API
  participant DB as Postgres
  participant First as First reviewer
  participant Second as Second reviewer
  participant Desk as Public / desk
  Phone->>Phone: Save UUID, figures and compressed photo offline
  Phone->>API: Send figures with clientId
  API->>DB: Insert once, record server receipt time
  Phone->>API: Upload photo separately with retries
  API->>DB: Strip metadata, hash image, recompute flags
  First->>API: Claim sheet, attach reference, record decision
  Second->>API: Verify reference transcription
  First->>API: Open case and investigate
  Second->>API: Independently confirm current evidence
  API->>DB: Audit confirmation and publish atomically
  Desk->>API: Filter board and inspect provenance
  Desk->>API: Download versioned ZIP and SHA-256 manifest
```

The TypeScript monorepo contains `apps/web` (Next.js), `apps/api` (Hono), `packages/db` (Drizzle, Postgres/PGlite, migrations and seeds) and `packages/shared` (validation and pure comparison rules). Browser requests use a same-origin `/backend` proxy with an HttpOnly session cookie.

The observer route uses system fonts, no map, a cached shell and IndexedDB drafts scoped to the account. Images are resized to a 1,600-pixel long edge at quality 0.7, then the server removes metadata again. Sync sends figures first, retries photos with backoff and resumes online; background sync is used where supported. The JavaScript budget is 200 KiB gzip including the worker.

Cross-checks cover party scores, accredited figures, overvotes, arithmetic, registered-voter plausibility, observer conflicts and reused images. A difference of at least ten votes or five percent is critical. Duplicate images are private abuse signals and cannot support public cases.

Review claims last ten minutes. L0 sheets need two independent approvals; after three approved sheets without a rejection an observer reaches L1. Admins verify accreditation for higher levels. Fabrication rejection freezes submissions at L0 until an admin documents a review. Shared address/device signals use hashes with 30-day retention; shared connections can be legitimate. ASN values are not inferred from untrusted forwarding headers.

Published cases preserve immutable evidence snapshots, two-person decisions, pseudonyms and an append-only hash-chained audit. Retraction requires two different admins and a public note. SQL aggregates select the newest approved sheet by server receipt time per unit; reporting coverage concerns only the polling units loaded here. Party rows are alphabetical and do not project results.

## Evidence and API

Public cases have no account requirement or embargo. Desk can read non-draft unpublished cases without observer identities; reviewers and admins can also inspect drafts. Boards filter election, state, LGA, severity and status using keyset pagination. The map clusters nearby pins and always has an equivalent list.

An evidence ZIP contains `case.json`, both sheet images, `provenance.json`, `audit.json`, `manifest.json`, `SHA256SUMS` and `DISCLAIMER.txt`. Provenance includes source URLs, retrieval times, hashes and pseudonymous transcription/review decisions. `X-Content-SHA256` hashes the full ZIP. Retractions produce a new version. Verify the extracted files with:

```bash
shasum -a 256 -c SHA256SUMS
```

Every JSON API response carries `official: false`, a disclaimer and request ID. OpenAPI is checked against all router methods. New routes cover submissions/retry photos, review claims, reference create/verify, cases/transitions/comments/history, polling-unit case counts, evidence ZIPs and images, admin trust/abuse/config, personal export and purpose consent. Public reads retain geography, sourced guidance and unofficial aggregates.

Quotas are shared through Postgres: public requests 120/minute per connection, register 5/hour per address, sign-in 10/15 minutes per address+email, submissions 10/hour and 3/unit per observer/election, references 60/hour per reviewer. Idempotent submission retries do not consume another slot. Forwarding headers are ignored; the web proxy shares a connection quota, so a real deployment needs an appropriate edge limit.

Counts are bounded, capture times must fit election day ±24 hours, and the server enforces the election submission switch. Uploads accept a single JPEG, PNG or WebP up to 2 MB. Photos remain outside the web root; only independently confirmed case evidence becomes public.

## Privacy and operations

The [privacy notice](apps/web/app/privacy/page.tsx), [DPIA](docs/DPIA.md) and [incident runbook](docs/INCIDENT.md) describe minimisation, consent, observer retaliation risks and NDPA obligations, including notifying the NDPC within 72 hours where required.

Configure `PRIVACY_CONTROLLER_NAME` and `PRIVACY_CONTACT_EMAIL`. The default identifies Obaro Destiny Udurie's personal demo project. Account offers a ZIP export, evidence-consent withdrawal/restoration and deletion. Unpublished observations and archives are removed; published evidence is retained without account identity. Phone drafts are cleared on withdrawal/deletion. Passwords and session tokens are never exported.

Run these daily with the same database and photo store as the API:

```bash
pnpm privacy:retain
pnpm audit:verify
```

Raw observer/reference photos expire 180 days after the election unless retained in published or retracted cases. Connection/device signals expire after 30 days. File deletion uses a durable queue so interrupted runs can retry. With Compose, execute the retention script inside the API container:

```bash
docker compose exec -T api pnpm exec tsx ../../scripts/retention.mts
```

Operators must provide TLS, encrypted photo volumes and backups, private database credentials, least-privilege roles and `COOKIE_SECURE=true`. Compose volumes alone do not provide encryption. Real-election deployment requires legal approval; the shipped data remains fictional. English ships with message keys reserved for Hausa, Yoruba, Igbo and Pidgin pending reviewed translations.

## Geography and sources

For the polling unit printed on a real PVC, use [INEC's portal](https://cvr.inecnigeria.org/pu). OpenCivic searches the dataset you load. The included sample contains 36 approximate locations in Lagos and Edo.

The CSV importer accepts a file you supply after confirming reuse terms; it never downloads an INEC list. Use `packages/db/fixtures/inec-import-template.csv`, remove its EXAMPLE row, then run:

```bash
pnpm import:inec ./polling-units.csv
```

Imported units retain `dataset=imported` and a notice to confirm them against the current INEC list. `pnpm db:clear-sample` removes removable sample geography; published cases are preserved by database constraints. Do not run it on the prepared Sheet Match demo.

INEC election-calendar and voter-education links remain on guidance pages; uncertain dates or logistics are labelled Unverified. Reference images are manually attached with citations. No automated IReV harvesting or reference importer is shipped.

## Checks and decisions

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check:budget
pnpm exec playwright install chromium
pnpm e2e
pnpm demo:captures
```

Vitest covers pure comparison rules, retries, image metadata removal, trust, shared quotas, independent decisions, audit integrity, board access, evidence hashes, privacy and retention. Set `TEST_DATABASE_URL` to run API/schema checks against isolated Postgres schemas. Browser tests use isolated databases and cover offline reload/sync, slow connections, review/publication/downloads, admin controls, privacy, axe and 200% zoom.

CI runs lint, types, PGlite and Postgres tests, build, budget, browser checks and the scripted demo. [Milestone evidence](docs/MILESTONES.md) records completed checks. Decisions document [manual sourcing](docs/adr/0001-manual-reference-sourcing.md), [independent evidence review](docs/adr/0002-independent-evidence-decisions.md) and [newest approved observations](docs/adr/0003-newest-approved-observation.md).

MIT. See [LICENSE](LICENSE).

# Sheet Match baseline

M1 verified on 13 November 2026. The API remains Hono. `SPEC.md` defines the milestones and acceptance criteria.

The branch starts at the unchanged remote root, `423add1`. The MVP and later commits use Obaro Destiny Udurie as both author and committer. Work stays local.

## Verification

Installed with `pnpm install --frozen-lockfile`. Lint, typecheck, 65 unit/API tests, and the production build pass. Both Playwright smoke tests pass, including axe checks, against Postgres 16 started with `docker compose up -d --wait db`. The browser run uses the production web server (`CI=1`).

## Confirmed gaps

| Milestone | Baseline gap |
| --- | --- |
| M2 | Only the original schema exists. No reference, case, trust, or shared-limit tables. |
| M3 | Arithmetic warnings exist; field comparisons and persisted flags do not. |
| M4 | Uploads have size/type checks, but no retry identity, EXIF removal, photo hashes, or shared quotas. |
| M5 | Submission requires a connection; no device outbox or cached observer shell. |
| M6 | One review decides a sheet; no claim, reference verification, or side-by-side evidence. |
| M7 | Audit rows cannot be edited, but have no hash chain. No case state machine. |
| M8 | No discrepancy board or evidence archives. |
| M9 | Three roles exist, without desk access, trust gating, or abuse signals. |
| M10 | Basic account deletion and privacy copy exist. Export, retention, purpose consent, and full-flow accessibility checks remain. |
| M11 | The README has an MVP diagram and screenshots; the Sheet Match demo and decision records remain. |

The initial hardening adds bounded in-process quotas, strict public query validation, request-size limits, and regression tests. M4 replaces those counters with the shared Postgres implementation required by the spec.

## Defaults

References are manually attached; no portal harvesting or bulk reference importer. The shipped election remains fictional. Party-score severity uses the stated 10-vote or 5% threshold. Controller details are configuration, with a clearly labelled personal-project demo default. English ships first; locale keys are prepared for reviewed translations without presenting unreviewed translations as complete.

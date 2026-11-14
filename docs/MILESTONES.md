# Acceptance record

`SPEC.md` is the product and engineering contract. Each milestone is committed after its checks pass.

| Milestone | Evidence |
| --- | --- |
| M1 | Installed dependencies; lint, types, 65 unit/API tests, production build, and 2 Playwright + axe tests passed with Compose Postgres. Gaps recorded in `BASELINE.md`. |
| M2 | New `0002` migration and typed tables; fictional sample reference; 70 unit/API tests. Five migration/constraint tests also passed against isolated schemas on Postgres 16. Repeat migration and legacy audit backfill are covered. `0001_init.sql` is unchanged. |
| M3 | Pure field comparisons cover all seven rules, percentage/absolute thresholds, missing values, trusted observer conflicts, and exact/perceptual duplicates. Recomputing flags is idempotent and preserves resolved history. All 83 tests and typecheck pass; persistence also passes on Postgres 16. |

> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# P0 Foundation — Safe Local DB + Dev/Prod Parity

**Date:** 2026-06-08 | **Branch:** `main` | **Status:** ✅ SHIPPED (executed by coding-team-leader session; local-DB e2e proven)

> The P0 lane from [`doc/strategy/2026-06-08-long-term-architecture-review.md §4`](../strategy/2026-06-08-long-term-architecture-review.md) — "the single highest-leverage unblock." Makes write-flows runnable locally so the two-phase verification (`GENERIC_HANDOFF §0.3`) stops slipping and the Procedure refactor's verification phases (Phase 0/2/3/5) become real. **Unblocks Procedure Phases 4–6** (incl. the L7 `dispatch_case_agent` retire).

## 1. The problem (was)
- Local `DATABASE_URL` (in `.env.local`) tunneled to **production** Postgres (`5433:localhost:5432` SSH tunnel) — every local write hit prod (memory `project_local_db_is_production`).
- `SESSION_SECRET` / `STAFF_PASSWORD` / `API_ORG_PASSWORD` **missing** from `.env.local` — Console refuses to issue sessions; local login impossible.
- `packages/shared/.env` (the file Prisma CLI actually loads) pointed at `file:../../dev.db` (SQLite) while the schema datasource is `postgresql` → `db:push` failed on provider mismatch. The SQLite story was non-functional.
- `sqlite-schema-compat.ts` was a stale, **zero-caller** ALTER-shim for that dead SQLite path.
- `docker-compose.yml` Postgres:16 existed but nothing wired it as the dev DB; the `db-integration` test hardcoded port `5432` while compose maps `5434` → it was a permanent "known-fail / skipped."

## 2. What changed

### Committed (tracked) files
- **`packages/shared/prisma/index.ts`** — removed the dead `export { ensureSqliteSchemaCompat }`.
- **`packages/shared/prisma/sqlite-schema-compat.ts`** — **deleted** (zero callers; SQLite dev path retired).
- **`packages/shared/prisma/schema.prisma`** — header comment corrected (local dev = Dockerized Postgres 16; SQLite shim retired; prod = self-hosted Postgres, not "Neon").
- **`.env.example`** — `DATABASE_URL` `file:./dev.db` → `postgresql://intera:intera@localhost:5434/intera`, plus the `docker compose up` / `db:push` / `db:seed` recipe.
- **`docker-compose.yml`** — removed the obsolete `version:` key (compose v2 warning); added a usage header.
- **`apps/console/lib/livechat/__tests__/integration/db-integration.test.ts`** — `LOCAL_DATABASE_URL` `localhost:5432` → `localhost:5434` to match `docker-compose.yml`.

### Local-only (gitignored — the operator's machine, not committed)
- **`.env.local`** — active `DATABASE_URL` → `postgresql://intera:intera@localhost:5434/intera`; the prod-tunnel URL preserved **commented** + labeled **SELECT-ONLY**; added `SESSION_SECRET` (openssl rand -hex 32), `STAFF_PASSWORD`, `API_ORG_PASSWORD` (dev values). Backup: `.env.local.bak.20260608`.
- **`packages/shared/.env`** — `file:../../dev.db` → the same local docker URL (so `prisma db push/studio` work without an inline override). Backup: `.env.bak.20260608`.

## 3. How to stand up the local DB (reproducible)
```bash
docker compose up -d postgres                      # Postgres 16, host port 5434, healthcheck
# .env.local + packages/shared/.env DATABASE_URL = postgresql://intera:intera@localhost:5434/intera
npm run db:generate
npx prisma db push --schema=packages/shared/prisma/schema.prisma --accept-data-loss   # fresh empty DB
npm run db:seed                                    # 2 vendors, agent_default_v1, 4 tools, 2 policies, 2 case types
```

## 4. Verification receipt
- `docker inspect intera-postgres` → **healthy**; 22 tables created; seed rows: organizations 3 · agent_configs 1 · tools 4 · policies 2 · case_types 2.
- **Real local-DB e2e proven:** the previously skipped `db-integration.test.ts` (session-store / webhook-dedup / retry-queue against live Postgres) now runs against the local docker DB → **10 passed**. This is the proof the foundation works — write-flow integration tests run locally, zero prod contact.
- Phase-1 gate after the retirements/edits: `tsc --noEmit` 0 · keyless `npm test` green (db-integration still **skipped** under the keyless gate — it only activates when `DATABASE_URL` is local) · `build:console` ✓.

## 5. Safety notes / standing rules
- The prod tunnel URL is preserved (commented, SELECT-ONLY) in `.env.local` for Procedure **Phase 0** read-only inventory. **Never** run `db:push`/`db:seed`/write-flows against it.
- Every DB-touching command in this lane was run with an **inline local `DATABASE_URL`** and the active value was asserted to contain `localhost:5434` and **not** `5433`/`43.134.51.138` before execution.
- This does not change production. No prod deploy is required for the foundation itself (the committed file edits — dead-code deletion, comment/example fixes, test port — ride the next code deploy; they are prod-safe: prod never used the SQLite shim).

## 6. What this unblocks
- **Procedure refactor Phases 4–6** (gated on this lane per the review §5 / the refactor plan §6) — they need SELECT-only-prod + real local-DB e2e, which now exist.
- **L7** (`dispatch_case_agent` detached sub-agent) retire lands in Procedure Phase 4 on top of this.
- General: two-phase verification's Phase-2 can stop slipping for any write-flow change.

## 7. Follow-ups (not in this lane)
- Optionally add a root `package.json` `db:reset` / `dev:db` convenience script (compose up + push + seed).
- The cross-tenant isolation guard test (F2/§L5) the review folded into "Next architect deliverable" is **already** covered by `cross-org-isolation.test.ts` (L5, `5bd7326b`); P1 isolation-seam reconciliation remains a separate lane.

# Master Build Handoff — Intera Agent

**Last updated:** 2026-06-02 | **Branch:** `main` @ `d2def3a` | **Target:** `https://demo.anytrans.ai`

> **This file does macro coordination only.** It tracks *what's left, in what order, and what's blocking what.* It is the single source of truth for project status.
>
> **Detailed, code-level steps live in [`doc/to-do/`](../../doc/to-do/)** — one guide per backlog item (`NN-slug.md`), with exact file paths, line numbers, and verification commands. Those guides do not exist yet; create the guide for an item **when you pick it up**, not before.
>
> **The update rule (铁律):** every time a `doc/to-do/` guide is completed → move it to `doc/what's done/`, then come back here and update the item's status, commit SHA, and the "what's now unblocked" note. Keep the header SHA current. See [`GENERIC_HANDOFF.md`](./GENERIC_HANDOFF.md) §0.

---

## Status at a glance

| Verdict | State |
|---|---|
| Does it run in prod? | ✅ HTTPS serves, agent replies, LiveChat connects, `/api/health` = `{status:ok, db:connected}`. |
| Multi-tenant access control (C1/C2)? | ✅ **Closed & verified on prod.** Signed HMAC session bound to orgId; forged `intera_org_id` cookie → 401. Password-less login closed. |
| Safe to onboard a 2nd tenant? | ⚠️ **After Phase 1** (rotate default `ChangeMe2026!` passwords + H4). Access control itself is sound. |
| Survives server failure? | ⛔ **No** — no DB backups (H1). |
| Push-to-deploy works? | ✅ End-to-end via `git push deploy main`. |

**Recently shipped (already done — do not redo):**
- C1/C2 multi-tenant IDOR fix — signed session + middleware gate (`83028cd`, verified on prod).
- Logo fluid-transition fix (`dcc7bca`); deploy-script `git pull` removal (`781fb6c`).
- Two-panel brand login UI (`6ed22e1`, `d2def3a`) — ✅ smoke-tested on prod at `d2def3a` (TODO-16 closed).

---

## The backlog

Phases are ordered by "what unblocks onboarding a second paying tenant," then resilience, then hygiene, then product, then code quality. Within a phase, top-to-bottom.

Status legend: 🔴 not started · 🟡 in progress · ✅ done (with commit) · ⬜ guide not yet written.

### Phase 1 — Pre-second-tenant security (blocks onboarding)

| ID | Item (audit ref) | Status | Guide |
|---|---|---|---|
| TODO-01 | **L1** — rotate default `ChangeMe2026!` (`STAFF_PASSWORD`, `API_ORG_PASSWORD`) on the server; confirm login still works. | 🔴 ⬜ | `doc/to-do/01-rotate-default-passwords.md` |
| TODO-02 | **H4** — purge SSH password + TLS-bundle path from committed docs; move to a reference; switch server to key-only SSH auth (`PasswordAuthentication no`). *(User said keep the SSH password usable — confirm scope before rotating.)* | 🔴 ⬜ | `doc/to-do/02-purge-secrets-keyauth.md` |
| TODO-03 | **M2** — `/api/messages/route.ts:308` `resolvedOrgId = authOrgId \|\| orgId \|\| 'default'` silently routes to `default` when unresolved. Fail closed (401) instead. Needs a guard test. | 🔴 ⬜ | `doc/to-do/03-messages-fail-closed-org.md` |
| TODO-04 | **M1** — `lib/api-auth.ts:38` `isTrustedInternalCall` uses non-timing-safe `===` on `INTERNAL_API_SECRET`. Switch to `crypto.timingSafeEqual`. | 🔴 ⬜ | `doc/to-do/04-internal-secret-timing-safe.md` |

### Phase 2 — Resilience & operability

| ID | Item (audit ref) | Status | Guide |
|---|---|---|---|
| TODO-05 | **H1** — no DB backups. Install daily `pg_dump` cron (`deploy-ubuntu.md §11`), verify a restore, consider off-box storage. | 🔴 ⬜ | `doc/to-do/05-db-backups.md` |
| TODO-06 | **H2** — app binds `0.0.0.0:3000` and UFW is inactive. Bind `127.0.0.1:3000` (Caddy proxies locally); enable UFW (`allow 22,80,443`). | 🔴 ⬜ | `doc/to-do/06-bind-localhost-ufw.md` |
| TODO-07 | **H3** — no rate limiting. Add per-IP + per-org limits on `/api/messages`, `/api/auth/login`, `/api/livechat/webhook/*` (Caddy `rate_limit` or app middleware). | 🔴 ⬜ | `doc/to-do/07-rate-limiting.md` |
| TODO-08 | **M3** — no observability. Add health alerting + error tracking (e.g. Sentry); review restart policy. | 🔴 ⬜ | `doc/to-do/08-observability.md` |

### Phase 3 — Correctness & hardening hygiene

| ID | Item (audit ref) | Status | Guide |
|---|---|---|---|
| TODO-09 | **M4** — schema is managed via `prisma db push` (no migration history). Adopt `prisma migrate` for prod to avoid silent data loss on drift. | 🔴 ⬜ | `doc/to-do/09-prisma-migrate.md` |
| TODO-10 | **M5** — API keys use `randomUUID()` (122-bit). Prefer `randomBytes(32).toString('base64url')` in `generateApiKey()`. | 🔴 ⬜ | `doc/to-do/10-apikey-entropy.md` |
| TODO-11 | **M6** — confirm which cert actually serves (`demo.anytrans.ai` LE vs manual RapidSSL wildcard, expires 2026-07-22) + auto-renew + expiry monitor. | 🔴 ⬜ | `doc/to-do/11-cert-clarity-monitor.md` |
| TODO-12 | **L2** — `npm ci` reported 2 vulnerabilities (1 high). Run `npm audit`, patch. | 🔴 ⬜ | `doc/to-do/12-npm-audit.md` |
| TODO-13 | **L3** — DB password `Intera2026Pg!` is weak/known. Rotate after key-only SSH (TODO-02) lands. | 🔴 ⬜ | `doc/to-do/13-rotate-db-password.md` |

### Phase 4 — Product feature

| ID | Item | Status | Guide |
|---|---|---|---|
| TODO-14 | **C2 runtime agent routing** — admin/management UI for multi-agent-per-org already shipped (`76b6821`). Runtime routing (Bearer key → specific `AgentConfig`) is still deferred. See plan: `doc/plans/2026-06-01-multi-agent-multi-org-plan.md`. | 🔴 ⬜ | `doc/to-do/14-runtime-agent-routing.md` |

### Phase 5 — Code quality & docs (non-blocking, do opportunistically)

| ID | Item | Status | Guide |
|---|---|---|---|
| TODO-15 | **README is stale** — references deleted `apps/chat/.env.example` and the two-app layout. Fix to match `apps/console`-only reality. | 🔴 ⬜ | `doc/to-do/15-fix-readme.md` |
| TODO-16 | **Verify two-panel login on prod** — UI commits `6ed22e1`/`d2def3a` landed after the last prod verification. Smoke-test on `demo.anytrans.ai` with screenshots; confirm wordmark color on the dark panel. | ✅ Verified on prod at `d2def3a` (2026-06-02 12:02 CST). Wordmark reads white on dark, orbs drift, headline italic emphasis correct, status pill shows "All systems operational" (db connected). C1 regression re-run after deploy: forged cookie still 401, `/admin` 307, `/api/health` 200. | n/a — verified inline |
| TODO-17 | **`loop.ts` decomposition** — `lib/agent/loop.ts` is ~2,160 lines; `app/api/messages/route.ts` ~1,040; `app/admin/agent/page.tsx` ~1,076. Carve out cohesive units behind the existing ports. Only with a clear seam + tests; no big-bang rewrite. | 🔴 ⬜ | `doc/to-do/17-decompose-loop.md` |
| TODO-18 | **Logging discipline** — ~91 raw `console.*` calls in `lib/` and ~137 `: any`/`as any`. Introduce a thin logger + tighten the worst types where it touches auth/tenancy. Low priority. | 🔴 ⬜ | `doc/to-do/18-logging-and-types.md` |

---

## Known follow-ups (carried context, not yet tasks)

- **Server working tree shows as "dirty"** — the post-receive hook checks files out without updating HEAD, so `git status` on the server shows phantom modifications. Build uses files-on-disk, so it works; cosmetic only. To clean: `git update-ref HEAD <sha> && git reset --mixed`, or accept it.
- **`doc/` is cluttered** — `needs/`, `salvage/`, `spec/`, `what's done/`, plus loose `.DS_Store` files. Consider a tidy-up pass, but not urgent.

---

## What is done well (don't "fix" these)

- `/api/messages` runtime auth: orgId from Bearer key (sha256 lookup, no plaintext stored), body `orgId` rejected on mismatch.
- Playground dry-run isolation: 3 DB-write bypasses fixed, e2e guard test with red→green proof.
- API keys stored as sha256 hashes, revocable, `lastUsedAt` tracked.
- Postgres bound to localhost only; per-org LiveChat `webhookSecret` validated timing-safe.
- Signed session: forged/tampered/expired tokens all rejected (7 green tests in `lib/__tests__/session.test.ts`).

---

## C1 verification recipe (re-run after each deploy that touches auth)

```bash
# Forged legacy cookie must now be rejected:
curl -s -o /dev/null -w '%{http_code}' https://demo.anytrans.ai/api/admin/api-keys \
  -H 'Cookie: intera_auth=1; intera_org_id=default'        # expect 401

curl -s -o /dev/null -w '%{http_code}' https://demo.anytrans.ai/admin   # expect 307 → /login?next=/admin
curl -s https://demo.anytrans.ai/api/health                            # expect {"status":"ok","db":"connected"}

# Server posture checks (Phase 1/2):
ssh ubuntu@43.134.51.138 'ls /etc/cron.daily/intera-pgbackup; sudo ufw status; sudo ss -tlnp | grep 3000'
```

---

*Backlog derived from the 2026-06-02 production-readiness audit (now folded into this file) + an independent source read at `d2def3a`. Audit MEDIUM items M1/M2/M5 re-verified as still open in source on 2026-06-02.*

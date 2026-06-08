> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Google Invite Flow — Hardening Plan

> **For the coding agent team:** This is an architect hand-off. Dispatch one sub-agent per task, review between tasks. Steps use checkbox (`- [ ]`) syntax. **Architect wrote the plan, not the code** — implement the changes yourselves following the precise direction + acceptance criteria below.

**Goal:** Close the remaining correctness/coverage gaps in the Google-SSO + invite-only flow so that an invited user (email-bound *and* share-link) is provably created in the DB under the right org with the right role, and can access the platform.

**Architecture:** The invite redemption logic now lives in two parallel surfaces — `POST /api/auth/register` (password) and `GET /api/auth/google/callback` (SSO). They must agree on invite semantics. This plan (a) normalizes email at every write/compare boundary, (b) fixes a stale-read in the SSO sweep, (c) adds the missing regression tests for the share-link-via-Google path, and (d) stands up a *production-free* local verification harness so acceptance can be proven without touching the live DB.

**Tech stack:** Next.js 15 (App Router) · Prisma + PostgreSQL · zod · vitest · Web Crypto session (`signSession`/HS256).

---

## ⚠️ Coordination note (read before starting)

At authoring time (2026-06-04 ~21:00) the working tree is **heavily uncommitted-WIP**:

- `apps/console/app/api/auth/google/callback/route.ts` — **dirty**, mid-migration to `defineRoute` (token→share-link redemption already added; ~355 lines).
- `apps/console/app/api/auth/google/__tests__/google-sso-invite-isolation.test.ts` — **dirty**, harness being adapted to `defineRoute`.
- `apps/console/app/api/auth/register/route.ts` — **dirty**.
- `apps/console/app/api/admin/invitations/route.ts` — **clean (= HEAD)**.

**Therefore:**
1. **Land + commit the in-flight callback/register/test WIP first.** Do not start Task 2/Task 3 on top of an uncommitted moving target.
2. **Task 1 is independent** (touches the clean `invitations/route.ts` + a shared schema) — it can start immediately.
3. Re-confirm line numbers against the committed state before editing — the numbers below are indicative, behavior is the contract.

---

## Current state (verified by architect, 2026-06-04)

| Area | State |
|---|---|
| Email-bound invite → Google SSO → new user | ✅ Correct in code (callback matches pending invite by email, txn creates User+Membership, marks accepted, signs session, redirects `/ops/guide`). |
| Share-link (email=null) → Google SSO → new user | ✅ **Now implemented** in WIP (`invitation.findUnique({where:{token}})` branch, `maxUses`/`useCount` enforced). **Was fully broken before today; still has zero test coverage.** |
| Platform access after login | ✅ `middleware.ts` verifies signed `intera_session`; role enforced at API via `requireRole`. |
| **Live end-to-end receipt** | ❌ Not obtained — dev server 500ing mid-edit, DB unreachable & points at **production**, Google consent not automatable. Task 0 below removes the prod dependency so this becomes provable. |

---

## Task 0 — Production-free local verification harness (foundation)

**Why:** Acceptance for every task below requires *running* the flow. Local dev currently points `DATABASE_URL` at the **production** Postgres via an SSH tunnel — verification must never write test users there. Stand up a throwaway local DB.

**Files:**
- Use existing: `docker-compose.yml` (already provides Postgres:16 per G8).
- Create: `apps/console/.env.test.local` (git-ignored) — local-only overrides.
- Create: `scripts/seed-invite-fixtures.ts` — seeds the fixtures the acceptance tests need.

- [ ] **Step 1 — Bring up a local Postgres (not prod).**
  Run: `docker compose up -d` → confirm container healthy.
  Set a **local-only** `DATABASE_URL` (e.g. `postgresql://postgres:postgres@localhost:5432/intera_local`) in `apps/console/.env.test.local`. **Do not edit `.env.local`** (it holds the prod tunnel URL).

- [ ] **Step 2 — Push schema + add the missing `SESSION_SECRET`.**
  Run: `DATABASE_URL=… npm run db:push`.
  Add `SESSION_SECRET=$(openssl rand -hex 32)` to `apps/console/.env.test.local` (also add it to `.env.example` guidance — the running prod server has one but a cold `next dev` from repo state 500s all auth without it).

- [ ] **Step 3 — Seed fixtures.** `scripts/seed-invite-fixtures.ts` must create:
  - Org `acme` (+ an `owner` User + Membership so `invitedBy` resolves).
  - Email-bound pending Invitation: `email="invitee@example.com"`, `role="operator"`, fresh `token`, `expiresAt=+7d`.
  - Share-link pending Invitation: `email=null`, `role="viewer"`, `maxUses=2`, `useCount=0`, fresh `token`, `expiresAt=+7d`.
  Run it; print the two invite URLs (`/login?invite=<token>`).

- [ ] **Step 4 — Prove the harness is live.**
  Run the console against the local env; `curl /api/health` → expect `{"status":"ok","db":"connected"}`.
  **Acceptance:** health ok against local DB; both invitation rows present (`SELECT email, role, token FROM invitations`).

---

## Task 1 — Normalize invite email at every boundary (P1, root-cause)

**Problem:** `createInviteSchema` stores the invited email **raw**, but every reader lowercases:
- `apps/console/lib/auth/google.ts:343` — Google email `.toLowerCase()`.
- `apps/console/app/api/auth/register/route.ts:13` and `login/route.ts:13` — `.trim().toLowerCase()`.

So inviting `John.Doe@Acme.com` (common for corporate Workspace) → user signs in as `john.doe@acme.com` → **both** redemption paths fail with misleading errors (`No invitation found` / `Email does not match`). Case also defeats `@@unique([email, orgId])` (`a@x` vs `A@x` counted distinct).

**Root-cause fix (not a one-spot patch):** define **one** shared normalized-email zod schema and reuse it at *every* invite write/compare site.

**Files:**
- Create/extend a shared schema home — prefer `packages/shared/contracts/` (where the per-domain zod schemas already live; confirm exact module). Export e.g. `emailNormalized = z.string().email().transform(e => e.trim().toLowerCase())`.
- Modify: `apps/console/app/api/admin/invitations/route.ts` — `createInviteSchema.email` → use `emailNormalized.optional()`; also lowercase in the duplicate-member check (`where: { user: { email: … } }`) and the existing-pending-invite check.
- Modify: `apps/console/app/api/auth/register/route.ts` + `login/route.ts` — replace the inline `.trim().toLowerCase()` with the shared schema (DRY; one source of truth).

- [ ] **Step 1 — Write the failing test.** Add to the invitations route test (or a new `invitations-email-normalization.test.ts`): invite `"Mixed@Case.COM"` → assert the persisted `invitation.email === "mixed@case.com"`. Add a second: creating an invite for `"a@x.com"` then `"A@x.com"` in the same org → second hits the `ConflictError`/unique path (not two rows).
- [ ] **Step 2 — Run it, confirm it fails** against current `createInviteSchema`.
- [ ] **Step 3 — Implement** the shared `emailNormalized` + wire it into the three routes per Files above.
- [ ] **Step 4 — Run tests green.**
- [ ] **Step 5 — E2E acceptance (Task 0 harness):** seed an invite with a mixed-case email, redeem via `POST /api/auth/register` (lowercased email + token) → 200, User+Membership created. Then via Google path (manual login with that Google account) → lands `/ops/guide`.
- [ ] **Step 6 — Commit:** `fix(invite): normalize invite email to lowercase at all boundaries`.

**Acceptance:** mixed-case invited email redeems on **both** register and Google paths; no case-duplicate invitations possible.

---

## Task 2 — Fix stale-membership read after invite sweep (P3, correctness)

**Problem:** In the SSO callback's existing-user branches (googleSub match *and* email match), `sweepPendingInvites()` creates missing Memberships, but `primary` is then chosen from `user.memberships` that was `include`d **before** the sweep. An existing User with **0 memberships + 1 pending invite** is wrongly rejected with `No organization membership` even though the sweep just created one.

**Files:**
- Modify: `apps/console/app/api/auth/google/callback/route.ts` (the two `if (user) { … }` branches — coordinate with the committed defineRoute WIP).

**Fix direction (pick one, prefer the first for clarity):**
- Have `sweepPendingInvites()` **return** the memberships it ensured, and merge/re-read before computing `primary`; **or**
- After `await sweepPendingInvites(...)`, **re-fetch** `prisma.membership.findMany({ where: { userId } })` and compute `primary`/`memberships.length` from the fresh list.

- [ ] **Step 1 — Write the failing test** (in the isolation test, after Task 3's mock upgrade or alongside): existing User by email, `memberships: []`, one pending email-bound invite → expect 307 → `/ops/guide`, session issued with the invited org+role, Membership now exists. Add the googleSub-match variant too.
- [ ] **Step 2 — Run it, confirm it fails** (currently redirects to `/login?error=No organization membership`).
- [ ] **Step 3 — Implement** the re-read/return fix in both branches.
- [ ] **Step 4 — Run tests green** (incl. the existing 9 scenarios — no regressions).
- [ ] **Step 5 — Commit:** `fix(oauth): use post-sweep memberships when selecting primary org`.

**Acceptance:** existing-user-with-only-a-pending-invite logs in successfully via both googleSub and email match.

---

## Task 3 — Cover the share-link-via-Google path (P2, regression safety)

**Problem:** `google-sso-invite-isolation.test.ts` mocks `invitation` with `findMany`/`findFirst`/`update` only — **no `findUnique`**, and **no share-link scenario**. The new token-redemption branch (the fix that closed the critical gap) ships with **zero coverage** → green suite is false confidence.

**Files:**
- Modify: `apps/console/app/api/auth/google/__tests__/google-sso-invite-isolation.test.ts` — add `invitation.findUnique` to the prisma mock (match `where:{token}`); drive `stateInviteToken` by making `getCsrfStateCookie` return `"<state>:<token>"`.

**Scenarios to add (given → when → then):**
- [ ] **S8 — share link, new user:** invitation `{email:null, role:"viewer", maxUses:2, useCount:0, token:"share-1"}`, CSRF cookie `valid-csrf-state:share-1`, claims = brand-new email → **then** User+Membership(viewer, org) created, `useCount→1`, state stays `pending`, session issued, redirect `/ops/guide`.
- [ ] **S9 — share link at max uses:** same but `useCount=2, maxUses=2` → **then** error redirect `…maximum number of uses`, no User created, no session.
- [ ] **S10 — share link last use flips state:** `useCount=1, maxUses=2` → after redemption `useCount→2`, state→`accepted`.
- [ ] **S11 — email-bound invite reached by token, wrong email:** invitation `{email:"a@x.com", token:"e-1"}`, CSRF `state:e-1`, claims email `b@x.com`, no other invite for `b@x.com` → **then** error redirect `Email does not match…`, no User created.
- [ ] **Step — Run keyless bar green:** `env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test` → all pass (existing 9 + S8–S11).
- [ ] **Commit:** `test(oauth): cover share-link + token-bound Google invite redemption`.

**Acceptance:** S8–S11 green; total Google-SSO scenarios ≥ 13; keyless `npm test` stays green.

---

## Final verification (run after all tasks land)

```bash
# 1. Static + unit (keyless bar — the handoff's standard)
npx tsc --noEmit -p apps/console/tsconfig.json
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test

# 2. Real end-to-end on the Task-0 LOCAL harness (never prod)
#    a) password path — fully automatable, proves invite→user→membership→session:
curl -i -X POST localhost:3001/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"invitee@example.com","password":"hunter2pw","token":"<email-invite-token>"}'
#    expect 200 + Set-Cookie intera_session; then verify in DB:
#    SELECT u.email, m.role, m.org_id FROM users u JOIN memberships m ON m.user_id=u.id;
#    b) Google path — one MANUAL consent with an invited Google account → lands /ops/guide,
#       row appears under org `acme` with the invited role.
```

**Receipts to capture for the architect review:** keyless `npm test` summary; the `register` 200 + the `SELECT` showing the new user+membership; (Google path) the `/ops/guide` redirect + DB row.

---

## Self-review (architect)

- **Spec coverage:** P1 email-norm → Task 1; P2 test gap → Task 3; P3 stale sweep → Task 2; verification-without-prod → Task 0. ✅
- **Out of scope (logged, not fixed here):** middleware does not role-gate *page* routes (API does) — defense-in-depth, separate ticket. Share-link + email-bound invites combined in one request only grants the share-link org (early return) — edge case, separate ticket if needed.
- **Ordering:** Task 0 → Task 1 (independent) → land WIP → Task 2 + Task 3. Frequent commits per task.

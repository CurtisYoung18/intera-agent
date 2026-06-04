# Enterprise-SaaS Readiness — Architecture Program (G1–G10)

**Author:** Architect | **Date:** 2026-06-04 | **Status:** backlog — **Wave 1 ready to execute**
**Source:** architect review of console↔backend cooperation (long-term, non-patch).

> This is the *steps* doc for the program. Macro status lives in
> [`MASTER_BUILD_HANDOFF.md`](../handoffs/MASTER_BUILD_HANDOFF.md). Stable context in
> [`GENERIC_HANDOFF.md`](../handoffs/GENERIC_HANDOFF.md). When a wave ships, move the
> shipped portion of this file to [`doc/what's done/`](../what's%20done/) and flip status in the master handoff.

---

## 0. Verdict (why this program exists)

Functionally Intera is a working product. Against an **enterprise commercial-SaaS engineering bar**, it is today a
**single-process, contract-unvalidated, tenant-isolation-by-convention, identity-less, unobservable** system. The
bottleneck is **not a missing feature** — it is that **console and backend lack a few shared *seams***, so every page and
every route hand-writes what should be written once (data-fetching, input validation, tenant scoping, error envelope,
cache invalidation). That duplication is the real drag at scale.

Evidence (code-verified 2026-06-04):

| Symptom | Evidence |
|---|---|
| No FE data layer | 117 raw `fetch()` in tsx; **0** client/SWR/React-Query; `/api/admin/agent-configs` independently fetched in **13** files; `lib/agent/agent-context.tsx:48` `catch{/*ignore*/}` silent-swallow |
| No boundary validation | `zod` is a dep + used in agent tools, but **0** API routes validate input; `app/api/admin/skills/route.ts:77` reads `body.*` raw |
| Stringly-typed errors | `{error:'Internal error'}` in **29** routes; FE cannot branch on error type |
| Tenant isolation by convention | manual `where:{orgId}` ×51; `config.orgId!==orgId` hand-checks; **already leaked** — `GENERIC_HANDOFF.md` gotcha #7 (`/api/livechat/config` reads `orgId` from query param, outside the gate); `orgId @default("default")` across schema |
| No identity / RBAC / audit | **no** `User`/`Membership`/`Role`/`AuditLog` model; all staff share one `STAFF_PASSWORD` |
| Single-process runtime | `lib/rate-limit.ts` in-memory (self-admits "replace with Redis"); `config-cache` in-process Map + `/api/admin/config-changed` busts it, called from **6** FE files; livechat session-store in-process |
| Fire-and-forget async | `lib/agent/orchestrator.ts:429` background dispatch `.catch(console.error)` — process death = lost work |
| Unobservable ops layer | `lib/logger.ts` = console.* wrapper, "future: external service"; **0** Sentry/OTel/metrics deps; no request-id correlation |
| Data model debt | JSON-in-`String` columns on a Postgres prod (rare `Json?`); no optimistic-concurrency on `AgentConfig` edits; "exactly one active version… enforced in app code" (`schema.prisma:63`, not DB) |
| Dev/prod DB fork | `scripts/deploy.sh:39` `sed`-rewrites schema `sqlite→postgresql` at deploy; local SQLite, prod Postgres; `db-integration.test.ts` fails locally by design |
| Contract surface untested | **1 of 51** routes has a route-level test (`app/api/chats/[chatId]/__tests__/compact-route.test.ts`) |

---

## 1. The ten gaps (G1–G10)

Vocabulary: **seam** = where an interface lives (behaviour alterable without editing in place); **deep** = high leverage
behind a small interface; **deletion test** = if we delete this, does complexity *concentrate* (earning its keep) or
just move?

| ID | Gap | Seam introduced | Deletion test |
|---|---|---|---|
| **G1** | FE↔BE contract: typed client + zod boundary validation + uniform error envelope | `defineRoute()` (server) + `apiClient`/`useApi` (client) over a shared `contracts/` zod source | delete → validation+error+fetch logic reappears in ~130 places |
| **G2** | Tenant isolation by structure, not convention | `repoForOrg(orgId)` (app-layer) + Postgres **RLS** (DB-layer, Wave 2) | delete → cross-tenant leak risk reappears in 51 routes |
| **G3** | Real identity, RBAC, audit + **Google SSO + invite-only** | `User`/`Membership(role)`/`Invitation`/`AuditLog`; Google login (auth only); invite-based membership (§3.5) | delete → "who changed the active config?" is unanswerable; no controlled onboarding |
| **G4** | Stateless runtime (horizontal scale / HA) | Redis-backed rate-limit/session/config-cache + pub/sub invalidation | delete → cannot run ≥2 instances |
| **G5** | Observability | structured logger w/ request-id·org-id·case-id correlation + error tracking + metrics; reuse existing `ActionTrace` | delete → "ssh + journalctl" is the only tool |
| **G6** | Durable async | generalize `LiveChatPendingEvent` into a job-queue seam | delete → background work lost on restart |
| **G7** | Data-model correctness | `jsonb` + zod accessors; optimistic-concurrency on config edits; DB-enforced single-active (partial unique index) | delete → silent-overwrite + dirty-JSON bugs reappear |
| **G8** | Dev/prod parity | local Postgres (docker compose); one schema; kill `sed` | delete → "green local / red prod" |
| **G9** | Contract-surface tests | route-level tests driving real handlers | delete → the most important seam is unguarded |
| **G10** | `loop.ts` 2160-line monolith (TODO-17) | decompose **after** G1/G7 seams are correct | — |

---

## 2. Sequencing (dependency-ordered — do NOT reorder)

```
WAVE 1 (this spec, fully detailed below) — the foundational seams, each route/page touched ONCE:
  G1 contract seam  +  G2 app-layer tenant scoping  +  G3 identity/RBAC/audit  +  G8 local-PG parity  +  G9 seed tests
  → Task 0 (serial foundation) → 5 disjoint parallel lanes → architect review

WAVE 2 (detail after Wave 1 review):
  G2-RLS (DB defense-in-depth, needs G8)  ·  G5 observability (reuse ActionTrace correlation)  ·  G9 expand coverage

WAVE 3:
  G4 Redis stateless runtime  ·  G6 unified job queue  ·  G7 jsonb + optimistic-concurrency + partial-unique-index
  ·  G10 loop.ts decomposition (now that seams are correct)
```

**Why this order:** G1/G2/G8 are prerequisite seams; G3 is an independent identity vertical that can run in parallel
because it owns disjoint files (auth/session/login/middleware/schema-User). G7/G10 come last so we *cut modules along
correct seams* rather than re-cutting later — consistent with "long-term clean, not minimal patches."

---

## 3. WAVE 1 — detailed spec

**Goal:** every API route and its calling page migrates **once** to: typed+validated contract (G1), structural tenant
scoping (G2 app-layer), per-user identity+audit (G3). Local Postgres replaces the sed hack (G8). The riskiest seams ship
red→green guard tests (G9 seed).

### 3.1 Task 0 — Foundation (SERIAL: lands + is reviewed before any lane fans out)

Owner: lead agent (no sub-agent parallelism here — this is the shared contract every lane plugs into).

Create:

1. `packages/shared/contracts/` — the single contract source.
   - `envelope.ts` — `ApiOk<T> = {ok:true,data:T}`; `ApiErr = {ok:false,error:{code:ErrorCode,message:string,fields?:Record<string,string>}}`; `ErrorCode` union (`unauthorized|forbidden|not_found|conflict|validation|rate_limited|internal`).
   - one zod file **per domain** (`agent-configs.ts`, `skills.ts`, `cases.ts`, `livechat.ts`, …) exporting `request`/`response` schemas. **Per-domain files so lanes never edit the same contract file.**
2. `apps/console/lib/api/define-route.ts` — server wrapper. Pipeline:
   `verify session → resolve {orgId,userId,role} → zod-parse input (→ 400 validation envelope) → build repoForOrg(orgId) → handler({input, session, repo, audit, log}) → serialize ApiOk | map throw→ApiErr+status`.
   Must expose to handlers: `repo` (G2), `audit(event)` (G3), `log` (G5 seed: request-id·org-id·user-id correlation).
   Centralized `error→status` map (replaces 29 ad-hoc `{error:'Internal error'}`).
3. `apps/console/lib/db/repo-for-org.ts` — **the tenant seam (G2 app-layer).** Prisma `$extends` (or typed repo) that
   injects `orgId` into every `where`/`create` for org-scoped models. Org-scoped `prisma.*` raw access becomes
   lint-forbidden in route/handler code. Remove `@default("default")` from schema in Wave 2 G7 (note here; not now — schema is Lane E's in W1 only for the User additions).
4. `apps/console/lib/api/client.ts` — typed `apiClient` over the contracts (infers response type from the zod schema);
   normalizes `ApiErr` into a thrown typed error; plus a thin `useApi(key, fetcher)` (SWR-style: cache + dedup +
   revalidate) so 13×-duplicated fetches collapse to one cache key.
5. **G8 decision** (Lane E executes, but Task 0 records the approach): add `docker-compose.yml` with a `postgres:16`
   service; local `DATABASE_URL=postgresql://intera:intera@localhost:5432/intera`; schema `provider` stays
   `postgresql` permanently; delete `scripts/deploy.sh:38-39` sed lines.
6. **Audit hook interface** (G3): define `AuditEvent {actorUserId, orgId, action, target, before?, after?}` in
   `packages/shared/contracts/audit.ts` so Lane D's `AuditLog` writer and `defineRoute`'s `audit()` agree.

**Task 0 acceptance:** `tsc` 0 errors; one **pilot route fully migrated** end-to-end (recommend `app/api/admin/skills/route.ts`
+ its page) proving the whole pipeline (validation 400, envelope, repoForOrg scoping, audit write, apiClient consumption);
route-level test for the pilot green. **Architect reviews Task 0 before fan-out.**

### 3.2 Parallel lanes (after Task 0 green — disjoint file ownership, zero merge conflict)

| Lane | Owns (routes + pages) | Job |
|---|---|---|
| **A — config domain** | routes: `agent-configs*`, `skills*`, `policies*`, `case-types*`, `models`, `knowledge*`, `config-changed`, `playground/run`; pages: `agent`, `model`, `memory`, `tools`, `guardrails`, `case-types`, `knowledge`, `playground` | migrate to defineRoute + repoForOrg + apiClient; per-domain contract files |
| **B — ops domain** | routes: `cases*`, `chats*`, `users*`, `ops/dashboard`; pages: `ops/*` | same migration |
| **C — channels domain** | routes: `livechat/*`, `api-keys*`, `customers`, `organizations`; pages: `channels/*`, `api-keys` | same migration **+ fix gotcha #7**: `/api/livechat/config` + `/api/livechat/groups` resolve `orgId` from session for authenticated callers (keep query-param fallback ONLY for the unauthenticated widget/webhook path, behind an explicit comment). **Ships red→green cross-org guard test.** Does **NOT** touch auth/session/login (Lane D owns those). |
| **D — identity (G3)** | `schema.prisma` (add `User`/`Membership`/`Invitation`/`AuditLog`), `lib/session.ts`, `lib/auth.ts`, `middleware.ts`, `app/api/auth/*` (incl. `google/*`), `app/api/admin/invitations/*`, `app/login/page.tsx`, `app/admin/members/page.tsx`, `AuditLog` writer wired into `define-route.ts`'s `audit()` | **Two sub-phases — D1 then D2 (D2 depends on D1):** **D1** per-user login + RBAC + audit: session carries `{userId, orgId, role}`; roles `owner/admin/operator/viewer`; `AuditLog` row on every mutation; keep `STAFF_PASSWORD` as **break-glass owner** only. **D2** Google SSO (Proposal A — auth only, session layer unchanged) + invite-only membership (Path 1 — no public signup). New migration (do **not** rename applied ones — §3.4). Google needs a GCP OAuth client (ops prereq). **Ships red→green RBAC + audit + invite-isolation guard tests.** Full design: **§3.5**. |
| **E — parity + tests (G8/G9)** | `docker-compose.yml`, `scripts/deploy.sh` (kill sed), `lib/livechat/__tests__/integration/db-integration.test.ts` (un-break), new route-level tests | stand up local PG; remove sed; un-break the PG integration test; add route-level tests for the highest-risk migrated endpoints as A/B/C land (coordinate). Add a **migration prefix-collision guard** (see §3.4). |

**Conflict rules (must hold):**
- Each lane edits only its listed files. Route groups are disjoint; pages map 1:1 to route groups.
- `schema.prisma` is edited **only by Lane D** in Wave 1 (User additions). Lane E does **not** edit schema.prisma.
- `scripts/deploy.sh` edited **only by Lane E**. `define-route.ts`/`repo-for-org.ts`/`client.ts`/`envelope.ts` created in Task 0, **read-only** to lanes (lanes only *add* per-domain contract files).
- Use the team's git-worktree-per-agent isolation (already in `.claude/worktrees/`).

### 3.3 Verification gates (per lane — the team's "receipt" discipline)

Each lane's receipt MUST include:
```
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
npm test                                          # all green (db-integration now runs against local PG)
npm run build:console                             # success
```
- list of changed files;
- UI lanes (A/B/C/D pages): browser screenshots of each migrated page still working (loading + error + success states);
- **safety lanes (C gotcha#7, D RBAC/audit): paste the red→green guard-test output** — per `GENERIC_HANDOFF.md` §0.4, seam/mock tests do NOT count; drive the real route.

### 3.4 Migration-collision correction (verified 2026-06-04 — supersedes earlier handoff claims)

- Disk truth: **two** dirs share prefix `20260603000008`: `…_add_capability_bindings` and `…_set_use_legacy_case_prompt_default`. The handoff also lists `20260603000008_remove_routing_table` — **that dir does not exist on disk** (handoff inaccuracy; fix the handoff).
- **Do NOT rename the two applied migrations.** They are already applied in prod; renaming desyncs prod's `_prisma_migrations` and triggers re-run. They touch independent columns (`capabilityBindings` vs `useLegacyCasePrompt` default) → order-independent → the collision is **benign in practice**.
- Action (Lane E): leave applied migrations as-is; add a **guard** (script or test) that fails CI if two migration dirs share a numeric prefix going forward; correct the master handoff's migration list.

---

## 3.5 Identity & Access design — Google SSO + invite-only (Lane D / G3)

Architect-endorsed from the user's Proposal A + Path 1. **Both are the B2B-SaaS standard** and slot onto G3 without touching
the session / middleware / `defineRoute` seams — OAuth is *authentication* (prove identity), the existing `intera_session`
cookie remains the *authorization* context (carries `{userId, orgId, role}`). The callback simply issues that same cookie.

### Schema additions (D1)

```prisma
model User {
  id         String   @id @default(cuid())
  email      String   @unique          // for invite-matching + display
  googleSub  String?  @unique          // Google `sub` — the DURABLE join key (emails can change/reassign)
  name       String?
  avatarUrl  String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@map("users")
}

model Membership {
  id        String   @id @default(cuid())
  userId    String
  orgId     String   @map("org_id")
  role      String                       // owner | admin | operator | viewer
  createdAt DateTime @default(now())
  @@unique([userId, orgId])              // one membership per (user, org); N:N overall → multi-org login
  @@index([orgId])
  @@map("memberships")
}

model Invitation {
  id              String    @id @default(cuid())
  orgId           String    @map("org_id")
  email           String
  role            String
  token           String    @unique      // signed; for accept-link (email send optional)
  invitedByUserId String
  status          String    @default("pending") // pending | accepted | revoked | expired
  expiresAt       DateTime
  acceptedAt      DateTime?
  createdAt       DateTime  @default(now())
  @@index([email])
  @@index([orgId, status])
  @@map("invitations")
}

model AuditLog {
  id          String   @id @default(cuid())
  orgId       String   @map("org_id")
  actorUserId String
  action      String                      // e.g. "agentConfig.activate", "invitation.create"
  target      String
  before      Json?
  after       Json?
  createdAt   DateTime @default(now())
  @@index([orgId, createdAt])
  @@map("audit_logs")
}
```
Keep `Organization.password` for the **break-glass owner** login (bootstrap + Google-outage). Google is primary for everyone else.

### Login flow (D2 — Proposal A, session layer unchanged)

```
GET /api/auth/google           → redirect to Google: scope=openid email profile, signed short-lived `state` (CSRF), `nonce`
GET /api/auth/google/callback  → 1. validate `state`  (reject mismatch — CSRF guard)
                                 2. exchange code → tokens
                                 3. VERIFY id_token: Google JWKS signature, aud=CLIENT_ID, iss, exp, nonce,
                                    and **email_verified === true** (reject unverified)
                                 4. extract { sub, email }
                                 5. User by googleSub=sub?
                                      ├─ yes → load Memberships → issue intera_session{userId,orgId,role}
                                      │        (>1 org → org-picker, reuse existing switch-org)
                                      └─ no  → `state` has inviteToken? → GET /api/invitations/:token → validate
                                               │   ├─ valid → create User(bind sub) + Membership(role) + mark accepted + audit → issue session
                                               │   └─ invalid/expired → fall through to email-match
                                               └─ no token → pending Invitation by email match? → same accept logic or DENY
```
`lib/session.ts` / `middleware.ts` / `defineRoute` **unchanged** — they already consume `{userId?, orgId, role}` (the `userId?`
slot was pre-wired in Task 0). Only a new callback route + a "Sign in with Google" button on `app/login/page.tsx`.

**Avatar:** Google `id_token.picture` is stored as `User.avatarUrl` at account creation + refreshed on subsequent logins. Scope `profile` already requests it.

### Invite flow (D2 — Path 1, no public signup)

- `POST /api/admin/invitations` (`defineRoute`, **requires admin|owner on that org**) → create `Invitation` (pending, token,
  `expiresAt` ~7d) + audit. Returns the token; admin can copy the invite link (`https://demo.anytrans.ai/invite/<token>`).
- **Invite link:** `app/invite/[token]/page.tsx` — validates token (unexpired, not revoked/accepted) → shows "You've been
  invited" + "Sign in with Google" button. Clicking it passes `inviteToken` in the OAuth `state` param. Callback matches by
  token (not email) for exact invite binding. **No email infra needed** — admin shares the link via Slack/WeChat/email externally.
- **Fallback:** match-on-login (email-match) still works — if the invitee goes directly to `/login` without the link, callback
  falls through to email-based matching against pending invitations.
- `app/admin/members/page.tsx` — active members (Membership + role editor) **and** pending invitations with **copy-link** button + revoke/resend.
- **Avatar display:** `User.avatarUrl` shown in: (1) sidebar — next to user name with org/role summary, (2) `/admin/members` table — per-member row, (3) login flow — shown after Google sign-in as confirmation of correct account. Missing avatar → initials fallback (first letter of email, e.g. "C" for curtis@...).
- **Avatar display:** `User.avatarUrl` shown in: (1) sidebar — next to user name with org/role summary, (2) `/admin/members` table — per-member row, (3) login flow — shown after Google sign-in as confirmation of correct account. Missing avatar → initials fallback (first letter of email, e.g. "C" for curtis@...).
- No public registration route exists. First access is always Google-login-against-a-pending-invitation.

### Edge cases (must be specified in tests)

- Inviter must hold `admin|owner` on the target org (RBAC at the route).
- Invite to an already-member email → `409 conflict`.
- Invitation expiry → `expired`; resend issues a fresh token.
- Revoke a pending invitation.
- **Multi-org:** one Google account → multiple Memberships → org-picker on login (maps to existing switch-org). This *is* the
  deferred "multi-org login/membership" (old C3/C4).
- **Last-owner protection:** cannot remove/demote the last `owner` of an org.
- `email_verified !== true` → reject.
- **Invite-link token consumed twice:** a used/accepted token rejects the second visitor.
- **Invite-link invalid/expired:** invite page shows a clear error (not a generic 404) with "ask your admin for a new invite."
- One admin can share the invite link to the wrong person → invitee's Google email must match `Invitation.email` after token
  validation (two-factor match: token + email, not token alone).

- **Avatar missing:** some Google accounts have no photo → `User.avatarUrl` stays `null`; UI falls back to a colored-initials circle (CSS, no external dep).

- **Invite-isolation guard test (red→green):** a Google identity with NO pending invitation and NO membership is denied; an
  invited identity lands in exactly the invited org+role and sees no other org's data.

### New env (add to `.env.example`)

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `INVITE_TOKEN_SECRET`. The GCP OAuth client (authorized
redirect URIs for localhost + `demo.anytrans.ai`) is an **ops prerequisite** the owner provisions before D2.

---

## 4. Disputes resolved (architect, approved by user 2026-06-04)

1. **C3/C4 (User table + login) un-deferred → G3, Wave 1.** Shared single `STAFF_PASSWORD` is an enterprise hard-blocker and the prerequisite for audit ("who changed what"). Was `MASTER_BUILD_HANDOFF.md` "Deferred — not needed for current phase"; now scheduled.
2. **M3 observability upgraded medium → Wave 2 must-do (G5).** A commercial SaaS cannot be unobservable; also the substrate for per-tenant usage metering (billing).
3. **Migration numbering** — see §3.4 (corrected to a safe guard + handoff fix, not a rename).
4. **schema `provider` / sed hack → G8, Wave 1.** Committed schema is `postgresql` while local needs SQLite via deploy-time `sed`; a fresh clone's `db:push` hits prod Postgres. Killed by local-PG parity.

---

## 5. WAVE 2 — detailed spec (ready after Wave 1 review, 2026-06-04)

**Scope:** G2-RLS (DB-layer tenant defense-in-depth) · G5 observability · G9 test-coverage expansion. Each route/page is
NOT re-touched — Wave 2 works *below* (DB) and *around* (logging/metrics) the Wave 1 seams.

### 5.1 Task 0 (W2) — shared plumbing (SERIAL, owns `define-route.ts`)

So Lanes R and O never both edit `define-route.ts`, all its changes land here first:
1. **Request correlation:** `defineRoute` generates `requestId = crypto.randomUUID()` per request, adds it to the `log`
   context (already carries orgId/userId), and sets it on the `x-request-id` response header.
2. **Org context propagation (the RLS hook):** wrap the handler in `prisma.$transaction(async (tx) => { … })` that first
   runs `SET LOCAL app.current_org_id = <session.orgId>`, and build `repoForOrg` over `tx`. **Also** push the orgId into
   an `AsyncLocalStorage` so non-defineRoute DB paths (agent runtime) can read it (see 5.2 risk).
3. Acceptance: `x-request-id` present on every response; a 500 logs with `{requestId, orgId, userId, route}`; the tx
   wrapper is a no-op for tenant behaviour until Lane R adds policies (so this step is safe to ship alone).

### 5.2 Lanes (parallel, disjoint files)

| Lane | Owns | Job |
|---|---|---|
| **R — RLS (G2 DB-layer)** | new migration(s), a global Prisma client extension, `repo-for-org.ts` (tx client), a DB-role doc | Postgres Row-Level Security as defense-in-depth (see design below). **Highest-risk lane — own review checkpoint.** |
| **O — Observability (G5)** | `lib/logger.ts`, `@sentry/nextjs` init, `lib/metrics.ts`, agent-trace correlation | structured JSON logs (prod) w/ requestId·orgId·userId; Sentry error capture (scrub PII); per-org **LLM token+cost** metric events (billing substrate); thread requestId → `ActionTrace` so HTTP-error → agent-run is one hop. |
| **T — Coverage (G9)** | `__tests__` only | route-level tests for ALL remaining mutating/tenant-sensitive routes; **real-DB** integration tests (PG is local now) for one route per domain; RLS defense-in-depth test (with Lane R); **finish S2: `skipIf(missing dependency)` on every external-key/DB e2e** so a keyless `npm test` is fully green. |

### 5.3 G2-RLS design (read before touching — this is the dangerous one)

**Goal:** even a `repo.raw` query, a future un-scoped query, or a SQL-injection that bypasses the app layer **cannot cross
tenants** — the database itself refuses.

**Mechanism:** `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` + `CREATE POLICY org_isolation ON <t> USING (org_id =
current_setting('app.current_org_id', true)) WITH CHECK (…)`, and every request sets `app.current_org_id` via `SET LOCAL`
inside a transaction (Task 0 W2). `SET LOCAL` is transaction-scoped → safe under PgBouncer transaction mode (Neon).

**Which tables:** the 14 org-scoped models in `repoForOrg` **+ `memberships`, `invitations`, `audit_logs`** (all org-keyed).
**NOT `users`** — a User spans multiple orgs (multi-org membership), so it is not org-scoped; gate user access by membership
instead. **NOT `organizations`** itself.

**⚠️ CRITICAL ROLLOUT RISK — do NOT enable RLS table-wide first.** Once a table has RLS, EVERY connection that reads it must
have `app.current_org_id` set, or the policy returns **zero rows**. The agent runtime (`loop.ts`, `/api/messages`,
orchestrator, livechat bridge) accesses these tables **outside `defineRoute`** — if RLS is on but those paths don't set the
GUC, **the bot silently reads nothing and breaks in production.** Therefore:
1. Set the GUC **globally**, not just in defineRoute: a Prisma Client `$extends` that reads orgId from `AsyncLocalStorage`
   (populated by defineRoute AND by the agent runtime's per-org entry points) and issues `SET LOCAL` on every transaction.
2. Roll out **one table at a time** behind the extension; after each, run the full suite + a manual agent smoke run.
3. Keep a privileged migration/seed role that is **not** subject to RLS; the app connects as an RLS-subject role.

**Acceptance (the proof that matters):** a red→green test that calls `repo.raw.skill.findMany({})` (NO `where`, app-layer
scoping deliberately bypassed) under org A's context and asserts it returns ONLY org A's rows. That proves the DB layer
defends independently of the app layer. Without this exact test, RLS is unverified.

**Sequencing:** Lane R lands its Prisma extension + GUC plumbing and proves the agent runtime still works **before** enabling
RLS on any table. Recommend a **hard STOP for architect review after the extension + first-table rollout**, mirroring Wave 1's
Task-0 gate — because a wrong RLS rollout breaks the live bot.

### 5.4 Verification (per lane — the team's receipt discipline)

`tsc` 0 · `npm test` GREEN (no env-dependent hard-fails after Lane T) · `build:console` · for Lane R additionally a manual
agent smoke run (real DB, real org) proving the runtime reads/writes normally under RLS · Sentry test event visible (Lane O).

---

## 5b. Wave 3 — outline (detail after Wave 2 review)

Do not execute yet: G4 Redis stateless runtime · G6 unified job queue (generalize `LiveChatPendingEvent`) ·
G7 jsonb + optimistic-concurrency + partial-unique-index · G10 `loop.ts` decomposition (now that the seams are correct).
Each gets a §3/§5-style detailed spec once Wave 2 lands and is reviewed.

---

## 6. Coding-agent kickoff prompt (Wave 1)

Paste into Claude Code. It is the orchestrator; it spawns sub-agents (git-worktree isolation) for the parallel lanes.

```text
You are the lead coding agent for Intera (Next.js monorepo: apps/console + packages/shared).
Execute WAVE 1 of the Enterprise-SaaS Readiness program. You may spawn sub-agents.

SOURCE OF TRUTH — read these first, in order, before writing any code:
  1) doc/handoffs/GENERIC_HANDOFF.md   (project context + §0 work rules — these are 铁律)
  2) doc/handoffs/MASTER_BUILD_HANDOFF.md  (current status + the G1–G10 program table)
  3) doc/to-do/2026-06-04-enterprise-saas-readiness.md  (THIS program — §3 is your detailed Wave 1 spec)
Wave 1 = G1 (FE↔BE contract seam) + G2 app-layer tenant scoping + G3 identity/RBAC/audit + G8 local-Postgres
parity + G9 seed tests. Goal: every API route AND its calling page migrates ONCE to the new seams.

NON-NEGOTIABLE RULES (from GENERIC_HANDOFF §0 + this spec):
  - Local gate for EVERY unit of work, paste the output as a receipt:
      npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
      npm test                                          # all green
      npm run build:console                             # success
  - Every safety/isolation change ships a red→green e2e guard test that drives the REAL route entry point.
    Seam/mock/constructor tests do NOT count. (Precedent: lib/agent/__tests__/integration/cross-org-isolation.test.ts)
  - UI changes: capture browser screenshots of the migrated page in loading + error + success states.
  - Do NOT deploy. Local only. Do NOT touch SSH creds, the DB password, or rotate anything (see GENERIC §6).
  - Do NOT rename already-applied Prisma migrations (see spec §3.4 — it desyncs prod).

EXECUTION — three phases with a hard STOP after Phase 1 for architect review:

PHASE 1 — Task 0 (SERIAL, do this yourself, NO sub-agents):
  Build the foundation in spec §3.1: packages/shared/contracts/{envelope,audit, per-domain}.ts;
  apps/console/lib/api/define-route.ts (session→orgId/userId/role→zod-parse→repoForOrg→handler→uniform envelope;
  exposes repo + audit() + log());  apps/console/lib/db/repo-for-org.ts (Prisma $extends injecting orgId — the
  tenant seam);  apps/console/lib/api/client.ts (typed apiClient + useApi SWR-style cache/dedup).
  Then fully migrate ONE pilot vertical end-to-end: app/api/admin/skills/route.ts + its page, proving
  validation-400 + envelope + repoForOrg scoping + audit write + apiClient consumption, with a green route-level test.
  >>> STOP. Post the receipt + a 10-line summary of the seam interfaces (defineRoute signature, repoForOrg API,
      apiClient API, envelope shape). WAIT for architect approval before Phase 2. Do not fan out yet. <<<

PHASE 2 — Fan out (AFTER approval): spawn 5 parallel sub-agents, one per lane, each in its own git worktree.
  Lane A=config domain, B=ops domain, C=channels domain (+fix livechat gotcha#7 with a red→green cross-org test),
  D=identity/G3 (User/Membership/AuditLog + per-user login + RBAC + audit writes; owns auth/session/login/middleware
  + schema.prisma; new migration only), E=parity+tests/G8+G9 (docker-compose Postgres, delete deploy.sh sed lines,
  un-break db-integration.test.ts, add the migration prefix-collision guard, seed route-level tests).
  CONFLICT RULES (spec §3.2): lanes edit ONLY their listed files; route groups are disjoint; pages map 1:1;
  schema.prisma is Lane D only; deploy.sh is Lane E only; Task-0 foundation files are read-only to lanes
  (lanes only ADD per-domain contract files). Each lane self-verifies with the local gate before reporting.

PHASE 3 — Integrate: merge lanes, run the full local gate once more, reconcile any drift, produce the consolidated
  receipt (all changed files grouped by lane + tsc/test/build output + screenshots + guard-test red→green proof).
  Update MASTER_BUILD_HANDOFF.md (flip Wave 1 items, note what's unblocked) and move the shipped portion of the spec
  to doc/what's done/. Then STOP for architect review — do NOT start Wave 2.

If anything in the spec is ambiguous or you find a load-bearing reason a step is wrong, STOP and surface it rather
than guessing — the architect will adjudicate.
```

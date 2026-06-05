# Enterprise-SaaS Readiness — Architecture Program (G1–G11)

**Author:** Architect | **Date:** 2026-06-04
**Status:** **Wave 1 + D2 ✅ shipped & verified** · **G11 Phase 1 ✅ delivered** (configurable `GuardrailHook` + safety floor, architect-reviewed) · **UX punch-list ✅ delivered** ([agent-build-ux-punchlist.md](../handoffs/2026-06-04-agent-build-ux-punchlist.md)). **Next:** G5+G9 (observability+coverage, §9) → G2-RLS (gated follow-up, §5.3) → G11 Phase 2 + Wave 3.
> ⚠️ **Priority note:** the immediate deliverable is the **internal-test "smooth build" version** (see [`MASTER_BUILD_HANDOFF.md`](../handoffs/MASTER_BUILD_HANDOFF.md) priority banner). Everything in this G-program is the **background hardening track** — ships as later version upgrades, does not gate the internal version.
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
| **G11** | Guardrail/policy engine: fail-open on the money checks, no audit trail, non-uniform checkpoint coverage (CS-native hooks) | richer `PolicyOutcome` + `failureMode` + `preReply` checkpoint + `AuditLog` wiring over the existing `PolicyEngine` seam | delete → safety decisions go silent + unauditable; "why did the agent refuse this refund?" is unanswerable |

---

## 2. Sequencing (dependency-ordered — do NOT reorder)

```
WAVE 1 (this spec, fully detailed below) — the foundational seams, each route/page touched ONCE:
  G1 contract seam  +  G2 app-layer tenant scoping  +  G3 identity/RBAC/audit  +  G8 local-PG parity  +  G9 seed tests
  → Task 0 (serial foundation) → 5 disjoint parallel lanes → architect review

WAVE 2 (detail after Wave 1 review):
  G2-RLS (DB defense-in-depth, needs G8)  ·  G5 observability (reuse ActionTrace correlation)  ·  G9 expand coverage
  ·  G11-P0 guardrail safety (fail-closed money checks + audit trail + close preFinalize/preReply gap — rides with G5)

WAVE 3:
  G4 Redis stateless runtime  ·  G6 unified job queue  ·  G7 jsonb + optimistic-concurrency + partial-unique-index
  ·  G10 loop.ts decomposition (now that seams are correct)  ·  G11-P1 CS-native hook model (matcher/preReply/PolicyOutcome — rides with G10)
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

> **Dispatch split (owner-approved 2026-06-04):** the three file-disjoint streams — **G5 · G9 · G11 Phase 1** — ship
> together FIRST (combined kickoff in **§9**). **G2-RLS (Lane R + the GUC/tx-wrapper Task-0 work + §5.3) is a SEPARATE
> gated follow-up dispatch** so the prod-risky RLS rollout gets a clean, unconfounded smoke-test signal. For the
> combined dispatch, **Task 0 is the LEAN version** (requestId correlation + a *shared audit-writer seam*); the
> AsyncLocalStorage / `SET LOCAL` GUC plumbing moves to the RLS dispatch. **Enable RLS on `audit_logs` LAST** — G11
> writes it from the agent runtime via the shared audit-writer, so RLS-on-audit_logs must come after that path lands.

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
| **T — Coverage (G9)** | `__tests__` only | route-level tests for ALL remaining mutating/tenant-sensitive routes; **real-DB** integration tests (PG is local now) for one route per domain. NOTE: **S2 is already RESOLVED** (global provider mock in `vitest-setup.ts`) — do **not** add `skipIf`; KEEP the keyless bar green and add new coverage under it. (The RLS defense-in-depth test belongs to the separate RLS dispatch, not this one.) |

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

---

## 7. G11 — Guardrail / Policy Engine (CS-native hook model)

**Supersedes** the Codex policy-engine audit (`policy-engine-review.md` — now deleted; fully absorbed here, in git history). Defects F1–F3 below were **re-verified by the architect against the real `policy.ts` / `loop.ts` / `case-agent-loop.ts`**; findings **F4–F6 are new** (the audit missed them). **This §7 is the single source of truth for G11 — build from here.**

### 7.0 Why this is a readiness gap, not a feature

`PolicyEngine` is a **deep module** (deletion test: remove it → guardrail logic reappears inline at every checkpoint, in *two* loops). The **seam is right; the interface is missing concepts** and has a safety inversion. For a SaaS that arbitrates refunds / account actions / financial disputes, "guardrails silently vanish under an LLM outage" and "no audit trail of why the agent refused" are enterprise blockers — same class as G3/G5.

### 7.1 Verified findings (architect, against real code)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | preTool LLM eval is dead | `policy.ts:228` `if(!context.skillOutput) continue` — no tool has run, so every `evaluationPrompt` at preTool is skipped | Med (latent) |
| F2 | **Fail-OPEN on the money checks, inconsistently** | `policy.ts:399-404` `CannotRetryError` → all `pass` (silent); but the outer catch in `evaluate()` `248-258` → all `hint` (visible). The *more common* failure (retries exhausted / rate-limit / auth) gets the *worse* silent-pass path. `no_compensation_promise` + `must_cite_basis` disappear during a policy-LLM outage, agent unaware. | **High** |
| F3 | `ai_eval_filtered` misnames gating as tool-filtering | `hook_skills` only gates *which skills trigger* a policy (`policy.ts:231,274`); nothing restricts the agent's palette | Low |
| **F4** | **preFinalize coverage is non-uniform across the two loops** | `loop.ts` calls only `evaluate('preTool')` (522) + `evaluate('postTool')` (995). `preFinalize` is invoked **only** in `case-agent-loop.ts:693`. Any customer-facing finalization that doesn't go through the case-agent path runs **no** finalize guardrail. | **High — verify reach** |
| **F5** | **No outbound (`preReply`) checkpoint** | Customer-visible replies are emitted mid-loop (`loop.ts:253,388,934`) as free-text assistant messages, gated by **no** policy. `no_compensation_promise` inspects only the `finalize_case` output → a conversational "sure, I'll refund you" is never checked. | **High** |
| **F6** | Zero audit trail of guardrail decisions | no `audit`/`AuditLog` reference anywhere in `lib/agent/*`; every `[POLICY]` verdict is ephemeral conversation text. G3 just shipped `AuditLog`. | Med (compliance) |
| F7 | `escalate` already exists + is wired | `PolicyResult` includes `escalated`; postTool→auto `create_human_task` (`loop.ts:1019-1051`) + graduated escalation (267-296). Not used as a fail-closed default; not uniform across checkpoints. | (asset to reuse) |

### 7.2 The platform primitive — a guardrail IS a configurable Hook

Architect direction (2026-06-04): don't ship defect-patches + a pile of optional fields. Define **one configurable primitive — a `GuardrailHook`** — and make the engine its interpreter. The configurator's mental model *is* the interface (the deep-module test: a lot of engine behaviour behind a tiny, fixed set of config questions). The platform owns the **safety floor**; the configurator tunes within it.

**Adding a guardrail = answering exactly six questions:**

| # | Question | Field | What the configurator gets to choose |
|---|---|---|---|
| 1 | **WHEN** does it run? | `when` | a fixed checkpoint enum — `preTool` · `postTool` · `preReply` · `preFinalize` (platform-owned; admins pick, can't invent new lifecycle events) |
| 2 | **WHICH** actions / outputs? | `match` | `skills` matcher (regex or `\|`-list) + optional cheap `ifPattern` on the payload (skip the expensive check when it can't apply) |
| 3 | **HOW** does it decide? | `check` | `rule` (deterministic: must/never-call skills) **or** `ai` (an `evaluationPrompt` judged by the policy LLM, optional model override) |
| 4 | **WHAT** on a violation? | `onViolation` | `warn` · `block(+guidance)` · **`invoke_tool`** (auto-call a safe system tool — §7.3) |
| 5 | **FALLBACK** if the check can't run? | `onUnavailable` | `open` (allow+warn) · `closed` (block) · **`invoke_tool`** — *constrained by the safety floor (§7.3)* |
| 6 | **What is the agent told?** | `guidance` | free text injected as the next instruction when blocked |

Everything else (audit write, severity aggregation, LLM batching, graduated escalation) is engine behaviour the configurator never touches. `matcher` **replaces** today's `hook_skills` (two conflated concepts → one — a genuine deepening); `ifPattern` makes cheap→expensive gating the default pipeline shape (the high-volume-CS cost model).

### 7.3 Fallback = invoke a system tool (the key generalization)

The platform already exposes **system tools** — `create_human_task` (转人工), `request_user_input`. Rather than a hardcoded `escalate` verdict, a hook's action *and* fallback can be **"invoke system tool T."** This:
- **unifies** intervention into the machinery the agent already uses — `escalate` simply *is* `invoke_tool: create_human_task`; no special escalation path (reuse the existing auto-human-task wiring at `loop.ts:1019-1051`);
- makes new control-flow tools **automatically available** as hook outcomes — wiring "on failure → 转人工" needs zero new code;
- is a real *deepening*: one mechanism (a hook can drive a tool call) replaces N special-case verdicts.

**Safety floor — platform-owned, NOT configurable (the 铁律 a configurator cannot override):**
- `invoke_tool` may target only a **curated allowlist of safe control-flow tools** (default: `create_human_task`, `request_user_input`). **Business / irreversible tools (`refund_money`, `change_ban_status`, `delete_account`) are never valid hook targets** — a guardrail must never *cause* a high-risk action. Rejected at config-validation **and** defended in the engine.
- For hooks attached to a **high-risk skill**, the configurator **cannot pick `onUnavailable: open`** — the UI offers only `closed` or `invoke_tool`(转人工). The platform refuses "silently allow a refund when the checker is down." *(This is the F2 fix expressed as a **constraint on the configuration space**, not a per-hook free choice.)*
- Every hook resolution writes an `AuditLog` row (F6) — non-optional.

So the safe **default wiring** of `no_compensation_promise` becomes, purely in config terms: `when: preReply + preFinalize`, `check: ai`, `onViolation: block(+guidance)`, `onUnavailable: invoke_tool(create_human_task)` — *if we can't verify the promise is safe, hand to a human automatically.*

### 7.4 What's exposed vs platform-fixed

| Layer | Owned by | Examples |
|---|---|---|
| **Configurable (admin UI)** | the configurator | the six fields above; enable/disable; tuning built-in `evaluationPrompt`s; the matcher; the guidance text |
| **Platform-fixed (铁律)** | the platform | the checkpoint enum; the safe-tool allowlist; the "no `open` fallback on a high-risk hook" rule; mandatory audit; deny-by-default; the engine's batching / severity / graduated-escalation behaviour |

The architect line: **the platform guarantees a safety floor; the configurator tunes within it.** An admin can make guardrails stricter or rewire a fallback to 转人工, but cannot configure their way *below* the floor.

### 7.5 Build sequencing — two phases, hard STOP between

- **G11 Phase 1 — the configurable model + safety floor (low runtime risk).** `GuardrailHook` schema (`PolicyRule` superset) in `packages/shared/types` + migration & backfill from today's built-ins; `PolicyEngine` interprets the new shape; `onUnavailable` risk-tiering with the high-risk-`open` prohibition (**fixes F2** — deletes the silent `pass` at `policy.ts:399-404`); `invoke_tool` **fallback** path wired to the existing human-task tool for the LLM-down case; every resolution → `AuditLog` (**fixes F6**); preTool *input-based* eval (**fixes F1**); admin UI for the six fields + the safe-tool picker + `ai_eval_filtered → ai_eval_targeted` rename (**F3**). *Mostly `policy.ts` + `types` + admin UI + `define-route` audit; minimal hot-loop change.* **This is the dispatch in §8.**
- **G11 Phase 2 — uniform runtime checkpoints (rides with G10 `loop.ts` decomposition).** Add `preReply`; make **both** `loop.ts` and `case-agent-loop.ts` honour the same checkpoint set (**fixes F4/F5** — the known live coverage gaps); full engine-initiated `invoke_tool` at every checkpoint (not just the fallback path). Co-located with G10 because both restructure the hot loop — touch those files once. **Do not start until G10 planning.**
- **Defer:** async eval, generic `PostTurn`.

### 7.6 Platform-policy decisions (architect-set defaults; owner may override)

The earlier fail-open-vs-closed question is **resolved**: fallback is a *configurable tool-invocation*, default 转人工 for high-risk. Remaining knobs (defaults baked into §8 — adjust if you disagree):

1. **Safe-tool allowlist for `invoke_tool`** → `create_human_task` (转人工), `request_user_input`.
2. **High-risk skill set** (forbids `onUnavailable: open`) → `refund_money`, `change_ban_status`, `delete_account` (today's `no_high_risk_account_change` deny-list).
3. **Default `onUnavailable` for an `ai` check NOT on a high-risk skill** → `open` + warn (availability over strictness for advisory checks).

---

## 8. Coding-agent kickoff prompt — G11 Phase 1 (configurable guardrail primitive)

Paste into a fresh Claude Code (zero context). It is the lead agent; it may spawn sub-agents.

```text
You are the lead coding agent for Intera — a multi-tenant AI customer-service SaaS (Next.js 15 monorepo:
apps/console + packages/shared; Prisma 6 + PostgreSQL). You may spawn sub-agents (git-worktree isolation).

SOURCE OF TRUTH — read these first, in order, before writing any code:
  1) doc/handoffs/GENERIC_HANDOFF.md   — project context + §0 work rules (these are 铁律 / non-negotiable)
  2) doc/handoffs/MASTER_BUILD_HANDOFF.md   — current status; find the G1–G11 program
  3) doc/to-do/2026-06-04-enterprise-saas-readiness.md — §0/§1 give the architecture vocabulary
     (seam, deep module, deletion test); **§7 is your COMPLETE spec for this task. Build from §7 only.**

TASK: implement **G11 Phase 1** — turn the guardrail/policy engine into a single CONFIGURABLE PRIMITIVE
(a `GuardrailHook`) with a platform-owned safety floor and a fallback-to-system-tool mechanism. Spec: §7.2–§7.6.
**DO NOT implement Phase 2** (new `preReply` checkpoint + uniform two-loop runtime rewiring) — that rides with the
G10 loop.ts decomposition, separate dispatch. If a Phase-2-shaped change seems required, STOP and ask the architect.

WHAT TO BUILD (all per §7.2–§7.4):
  1) `GuardrailHook` config model — a superset of today's `PolicyRule` (packages/shared/types):
     when (checkpoint enum) · match {skills matcher, ifPattern?} · check {kind:'rule'|'ai', ...} ·
     onViolation {warn | block(+guidance) | invoke_tool} · onUnavailable {open | closed | invoke_tool} · guidance.
     Add a NEW Prisma migration (do NOT rename applied migrations — spec §3.4) + a backfill mapping the current
     built-ins (policy.ts loadBuiltInPolicies) into the new shape with the §7.6 safe defaults.
  2) PolicyEngine (apps/console/lib/agent/policy.ts) interprets the new model:
     - onUnavailable risk-tiering — FIXES F2. On an `ai` check hitting CannotRetryError/timeout, follow the hook's
       onUnavailable. DELETE the current silent "all pass" (policy.ts:399-404).
     - SAFETY FLOOR (platform-owned, NOT configurable): for hooks on high-risk skills
       {refund_money, change_ban_status, delete_account}, onUnavailable:'open' is REJECTED at config-validation AND
       defended in the engine (coerced to invoke_tool: create_human_task). invoke_tool may target ONLY the
       allowlist {create_human_task, request_user_input} — business/irreversible tools are never valid targets.
     - preTool input-based eval — FIXES F1: at preTool, resolve {{skill_input}}/{{skill_name}} (skillOutput is
       absent by definition); stop silently skipping `ai` checks at preTool.
  3) Fallback-to-tool wiring (eval-unavailable path ONLY, this phase): when a hook resolves to
     invoke_tool(create_human_task), signal the loop to enqueue that system tool call by REUSING the existing path
     (loop.ts already auto-creates a human task on postTool 'escalated', ~loop.ts:1019-1051 — generalize that; do
     NOT invent a new escalation path, and do NOT add new checkpoints).
  4) Audit — FIXES F6: every hook resolution writes an AuditLog row (G3 AuditLog model + the audit() hook from
     define-route / packages/shared/contracts/audit.ts). e.g. action "guardrail.block" / "guardrail.escalate".
  5) Admin UI (apps/console/app/admin/guardrails/page.tsx + i18n dictionaries.ts en+zh): expose the six fields;
     the onViolation/onUnavailable tool pickers list ONLY the safe-tool allowlist; for a hook on a high-risk skill
     the UI forbids onUnavailable:'open'. Do the ai_eval_filtered → ai_eval_targeted rename (F3) here.

DEFAULTS (architect-set, §7.6; the owner may override — if so you'll be told):
  - safe-tool allowlist: { create_human_task (转人工), request_user_input }
  - high-risk skills (forbid onUnavailable:'open'): { refund_money, change_ban_status, delete_account }
  - default onUnavailable for an `ai` check NOT on a high-risk skill: 'open' + warn
  - no_compensation_promise default: check:ai · onViolation:block(+guidance) · onUnavailable:invoke_tool(create_human_task)

NON-NEGOTIABLE RULES (GENERIC_HANDOFF §0 + this program):
  - Local gate for EVERY unit of work; paste the output as a receipt:
      npx tsc --noEmit -p apps/console/tsconfig.json     # 0 errors
      env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # ALL GREEN, KEYLESS
      npm run build:console                               # success
    Run tests with keys UNSET (the suite has a global provider mock; a green bar must NOT depend on live keys).
  - The safety changes (F2 fail-closed + the safe-tool floor) MUST ship a red→green guard test driving the REAL
    PolicyEngine entry point: simulate CannotRetryError on a money-hook `ai` check → assert create_human_task is
    invoked and the action is NOT silently passed. Mock/seam-only tests do NOT count (§0.4).
  - Config-validation tests: onUnavailable:'open' on a high-risk hook is rejected; invoke_tool to a non-allowlisted
    tool is rejected.
  - UI: browser screenshots of the guardrails page (add/edit a hook, the tool picker, the high-risk constraint).
  - Do NOT deploy. Local only. Do NOT touch SSH creds, the DB password, or rotate anything.

>>> STOP after this phase. Post: changed files, the KEYLESS receipt, the red→green guard-test output, UI
    screenshots, and a 10-line summary of the GuardrailHook interface as built. WAIT for architect review.
    Do NOT start Phase 2 (preReply / two-loop checkpoint unification). <<<

If anything in §7 is ambiguous or you find a load-bearing reason a step is wrong, STOP and surface it rather than
guessing — the architect adjudicates.
```

---

## 9. Combined dispatch kickoff — Wave 2 "safe three" (G5 + G9 + G11 Phase 1)

> Sequencing decision (2026-06-04, owner-approved): dispatch the **three low-risk, file-disjoint** streams together
> now; **G2-RLS is a SEPARATE gated follow-up** (it can break the live bot — it gets a clean smoke-test signal).
> This prompt covers G5 + G9 + G11-P1 only. Lane briefs: G5/G9 in §5.2, G11 in §7+§8.

```text
You are the lead coding agent for Intera — a multi-tenant AI customer-service SaaS (Next.js 15 monorepo:
apps/console + packages/shared; Prisma 6 + PostgreSQL). You may spawn sub-agents (git-worktree isolation).

SOURCE OF TRUTH — read first, in order:
  1) doc/handoffs/GENERIC_HANDOFF.md        — project context + §0 work rules (铁律, non-negotiable)
  2) doc/handoffs/MASTER_BUILD_HANDOFF.md    — current status; the G1–G11 program
  3) doc/to-do/2026-06-04-enterprise-saas-readiness.md — §5 (Wave 2 G5/G9 specs) + §7 (G11 design) + §8 (G11 lane
     brief). §0/§1 give the architecture vocabulary (seam, deep module, deletion test).

SCOPE: three file-disjoint streams in ONE dispatch — G5 observability, G9 coverage, G11 Phase 1 (configurable
guardrail primitive).
  DO NOT do G2-RLS — separate gated follow-up. If you find yourself writing `ENABLE ROW LEVEL SECURITY`,
    `SET LOCAL app.current_org_id`, or RLS policies, STOP — wrong dispatch.
  DO NOT do G11 Phase 2 (new `preReply` checkpoint / two-loop checkpoint unification) — rides with G10, Wave 3.

EXECUTION — Task 0 (serial, STOP for review) → 3 parallel lanes → integrate.

PHASE 1 — Task 0 (SERIAL, do yourself, NO sub-agents): the shared foundation G5 + G11 both need.
  a) Request correlation (G5 seed, §5.1): defineRoute generates `requestId = crypto.randomUUID()` per request, adds
     it to the `log` context (already carries orgId/userId), sets `x-request-id` on the response.
  b) Shared audit-writer seam: today defineRoute.audit() writes AuditLog for HTTP routes. Extract the underlying
     writer so the AGENT RUNTIME (policy.ts/loop.ts) can write AuditLog too, taking orgId explicitly from the caller.
     Keep it a SINGLE seam (one writeAudit(event)) so the later RLS dispatch can make it GUC-aware in one place
     without re-touching G11. Do NOT add AsyncLocalStorage / SET LOCAL now (that's the RLS dispatch).
  Acceptance: x-request-id on every response; a 500 logs {requestId, orgId, userId, route}; the audit-writer is
  callable from BOTH defineRoute and a plain agent-runtime context (unit test proving both paths write a row).
  >>> STOP. Post the receipt + a 10-line summary of the requestId + audit-writer seam. WAIT for architect approval. <<<

PHASE 2 — fan out 3 sub-agents (own git worktree each), disjoint files:
  • Lane O — G5 observability (§5.2): lib/logger.ts (structured JSON in prod; requestId·orgId·userId), @sentry/nextjs
    init (scrub PII), lib/metrics.ts (per-org LLM token+cost events — billing substrate), thread requestId →
    ActionTrace so HTTP-error → agent-run is one hop. Owns: logger / sentry / metrics / trace-correlation.
  • Lane T — G9 coverage (§5.2, __tests__ only): route-level tests for remaining mutating/tenant-sensitive routes;
    one real-DB (local PG) integration test per domain. S2 is ALREADY resolved (global provider mock) — do NOT add
    skipIf; KEEP the keyless bar green and add coverage under it.
  • Lane G — G11 Phase 1: implement the configurable GuardrailHook primitive EXACTLY per §7.2–§7.6 + the lane brief
    §8 (model + safety floor + fallback-to-tool + audit + F1/F2/F3/F6 fixes + admin UI). Its AuditLog writes use the
    Task-0 shared audit-writer. Owns: policy.ts, packages/shared/types, guardrails admin page, dictionaries.ts, a new
    migration + backfill, minimal loop.ts (reuse the EXISTING escalate path only — no new checkpoints).

CONFLICT RULES: lanes edit only their listed files; Task-0 files (defineRoute requestId, the audit-writer) are
read-only to lanes after Phase 1; new migrations get distinct numeric prefixes (§3.4 — never rename applied ones).

NON-NEGOTIABLE (GENERIC_HANDOFF §0 + program):
  - Local gate per unit of work, paste as receipt:
      npx tsc --noEmit -p apps/console/tsconfig.json     # 0 errors
      env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # ALL GREEN, KEYLESS
      npm run build:console                               # success
  - G11 safety changes (F2 fail-closed + safe-tool floor) ship a red→green guard test driving the REAL PolicyEngine
    (simulate CannotRetryError on a money-hook ai check → assert create_human_task invoked, NOT silent pass).
    Mock/seam-only tests don't count (§0.4).
  - UI (Lane G + any G5 surface): browser screenshots in loading / error / success states.
  - Do NOT deploy. Local only. Do NOT touch SSH creds, the DB password, or rotate anything.

PHASE 3 — integrate, run the full KEYLESS gate once more, produce the consolidated receipt (changed files by lane +
tsc/test/build + guard-test red→green + screenshots). Update MASTER_BUILD_HANDOFF.md (flip G5/G9/G11-P1) and move the
shipped portion of the spec to doc/what's done/. Then STOP for architect review — do NOT start G2-RLS or G11 Phase 2.

If anything is ambiguous or you find a load-bearing reason a step is wrong, STOP and surface it — the architect adjudicates.
```

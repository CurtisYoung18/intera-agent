# LiveChat Per-Agent Integration — `channel_bindings` Consolidation Plan

> **For the coding agent team:** Architect hand-off. Dispatch sub-agents per the wave plan; **one sub-agent per file** (never two on the same file at once). Steps use `- [ ]`. The architect wrote the plan and verified current state against the live tree (file:line evidence below). **You write the code**, following the direction + acceptance. Waves are ordered by risk: each wave is independently shippable and reviewable.

**Goal:** Make LiveChat integration **per-agent** instead of per-org, so one org's different agents can bind different LiveChat licenses/bot tokens *and* route to their own agent "brain". Do it the long-term-clean way: **fold the org-scoped `livechat_configs` table into the (currently dormant) `channel_bindings` table**, keyed per `(orgId, agentName, channel)`, and fix the agent-selection routing **end-to-end** (webhook → bridge → `/api/messages`).

---

## Why this is a real refactor (verified current state)

All four points from the original analysis are **confirmed against the live tree**, and the gap is **deeper than the schema**:

| Claim | Status | Evidence |
|---|---|---|
| `livechat_configs` has no agent dimension; `org_id` is UNIQUE | ✅ | `packages/shared/prisma/schema.prisma:418` — `orgId String? @unique`, no `agentConfigId` |
| `channel_bindings` keyed only `[orgId, channel]` | ✅ | `schema.prisma:515` — `@@unique([orgId, channel])` |
| `[orgId]/[agentName]` webhook only validates agent, passes **org** config | ✅ (worse) | `app/api/livechat/webhook/[orgId]/[agentName]/route.ts:34-38` resolves `agentConfig` then **throws away `agentConfig.id`**; `:40` loads `liveChatConfig.findUnique({ orgId })` |
| `bridge.handleIncomingEvent` has `agentConfigId` param, no caller passes it | ✅ | `lib/livechat/bridge.ts:124`; all call sites pass 5 args |

**Two findings the original analysis did not have (both critical):**

1. **The receiving end is also broken.** `/api/messages` selects the agent from `session.agentConfigId`, which is populated **only from an ApiKey row** (`lib/api-auth.ts:34`, consumed at `app/api/messages/route.ts:156,632`). It **ignores `body.configId`** entirely. LiveChat's bridge authenticates with an internal-secret header (`x-intera-internal` + `x-intera-org`, **no Bearer** — `bridge.ts:220-224`), so `session.agentConfigId` is `undefined` for all LiveChat traffic → **every LiveChat message currently routes to the org's default agent.** Passing `agentConfigId` into the bridge alone would NOT fix this; the session/auth layer and the consumer must change too.

2. **`channel_bindings` is dormant.** Grep for `channelBinding.` (table reads/writes) across `apps/` + `packages/` returns **nothing** outside tests. The S5 table exists in the schema and is wired into `repoForOrg` (`lib/db/repo-for-org.ts:131`), and the bridge builds a `ChannelBindingConfig` **in memory** (`bridge.ts:247-251`), but the table itself is never persisted to. **This makes consolidation low-risk: we populate a dormant table and repoint consumers — there is no live `channel='livechat'` data to reconcile.**

**Architecture constraint that shaped the design:** `AgentConfig` is **versioned** — every publish creates a new row with a new `id`, and the `isActive=true` row is the runtime one (`schema.prisma:55`, `@@unique([orgId, name, version])`). Therefore a binding must key on the **stable identity `(orgId, agentName)`**, never on a version-row `id`. The active version's `id` is resolved per-request (the `[agentName]` route already does `findFirst({ name, isActive: true })`).

**Org-keyed config read sites that must move (the blast radius — ~10):**
`app/api/admin/livechat/config/route.ts` (GET `:26`, raw `:50`, PUT upsert `:58`) · `app/api/admin/livechat/groups/route.ts:13` · `app/api/livechat/webhook/route.ts:88` (legacy) · `app/api/livechat/webhook/[orgId]/route.ts:34` · `app/api/livechat/webhook/[orgId]/[agentName]/route.ts:40` · `app/api/livechat/config/route.ts:22` (legacy read) · `app/api/livechat/form-submit/route.ts:31` · `lib/livechat/config-store.ts` (TTL cache, keyed by orgId) · `lib/livechat/retry-queue.ts:50` · `lib/api/define-route.ts:233` (webhook-auth secret lookup).

---

## Target architecture

**One config table.** `channel_bindings` becomes the single source of truth for per-channel integration config, keyed `(orgId, agentName, channel)`.

**`agentName` is nullable, with org-default fallback.** This is the key design decision and the thing that de-risks the migration:

- `agentName = NULL` → the org-level default/fallback binding (preserves today's single-config-per-org behavior exactly).
- `agentName = '<name>'` → that specific agent's override (its own license/token).
- **Resolution at request time:** look up `(orgId, agentName, channel)`; if absent, fall back to `(orgId, NULL, channel)`.
- **Migration becomes mechanical and unambiguous:** each existing `livechat_configs` row → one `channel_bindings` row with `agentName = NULL`. **No guessing which agent the existing config "belongs to."**

**Brain vs. credentials are resolved separately but coherently.** The webhook URL's `agentName` selects the agent **brain** (which `AgentConfig` answers); the binding row supplies the **credentials** (which LiveChat license sends/receives). They are normally the same agent, but the NULL fallback lets an agent's brain run on the org-default credentials until a per-agent license is configured.

**Routing is uniform through the session layer.** Agent selection always flows through `session.agentConfigId` — from the ApiKey row for external API calls, and from a **trusted-internal header** (`x-intera-agent-config-id`) for the bridge's internal call. `body.configId` (currently dead) is removed.

```
LiveChat  ──webhook──▶  /api/livechat/webhook/[orgId]/[agentName]
                          ├─ resolve agentConfig (orgId, agentName, isActive) → agentConfigId
                          ├─ resolve binding (orgId, agentName, 'livechat') ?? (orgId, NULL, 'livechat')
                          └─ bridge.handleIncomingEvent(..., config, agentConfigId)
                                  └─ POST /api/messages
                                       headers: x-intera-internal, x-intera-org,
                                                x-intera-agent-config-id  ◀── NEW
                                       └─ session.agentConfigId = header (trusted-internal only)
                                            └─ loadAgentConfig(orgId, agentConfigId)  ◀── now per-agent
```

**Tech stack:** Next.js 15 App Router · Prisma/Postgres · SSE · `defineRoute` + `repoForOrg` seams · vitest.

---

## ⛔ Safety red line (inherited project state — read before any DB work)

Local `apps/console/.env.local` `DATABASE_URL` points at **production** Postgres via SSH tunnel. **There is no safe local DB by default, and `SESSION_SECRET` is missing from `.env.local`.**

- **This plan writes SCHEMA and migrates PRODUCTION data.** It is **not** DB-safe like the Playground work.
- **Migration is expand/contract (parallel change).** Wave 1 only **adds** columns/indexes and **backfills**; it does **not** drop `livechat_configs`. The drop is a **separate migration in Wave 6**, only after Waves 1–5 are verified in production.
- **All migration + backfill SQL must be reviewed by the architect before `prisma migrate deploy`.** Run schema work against a **local throwaway Postgres** (docker-compose Postgres:16 + throwaway `DATABASE_URL` + `SESSION_SECRET` in `.env.test.local`) first — see `2026-06-04-google-invite-flow-hardening.md` Task 0 for the harness. Never point `prisma migrate` at the prod tunnel during development.
- **Two-phase verification (every task):** (1) local gate — `vitest` + typecheck green on a local DB; (2) production browser test — exercise the real LiveChat webhook against a staged config before calling it done.

---

## Shared contract (all tasks align to this)

### Schema — `channel_bindings` additions

```prisma
model ChannelBinding {
  id                  String   @id @default(cuid())
  orgId               String   @map("org_id") @default("default")
  agentName           String?  @map("agent_name")   // NEW — NULL = org default/fallback
  channel             String   // 'web-chat' | 'livechat' | 'slack' | ...
  enabled             Boolean  @default(false)
  credentials         String   @default("{}")       // JSON — secrets/connection (see LiveChatCredentials)
  showSkillStatus     Boolean  @default(true)        // NEW — cross-channel render pref (moved from livechat_configs)
  transferMessage     String?  @map("transfer_message") // NEW — moved from livechat_configs
  toolOverrides       String?
  defaults            String?
  channelSkillBinding String?
  transferStrategy    String?  // 'transfer_chat' | 'consult' | 'silent_task'
  transferTarget      String?  // JSON: { type:'group'|'agent'|'queue', ids:[...] }
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([orgId, agentName, channel])     // non-null agent overrides
  @@map("channel_bindings")
}
```

Plus a **partial unique index** added in raw migration SQL (Postgres treats NULLs as distinct, so the compound `@@unique` does not stop two NULL-agent rows):

```sql
CREATE UNIQUE INDEX channel_bindings_org_channel_default_uq
  ON channel_bindings (org_id, channel)
  WHERE agent_name IS NULL;
```

### `credentials` JSON shape (LiveChat)

```ts
// Stored in channel_bindings.credentials when channel === 'livechat'
interface LiveChatCredentials {
  botAccessToken: string
  licenseId: string
  webhookSecret?: string
  region?: string            // default 'dal'
  authType?: 'bearer' | 'basic' | 'auto'
  accountId?: string
  agentAccountId?: string
}
```

Field mapping from `livechat_configs` → `channel_bindings`:

| `livechat_configs` | → | `channel_bindings` |
|---|---|---|
| `botAccessToken`,`licenseId`,`webhookSecret`,`region`,`authType`,`accountId`,`agentAccountId` | → | `credentials` JSON |
| `enabled` | → | `enabled` |
| `showSkillStatus` | → | `showSkillStatus` (typed col) |
| `transferMessage` | → | `transferMessage` (typed col) |
| `transferGroupId` (Int) | → | `transferTarget` = `{ type:'group', ids:[transferGroupId] }`; `transferStrategy='transfer_chat'` |
| `orgId` | → | `orgId`, with `agentName = NULL` (backfill) |

### Hydration helper (the new read seam)

A single module hydrates a `channel_bindings` row into the flat `LiveChatConfig` shape the bridge already expects (`lib/livechat/types.ts:19`), so the bridge and renderer are untouched by the storage change:

```ts
// lib/livechat/channel-binding-store.ts  (replaces config-store.ts)
export async function getLiveChatConfig(
  orgId: string, agentName?: string | null,
): Promise<LiveChatConfig | null>   // resolves (orgId, agentName, 'livechat') ?? (orgId, NULL, 'livechat'); TTL cache keyed by (orgId, agentName); returns null when !enabled
export function invalidateLiveChatConfig(orgId: string, agentName?: string | null): void
export async function upsertLiveChatConfig(orgId: string, agentName: string | null, data: Omit<LiveChatConfig,'orgId'>): Promise<void>
```

### Routing contract

- Bridge's internal POST to `/api/messages` sets header `x-intera-agent-config-id: <agentConfigId>` (only when present).
- The trusted-internal branch of session resolution populates `session.agentConfigId` from that header **iff `isTrustedInternalCall(req)`**.
- `/api/messages` is unchanged (keeps reading `session.agentConfigId`); `body.configId` is removed from `bridge.ts` and the messages route.

---

## WAVE 0 — De-risk: trace + audit (no schema changes)

### Task 0a — Trace the bridge → `/api/messages` internal auth path
**Files (read-only investigation; output a short note in this doc's PR description):** `lib/livechat/bridge.ts`, `lib/api/define-route.ts`, `lib/api-auth.ts`, `app/api/messages/route.ts`.

- [ ] Confirm how the bridge's internal call (`x-intera-internal` + `x-intera-org`, no Bearer) is authenticated by `/api/messages` (`auth:'apiKey'`). `resolveOrgFromApiKey` requires a Bearer (`api-auth.ts:22-23`) and the `apiKey` branch has **no** internal bypass (`define-route.ts:217-221`), unlike the `webhook` branch (`:228`). Determine whether the call works today via some path (env routing to a separate chat service on `INTERNAL_CHAT_API_URL`, `:3001`) or is partially broken.
- [ ] Decide the exact injection point for `session.agentConfigId` from `x-intera-agent-config-id`: either a new internal branch in the `apiKey` case, or switch `/api/messages` to a mode that calls `isTrustedInternalCall`. **Document the decision before Wave 4.**

**Acceptance:** a written note in the PR stating how internal calls authenticate today and which session-resolution branch will read the new header.

### Task 0b — Prod data audit (read-only, DB-safe)
- [ ] Count `livechat_configs` rows and distinct orgs; for each such org, count active `AgentConfig`. Confirms Wave 1 backfill is purely mechanical (it is, since every row maps to an `agentName = NULL` binding) and surfaces any org that already needs >1 license so admins can configure per-agent overrides post-migration.

**Acceptance:** counts recorded; no writes.

---

## WAVE 1 — Schema + backfill (EXPAND only)

### Task 1 — Extend `channel_bindings`, backfill from `livechat_configs`
**Owns:** `packages/shared/prisma/schema.prisma`, new migration dir `packages/shared/prisma/migrations/20260605000001_channel_binding_per_agent/`.

- [ ] **Step 1 — Schema:** add `agentName String?`, `showSkillStatus Boolean @default(true)`, `transferMessage String?` to `ChannelBinding`; change `@@unique([orgId, channel])` → `@@unique([orgId, agentName, channel])`.
- [ ] **Step 2 — Migration SQL (additive):** `ALTER TABLE` to add the three columns; drop old unique, add new compound unique; add the partial unique index (see Shared contract). **Do NOT drop `livechat_configs`.**
- [ ] **Step 3 — Backfill SQL:** for each `livechat_configs` row, `INSERT` a `channel_bindings` row with `channel='livechat'`, `agent_name=NULL`, `enabled`, `credentials` JSON assembled per the mapping table, `show_skill_status`, `transfer_message`, and `transfer_target`/`transfer_strategy` derived from `transfer_group_id`. Idempotent (`ON CONFLICT DO NOTHING` against the partial unique index).
- [ ] **Step 4 — Verify on local throwaway DB:** seed a couple of `livechat_configs` rows, run migrate + backfill, assert exactly one NULL-agent `channel_bindings` livechat row per org and that `credentials` round-trips.

**Acceptance:** migration + backfill green on local Postgres; partial unique index rejects a second NULL-agent livechat row per org; architect-reviewed before any prod deploy.

---

## WAVE 2 — Read/hydrate seam + repoint consumers

### Task 2a — New `channel-binding-store.ts`
**Owns:** create `lib/livechat/channel-binding-store.ts`; delete `lib/livechat/config-store.ts` after consumers move. Test: `lib/livechat/__tests__/unit/channel-binding-store.test.ts`.

- [ ] **Step 1 — Test first:** given a livechat binding at `(org, NULL)` and an override at `(org, 'A')`, assert `getLiveChatConfig(org,'A')` returns the override and `getLiveChatConfig(org,'B')` falls back to NULL; `enabled=false` → `null`; cache invalidation works.
- [ ] **Step 2 — Implement** `getLiveChatConfig` / `invalidateLiveChatConfig` / `upsertLiveChatConfig` per the Shared contract; hydrate `credentials` JSON → `LiveChatConfig`. TTL cache keyed by `(orgId, agentName)`.

### Task 2b — Repoint the ~10 read/write consumers
**Owns (separate sub-agents, one file each):** `admin/livechat/groups/route.ts`, `livechat/webhook/route.ts`, `livechat/config/route.ts`, `livechat/form-submit/route.ts`, `lib/livechat/retry-queue.ts`.

- [ ] Replace `getLiveChatConfig(orgId)` / `prisma.liveChatConfig.*` with the new store (org-default resolution, i.e. `agentName` omitted → NULL fallback). Keep behavior identical for now (these are org-level callers).

**Acceptance:** all consumers compile against the new store; existing livechat unit/integration tests green; no remaining `prisma.liveChatConfig` reads outside the migration and Wave 6 cleanup.

---

## WAVE 3 — Per-agent webhook wiring

### Task 3a — `[orgId]/[agentName]` route: bind + route per agent
**Owns:** `app/api/livechat/webhook/[orgId]/[agentName]/route.ts`.

- [ ] Load the binding via `getLiveChatConfig(orgId, agentName)` (override → NULL fallback) instead of `repo.liveChatConfig.findUnique({ orgId })` (`:40`).
- [ ] Pass `agentConfig.id` (the resolved active version) as the 6th arg to **every** `handleIncomingEvent(...)` call (`:64,79,85,90`). Remove the `as any` casts where the typed signature now fits.

### Task 3b — Legacy `[orgId]` + `/webhook` routes: org-default
**Owns:** `app/api/livechat/webhook/[orgId]/route.ts`, `app/api/livechat/webhook/route.ts`.

- [ ] Resolve `getLiveChatConfig(orgId)` (NULL fallback). Do not pass `agentConfigId` (org-default brain). Behavior identical to today — back-compat.

### Task 3c — Webhook-auth secret lookup
**Owns:** `lib/api/define-route.ts` (`resolveSession` webhook branch, `:233`).

- [ ] Read `webhookSecret` from the `channel_bindings` livechat credentials for `(orgId, agentName?)` (params carry `agentName` on the per-agent route) instead of `prisma.liveChatConfig.findUnique`. NULL fallback when no per-agent binding.

**Acceptance:** an inbound webhook to `/[orgId]/[agentName]` with a per-agent binding uses that agent's token AND routes to that agent's brain; `/[orgId]` still works unchanged; secret validation green for both shapes.

---

## WAVE 4 — End-to-end routing fix

### Task 4a — Bridge carries `agentConfigId` via header
**Owns:** `lib/livechat/bridge.ts`.

- [ ] On the internal POST (`:218-226`), add header `x-intera-agent-config-id: agentConfigId` when present. Remove the dead `body.configId = agentConfigId` (`:179-180`).

### Task 4b — Session layer reads the header (trusted-internal only)
**Owns:** `lib/api/define-route.ts` (per Task 0a decision) and/or `lib/api-auth.ts`. Test: extend the messages/route auth test.

- [ ] In the trusted-internal path (`isTrustedInternalCall(req) === true`), populate `session.agentConfigId` from `x-intera-agent-config-id`. **Never** trust this header for non-internal calls.
- [ ] `/api/messages` unchanged (`session.agentConfigId` already drives `loadAgentConfig`, `:632`). Remove any `body.configId` read.

**Acceptance:** a unit/integration test proving (1) an internal call with the header selects that `agentConfigId`; (2) an external apiKey call with the header set is **ignored** (uses the ApiKey binding); (3) a LiveChat webhook to agent "A" produces a `/api/messages` call whose resolved config is A's active version, not the org default.

---

## WAVE 5 — Admin API + UI (per-agent selector)

### Task 5a — `/api/admin/livechat/config` scoped by agent
**Owns:** `app/api/admin/livechat/config/route.ts`.

- [ ] GET/PUT take an `agentName` (query for GET, body for PUT; omitted ⇒ org default / NULL). Read/write `channel_bindings` via the new store + `repo.channelBinding`. `orgId` STILL strictly from `session.orgId` (B1 invariant — never from body/query). Keep masked-secret preservation and audit (`livechat.config.update`, target `org:{orgId}/agent:{agentName ?? '_default'}`).
- [ ] Update `app/api/admin/livechat/__tests__/livechat-b1-guard.test.ts` so the B1 guarantees (session-only orgId, `requireRole`, masked GET) hold for the agent-scoped shape.

### Task 5b — Admin UI agent selector
**Owns:** `app/admin/channels/livechat/page.tsx`.

- [ ] Add an agent picker (list the org's active `AgentConfig` names + an "Org default" entry) that scopes load/save to that agent. Preserve B1/B5 auto-save + persistent save-state chip.
- [ ] ⚠️ **UI direction:** confirm the page-specific UX (selector placement, default tab, per-agent webhook-URL display) with the architect/user before finalizing — do not assume the Intera Design System defaults.

**Acceptance:** admin can configure distinct LiveChat licenses for two agents in one org; org-default still editable; B1 guard test green.

---

## WAVE 6 — CONTRACT: drop the old table (separate deploy)

### Task 6 — Remove `livechat_configs` + legacy shims
**Owns:** `packages/shared/prisma/schema.prisma`, new migration `20260605000002_drop_livechat_configs`, `lib/db/repo-for-org.ts`, `lib/livechat/types.ts`.

- [ ] **Only after Waves 1–5 are verified in production.** Drop `model LiveChatConfig` + the `livechat_configs` table; remove `liveChatConfig` from `repoForOrg`; remove the legacy `/api/livechat/config/route.ts` read path if fully superseded.
- [ ] Confirm zero remaining `liveChatConfig` references (grep gate in CI).

**Acceptance:** schema has no `livechat_configs`; full livechat suite green; prod webhook smoke test (per-agent + org-default) green post-deploy.

---

## Open decisions / assumptions (confirm with architect)

1. **Field placement** — `showSkillStatus` and `transferMessage` promoted to typed columns on `channel_bindings` (treated as cross-channel), secrets in `credentials` JSON. Adjustable if you'd rather keep them LiveChat-only inside JSON.
2. **`agentName` nullable + fallback** — chosen to make backfill unambiguous and preserve org-level behavior. Alternative (sentinel string `'__org_default__'`) avoids the partial unique index but is hackier; not recommended.
3. **Brain/credentials decoupling** — a named agent's webhook routes to that agent's brain even when only the org-default credentials exist (NULL fallback). Confirm this is the desired behavior vs. hard-requiring a per-agent binding.
4. **Doc says it's live** — `MASTER_BUILD_HANDOFF.md:40,98,451` claims "per-agent webhooks live." It is path-live only; update that handoff line when Wave 4 lands so it stops overstating.

## Verification (two-phase, per task and at the end)

- **Local gate:** `pnpm vitest` (livechat unit + integration), typecheck, and migration/backfill on a **local throwaway Postgres** — never the prod tunnel.
- **Production browser test:** stage two agents in one org with different LiveChat licenses; send a real message to each agent's webhook; confirm (a) the correct bot token replies and (b) the correct agent brain answers (distinct system prompt/behavior). Org-default webhook still works.

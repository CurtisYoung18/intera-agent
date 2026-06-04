# Generic Handoff — Intera Agent

**Last updated:** 2026-06-02 | **Branch:** `main` @ `d2def3a` | **Audience:** any coding agent picking up this project cold.

> **Two handoffs live in this folder, and only two:**
> 1. **`GENERIC_HANDOFF.md`** (this file) — stable project context. Changes rarely.
> 2. **`MASTER_BUILD_HANDOFF.md`** — the live macro backlog: what's left, in what order, and which `doc/to-do/` guide covers each item.
>
> Concrete, code-level task guides live in **[`doc/to-do/`](../../doc/to-do/)** — one file per task with exact paths, line numbers, and verification steps.

---

## 0. How work flows here (read this first — 铁律)

1. **This file = context. `MASTER_BUILD_HANDOFF.md` = the plan. `doc/to-do/*` = the steps.** Don't duplicate task detail into the handoffs; put it in a `doc/to-do/` guide and link it from the master build handoff.
2. **Every time you finish a `doc/to-do/` item:** (a) move the guide to `doc/what's done/`, and (b) update `MASTER_BUILD_HANDOFF.md` — flip the item's status, note the commit, and re-state what's now unblocked. **The master build handoff must never lie about current state.**
3. **Receipt required for every task:** list changed files + paste verification output (`npx tsc --noEmit -p apps/console/tsconfig.json` + `npm test` + `npm run build:console`). UI changes need browser screenshots.
4. **Every safety/isolation change ships an e2e guard test with red→green proof.** Tests that exercise mocks/constructors ("seam tests") don't count — drive the real entry point.
5. **Minimize deployments.** Test locally first; deploy at a meaningful-release cadence via `git push deploy main`, not per-commit.
6. **Handoffs may be stale — verify before relying.** The branch SHA in the header tells you how old this is; `git log` tells you what landed since.

---

## 1. What this is

**Intera Agent** is a multi-tenant SaaS customer-service AI platform. Next.js monorepo (`apps/console` + `packages/shared`), self-hosted on an Ubuntu box, served at `https://demo.anytrans.ai`.

The AI engine (`apps/console/lib/agent/loop.ts`) is a ReAct loop with streaming tool execution, a stage-based state machine, sub-agent orchestration, a policy engine, and a LiveChat bridge.

```
apps/console/             ← the only app (apps/chat was deleted post-migration)
  app/api/messages/       ← main SSE entry point (LiveChat + API consumers)
  app/api/admin/          ← console admin CRUD + agent-configs + playground
  app/api/auth/           ← login / session / switch-org / logout
  lib/agent/              ← core AI engine (AgentLoop, skills, policy, trace, memory)
  lib/livechat/           ← LiveChat bridge (webhook → /api/messages → SSE)
  lib/session.ts          ← signed HMAC-SHA256 session token (no external dep)
  lib/auth.ts             ← getSession / getActiveOrgId / getActiveVendor (verified session only)
  lib/api-auth.ts         ← Bearer-key resolution + isTrustedInternalCall
  middleware.ts           ← edge gate for /admin /ops + gated /api/*
  components/             ← React (sidebar, docked-preview, admin editors)

packages/shared/
  prisma/schema.prisma    ← ~21 models (Organization, AgentConfig, Case, ApiKey, …)
  types/index.ts          ← SSEEvent, SkillDefinition, AgentConfigData, …
  defaults/index.ts       ← default system prompts, memory strategies, policy hooks
  ui/intera-logo.tsx      ← animated wordmark (INTERA ↔ AI, one fluid transition)
```

## 2. Auth model (multi-tenant)

```
External API → Bearer intera_sk_live_… → resolveOrgFromApiKey() → sha256 lookup
  → orgId from ApiKey table (NEVER from request body)

LiveChat webhook → /api/livechat/webhook/:orgId (per-org webhookSecret, timing-safe)
  → bridge.ts → x-intera-internal + x-intera-org headers → /api/messages
  → isTrustedInternalCall() → orgId from header

Console UI → signed `intera_session` cookie (HMAC-SHA256 JWT, lib/session.ts)
  → verifySessionToken() → { role: 'staff' | 'customer', orgId, exp }
  → middleware blocks /admin /ops and /api/admin|ops|chats|users when invalid
```

- **Staff** log in with a single shared password (`STAFF_PASSWORD`); may switch orgs.
- **Customer** log in with a per-org bcrypt password (`API_ORG_PASSWORD` for the seeded `api` org). Password-less orgs are rejected.
- Required env for login: `SESSION_SECRET` (random 32-byte hex), `STAFF_PASSWORD`, `API_ORG_PASSWORD`. See `.env.example`.

### Playground dry-run isolation
```
AgentLoop.create({ persistence: MemoryPersistence, dryRun: true })
  → all prisma writes → memory port (zero DB)
  → StreamingToolExecutor(…, dryRun) → operational tools mocked at dispatch entry
  → TraceWriter(…, dryRun) → no-ops actionTrace.create
  → SkillRouter.create(orgId, dryRun) → skips knowledgeSource.update heal
  → OrchestratorAgent.dispatchInBackground → guarded by if(!this.dryRun)
```

## 3. Key files

| File | Role |
|---|---|
| `apps/console/lib/agent/loop.ts` | Core AgentLoop (~2,160 lines). Persistence port + dryRun injected at constructor. |
| `apps/console/lib/agent/streaming-tool-executor.ts` | Tool dispatch. `dryRun` chokepoint at `runTrackedTool`. |
| `apps/console/lib/agent/persistence-port.ts` | `PersistencePort` interface + `PrismaPersistence` + `MemoryPersistence`. |
| `apps/console/lib/agent/playground-runner.ts` | `runPlaygroundTurn()` — accepts optional `configId` for multi-agent. |
| `apps/console/lib/agent/config-cache.ts` | Config cache keyed `orgId::agentId` (falls back to `orgId`). |
| `apps/console/lib/session.ts` | Signed HMAC-SHA256 session token; fail-closed if `SESSION_SECRET` unset. |
| `apps/console/lib/auth.ts` | Reads verified session only. |
| `apps/console/lib/api-auth.ts` | `resolveOrgFromApiKey`, `isTrustedInternalCall`, `generateApiKey`. |
| `apps/console/middleware.ts` | Edge gate. |
| `apps/console/app/api/messages/route.ts` | Main SSE entry (~1,040 lines). |
| `apps/console/app/api/auth/login/route.ts` | Issues `intera_session`; staff (constant-time shared pw) + customer (per-org bcrypt). |
| `apps/console/app/admin/agent/page.tsx` | Agent selector dropdown + Suspense. |
| `apps/console/components/console-sidebar.tsx` | Agent switcher + duplicate/delete; org-switcher gated to staff. |
| `apps/console/app/login/page.tsx` | Two-panel brand login (matches `LOGIN_PAGE_PREVIEW.html`). |
| `packages/shared/ui/intera-logo.tsx` | Animated wordmark, 5s cycle. |

## 4. Gotchas

1. **Prisma standalone embed:** Next standalone embeds the Prisma schema at build time. Always: `db:generate` → `build:console` → `cp static+public`.
2. **Prisma monorepo type duplication:** `node_modules/.prisma/client/index.d.ts` can define `coreSystemPrompt` 3× (Prisma 6 monorepo codegen bug) → seed failure for `api` org. Fix: explicit `output` path on the generator client.
3. **SWC multi-line className:** Next SWC fails with "Unterminated string constant" when a `className` spans two lines. Keep `className` strings single-line.
4. **SSE + Caddy:** `flush_interval -1` is critical or SSE buffers.
5. **Cert renewal:** manual RapidSSL wildcard (`*.anytrans.ai`) expires 2026-07-22; Caddy auto-renews Let's Encrypt for `demo.anytrans.ai`. Which one actually serves is unconfirmed (see master build handoff M6).
6. **README is partly stale:** it still references `apps/chat/.env.example`, which no longer exists. Don't trust setup docs blindly.
7. **Channel-config endpoints take org from a client param — exception to §2's "session-only" rule.** `/api/livechat/config` (GET) and `/api/livechat/groups` resolve `orgId` from `searchParams.get('orgId') ?? 'default'`, NOT from the verified session, and sit *outside* the middleware gate (they're widget/webhook-facing with CORS). §2's "orgId from session, NEVER from request" holds for `/api/messages`, `/api/admin/*` (via `getActiveOrgId()`), and Bearer-key resolution — but NOT these two. Consequence: any caller can read another org's livechat config by passing/omitting `orgId` (omit → `'default'`). Console code must pass the *session* orgId explicitly when calling them (the livechat admin page does; T6 readiness did not — see master handoff BLK-1). Latent multi-tenant leak; candidate to harden (resolve from session for authenticated callers). **→ ✅ RESOLVED 2026-06-04 (G2/B1 — the description above is now historical).** Admin read/write for BOTH `config` and `groups` moved to **gated** `/api/admin/livechat/{config,groups}` (`defineRoute` + `repoForOrg`, `orgId` STRICTLY from session, `requireRole:['admin','owner']` on writes). The anonymous `/api/livechat/config` has **no PUT** and its GET returns only non-sensitive fields; the anonymous `/api/livechat/groups` no longer reads `orgId` from the query. Guard: `app/api/admin/livechat/__tests__/livechat-b1-guard.test.ts`.

## 5. Build / test / deploy

```bash
# Local gate (run before every commit)
npx tsc --noEmit -p apps/console/tsconfig.json   # must be 0 errors
npm test                                          # see note below
npm run build:console                             # must succeed

# Deploy (push-to-deploy; post-receive hook → scripts/deploy.sh)
git remote add deploy ssh://intera@43.134.51.138/var/git/intera.git   # one-time
git push deploy main
#   → checkout -f → npm ci → db:generate → build:console → cp static → systemctl restart → health check
```

**Test note:** `lib/livechat/__tests__/integration/db-integration.test.ts` fails locally — it targets a PostgreSQL instance not available from local dev. Pre-existing, unrelated; everything else should be green.

### Server quick reference
```bash
ssh ubuntu@43.134.51.138                     # see credentials note below
sudo journalctl -u intera-console -f         # app logs
sudo journalctl -u caddy -f                  # proxy logs
sudo systemctl restart intera-console
sudo nano /etc/intera/console.env            # env; restart after editing
sudo -u postgres psql -d intera              # DB
cd ~/intera-agent && ./scripts/deploy.sh     # manual deploy if hook fails
```

## 6. Credentials & secrets

- **SSH:** `ssh ubuntu@43.134.51.138`. The password is stored in the team password manager. **Do NOT change the SSH password, do NOT rotate it, do NOT switch to key-only auth.** Use it as-is, always. This is a standing explicit user instruction — the SSH credential must remain untouched.
- **TLS bundle:** `/Users/curtis/Desktop/scs1751876232493_.anytrans.ai`.
- **Server env:** `/etc/intera/console.env`.
- Useful greps:
  - `grep -rn "dryRun" apps/console/lib/agent/loop.ts` — dry-run gates
  - `grep -rn "prisma\." apps/console/lib/agent/loop.ts` — audit DB writes
  - `npx vitest run apps/console/lib/agent/__tests__/integration/playground-isolation.test.ts` — isolation guard

---

*For the current state of work, the remaining backlog, and what to do next, read [`MASTER_BUILD_HANDOFF.md`](./MASTER_BUILD_HANDOFF.md).*

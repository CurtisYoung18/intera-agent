# Generic Handoff — Intera Agent

**Last updated:** 2026-06-08 (architect: reconciled with the Foundation Reset docs) | **Branch:** `main` | **Audience:** any coding agent picking up this project cold.

> **Coordination docs in this folder:**
> 1. **`GENERIC_HANDOFF.md`** (this file) — stable project context. Changes rarely.
> 2. **`MASTER_BUILD_HANDOFF.md`** — the live macro backlog: what's left, in what order, and which `doc/to-do/` guide covers each item.
> 3. **`HARD_BUGS.md`** — open landmines and resolved bug lessons.
>
> Concrete, code-level task guides live in **[`doc/to-do/`](../../doc/to-do/)** — one file per task with exact paths, line numbers, and verification steps.

---

## 0. How work flows here (read this first — 铁律)

1. **This file = context. `MASTER_BUILD_HANDOFF.md` = the plan. `doc/to-do/*` = the steps.** Don't duplicate task detail into the handoffs; put it in a `doc/to-do/` guide and link it from the master build handoff.
2. **Every time you finish a `doc/to-do/` item:** (a) move the guide to `doc/what's done/`, and (b) update `MASTER_BUILD_HANDOFF.md` — flip the item's status, note the commit, and re-state what's now unblocked. **The master build handoff must never lie about current state.**
3. **Receipt required for every task:** Two-phase verification (both must pass):

   **Phase 1 — Local gate (before commit):**
   - `npx tsc --noEmit -p apps/console/tsconfig.json` → 0 errors
   - `env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test` → all passing (keyless gate; known-fail db-integration excluded)
   - `npm run build:console` → success
   - List all changed files

   **Phase 2 — Production verification (after deploy):**
   - Deploy: `git push deploy main` → wait for health check `curl -s https://demo.anytrans.ai/api/health` → `{"status":"ok"}`
   - Open production site with Playwright MCP and log in (credentials in §6)
   - **Verify every changed page/feature** through the browser — click the golden path, test edge cases, confirm error states don't crash
   - Take screenshots of key interactions as evidence
   - Paste the verification log: pages visited, actions taken, results observed, screenshots captured

   **Why two phases:** Phase 1 catches compile/logic errors. Phase 2 catches the bugs static checks miss — UI state bugs, interaction failures, cross-page consistency breaks, and runtime crashes in production. If a coding agent claims "done" without Phase 2, it's not done.

4. **Every safety/isolation change ships an e2e guard test with red→green proof.** Tests that exercise mocks/constructors ("seam tests") don't count — drive the real entry point.
5. **Deploy freely during internal-test phase.** The app serves zero real customers — deploy per-task and verify immediately. The old "minimize deployments" rule is suspended until launch. However: never deploy a broken build (Phase 1 must pass first), and never leave the site broken (if production verification fails, fix it immediately).
6. **Handoffs may be stale — verify before relying.** The branch SHA in the header tells you how old this is; `git log` tells you what landed since.
7. **Assume parallel work by default.** You are never the only coding session working on this project. Other agents are editing files, committing, and deploying right now — you do not need to be told this. Act accordingly. **When you encounter a file conflict or are unsure whether your changes will collide with another active lane, stop and ask the user before proceeding.** Guessing wrong wastes everyone's time; a 30-second confirmation does not.

### Parallel work protocol

You are one of several coding sessions running at the same time. This is the default state — no one will warn you. Follow this protocol every time you start a task. **The rule is simple: declare files before touching them, and escalate uncertainty to the user.**

**Before starting work:**

1. **Read `MASTER_BUILD_HANDOFF.md`** — check the "Active Lanes" section. Note which files each active lane owns. Assume the table is up to date.
2. **Identify the files you'll touch** — skim the task spec and list every file you expect to edit.
3. **Check for conflicts** — do any of your files appear in another active lane's file list?
   - **No conflict →** declare your lane (add a row to the Active Lanes table), then start work.
   - **Conflict →** do not guess. Do not try to "work around" it silently. **Ask the user.** Tell them which files overlap and let them decide: wait for that lane, reassign files, or proceed sequentially.
4. **The same file cannot be owned by two lanes simultaneously.** If two tasks legitimately need the same file, only the user can decide how to sequence them.

**While working:**

- **Stick to your declared files.** If you discover you need to touch an additional file, check the Active Lanes table again. If it's owned by another lane: ask the user.
- **Any time you're unsure about a potential conflict → ask the user.** "I need to edit X but Lane B declared it — ok to proceed or should I wait?" Costs 30 seconds. A merge conflict costs much more.
- **Dictionaries (`dictionaries.ts`) are a shared hotspot.** This file is frequently touched by multiple lanes for i18n keys. Two rules:
  - Pre-declare ALL the i18n keys your task will add, and list them in your lane's Active Lanes entry
  - If another lane is adding keys, add yours in a **non-overlapping section** (separated by blank lines), so git can merge without conflict
- **Schema (`schema.prisma`) is read-only for most lanes.** Only the lane explicitly tasked with schema changes may touch it. Other lanes: read the schema, do not edit it.

**Before committing:**

```
git pull --rebase origin main          # integrate other lanes' commits
```

**If `git pull --rebase` produces a conflict → stop and ask the user.** Do not resolve merge conflicts on your own unless you are certain you understand both sides of the change.

**After completing:**

- Remove your lane from the Active Lanes table in `MASTER_BUILD_HANDOFF.md`
- Your commit is now on `main` — other lanes will pick it up on their next `git pull --rebase`

---

## 1. What this is

**Intera Agent** is a multi-tenant SaaS customer-service AI platform. Next.js monorepo (`apps/console` + `packages/shared`), self-hosted on an Ubuntu box, served at `https://demo.anytrans.ai`.

The current tree is past the first Foundation Reset wave through R2. The target architecture is a **single Case Owner Agent** with CaseType + Procedure + Tool + Hook (`PreToolUse`, `PostToolUse`, `Stop`), inline Procedure continuation, and no customer-facing background worker dispatch. Follow [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md), [`POST_FOUNDATION_DISPATCH_PROMPTS.md`](./POST_FOUNDATION_DISPATCH_PROMPTS.md), and [`../spec/Intera_Harness_架构梳理.md`](../spec/Intera_Harness_架构梳理.md) for new work.

> ⚠️ **2026-06-06 data-model pivot — config is now AGENT-scoped, not org-scoped.** Migration `20260606000000_agent_scoped_architecture` moved current sub-module config rows from `org_id` to `agent_config_id` (old `org_id` columns dropped, old rows deleted), and dropped `policyHooks` + `capabilityBindings` from `AgentConfig`. **Consequence:** the `repoForOrg`/`scopedModel` proxy scopes by `orgId`, which these models no longer carry — so sub-module routes use `repo.raw.*` and scope by `agentConfigId` manually, with an orgId→agentConfig ownership check as the real isolation boundary. L5 is resolved by `assertAgentInOrg()`, but keep this boundary in mind when editing admin sub-module routes. `capabilityBindings` and `policyHooks` are **gone**.

```
apps/console/             ← the only app (apps/chat was deleted post-migration)
  app/api/messages/       ← main SSE entry point (LiveChat + API consumers)
  app/api/admin/          ← console admin CRUD + agent-configs + playground
  app/api/auth/           ← login / session / switch-org / logout
  lib/agent/              ← core AI engine (AgentLoop, Tool executor, HookEngine, ProcedureExecutor, trace, memory)
  lib/livechat/           ← LiveChat bridge (webhook → /api/messages → SSE)
  lib/session.ts          ← signed HMAC-SHA256 session token (no external dep)
  lib/auth.ts             ← getSession / getActiveOrgId / getActiveVendor (verified session only)
  lib/api-auth.ts         ← Bearer-key resolution + isTrustedInternalCall
  middleware.ts           ← edge gate for /admin /ops + gated /api/*
  components/             ← React (sidebar, docked-preview, admin editors)

packages/shared/
  prisma/schema.prisma    ← Agent-scoped config models including Tool, Hook, HookBinding, CaseType, KnowledgeSource, ChannelBinding, Scenario, and durable Case shells.
  types/index.ts          ← SSEEvent, AgentConfigData, Tool/Hook/Scenario contracts.
  defaults/index.ts       ← default system prompts, memory strategies, Tool defaults, Hook defaults.
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
  → HookEngine checkpoints run in-memory
  → Procedure continuation stays inline in the Case Owner Agent loop
```

## 3. Key files

| File | Role |
|---|---|
| `apps/console/lib/agent/loop.ts` | Core AgentLoop (~1,819 lines). Persistence port + dryRun injected at constructor. |
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
7. **Channel-config endpoints (livechat `config`/`groups`) once took org from a query param — ✅ RESOLVED 2026-06-04 (G2/B1).** Admin read/write moved to gated `/api/admin/livechat/{config,groups}` (`defineRoute` + `repoForOrg`, orgId strictly from session, `requireRole:['admin','owner']` on writes). Anonymous `/api/livechat/config` has no PUT and returns only non-sensitive fields; anonymous `/api/livechat/groups` no longer reads orgId from the query. Guard: `app/api/admin/livechat/__tests__/livechat-b1-guard.test.ts`.

## 5. Build / test / deploy

```bash
# Phase 1 — Local gate (run before every commit)
npx tsc --noEmit -p apps/console/tsconfig.json   # must be 0 errors
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # keyless gate
npm run build:console                             # must succeed

# Deploy (push-to-deploy; post-receive hook → scripts/deploy.sh)
git remote add deploy ssh://intera@43.134.51.138/var/git/intera.git   # one-time
git push deploy main
#   → checkout -f → npm ci → db:generate → build:console → cp static → systemctl restart → health check

# Wait for deploy to complete
curl -s https://demo.anytrans.ai/api/health   # expect {"status":"ok","db":"connected"}
```

**Test note:** local Postgres is now the expected dev DB. Bring it up with `docker compose up -d postgres` before DB integration tests.

**Local browser-smoke note:** before spending time on authenticated local browser flows, read [`BROWSER_SMOKE_RUNBOOK.md`](./BROWSER_SMOKE_RUNBOOK.md). Console auth uses a `secure: true` session cookie, so HTTP localhost smoke can redirect to login or return `401` even when login succeeds. Timebox local auth debugging to 10 minutes; do not hand-roll JWT/cookie/HTTPS harnesses inside feature lanes.

### Phase 2 — Production verification procedure

After every deploy, verify the changes work on the live site. Use Playwright MCP (`mcp__playwright__*` tools) to automate browser verification.

**Step-by-step:**

```
1. browser_navigate → https://demo.anytrans.ai/
2. Verify login page loads (brand logo, two-panel layout, "Staff" tab)
3. Click "Staff" tab → fill email: test@intera.dev, password: intera123 → submit
4. Verify redirect to /admin → sidebar visible, agent list loaded
5. Navigate to each changed page. For each page:
   a. Verify page renders without crash (no white screen, no infinite spinner)
   b. Verify data loads (no stuck skeleton, actual content visible)
   c. Exercise the changed interaction (click buttons, fill forms, toggle switches)
   d. Verify feedback states (loading spinner → success confirmation → updated data)
   e. Test error path: what happens with empty input / invalid value?
6. Take screenshots at key moments as evidence
7. Paste the verification log in your receipt
```

**Verification log template (paste in your receipt):**

```
## Production verification
- Deploy health: {"status":"ok","db":"connected"}
- Login: ✓ test@intera.dev → /admin
- Page: /admin/XXX — ✓ renders, ✓ data loads, ✓ interaction works
- Edge cases: [list what you tested]
- Screenshots: [list file paths]
- Verdict: ✓ all pages functional / ✗ issues found: [describe]
```

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

- **Production test account:** `test@intera.dev` / `intera123` — admin on `default` org (Test). Use this for all production verification. This user has role `admin` (not `owner`), so some owner-only operations (e.g., changing owner roles) require the owner account.
- **SSH:** `ssh ubuntu@43.134.51.138`. The owner provided the SSH password in this Codex thread on 2026-06-08 for deployment use. If the credential is available in the current thread/session, use it without asking again. **Do NOT write the password into git, docs, `.env`, shell history, screenshots, logs, or command output. Do NOT change the SSH password, do NOT rotate it, do NOT switch to key-only auth.** Use it as-is, always. This is a standing explicit user instruction — the SSH credential must remain untouched.
- **TLS bundle:** `/Users/curtis/Desktop/scs1751876232493_.anytrans.ai`.
- **Server env:** `/etc/intera/console.env`.
- Useful greps:
  - `grep -rn "dryRun" apps/console/lib/agent/loop.ts` — dry-run gates
  - `grep -rn "prisma\." apps/console/lib/agent/loop.ts` — audit DB writes
  - `npx vitest run apps/console/lib/agent/__tests__/integration/playground-isolation.test.ts` — isolation guard

---

*For the current state of work, the remaining backlog, and what to do next, read [`MASTER_BUILD_HANDOFF.md`](./MASTER_BUILD_HANDOFF.md).*

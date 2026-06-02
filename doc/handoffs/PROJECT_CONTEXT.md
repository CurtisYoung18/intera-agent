# Handoff: Intera Agent — Post-Phase B Reference

**Last updated:** 2026-06-02 | **Branch:** `main` @ TBD | **Status:** Post-Phase B + C1 (multi-agent UI) complete

> This is a **generic context document** for any coding agent picking up this project.
> Concrete tasks live in [doc/to-do/](../../doc/to-do/).

> ssh config:
ssh ubuntu@43.134.51.138
70?kwi@Kmqt(dtY

**CAREFULL** MUST NOT CHANGE THE SSH PW, JUST USE IT.


> credentials
see `/Users/curtis/Desktop/scs1751876232493_.anytrans.ai`

> console login
- `/login` page accepts two modes
- **Staff**: single shared password (env `STAFF_PASSWORD`) — may switch orgs
- **Customer**: per-org bcrypt password (env `API_ORG_PASSWORD` for the seeded `api` org)
- Server env: `/etc/intera/console.env` on `43.134.51.138`
- Required env for login to work: `SESSION_SECRET` (random 32-byte hex), `STAFF_PASSWORD`, `API_ORG_PASSWORD`
- See `.env.example` for placeholders

---

## Process Rules (铁律)

1. **Master planning handoffs** live in `doc/handoffs/`. When a phase completes, move the previous handoff to `doc/what's done/` and create a new one.

2. **Specific implementation tasks** must have detailed code-level guides in `doc/to-do/`. Each guide includes exact file paths, line numbers, and verification steps. After completion **and user approval**, move the guide to `doc/what's done/`.

3. **Audit `doc/to-do/` periodically**: move completed items to `doc/what's done/`, consolidate remaining items into a single todo. Never leave stale to-do files.

4. **Every safety/isolation change** must deliver an e2e guard test with red→green proof. "Seam tests" (testing mocks/constructors) don't count — must drive the real pipeline entry point.

5. **Receipt required** for every task: changed files, verification output (`tsc` + `npm test` + `npm run build:console`), UI items with Chrome screenshots.

6. **Minimize deployments**: test thoroughly locally before deploying. Deploy at normal major-version cadence — not per-commit. Batch changes into meaningful releases.

---

## Project Summary

**Intera Agent** is a multi-tenant SaaS customer-service AI platform. It's a Next.js monorepo (`apps/console` + `packages/shared`) running on a self-hosted Ubuntu server at `demo.anytrans.ai`.

The AI engine (`lib/agent/loop.ts`) is a ReAct loop with streaming tool execution, stage-based state machine, sub-agent orchestration, policy engine, and LiveChat bridge.

---

## Architecture

```
apps/console/          ← the only app (apps/chat deleted post-migration)
  app/api/messages/    ← main SSE entry point (LiveChat + API consumers)
  app/api/admin/       ← console admin CRUD + agent-configs + playground
  lib/agent/           ← core AI engine (AgentLoop, skills, policy, trace, etc.)
  lib/livechat/        ← LiveChat bridge (webhook → /api/messages → SSE)
  components/          ← React components (sidebar, docked-preview, etc.)

packages/shared/
  prisma/schema.prisma ← 21 models (Organization, AgentConfig, Case, ApiKey, etc.)
  types/index.ts       ← SSEEvent, SkillDefinition, AgentConfigData, etc.
  defaults/index.ts    ← default system prompts, memory strategies, policy hooks
```

### Auth (multi-tenant, signed session)

```
External API → Bearer intera_sk_live_... → resolveOrgFromApiKey() → sha256 lookup
  → orgId from ApiKey table (NEVER from request body)

LiveChat webhook → /api/livechat/webhook/:orgId (webhookSecret validation)
  → bridge.ts → x-intera-internal + x-intera-org headers → /api/messages
  → isTrustedInternalCall() → orgId from header

Console UI → signed `intera_session` cookie (HMAC-SHA256 JWT in `lib/session.ts`)
  → verifySessionToken() → { role: 'staff' | 'customer', orgId, exp }
  → middleware blocks /admin /ops /api/admin|ops|chats|users when invalid
```

### Playground dry-run isolation

```
AgentLoop.create({ persistence: MemoryPersistence, dryRun: true })
  → all prisma writes → memory port (zero DB)
  → StreamingToolExecutor(..., dryRun) → operational tools mocked at dispatch entry
  → TraceWriter(..., dryRun) → no-ops actionTrace.create
  → SkillRouter.create(orgId, dryRun) → skips knowledgeSource.update heal
  → OrchestratorAgent.dispatchInBackground → guarded by if(!this.dryRun)
```

---

## Key Files

| File | Role |
|---|---|
| `apps/console/lib/agent/loop.ts` | Core AgentLoop (2000+ lines). Persistence port + dryRun injected at constructor. |
| `apps/console/lib/agent/streaming-tool-executor.ts` | Tool dispatch. `dryRun` chokepoint at `runTrackedTool`:211. |
| `apps/console/lib/agent/persistence-port.ts` | `PersistencePort` interface + `PrismaPersistence` + `MemoryPersistence`. |
| `apps/console/lib/agent/playground-runner.ts` | `runPlaygroundTurn()` — accepts optional `configId` for multi-agent. |
| `apps/console/lib/agent/config-cache.ts` | Config cache keyed `orgId::agentId` (falls back to `orgId`). |
| `apps/console/lib/session.ts` | Signed HMAC-SHA256 JWT session token (no external dep). |
| `apps/console/lib/auth.ts` | `getSession()`, `getActiveOrgId()`, `getActiveVendor()` — all read verified session. |
| `apps/console/middleware.ts` | Edge gate: redirects `/admin` `/ops` to `/login`; returns 401 for gated API. |
| `apps/console/app/api/admin/agent/route.ts` | GET/PUT `/api/admin/agent` — accepts `?agentId=` (fallback to first config). |
| `apps/console/app/api/admin/agent-configs/route.ts` | GET/POST — list/create agent configs. POST accepts `templateId` for duplicate. |
| `apps/console/app/api/admin/agent-configs/[id]/route.ts` | DELETE — refuses to delete the only config. |
| `apps/console/app/api/auth/login/route.ts` | Issues `intera_session` cookie. Needs `STAFF_PASSWORD` (staff mode) or per-org bcrypt (customer mode). |
| `apps/console/components/console-sidebar.tsx` | Agent switcher dropdown + duplicate/delete buttons. NEW badge removed from playground. |
| `apps/console/app/admin/agent/page.tsx` | Wrapped in `<Suspense>` for `useSearchParams`. Agent selector dropdown at top. |
| `packages/shared/ui/intera-logo.tsx` | 2-phase cycle: INTERA → IA → AI (auto-swaps after 600ms). |

---

## Gotchas & Pitfalls

1. **Prisma standalone embed:** Next standalone embeds Prisma schema at build time. Always: `db:generate` → `build:console` → `cp static+public`.
2. **Prisma monorepo type duplication:** `node_modules/.prisma/client/index.d.ts` has `coreSystemPrompt` defined 3 times — Prisma 6 monorepo codegen bug. Causes seed failure for `api` org. Fix: add explicit `output` path to generator client.
3. **SWC multi-line className:** Next.js SWC compiler fails with "Unterminated string constant" when `className` spans two lines. Keep all `className` strings single-line.
4. **SSE + Caddy:** `flush_interval -1` is critical. Without it, SSE buffers.
5. **Cert renewal:** Manual RapidSSL wildcard (`*.anytrans.ai`), expires 2026-07-22. Caddy auto-renews Let's Encrypt for `demo.anytrans.ai`. Durable cron monitors expiry for the wildcard.

---

## Server Quick Reference

### Push-to-Deploy (primary)

```bash
# One-time setup on server (as root):
/home/intera/intera-agent/deploy/setup-bare-repo.sh

# On local machine — add deploy remote (one-time):
git remote add deploy ssh://intera@43.134.51.138/var/git/intera.git

# Deploy: push = checkout + build + restart
git push deploy main
```

### Post-receive hook chain

```
git push deploy main
  → /var/git/intera.git (bare repo, post-receive hook fires)
    → git checkout -f main → /home/intera/intera-agent
      → sudo -u intera scripts/deploy.sh
        → npm ci → db:generate → build:console → cp static → systemctl restart
```

### Manual server commands

```bash
# SSH
ssh ubuntu@43.134.51.138

# Logs
sudo journalctl -u intera-console -f
sudo journalctl -u caddy -f

# Restart app
sudo systemctl restart intera-console

# Edit env
sudo nano /etc/intera/console.env
sudo systemctl restart intera-console

# DB access
sudo -u postgres psql -d intera

# Manual deploy (if hook fails)
cd ~/intera-agent && ./scripts/deploy.sh
```

---

## Search Queries

- `grep -rn "dryRun" apps/console/lib/agent/loop.ts` — dry-run gates in AgentLoop
- `grep -rn "prisma\." apps/console/lib/agent/loop.ts` — audit all DB writes
- `grep -rn "findUnique\|findFirst" apps/console/app/api --include="*.ts"` — audit AgentConfig queries
- `npx vitest run apps/console/lib/agent/__tests__/integration/playground-isolation.test.ts` — guard test

---

## Tests

```bash
npm test                    # 25 passed, 1 failed (DB connectivity pre-existing), 2 skipped
npm run build:console       # must succeed
npx tsc --noEmit -p apps/console/tsconfig.json  # 0 errors
```

The single failing test is `db-integration.test.ts` which requires live PostgreSQL
connectivity to a now-defunct Railway instance — pre-existing, unrelated to current work.

---

## Latest Progress (2026-06-02)

**Post-Phase B complete (committed `6346c23`)**:
- Deleted `apps/chat` (155 files, 26k LOC); fixed 2 broken imports; i18n path updates
- 14 LLM models live (MiniMax × DeepSeek × OpenRouter × 3)
- LiveChat webhooks configured to `demo.anytrans.ai/api/livechat/webhook/default`
- GitHub deploy key set up; `git push deploy main` triggers full build+restart

**C1 multi-agent UI (admin/management only, runtime routing deferred to C2)**:
- `AgentConfig` schema gained `@@unique([orgId, name])`
- New DELETE endpoint `/api/admin/agent-configs/[id]`
- POST `/api/admin/agent-configs` accepts `templateId` for duplicate
- GET/PUT `/api/admin/agent` accepts `?agentId=`
- Config cache now keyed `orgId::agentId`
- Admin agent page has agentId dropdown + Suspense wrapper
- Sidebar agent switcher wires up to `?agentId=` nav + duplicate/delete buttons
- Playground uses selected agent config (reads from localStorage)

**Logo animation**: 2-phase cycle (INTERA → IA → AI in one transition, no pause at IA).

**Cleanup**:
- Removed `/ops/human-tasks` (orphaned), `/embed/human-tasks`, `/api/human-tasks/*`,
  `/api/cases/[id]/{stream,message}` (legacy web-chat), `event-translators.ts` shim,
  `propose_interaction` disabled skill.

---

*Refer to [doc/to-do/](../../doc/to-do/) for current task list and detailed implementation guides.*

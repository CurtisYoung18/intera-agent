# Handoff: Intera Agent — Post-Phase B Reference

**Last updated:** 2026-06-02 | **Branch:** `main` @ `57f2ea3`

> This is a **generic context document** for any coding agent picking up this project.  
> Concrete tasks live in [doc/to-do/](../../doc/to-do/). See [2026-06-02-post-phase-b-cleanup.md](../../doc/to-do/2026-06-02-post-phase-b-cleanup.md) for the current task list.

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

### Auth (multi-tenant)

```
External API → Bearer intera_sk_live_... → resolveOrgFromApiKey() → sha256 lookup
  → orgId from ApiKey table (NEVER from request body)

LiveChat webhook → /api/livechat/webhook/:orgId (webhookSecret validation)
  → bridge.ts → x-intera-internal + x-intera-org headers → /api/messages
  → isTrustedInternalCall() → orgId from header

Console UI → cookie intera_auth=1 + intera_org_id → getActiveOrgId()
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
| `apps/console/lib/agent/playground-runner.ts` | `runPlaygroundTurn()` — creates AgentLoop with memory port + dryRun. |
| `apps/console/lib/agent/__tests__/integration/playground-isolation.test.ts` | E2E guard test. 10 scenarios. Must stay green. |
| `packages/shared/prisma/schema.prisma` | 21 models. `ApiKey` still has `agentConfigId?` (YAGNI, to be removed). |
| `apps/console/app/api/admin/playground/run/route.ts` | SSE endpoint. Admin cookie auth. |
| `apps/console/components/docked-preview.tsx` | Slide-in test panel. SWC bug: multi-line classNames break build. |

---

## Gotchas & Pitfalls

1. **Prisma standalone embed:** Next standalone embeds Prisma schema at build time. Always: `db:generate` → `build:console` → `cp static+public`.
2. **Prisma monorepo type duplication:** `node_modules/.prisma/client/index.d.ts` has `coreSystemPrompt` defined 3 times — Prisma 6 monorepo codegen bug. Causes seed failure for `api` org. Fix: add explicit `output` path to generator client.
3. **`agentConfigId` YAGNI:** `packages/shared/prisma/schema.prisma:36` still has the field. Was supposed to be removed in `9899c74`. Dead code, remove it.
4. **SWC multi-line className:** `docked-preview.tsx` has a classname spanning two lines. Next.js SWC compiler fails with "Unterminated string constant." Keep all `className` strings single-line.
5. **SSE + Caddy:** `flush_interval -1` is critical. Without it, SSE buffers.
6. **`apps/chat` not deleted:** Kept as reference. Console doesn't depend on it.
7. **Cert renewal:** Manual cert, expires 2026-07-22. No auto-renewal.

---

## Server Quick Reference

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

# Deploy (bundle method)
git bundle create /tmp/intera-agent.bundle main
scp /tmp/intera-agent.bundle ubuntu@43.134.51.138:/tmp/
ssh ubuntu@43.134.51.138 "sudo -iu intera bash -c 'cd ~/intera-agent && git remote set-url origin /tmp/intera-agent.bundle && git pull origin main && npm ci && npm run db:generate && npm run build:console && cp -r apps/console/.next/static apps/console/.next/standalone/apps/console/.next/static && cp -r apps/console/public apps/console/.next/standalone/apps/console/public && sudo cp -r node_modules/.prisma apps/console/.next/standalone/node_modules/.prisma && sudo systemctl restart intera-console && curl -s localhost:3000/api/health'"
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
npm test                    # 421 passed, 0 failed, 29 skipped
npm run build:console       # must succeed
npx tsc --noEmit -p apps/console/tsconfig.json  # 0 errors
```

---

*Refer to [doc/to-do/](../../doc/to-do/) for current task list and detailed implementation guides.*

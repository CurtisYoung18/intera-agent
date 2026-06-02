# Handoff: Phase B UI + Ubuntu Production Deployment

**Created:** 2026-06-02
**Branch:** `main` @ `654bde9`
**Covers:** Phase A migration completion → Phase B UI (B1–B5) → Ubuntu deployment to `demo.anytrans.ai`

---

## Summary

Intera Agent is a multi-tenant SaaS customer-service AI platform. This session completed Phase B UI refactor (B1 InteraLogo animation, B2 sidebar restructure, B3 Playground, B4 Docked Preview, B5 Dashboard) and performed a full production deployment to a self-hosted Ubuntu server at `43.134.51.138` / `demo.anytrans.ai`. The app is **live and serving HTTPS** with a valid wildcard cert. Three remaining items: real LLM API keys not yet injected, SSH password rotation pending, and a Prisma seed bug (non-blocking) still present.

---

## Work Completed

### Phase A (prior session, already merged)
- [x] 54 agent engine files migrated from `apps/chat` → `apps/console`
- [x] Multi-tenant org isolation: `orgId` from Bearer API key, never from request body
- [x] `ApiKey` table + `resolveOrgFromApiKey()` + `isTrustedInternalCall()` auth
- [x] Auth gate moved **before** `ReadableStream` (was returning HTTP 200 with SSE error — fixed in `6d734eb`)
- [x] LiveChat bridge self-call uses `x-intera-internal` header + `INTERNAL_API_SECRET`

### Phase B UI
- [x] **B1** InteraLogo: JS-measured width animation, 3-phase auto-cycle (Intera / I / Ia), Cormorant Garamond loaded in `layout.tsx`, `--font-serif` defined in globals
- [x] **B2** Sidebar: BUILD/OPERATE groups, i18n keys, sub-agents orphan page removed, bottom pull-up panel
- [x] **B3** Playground: real AgentLoop pipeline with `PersistencePort` injection + `dryRun:true`, 6-stage trace aggregation, SSE endpoint `/api/admin/playground/run`, 3-column UI
- [x] **B4** Docked Preview: 420px slide-in panel, "Test agent" button (fixed top-right), tabs Chat/Trace, `localStorage` state persistence
- [x] **B5** Dashboard: 4-metric grid + Recent Cases table + Channel Health

### Playground safety (3 bypass fixes by reviewer, not coding agent)
- [x] `dispatch_case_agent` → `OrchestratorAgent.dispatchInBackground` guarded by `if(!this.dryRun)` in `loop.ts:1268`
- [x] `TraceWriter.write()` → added `dryRun` param, no-ops `prisma.actionTrace.create` when `dryRun=true`
- [x] `SkillRouter` auto-heal → entire `prisma.knowledgeSource.update` block skipped when `dryRun=true`
- [x] E2E guard test `playground-isolation.test.ts` — drives real `runPlaygroundTurn`, red-before-green proven

### Ubuntu Deployment
- [x] Node 20 LTS installed
- [x] PostgreSQL installed, `intera` user + `intera` database created
- [x] Repo cloned from git bundle (private repo → bundle upload via scp)
- [x] `npm ci` + `npm run db:generate` + `npm run build:console` — successful
- [x] static + public copied into standalone; Prisma engine in standalone
- [x] `/etc/intera/console.env` created with generated `INTERNAL_API_SECRET`
- [x] TLS cert installed: `/etc/intera/tls/demo.anytrans.ai.{crt,key}` (wildcard `*.anytrans.ai`, DigiCert, expires 2026-07-22)
- [x] Caddy configured with manual TLS (no Let's Encrypt) + `flush_interval -1` for SSE
- [x] `intera-console.service` systemd unit installed, enabled, running
- [x] `db:push` — all 21 tables created
- [x] Partial seed: `default` org fully seeded; `api` org AgentConfig inserted via raw SQL

---

## Key Decisions

| Decision | Rationale | Alternatives |
|---|---|---|
| Manual TLS cert (not Caddy auto-TLS) | Pre-issued wildcard `*.anytrans.ai` DigiCert cert provided; no ACME needed | Caddy auto-TLS (requires port 80 open + Let's Encrypt) |
| Git bundle (not `git clone`) | Repo is private, server has no GitHub credentials | SSH deploy key, GitHub token, make repo public |
| `PersistencePort` abstraction for playground | Single seam isolates all DB writes; `MemoryPersistence` no-ops all | `dryRun` flags scattered per-call, `vi.mock` only in tests |
| Reviewer fixed 3 bypasses instead of coding agent | Agent's "100% coverage" audit only checked `loop.ts`, missed `trace.ts`, `skills.ts`, and the orchestrator dispatch (loop-internal control flow, not tool path) | Wait for another round-trip |
| DB password `Intera2026Pg!` | Temporary strong-enough for initial deploy | Rotate to random after SSH key auth is set up |

---

## Files Affected

### New Files (this session)
- `packages/shared/ui/intera-logo.tsx` — JS-width-measured 3-phase animated wordmark
- `apps/console/lib/agent/persistence-port.ts` — `PersistencePort` interface + `PrismaPersistence` + `MemoryPersistence`
- `apps/console/lib/agent/dry-run-executor.ts` — `isSafeInDryRun()` + mock helpers
- `apps/console/lib/agent/playground-runner.ts` — `runPlaygroundTurn()` async generator (real AgentLoop)
- `apps/console/lib/agent/trace-aggregator.ts` — 6-stage trace aggregation
- `apps/console/app/api/admin/playground/run/route.ts` — SSE endpoint
- `apps/console/app/admin/playground/page.tsx` — 3-column UI (ConfigPanel / TestChat / TraceInspector)
- `apps/console/components/docked-preview.tsx` — Docked Preview slide-in panel
- `apps/console/app/ops/dashboards/page.tsx` — Dashboard redesign
- `apps/console/lib/agent/__tests__/integration/playground-isolation.test.ts` — E2E guard test
- `deploy/Caddyfile.demo-anytrans.ai` — Production Caddyfile (manual cert)

### Modified (this session)
- `apps/console/app/layout.tsx` — Added Cormorant Garamond to Google Fonts URL
- `apps/console/app/globals.css` — Added `--font-serif`, `.intera-logo` CSS, `color: var(--mist)`
- `apps/console/components/console-sidebar.tsx` — Replaced wordmark with `<InteraLogo>`, BUILD/OPERATE groups, bottom panel
- `apps/console/lib/agent/loop.ts` — `dryRun` + `persistence` injection, `if(!this.dryRun)` around `OrchestratorAgent.dispatchInBackground`, `TraceWriter` constructed with `dryRun` flag, `SkillRouter.create` receives `dryRun`
- `apps/console/lib/agent/trace.ts` — `TraceWriter` constructor takes `dryRun?: boolean`; `write()` skips prisma when `dryRun=true`
- `apps/console/lib/agent/skills.ts` — `SkillRouter.create(orgId, dryRun?)`: heal block inside `if(!dryRun)`
- `packages/shared/package.json` — Added `"./memory/*": "./memory/*.ts"` to exports (vitest resolution)
- `deploy/Caddyfile` — SSE flush config (committed earlier)
- `scripts/deploy.sh` — Update script (committed earlier)

### Deployment-only (on server, not in repo)
- `/etc/intera/console.env` — Production env vars (LLM keys are PLACEHOLDER, must fill)
- `/etc/intera/tls/demo.anytrans.ai.crt` — Nginx fullchain cert
- `/etc/intera/tls/demo.anytrans.ai.key` — Private key (chmod 600)
- `/etc/caddy/Caddyfile` — Same as `deploy/Caddyfile.demo-anytrans.ai`
- `/etc/systemd/system/intera-console.service`

---

## Technical Context

### Server
- **Host:** `43.134.51.138` (Tencent Cloud, Ubuntu 24.04, 99GB disk, 7.4GB RAM)
- **Domain:** `demo.anytrans.ai` → A record → `43.134.51.138`
- **NAT:** Tencent Cloud NAT, internal IP `172.22.16.7`
- **Ports open:** 22 (SSH), 80 (HTTP→HTTPS redirect), 443 (HTTPS)
- **Ports NOT exposed:** 3000 (app), 5432 (Postgres)

### Credentials (rotate these)
- SSH: `ubuntu@43.134.51.138` — **password was exposed in chat, must rotate immediately**
- DB: `postgresql://intera:Intera2026Pg!@localhost:5432/intera`
- `INTERNAL_API_SECRET`: generated with `openssl rand -hex 32`, stored in `/etc/intera/console.env`
- TLS cert: expires **2026-07-22** — set a calendar reminder to renew

### Deployment process (for future updates)
```bash
# From your Mac: bundle latest main
git bundle create /tmp/intera-agent.bundle main
scp /tmp/intera-agent.bundle ubuntu@43.134.51.138:/tmp/

# On server (or use scripts/deploy.sh)
ssh ubuntu@43.134.51.138
sudo -iu intera
cd ~/intera-agent
git remote set-url origin /tmp/intera-agent.bundle
git pull origin main
npm ci && npm run db:generate && npm run build:console
cp -r apps/console/.next/static apps/console/.next/standalone/apps/console/.next/static
cp -r apps/console/public apps/console/.next/standalone/apps/console/public
sudo systemctl restart intera-console
curl localhost:3000/api/health
```

> **Better long-term:** add a GitHub deploy key to the server so `git pull` works directly.

### Architecture: multi-tenant auth flow
```
LiveChat webhook → /api/livechat/webhook/:orgId (per-org webhookSecret validation)
  → bridge.ts → x-intera-internal + x-intera-org headers → /api/messages
  → isTrustedInternalCall() → orgId from header (never from body)

External API → Bearer intera_sk_live_... → resolveOrgFromApiKey() → sha256 lookup
  → orgId from ApiKey table (never from request body)
```

### SSE + Caddy
Caddy `flush_interval -1` is **critical** for streaming. Without it, SSE responses buffer and arrive all at once. The matcher covers `/api/messages` and `/api/cases/*/stream`.

---

## Gotchas & Pitfalls

1. **Prisma standalone embed:** Next standalone embeds the Prisma schema at build time. If you build then update the schema without rebuilding, the embedded schema is stale. Always: `db:generate` → `build:console` → `cp static+public`.

2. **Prisma monorepo type duplication:** `node_modules/.prisma/client/index.d.ts` has `coreSystemPrompt` defined 3 times (`string|null` × 2 + `number`) — Prisma 6 monorepo codegen bug. This causes `PrismaClientValidationError` in the seed script for the `api` org's `agentConfig.upsert`. The **app runs fine** (runtime doesn't use those types). Workaround: `api` org AgentConfig inserted via raw SQL. Fix: add explicit `output` path to Prisma generator.

3. **`agentConfigId` still in schema:** `packages/shared/prisma/schema.prisma:36` still has `agentConfigId String? @map("agent_config_id")` in `ApiKey` — was supposed to be removed in `9899c74` (YAGNI) but wasn't. The column exists in DB too so there's no conflict, but it's dead code. Remove in next coding session.

4. **SSH password leaked in chat history:** `70?kwi@Kmqt(dtY` appeared twice in conversation. Rotate immediately.

5. **`ANTHROPIC_AUTH_TOKEN` is `PLACEHOLDER`:** The app starts but LLM calls will fail until this is filled. No test of actual agent conversations was done.

6. **Cert renewal:** Manual cert, no auto-renewal. Expires 2026-07-22. Tencent SSL console or ACME when ready.

7. **`apps/chat` not deleted:** Agreed to keep it as reference until Phase B is stable and local validation passes. It's not deployed and console doesn't depend on it.

8. **docked-preview SWC bug:** Multi-line string in JSX `className` (spanning two source lines) causes Next.js SWC compiler to fail with "Unterminated string constant." Fixed by keeping all classNames on a single line. If future CSS refactoring creates multi-line classNames in JSX, check the build.

---

## Current State

### What's Working ✅
- `https://demo.anytrans.ai/api/health` → `{"status":"ok","db":"connected"}`
- TLS: valid cert, HTTP/2, `Verify return code: 0 (ok)`
- Auth gate: no Bearer key → HTTP 401
- `intera-console` systemd: `active (running)`, enabled for boot
- Caddy: `active (running)` since before this session
- 21 DB tables created, `default` org fully seeded
- Console UI: all B1–B5 pages accessible at `https://demo.anytrans.ai/admin`
- Playground dry-run isolation: e2e guard test covers all 3 bypass paths

### What's Not Working / Incomplete ⚠️
- **LLM calls fail** — `ANTHROPIC_AUTH_TOKEN=PLACEHOLDER` in `/etc/intera/console.env`
- **`api` org partial seed** — AgentConfig inserted via SQL, skills/case-types/policies not seeded
- **LiveChat not connected** — `LIVECHAT_CLIENT_ID` / `LIVECHAT_CLIENT_SECRET` empty
- **SSH password not rotated** — exposed in chat, still using password auth
- **`agentConfigId` YAGNI field** still in schema (dead code, not blocking)
- **Prisma seed script** — `api` org AgentConfig upsert always fails due to type generation bug

### Tests
- [x] Unit + integration: **421 passed**, 0 failed, 29 skipped (`npm test` green)
- [x] Build: `npm run build:console` succeeds
- [x] TypeScript: `tsc --noEmit` 0 errors
- [ ] End-to-end agent conversation with real LLM (blocked on API keys)
- [ ] LiveChat webhook round-trip (blocked on LiveChat credentials)

---

## Next Steps

### Immediate (start here)

1. **Fill real LLM keys** on server:
   ```bash
   ssh ubuntu@43.134.51.138
   sudo nano /etc/intera/console.env
   # Set ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL
   sudo systemctl restart intera-console
   curl https://demo.anytrans.ai/api/health  # verify
   ```

2. **Rotate SSH credentials** (password was leaked in chat):
   ```bash
   passwd
   ssh-copy-id ubuntu@43.134.51.138   # from Mac, add your public key
   # Then disable password auth:
   sudo nano /etc/ssh/sshd_config
   # PasswordAuthentication no
   # PermitRootLogin no
   sudo systemctl restart ssh
   ```

3. **Test end-to-end agent conversation** — open `https://demo.anytrans.ai/admin`, generate an API key, send a test message via the Playground or curl.

4. **Connect LiveChat** — set `LIVECHAT_CLIENT_ID`, `LIVECHAT_CLIENT_SECRET` in `/etc/intera/console.env`, configure webhook URL in LiveChat Developer Console: `https://demo.anytrans.ai/api/livechat/webhook/<orgId>`.

### Subsequent

- **Fix Prisma seed bug** — add explicit `output` path to `generator client` in `schema.prisma` so monorepo codegen doesn't produce duplicate types. Then `api` org will seed fully automatically.
- **Remove `agentConfigId` from schema** — `packages/shared/prisma/schema.prisma:36` and run `db:push` + `db:migrate` on server.
- **Add GitHub deploy key** to server so updates can be `git pull` instead of bundle-scp.
- **Delete `apps/chat`** — was kept as reference; safe to remove after live validation.
- **Set up cert renewal reminder** — cert expires 2026-07-22.

### Blocked On
- Nothing currently blocking Phase B review — UI is live at `demo.anytrans.ai`
- LiveChat integration blocked on credentials from LiveChat Developer Console

---

## Server Quick Reference

```bash
# SSH
ssh ubuntu@43.134.51.138          # password: rotate ASAP

# Logs
sudo journalctl -u intera-console -f
sudo journalctl -u caddy -f

# Restart app
sudo systemctl restart intera-console

# Edit env (LLM keys etc.)
sudo nano /etc/intera/console.env
sudo systemctl restart intera-console

# DB access
sudo -u postgres psql -d intera

# Deploy update (bundle method — until deploy key is set up)
# On Mac:
git bundle create /tmp/intera-agent.bundle main
scp /tmp/intera-agent.bundle ubuntu@43.134.51.138:/tmp/
# On server (as intera user):
git remote set-url origin /tmp/intera-agent.bundle
git pull origin main
npm ci && npm run db:generate && npm run build:console
cp -r apps/console/.next/static apps/console/.next/standalone/apps/console/.next/static
cp -r apps/console/public apps/console/.next/standalone/apps/console/public
sudo cp -r node_modules/.prisma apps/console/.next/standalone/node_modules/.prisma
sudo systemctl restart intera-console
```

## Search Queries

- `grep -rn "dryRun" apps/console/lib/agent/loop.ts` — find all dry-run gates in AgentLoop
- `grep -rn "prisma\." apps/console/lib/agent/loop.ts` — audit all remaining DB writes in loop
- `grep -rn "ANTHROPIC\|DEEPSEEK\|MINIMAX" /etc/intera/console.env` — check which LLM keys are set (on server)

---

## Open Questions

- [ ] Which LLM provider to use in production — Anthropic Claude or MiniMax? Currently DB default is `MiniMax-M2.7-highspeed`; env file has Anthropic placeholder
- [ ] LiveChat credentials — which org gets the first LiveChat integration?
- [ ] Should `apps/chat` be deleted now, or wait for more live validation?
- [ ] Cert renewal strategy — manual re-upload from Tencent SSL, or switch to Let's Encrypt auto-TLS?
- [ ] Do we need the `api` org fully seeded (skills, case-types, policies), or is it API-key-only access with no console UI?

---

## Session Notes

This session covered roughly 3 major phases:

**B3 Playground** had the most back-and-forth — the coding agent reported "done" 3 times before the safety invariants were actually met. The key lesson: "audit by grep on one file" misses transmitive writes. The final working state has: real `AgentLoop` pipeline, 3 dry-run bypass fixes applied by the reviewer directly (not delegated), and an e2e guard test with proven red-before-green.

**Deployment** hit two non-obvious issues: (1) the git bundle approach required root-then-chown to get past `drwx------` home dir permissions; (2) the Prisma client in standalone had duplicate type definitions from a stale embedded schema, causing seed validation errors that *don't* affect runtime.

The `scripts/deploy.sh` in the repo covers future updates but currently requires the bundle-scp dance. Setting up a GitHub deploy key is the right fix.

---

*Generated 2026-06-02. Continue in a new session using this document as initial context.*

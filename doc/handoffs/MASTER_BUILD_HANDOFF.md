# Master Build Handoff — Intera Agent

**Last updated:** 2026-06-03 | **Branch:** `main` | **Target:** `https://demo.anytrans.ai`

> This file is the single source of truth for project status. Read [`GENERIC_HANDOFF.md`](./GENERIC_HANDOFF.md) for project context. Task-level guides live in [`doc/to-do/`](../to-do/) (completed → [`doc/what's done/`](../what's%20done/)).

---

## Status at a glance

| Verdict | State |
|---|---|
| Does it run in prod? | `{"status":"ok","db":"connected"}` |
| Multi-tenant access control? | C1 (session) + C2 (API key → AgentConfig binding) |
| Safe to onboard 2nd tenant? | Passwords rotated, org isolation verified |
| Survives server failure? | Daily backups, systemd auto-restart, health monitoring |
| Push-to-deploy works? | `git push deploy main` |
| LiveChat integrated? | Per-org + per-agent webhooks live |
| API keys page? | Full CRUD with agent binding + usage tutorial |

---

## What shipped (v1.1 — 2026-06-03)

**Security:** STAFF_PASSWORD rotated, `api` org removed from seed, `/api/messages` org resolution fails closed, `timingSafeEqual` for internal calls, daily pg_dump backups, UFW active (22,80,443/tcp), in-memory rate limiter (login 20/min, messages 120/min, webhook 60/min), health monitoring every 5min, weekly TLS cert check (expires 2026-07-22).

**Hardening:** 5 prisma migrations applied, API key entropy 122→256-bit, `npm audit` → 0 vulnerabilities.

**C2 routing:** `ApiKey.agentConfigId` binding, all 6 runtime consumers updated, `/admin/api-keys` management page.

**Cleanup:** 13 dead columns removed (prefixContinuation*, knowledgeRetrieval, humanSkills, consultationPrompt, enableLlmSanitization), dead endpoints deleted (coordinate, human-chat, composer-assist), orphaned libs deleted, `formResponseTemplate` column+UI removed, README rewritten, guide page updated.

**Playground UX:** Input clears after send, chat bubbles for user+agent, empty trace sections auto-collapsed.

**LiveChat:** Credentials configured, per-agent webhooks with copy buttons, connection test button.

**Code quality:** `StreamingTextSanitizer` extracted from loop.ts, shared `loadAgentConfig` extracted, `DEFAULT_CONSULTATION_PROMPT` removed.

---

## v1.2 — 2026-06-03 — ✅ SHIPPED (ready to deploy)

**Friday delivery — internal large-scale test readiness.** Executed by two parallel coding agents (Lane A + Lane B), zero merge conflicts. **Architect-reviewed blockers cleared.**

### Lane A — Agent Config + Playground (5 tasks)
- **T1** Playground reply duplication fixed — `setReply` returns `''` after archiving
- **T2** Behavior trace preserved across turns — `turnTraces[][]` per-message indexing
- **T4** Active version warning banner — with one-click fork to draft + dismiss
- **T5-A** Save semantics unified — four-state feedback (`Unsaved / Saving… / Saved ✓ / Failed ✗`) + `beforeunload` guard
- **T6** Agent readiness view — 4-criterion live aggregation (configured / active / API key / LiveChat) as pills

Files: `playground/page.tsx`, `agent/page.tsx`

### Lane B — Navigation + i18n + Integrations (5 tasks)
- **T0** i18n registry — 101 new keys in `en` + `zh` covering all new features
- **T3** Agent `AgentVersionPicker` promoted to sidebar top (always visible), `localStorage` sync with playground
- **T7** Full i18n coverage — `livechat/page.tsx` migrated from local `L` to `t()`, `api-keys/page.tsx` fully bilingual
- **T8** LiveChat connection diagnostics — 5 error codes (`credentials/region/permission/network/unknown`) with specific i18n messages
- **T5-B** Save semantics aligned — four-state + `beforeunload` matching agent page

Files: `dictionaries.ts`, `console-sidebar.tsx`, `livechat/page.tsx`, `api-keys/page.tsx`, `livechat/groups/route.ts`

### Blockers resolved (architect review)
- **BLK-1** T6 readiness cross-org leak fixed — passes session `orgId` to `/api/livechat/config?orgId=`
- **BLK-1b** Livechat routes (`config` + `groups`) now prefer session `orgId` when available, fall back to query param for widget/webhook paths
- **BLK-2** Cross-org guard test written — `cross-org-isolation.test.ts` (9 tests, all green), verifies config never leaks between orgs and session-based resolution works
- **BLK-3** `zh` dict repaired — added missing `agent.invariantCheck`/`agent.invariantCheckHint`; removed anti-pattern `agent.invariantCheckHintZh`; en=1090, zh=1090

Files: `dictionaries.ts`, `agent/page.tsx`, `config/route.ts`, `groups/route.ts`, `cross-org-isolation.test.ts`

### Verification (2026-06-03, post-blocker-fix)
```
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors ✓
npm test                                          # 26 passed (239 tests), 1 known-fail (PostgreSQL), +9 new isolation tests
npm run build:console                             # success, 53 static pages
```

→ [`2026-06-03-friday-delivery-plan.md`](../what's%20done/2026-06-03-friday-delivery-plan.md)
→ [`2026-06-03-lane-A-agent-playground.md`](../what's%20done/2026-06-03-lane-A-agent-playground.md)
→ [`2026-06-03-lane-B-nav-integrations.md`](../what's%20done/2026-06-03-lane-B-nav-integrations.md)
→ [`2026-06-03-playground-bugs.md`](../what's%20done/2026-06-03-playground-bugs.md)
→ [`2026-06-03-v1.2-blockers.md`](../what's%20done/2026-06-03-v1.2-blockers.md)

---

## Active backlog

### 🔬 UX batch 2 — prompt / playground / i18n (post-Friday, decisions locked)

From production testing + architect cross-page review. All directions confirmed by user. → [`doc/what's done/2026-06-03-ux-batch-2-prompt-playground.md`](../what's%20done/2026-06-03-ux-batch-2-prompt-playground.md)

| ID | Item | Decision | Status |
|---|---|---|---|
| U1 | **Case Prompt → base+append model.** ✅ Phase 1 shipped. New `buildModePrompt.ts` unifies assembly for messages + playground. DB: `caseAddendum` + `useLegacyCasePrompt` columns (migration 0007). UI: Brain split into Base + Case Addendum areas. `DEFAULT_MODEL` extracted to shared defaults. → [`2026-06-03-U1-case-prompt-base-append-plan.md`](../what's%20done/2026-06-03-U1-case-prompt-base-append-plan.md) | base+append (locked) | 🟢 done |
| U2 | **Playground render fidelity.** ✅ `thinking_delta` SSE branch + collapsible &lt;details&gt; render. ✅ renderHint layer: playground now parses `renderHints` from `skill_result` SSE events and renders form fields, cards, and quick_replies. SSE already emitted renderHints — only playground consumption was missing. | add thinking + renderHint rendering (locked) | 🟢 done |
| U3 | **Placeholder indicator cleanup.** ✅ Count bar removed from `HighlightedTextarea`. Placeholder pills verified correct (each prompt section shows its actual placeholders — Core has 3, Case has 5). | remove count bar + fix placeholder tables (locked) | 🟢 done |
| U4 | **i18n extend.** ✅ human-ops fully i18n'd (20+ keys en+zh). knowledge error messages + key labels wrapped. routing already had good coverage. | extend coverage (locked) | 🟢 done |
| U5 | **Cleanup.** ✅ `MessageSquareText` unused import removed from `agent-blueprint.tsx`. Blueprint preview now shows `core Nc · addendum Nc` instead of just `systemPrompt` chars. Save paradigm split noted (not addressed — needs cross-site decision). | — | 🟢 done |

### P1 — Code quality

| ID | Item | Status |
|---|---|---|
| TODO-17 | **`loop.ts` decomposition.** Core loop tightly coupled — needs dedicated planning session. | 🟡 2086 lines |

### Design

| ID | Item | Status |
|---|---|---|
| TODO-39 | **Agent drawer delete-button visibility.** Delete only shows when `versions.length > 1` — user may want always-visible or lower threshold. | 🟡 pending user decision |

### Done (recent)

| ID | Item |
|---|---|
| TODO-36 | **Animated logo lockup.** Replaced CSS-based InteraLogo with disc+wordmark animation. New `intera-svg.ts` DOM helpers + rewritten `intera-logo.tsx`. Modes: `idle` (shimmer intro → auto-loop Intera ↔ AI, 5s cycle), `none` (static SSR-safe). 5 files touched. → [`2026-06-03-logo-lockup.md`](../what's%20done/2026-06-03-logo-lockup.md) |
| TODO-21 | Web Chat page cleaned (widget pending) |
| TODO-22 | Web Chat embed script fixed |
| TODO-23 | Case export via UI |
| TODO-24 | LiveChat connection test |
| TODO-31 | Per-agent LiveChat webhooks |
| TODO-32 | Shared `loadAgentConfig` extracted |
| TODO-33 | `@intera/shared/composer-min-draft` removed |
| TODO-34 | `DEFAULT_CONSULTATION_PROMPT` removed |
| TODO-35 | `formResponseTemplate` removed (migration 0006) |

---

## Server reference

```bash
ssh ubuntu@43.134.51.138               # password in team password manager — do NOT change
sudo journalctl -u intera-console -f    # app logs
sudo systemctl restart intera-console
sudo -u postgres psql -d intera         # DB
```

**Cron jobs:** `intera-pgbackup` (daily 07:27), `intera-health-check` (every 5 min), `intera-cert-check` (weekly Sun 08:17).

**Deploy:** `git push deploy main` → post-receive hook → `scripts/deploy.sh`.

**LiveChat webhooks:**
- Per-org: `https://demo.anytrans.ai/api/livechat/webhook/default`
- Per-agent: `https://demo.anytrans.ai/api/livechat/webhook/default/{agentName}`

## C1 regression check

```bash
curl -s -o /dev/null -w '%{http_code}' https://demo.anytrans.ai/api/admin/api-keys \
  -H 'Cookie: intera_auth=1; intera_org_id=default'        # expect 401
curl -s -o /dev/null -w '%{http_code}' https://demo.anytrans.ai/admin   # expect 307
curl -s https://demo.anytrans.ai/api/health                            # expect {"status":"ok","db":"connected"}
```

### 2026-06-03 — Remove Routing table + dead admin pages

**Routing table (`routings`) and two redundant admin pages deleted.** The `Routing` table was pure CRUD with zero runtime consumption — `create_human_task` uses freeform queue strings, not FK to routings. The `/admin/human-ops` and `/admin/routing` pages were two UI entrances to the same dead table.

**Deleted:**
- `apps/console/app/admin/human-ops/page.tsx` — Human Ops admin page
- `apps/console/app/admin/routing/page.tsx` — Routing admin page
- `apps/console/app/api/admin/routing/` — routing CRUD API (GET/POST/PUT/DELETE)
- `packages/shared/prisma/schema.prisma` — `model Routing` block
- Migration: `20260603000008_remove_routing_table` (`DROP TABLE IF EXISTS "routings"`)
- `packages/shared/defaults/index.ts` — `DEFAULT_ROUTING` array + `DefaultRoutingSeed` type
- `packages/shared/prisma/seed.ts` — routing upsert block
- `apps/console/components/console-sidebar.tsx` — humanOps/routing nav items + icons
- `apps/console/lib/i18n/dictionaries.ts` — `routing.*` + `humanOps.*` namespaces (en + zh, ~40 keys)
- `apps/console/app/ops/guide/page.tsx` — §2.6 Routing API docs (4 endpoints)
- `apps/console/app/admin/tools/page.tsx` — dead "Configure in Human Ops" links from `create_human_task` skill

**Preserved:** `HumanTask` model, `create_human_task` tool, `waiting_human` recovery flow, agent config "Human Interaction" section (consultation prompt + skills), ops/chats human task UI.

→ [`doc/what's done/2026-06-03-remove-routing-human-ops-dead-config.md`](../what's%20done/2026-06-03-remove-routing-human-ops-dead-config.md)

## Applied migrations (6)

```
20260603000001_initial_baseline
20260603000002_api_key_agent_config_id
20260603000003_remove_dead_columns
20260603000004_remove_consultation_fields
20260603000005_remove_enableLlmSanitization
20260603000008_remove_routing_table
```

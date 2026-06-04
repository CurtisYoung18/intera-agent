# Master Build Handoff — Intera Agent

**Last updated:** 2026-06-04 (v1.4 shipped — TODO-41 + TODO-42; `doc/to-do/` specs referenced into backlog) | **Branch:** `main` | **Target:** `https://demo.anytrans.ai`

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

## v1.4 — 2026-06-04 — ✅ SHIPPED

**Memory three-layer redesign (TODO-41) + Trace cleanup (TODO-42) + Sub-agent max-iterations config.** Executed by 5 parallel coding agents (Task 0 + Lane A/B/C/D), zero merge conflicts.

### TODO-41 — Memory / Compact three-layer redesign

6 root defects fixed. Subsystem went from 0 → ~60 tests.

- **Task 0:** `packages/shared/memory/contract.ts` — `PROFILE_SECTIONS`, `ProfileSections`, `DEFAULT_MEMORY_MODEL`
- **Lane A:** `CASE_COMPACT_PROMPT` (working-state, L2) + `PROFILE_COMPACT_PROMPT` (portrait, L3, contract-bound) — fixes P0-2, producer-side P0-3
- **Lane B:** Ratio-based `assessCompaction` (`0.70`/`0.60`/`0.92`) + cadence-driven `compactEveryNMessages` — fixes P0-1
- **Lane C:** `UserProfile.sections` JSON column + `mergeProfile` contract rewrite (dedup, truncation History-first) + dual-write — fixes P0-3 consumer side, P1-2
- **Lane D:** Inlined compact route (deleted dead proxy) + converged model names to `DEFAULT_MEMORY_MODEL` — fixes P1-1, P2
- **C4:** System tools model (user chose Option B) — `read_chat_memory`/`read_user_profile` available in all stages, `system_info` auto-allow, structured `sections` returned, `## Memory Tools` prompt section

### TODO-42 — Trace cleanup + observability

5 items completed:

| # | Item | Outcome |
|---|---|---|
| 1/2 | Profiler Snapshot | Removed entirely (user chose A) — `profiler-utils.ts` deleted, ~13 call sites removed |
| 3 | "View conversation" button | KEPT — chat page has unique features (memory panel, filterable timeline) |
| 4 | Tool call I/O visibility | `skill_result` cards + `ToolCallCard` default open (was 2 clicks → now visible) |
| 5 | Playground LLM prompt | SSE event path → `memoryTraces` → `trace-aggregator` → `PromptViewer` component |

→ [`2026-06-04-todo-41-memory-three-layer-redesign.md`](../what's%20done/2026-06-04-todo-41-memory-three-layer-redesign.md)
→ [`2026-06-04-todo-42-trace-cleanup.md`](../what's%20done/2026-06-04-todo-42-trace-cleanup.md)
→ [`2026-06-04-sub-agent-max-iterations-config.md`](../what's%20done/2026-06-04-sub-agent-max-iterations-config.md)

### Sub-agent max-iterations per-stage config

**Problem:** Sub-agents inherited main agent's `maxIterations` (20), far too high for focused investigation stages (typically 3–5 turns).

**Fix:** 4 edits across 3 files:
- [stage-config-editor.tsx](apps/console/components/admin/stage-config-editor.tsx): Added `maxIterations` field to `StageCfg` interface + number input in Model panel
- [case-types/[name]/page.tsx](apps/console/app/admin/case-types/[name]/page.tsx): Added `maxIterations` to local `StageCfg` type
- [loop.ts](apps/console/lib/agent/loop.ts): Derives sub-agent `maxIterations` from `Math.max(...stageConfigs.*.maxIterations)`, defaults to 5

### Verification (2026-06-04)
```
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors ✓
npm test                                          # 36 passed, 1 known-fail (PostgreSQL), 328 tests
npm run build:console                             # success (53 static pages)
```

## Active backlog

### P1 — Code quality

| ID | Item | Status |
|---|---|---|
| TODO-17 | **`loop.ts` decomposition.** Core loop tightly coupled — needs dedicated planning session. | 🟡 2086 lines |

### Design

| ID | Item | Status |
|---|---|---|
| TODO-39 | **Agent drawer delete-button visibility.** Delete only shows when `versions.length > 1`. | 🟡 pending user decision |

### Ops hardening (folded from PRODUCTION_READINESS_AUDIT, 2026-06-03)

| ID | Item | Priority |
|---|---|---|
| M3 | No observability — add error tracking (Sentry) + health alerting | medium |
| M6 | Confirm which TLS cert actually serves (`*.anytrans.ai` RapidSSL expires 2026-07-22 vs Caddy LE) | medium |
| L3 | Rotate DB password (`Intera2026Pg!` weak/known) | low |

### Deferred
- **C3/C4** User table + multi-org login/membership (from [multi-agent-multi-org-plan](../to-do/2026-06-01-multi-agent-multi-org-plan.md)) — not needed for current phase
- **C5** Anonymous visitor identity key — needs separate exploration

### Planned specs in [`doc/to-do/`](../to-do/) (for coding-team pickup)

Architect-authored specs. Status verified in code 2026-06-04.

| Spec | Scope | Status | Coding-team action |
|---|---|---|---|
| [`sub-agent-max-iterations-config.md`](../to-do/sub-agent-max-iterations-config.md) | Per-stage `maxIterations` for sub-agents (UI field → `stageConfigs` JSON → `loop.ts` builder). | 🟢 **SHIPPED 2026-06-04.** 4 edits: `stage-config-editor.tsx` (type + UI), `case-types/[name]/page.tsx` (type), `loop.ts` (builder). | ✅ Done. |
| [`2026-06-01-multi-agent-multi-org-plan.md`](../to-do/2026-06-01-multi-agent-multi-org-plan.md) | Phase C: 1 org → N AgentConfig, User table + multi-org membership/login. | 🟡 **Partially shipped, remainder deferred.** C1 (AgentConfig 1:N) ✅ v1.3, C2 (ApiKey.agentConfigId) ✅ v1.1. C3/C4 (User table + login + membership) deferred — not needed for current phase. | No action needed now. |
| [`2026-06-03-version-bound-config-blueprint-redesign.md`](../to-do/2026-06-03-version-bound-config-blueprint-redesign.md) | Version-bound `capabilityBindings` + library/blueprint redesign (4 architecture decisions D1–D6). | ⚪ **Already SHIPPED as v1.3 / TODO-40.** This is the *source plan*, not backlog. | **Do NOT re-execute.** Move to [`doc/what's done/`](../what's%20done/); kept here only as design reference. |

## v1.3 — 2026-06-03 — ✅ SHIPPED

**Version-bound config + blueprint/library redesign.** Executed by 4 parallel coding agents (Lane 1 + Lane 2 + Lane 3 + U1 Phase 2), zero merge conflicts.

### Lane 1 — Data + Runtime (foundation)
- `CapabilityBindings` interface + `EMPTY_BINDINGS` frozen in `packages/shared/types/index.ts`
- Schema: `capabilityBindings String?` added to `AgentConfig`, `policyHooks` marked @deprecated (migration `0008_add_capability_bindings`)
- `resolveBindings()` helper: `apps/console/lib/agent/resolve-bindings.ts`
- Runtime switch: `loop.ts`, `skills.ts` (SkillRouter), `policy.ts` (PolicyEngine), `config-loader.ts` all read `capabilityBindings`
- Backfill script: `scripts/backfill-capability-bindings.ts`
- 11 e2e guard tests: `capability-bindings-e2e.test.ts` — binding isolation, drift fail-soft, guardrail migration regression

Files: `types/index.ts`, `schema.prisma`, `resolve-bindings.ts`, `loop.ts`, `skills.ts`, `policy.ts`, `config-loader.ts`

### Lane 2 — CRUD Consolidation (pure UI)
- `ConfirmDialog` shared component (`components/ui/confirm-dialog.tsx`) — danger + warning variants
- All `alert()`/`confirm()` removed from guardrails, tools, case-types pages
- Four-state save feedback (Unsaved/Saving…/Saved✓/Failed✗) across all three pages
- Tools: unified mode naming (`static` everywhere, no more mock/static mix); modal broken into steps
- Case types: dual-entry eliminated (list → detail page only); 4 bare JSON textareas → ChipInput + draggable pills + JSON escape hatch
- Guardrails: `guardrailType` explicit stored field, shared ConfirmDialog

Files: `confirm-dialog.tsx`, `guardrails/page.tsx`, `tools/page.tsx`, `case-types/page.tsx`, `case-types/[name]/page.tsx`, `dictionaries.ts`

### Lane 3 — Binding UI + Blueprint + Model/Memory Pages
- `VersionContextBar` component + `useSelectedAgentId()` / `useIsActiveVersion()` hooks
- `BindingIndicator` three-state (✓ bound / ＋ unbound / ⚠ drift) on all 4 library pages
- New `/admin/model` page — brain config (model, temperature, prompts, thinking budget, etc.) extracted from agent drawer
- New `/admin/memory` page — memory strategy config extracted from agent drawer
- `agent-blueprint.tsx` → read-only health dashboard: 6 nodes with binding counts + drift indicators, click to navigate
- `agent/page.tsx` slimmed from ~1159 to ~140 lines (drawer editing removed)
- Sidebar: `/admin/model` + `/admin/memory` entries added
- T4 active-version guard on model/memory pages (fork-to-draft warning)

Files: `version-context-bar.tsx`, `binding-column.tsx`, `model/page.tsx`, `memory/page.tsx`, `agent-blueprint.tsx`, `agent/page.tsx`, `console-sidebar.tsx`, `guardrails/page.tsx`, `tools/page.tsx`, `case-types/page.tsx`, `knowledge/page.tsx`, `agent/route.ts`, `agent/types.ts`, `dictionaries.ts`

### U1 Phase 2 — Case Prompt Default Flip
- `CASE_SYSTEM_PROMPT` marked `@deprecated` in `packages/shared/defaults/index.ts`
- `useLegacyCasePrompt` default flipped: `true` → `false` (migration `0008_set_use_legacy_case_prompt_default`)
- Seed updated: explicit `useLegacyCasePrompt: false`
- Data migration script: `packages/shared/prisma/migrate-legacy-case-prompt.ts` — flips only configs with both `coreSystemPrompt` + `caseAddendum` filled

Files: `defaults/index.ts`, `schema.prisma`, `seed.ts`, `buildModePrompt.ts`

### Verification (2026-06-03, all 4 lanes)
```
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
npm test                                          # 27 passed, 2 skipped, 1 PostgreSQL known-fail
npm run build:console                             # success
```

→ [`doc/what's done/2026-06-03-lane-1-capability-bindings-runtime.md`](../what's%20done/2026-06-03-lane-1-capability-bindings-runtime.md)
→ [`doc/what's done/2026-06-03-lane-2-crud-consolidation.md`](../what's%20done/2026-06-03-lane-2-crud-consolidation.md)
→ [`doc/what's done/2026-06-03-lane-3-binding-ui-blueprint-pages.md`](../what's%20done/2026-06-03-lane-3-binding-ui-blueprint-pages.md)
→ [`doc/what's done/2026-06-03-U1-phase-2-case-prompt-cleanup.md`](../what's%20done/2026-06-03-U1-phase-2-case-prompt-cleanup.md)

### 🔬 UX batch 2 — prompt / playground / i18n (post-Friday, decisions locked)

From production testing + architect cross-page review. All directions confirmed by user. → [`doc/what's done/2026-06-03-ux-batch-2-prompt-playground.md`](../what's%20done/2026-06-03-ux-batch-2-prompt-playground.md)

| ID | Item | Decision | Status |
|---|---|---|---|
| U1 | **Case Prompt → base+append model.** ✅ **Phase 1 shipped** (verified in code 2026-06-03). ✅ **Phase 2 shipped** (2026-06-03): `CASE_SYSTEM_PROMPT` marked @deprecated, `useLegacyCasePrompt` default flipped to `false`, migration script for existing configs. Both phases complete. Plan: [`2026-06-03-U1-case-prompt-base-append-plan.md`](../what's%20done/2026-06-03-U1-case-prompt-base-append-plan.md) | base+append (locked) | 🟢 done |
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
| TODO-40 | **v1.3 version-bound config redesign.** 4 lanes (CapabilityBindings runtime + CRUD consolidation + binding UI + case prompt default flip), 4 parallel agents. |
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

## Applied migrations (11)

```
20260603000001_initial_baseline
20260603000002_api_key_agent_config_id
20260603000003_remove_dead_columns
20260603000004_remove_consultation_fields
20260603000005_remove_enableLlmSanitization
20260603000006_remove_formResponseTemplate
20260603000007_add_case_addendum
20260603000008_remove_routing_table
20260603000008_add_capability_bindings
20260603000008_set_use_legacy_case_prompt_default
20260603000009_add_user_profile_sections
```

## Ops hardening backlog (folded from PRODUCTION_READINESS_AUDIT, 2026-06-03)

Security audit C1/C2 + H1 (backups) + H2 (UFW) + H3 (rate limits) + M1/M2/M5 + L1/L2 all closed (see "What shipped v1.1"). Still open:

| ID | Item | Priority |
|---|---|---|
| M3 | No observability — add error tracking (Sentry) + health alerting | medium |
| M6 | Confirm which TLS cert actually serves (`*.anytrans.ai` RapidSSL expires 2026-07-22 vs Caddy LE) — see GENERIC gotcha #5 | medium |
| L3 | Rotate DB password (`Intera2026Pg!` weak/known) | low |
| H4 | SSH password was in `PROJECT_CONTEXT.md` (now deleted from tree; history retains it). **Rotation explicitly waived by user — do NOT change SSH pw.** | waived |

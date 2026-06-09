# Foundation Reset Lane Prompts

**Last updated:** 2026-06-09
**Status:** HISTORICAL - F1-F7/UX0 shipped through `d42c543e foundation: add hooks admin ui`.
**Purpose:** preserve the original first-wave lane prompts for audit/history.
**Baseline:** `origin/main` at or after `373d2eed docs: Procedure Phase 3 shipped`.

For new zero-context coding sessions, dispatch from [`POST_FOUNDATION_DISPATCH_PROMPTS.md`](./POST_FOUNDATION_DISPATCH_PROMPTS.md), not this file.

Use these prompts with the current docs:

- [`GENERIC_HANDOFF.md`](./GENERIC_HANDOFF.md)
- [`MASTER_BUILD_HANDOFF.md`](./MASTER_BUILD_HANDOFF.md)
- [`../README.md`](../README.md)
- [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md)
- [`../spec/Intera_Harness_架构梳理.md`](../spec/Intera_Harness_架构梳理.md)
- [`../spec/Intera_UI_UX_Design_System.md`](../spec/Intera_UI_UX_Design_System.md)

---

## Shared preamble for every lane

Paste this before the lane-specific block.

```text
You are working in /Users/curtis/Desktop/intera-agent on the Intera Foundation Reset.

Start by running:
- git fetch origin
- git status --short
- git log --oneline -n 8

Read these docs before editing:
- doc/handoffs/GENERIC_HANDOFF.md
- doc/handoffs/MASTER_BUILD_HANDOFF.md
- doc/handoffs/FOUNDATION_RESET_LANE_PROMPTS.md
- doc/README.md
- doc/to-do/2026-06-08-foundation-reset-domain-model.md
- doc/spec/Intera_Harness_架构梳理.md
- doc/spec/Intera_UI_UX_Design_System.md

Current code baseline includes Procedure additive Phases 1-3:
- CaseType.procedure, CaseType.guardrails, maxAutoTurns exist.
- ProcedureExecutor prompt path exists.
- Policy/Guardrail case-scoped activation exists.
Treat these as migration inputs, not target architecture. The target is Hook/HookBinding, Tool vocabulary, Procedure runtime cleanup, .intera-agent.json packages, Scenario receipts, and the UI/UX structure in the docs.

Do not dispatch from doc/archive/superseded/2026-06-08-case-type-procedure-orchestration-refactor.md except as history.
Do not preserve long-term Policy/Guardrail/Skill compatibility unless the active reset plan explicitly says so.
Do not overwrite unrelated dirty work. If files outside your owned list are dirty, inspect and work around them.
Do not edit doc/handoffs/MASTER_BUILD_HANDOFF.md just to claim a lane unless the owner asked you to; this prompt is the lane declaration.

Security:
- Do not write plaintext secrets, SSH passwords, API keys, tokens, or customer credentials into git, docs, prompts, logs, command output, .env, or shell history.
- SSH host may be referenced as ssh ubuntu@43.134.51.138. The owner may provide the credential privately inside the active Codex session. If available in your session, use it without printing or storing it. If absent and deployment is explicitly required, stop at local verification and ask the owner for the credential through the secure session.
- Do not rotate SSH credentials and do not switch the server to key-only auth.

Verification expectations:
- npx tsc --noEmit -p apps/console/tsconfig.json
- env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
- npm run build:console
- Add focused tests for your lane where behavior changes.
- For UI lanes, also run browser verification/screenshots once the route can render.

End with:
- changed files
- exact verification commands and results
- residual risks
- whether you pushed a branch/commit
```

---

## Dependency map

| Wave | Lanes | Can run in parallel? |
|---|---|---|
| A | F1, UX0 | Yes. F1 owns schema/contracts; UX0 owns visual primitives only. |
| B | F2, F3, F4, F6, F7 | After F1 contracts land. Coordinate if runtime files overlap. |
| C | F5, F8 | After F2/F3 stabilize runtime vocabulary. F8 should be last for i18n/navigation copy. |
| D | UX1-UX6 | After F8 route vocabulary for shell/nav; UX2-UX5 can split once APIs exist. |
| Final | INTEGRATION-GATE | After all selected lanes merge. One deploy owner only. |

---

## F1 - Schema and shared contracts

```text
Lane: F1 - Schema and shared contracts

Goal:
Create the physical Hook/HookBinding foundation and shared contracts for Hooks, Tools, CaseTypes, Scenarios, and .intera-agent.json packages.

Owned files:
- packages/shared/prisma/schema.prisma
- packages/shared/prisma/migrations/*
- packages/shared/types/index.ts
- packages/shared/contracts/hooks.ts
- packages/shared/contracts/agent-template.ts
- packages/shared/contracts/case-types.ts
- packages/shared/contracts/tools.ts
- packages/shared/contracts/scenarios.ts if needed
- focused contract/schema tests

Do not touch:
- apps/console/lib/agent/* except type imports forced by compile errors.
- apps/console/lib/i18n/dictionaries.ts.
- UI pages.

Tasks:
1. Inspect current schema and migrations, especially AgentConfig.policies, Policy, CaseType.guardrails, Tool.mode/mockFixture, and ChatMemory skills* fields.
2. Add Hook and HookBinding Prisma models exactly aligned with doc/to-do/2026-06-08-foundation-reset-domain-model.md.
3. Replace AgentConfig.policies relation with hooks relation.
4. Plan migration from Policy rows to Hook rows and CaseType.guardrails to HookBinding(scopeType='caseType'). Preserve old payload under legacy only where the plan says so.
5. Define zod/types for HookCheckpoint, HookDecision, HookHandler, HookContext, HookBinding scope, .intera-agent.json v1.
6. Rename shared contract vocabulary from Skill to Tool where this lane owns the file.
7. Ensure schema supports import/export-safe stable names.
8. Add tests for contract parse/validation and migration/backfill shape where practical.

Conflict note:
Procedure Phase 3 added case-scoped guardrails. Do not continue that old naming. Use it only as source data for HookBinding.

Acceptance:
- Prisma generate succeeds.
- Migration applies to local Postgres.
- Existing seed still runs or is updated narrowly.
- Typecheck and keyless tests pass.
- No new top-level Policy/Guardrail/Skill contract names remain in files you own, except explicit legacy/backfill comments.
```

---

## F2 - HookEngine and runtime checkpoints

```text
Lane: F2 - HookEngine and runtime checkpoints

Start only after F1 lands.

Goal:
Replace PolicyEngine with HookEngine and wire PreToolUse, PostToolUse, and Stop into customer-visible runtime.

Owned files:
- apps/console/lib/agent/policy.ts -> delete or rename to hook-engine.ts
- apps/console/lib/agent/loop.ts
- apps/console/lib/agent/case-agent-loop.ts
- apps/console/lib/agent/procedure-executor.ts
- apps/console/lib/agent/tool-interceptor.ts
- apps/console/lib/agent/prompt-selector.ts
- runtime tests for HookEngine, Tool checkpoints, Stop retry

Coordinate before touching:
- apps/console/lib/agent/tools.ts
- apps/console/lib/agent/stream-handler.ts
- apps/console/lib/agent/trace.ts

Tasks:
1. Inspect the current PolicyEngine and Phase 3 case-scoped guardrail activation.
2. Implement HookEngine loading active HookBindings from agent, CaseType, ProcedureStep, and Tool scopes.
3. Implement declarative, restricted JavaScript, and HTTP Hook handler dispatch.
4. Wire PreToolUse before Tool execution.
5. Wire PostToolUse after Tool result.
6. Wire Stop before any customer-visible answer is persisted/sent.
7. Add bounded Stop repair loop with maxStopRetries default 2.
8. Ensure HookContext includes checkpoint, CaseType, Procedure step ids, tool input/output, case facts, trace summary, and reply draft.
9. Emit trace entries using Hook vocabulary, not Policy/Guardrail vocabulary.

Acceptance:
- Tests prove PreToolUse block prevents Tool call.
- Tests prove PostToolUse can escalate on result.
- Tests prove Stop block prevents final answer and retries safely.
- No runtime path emits new preFinalize.
- Typecheck, keyless tests, build pass.
```

---

## F3 - Tool naming and trace/event reset

```text
Lane: F3 - Tool naming and trace/event reset

Start after F1 contracts land. Coordinate with F2 on runtime files.

Goal:
Remove Skill vocabulary from runtime contracts, SSE, traces, memory, and UI-facing event data.

Owned files:
- packages/shared/types/index.ts only after F1 if needed
- apps/console/lib/agent/tools.ts
- apps/console/lib/agent/streaming-tool-executor.ts
- apps/console/lib/agent/stream-handler.ts
- apps/console/lib/agent/trace.ts
- apps/console/lib/agent/trace-aggregator.ts
- chat/playground trace rendering components that consume skill_* events
- tests containing skill_call / skill_result

Do not touch:
- schema.prisma
- hooks API/UI
- dictionaries.ts unless absolutely required; leave visible copy to F8

Tasks:
1. Inventory skill_call, skill_result, skillsCalled, skillResults, SkillDefinition, SkillRunResult.
2. Rename new runtime/event vocabulary to tool_call and tool_result.
3. Rename memory field access to toolsCalled/toolResults where F1 schema/contracts support it.
4. Keep a read-only adapter for historical old trace rows only if needed for old receipts.
5. Update tests to assert new event names.
6. Ensure no new code emits skill_* events.

Acceptance:
- Runtime emits tool_call/tool_result only.
- Historical skill_* rows can still display if adapter is implemented.
- Typecheck, keyless tests, build pass.
```

---

## F4 - Hooks API and admin UI

```text
Lane: F4 - Hooks API and admin UI

Start after F1 contract shape lands. Runtime behavior may be stubbed until F2 lands, but API contracts must match F1.

Goal:
Replace Policies/Guardrails admin surfaces with Hooks and HookBindings.

Owned files:
- apps/console/app/api/admin/hooks/**
- apps/console/app/api/admin/policies/** deletion or 410 routes
- apps/console/app/admin/hooks/page.tsx or target Build route if UX1 has landed
- apps/console/app/admin/guardrails/page.tsx redirect
- apps/console/components/admin/*hook*
- route/UI tests for hooks

Do not touch:
- schema.prisma
- agent runtime files
- global navigation/i18n sweep unless this lane owns a minimal local label

Tasks:
1. Build Hook CRUD for name/displayName/description/checkpoint/handlerKind/handler/enabled/severity.
2. Build HookBinding CRUD for agent, CaseType, ProcedureStep, and Tool scopes.
3. Implement old policies endpoints as 410 Gone or remove as plan directs.
4. Redirect old guardrails page to Hooks.
5. Support declarative/code/http Hook editing.
6. Add ProcedureStep picker and Tool picker support for bindings.
7. Add route tests for org isolation and invalid references.

Acceptance:
- /api/admin/hooks works and is org/agent scoped.
- Old /api/admin/policies does not silently keep working.
- /admin/guardrails redirects.
- Hook page can create a Hook and bind it to at least one scope locally.
- Typecheck, keyless tests, build pass.
```

---

## F5 - Procedure runtime cleanup and dispatch_case_agent retire

```text
Lane: F5 - Procedure runtime cleanup

Start after F2 and F3 stabilize runtime vocabulary.

Goal:
Retire detached sub-agent fan-out and old stage runtime. Make dispatch_case_agent only open/select a Case and attach CaseType/Procedure, then continue inline through the main Case Owner Agent.

Owned files:
- apps/console/lib/agent/stage-executor.ts
- apps/console/lib/agent/orchestrator.ts
- apps/console/lib/agent/sub-agent.ts
- apps/console/lib/agent/react-loop.ts
- apps/console/lib/agent/conversation-loop.ts
- apps/console/lib/agent/strategies/*
- packages/shared/defaults/index.ts
- packages/shared/prisma/seed.ts
- Procedure runtime tests

Coordinate before touching:
- loop.ts
- case-agent-loop.ts
- tool-interceptor.ts

Tasks:
1. Re-read HARD_BUGS L7 and confirm current dispatch_case_agent behavior.
2. Rewrite dispatch_case_agent to create/select Case, attach CaseType/Procedure, and return inline routing context only.
3. Delete or fully disconnect background sub-agent execution from customer-facing path.
4. Remove dead needsContinuation/sub-agent continuation behavior.
5. Remove stage executor runtime path once tests prove ProcedureExecutor path works.
6. Rewrite seeds/defaults to Procedure-based CaseTypes and current Tool/Hook vocabulary.
7. Add tests proving dispatch_case_agent no longer spawns background workers and ProcedureExecutor owns the flow.

Acceptance:
- grep confirms no customer-facing runtime uses detached dispatchInBackground.
- No new needsContinuation writes/read dependencies remain.
- Seeded CaseTypes run via ProcedureExecutor.
- Typecheck, keyless tests, build pass.
```

---

## F6 - .intera-agent.json export/import

```text
Lane: F6 - Agent Template Package import/export

Start after F1 contracts land.

Goal:
Make .intera-agent.json package real for internal delivery reuse and future marketplace support.

Owned files:
- apps/console/lib/agent-template/**
- apps/console/app/api/admin/agent-templates/export/route.ts
- apps/console/app/api/admin/agent-templates/import/route.ts
- packages/shared/contracts/agent-template.ts if not already complete
- templates/gaming-support-starter.intera-agent.json
- package tests

Do not touch:
- runtime loop files
- Hook admin UI except import/export entry hooks if already stable

Tasks:
1. Export current Agent version into schemaVersion intera.agentTemplate.v1.
2. Include metadata, agent, caseTypes/procedures, tools, hooks, hookBindings, scenarios, secret placeholders, and legacy snapshot namespace.
3. Import a package into a new draft/fork Agent.
4. Map stable manifest names to DB ids safely.
5. Never export real secret values.
6. Add tests for export/import round-trip on local DB or mocked repository.

Acceptance:
- Export JSON validates against contract.
- Import creates a usable draft/fork Agent without colliding ids.
- Legacy fields are under legacy only.
- Typecheck, keyless tests, build pass.
```

---

## F7 - Scenario soft gate and receipts

```text
Lane: F7 - Scenario soft gate

Start after F1. Coordinate with F2 for runtime runner API and F6 for package inclusion.

Goal:
Create saved Scenarios, runner receipts, and changed-since-validation state for commercial delivery validation.

Owned files:
- packages/shared/contracts/scenarios.ts
- scenario Prisma models if needed, otherwise first-slice JSON-backed storage
- apps/console/app/api/admin/scenarios/**
- apps/console/app/admin/scenarios/** or Pilot Lab integration if UX4 has landed
- scenario runner tests

Tasks:
1. Define Scenario contract: multi-turn inputs, expected Tool calls, Hook decisions, human transfer, forbidden phrases, final status.
2. Implement save/list/update/delete Scenario APIs.
3. Implement runner that executes against Agent runtime or a stable test harness.
4. Generate receipt with Tool/Hook/Knowledge/handoff evidence.
5. Mark Agent validation state: Validated, Changed since last validation, Validation failed, Not validated.
6. Hook edits/imports/ConfigPilot mutations should mark changed-since-validation where APIs exist.

Acceptance:
- Can save and run at least one Scenario locally.
- Receipt shows pass/fail and evidence.
- Activation remains soft-gated with override path, not hard-blocked.
- Typecheck, keyless tests, build pass.
```

---

## F8 - I18N, docs, and navigation vocabulary sweep

```text
Lane: F8 - I18N, docs, and navigation sweep

Start last after core route/API vocabulary stabilizes.

Goal:
Remove stale user-facing vocabulary and ensure en-US/zh-CN parity.

Owned files:
- apps/console/lib/i18n/dictionaries.ts
- apps/console/components/console-sidebar.tsx
- apps/console/components/admin/agent-onboarding.tsx
- apps/console/app/ops/guide/page.tsx
- apps/console/components/ops/runtime-guide-*
- current docs that still mislead coding teams

Tasks:
1. Replace Guardrails/Policies with Hooks in current UI copy.
2. Replace Skills with Tools in current UI copy.
3. Remove state-machine/stage/sub-agent product copy from current docs/UI, except historical archive context.
4. Add Build / Operate / Settings copy if UX1 route shell has landed.
5. Ensure en/zh dictionary key parity.
6. Run terminology greps and document intentional historical leftovers.

Acceptance:
- en-US and zh-CN dictionaries have identical keys.
- New UI copy uses Hook/Tool/Procedure/CaseType.
- Historical docs may retain old terms only with context.
- Typecheck, keyless tests, build pass.
```

---

## UX0 - Design primitives and tokens

```text
Lane: UX0 - Design primitives and tokens

Can start early. Do not rewrite navigation or page routes.

Goal:
Introduce Quiet Agent Studio design primitives without disrupting current product behavior.

Owned files:
- apps/console/app/globals.css
- apps/console/tailwind.config.ts if needed
- new shared UI primitive components only if needed
- token/primitives tests if available

Tasks:
1. Read doc/spec/Intera_UI_UX_Design_System.md.
2. Add primitive/semantic/component tokens for light shell and deep workspace surfaces.
3. Remove or neutralize decorative orb/blob patterns from new primitives; do not mass-delete old styles unless safe.
4. Add reusable classes/components for workspace surface, panel, status, command overlay base, diff surface base.
5. Keep existing pages rendering.

Acceptance:
- Existing Console still renders.
- No route/nav changes.
- Typecheck/build pass.
- Browser screenshot check for at least current default page if local server is available.
```

---

## UX1 - IA, routes, shell, and redirects

```text
Lane: UX1 - IA, routes, shell, redirects

Start after F8 vocabulary direction is stable.

Goal:
Implement Build / Operate / Settings app shell and route redirects according to the UI/UX spec.

Owned files:
- apps/console/components/console-shell.tsx
- apps/console/components/console-sidebar.tsx
- route layout files under apps/console/app/build, operate, settings
- redirect files for old admin/ops routes
- dictionaries only if F8 is not active

Tasks:
1. Default logged-in route should land at /build/release.
2. Top-level nav: Build, Operate, Settings.
3. Left rail changes by block.
4. Build has Release, Pilot Lab, Components.
5. Components has local nav for Brain, Procedures, Tools, Hooks, Knowledge, Integrations.
6. Operate has Conversations and Human Handoff only.
7. Settings has Organization only.
8. Old routes redirect cleanly.

Acceptance:
- Navigation works by browser click-through.
- Old links do not 404.
- Typecheck/build pass.
- Screenshot desktop 1440 and tablet-ish 1024.
```

---

## UX2 - Release command center and Config Diff Viewer

```text
Lane: UX2 - Release command center and Config Diff Viewer

Start after version/package contracts exist. Can use mocks only if APIs are not ready, but isolate mocks clearly.

Goal:
Build /build/release as the first screen and create reusable Config Diff Viewer.

Owned files:
- apps/console/app/build/release/**
- apps/console/components/release/**
- apps/console/components/config-diff/**
- package action UI components

Tasks:
1. Release page shows Live Version, Draft Changes, Validation Receipts, Package Actions, ConfigPilot entry.
2. Implement Config Diff Viewer reusable by Publish, Rollback, Import, ConfigPilot Apply.
3. Diff groups by Brain, Procedures, Tools, Hooks, Knowledge, Integrations.
4. Highlight high-risk changes.
5. Publish is explicit; stale validation shows warning + override reason.

Acceptance:
- Release page renders with real or clearly mocked data.
- Diff Viewer can display added/changed/removed groups.
- Typecheck/build/browser verification pass.
```

---

## UX3 - Components workspace shell

```text
Lane: UX3 - Components workspace shell

Start after UX1 shell exists.

Goal:
Create Build -> Components workspace with independent subroutes and shared draft/test panel patterns.

Owned files:
- apps/console/app/build/components/**
- apps/console/components/components-workspace/**
- route adapters from old admin pages if needed

Tasks:
1. Create subroutes: brain, procedures, tools, hooks, knowledge, integrations.
2. Each subroute owns fetch/save/dirty state boundary.
3. Add explicit Save draft pattern.
4. Add local test panel container pattern.
5. Reuse old admin pages carefully; do not keep Blueprint/Skill/Policy/Guardrail labels.

Acceptance:
- Each subroute renders independently.
- Dirty state does not bleed across subroutes.
- Typecheck/build/browser verification pass.
```

---

## UX4 - Pilot Lab and ConfigPilot surfaces

```text
Lane: UX4 - Pilot Lab and ConfigPilot surfaces

Start after Scenario APIs or stubs exist and shell can host global drawer.

Goal:
Implement ConfigPilot as global right drawer plus full Pilot Lab workspace.

Owned files:
- apps/console/app/build/pilot-lab/**
- apps/console/components/config-pilot/**
- apps/console/components/scenario-receipts/**
- global drawer mount in shell only if coordinated with UX1

Tasks:
1. Global ConfigPilot drawer with current page/object context.
2. Pilot Lab workspace with ConfigPilot Workspace, Free Test, Test Cases, Receipts.
3. Apply draft always opens Config Diff Viewer.
4. ConfigPilot cannot Publish.
5. Receipts show Tool/Hook/Knowledge/handoff evidence.

Acceptance:
- Drawer opens globally.
- Pilot Lab renders.
- Apply flow reaches Diff Viewer.
- Typecheck/build/browser verification pass.
```

---

## UX5 - Operate Conversations and Human Handoff

```text
Lane: UX5 - Operate Conversations and Human Handoff

Start after trace/handoff contracts are stable enough to read or mock.

Goal:
Implement Operate as Conversations + Human Handoff only.

Owned files:
- apps/console/app/operate/conversations/**
- apps/console/app/operate/handoff/**
- apps/console/components/operate/**
- apps/console/components/trace-panel/**

Tasks:
1. Conversations: Inbox + transcript + Case context + expandable trace.
2. Handoff: Queue + metrics + detail.
3. Configuration shortcuts point back to Build pages.
4. Do not build full CRM/task-management/SLA system.
5. Trace groups: Procedure step, Tool, Hook, Knowledge, human handoff, Stop retry.

Acceptance:
- Conversations and Handoff render on desktop.
- Trace is expandable and readable.
- Typecheck/build/browser verification pass.
```

---

## UX6 - i18n, responsive, and browser QA sweep

```text
Lane: UX6 - i18n/responsive/browser QA sweep

Start after UX1-UX5 are merged or stable.

Goal:
Final polish pass for language parity, desktop-first responsive behavior, and browser verification.

Owned files:
- apps/console/lib/i18n/dictionaries.ts
- small responsive fixes across UX routes
- tests/screenshots as needed

Tasks:
1. Verify en-US and zh-CN key parity.
2. Check desktop 1440/1280, tablet 1024, and mobile read-only states.
3. Ensure complex editing on mobile shows an appropriate open-on-desktop state.
4. Fix text overflow/overlap.
5. Verify no current UI uses Blueprint, Skill, Policy, or Guardrail as active language.

Acceptance:
- Browser screenshots pass for main routes.
- No obvious overlap/text clipping.
- Typecheck/build pass.
```

---

## INTEGRATION-GATE - Final merge, smoke, and optional deploy

```text
Lane: INTEGRATION-GATE - final merge/smoke/deploy owner

Start only after selected F/UX lanes are merged. Only one session should own this lane.

Goal:
Run the complete local gate, resolve integration fallout, push to origin/main, and deploy only if owner explicitly asks.

Owned files:
- Any small integration fixes needed after reading changed files.
- Deployment notes/receipt under doc/what's done only after success.

Tasks:
1. Pull latest origin/main.
2. Inspect merged lane commits and changed files.
3. Run:
   - npx tsc --noEmit -p apps/console/tsconfig.json
   - env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
   - npm run build:console
4. Run DB migration locally if schema changed.
5. Run browser smoke for Build Release, Components Hooks/Tools/Procedures, Pilot Lab, Operate Conversations, Settings Organization.
6. If and only if owner asks for deployment, use the configured deploy flow. SSH host is ssh ubuntu@43.134.51.138. Use the owner-provided credential only if available in this session; never print/store/commit it.
7. After deploy, verify /api/health returns ok and run one smoke message if safe.

Acceptance:
- origin/main contains all intended lane commits.
- deploy/main updated only if owner approved deploy.
- Health check ok after deploy.
- Receipt written with exact commands/results.
```

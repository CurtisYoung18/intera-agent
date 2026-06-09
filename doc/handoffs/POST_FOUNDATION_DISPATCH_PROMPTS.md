# Post-Foundation Dispatch Prompts

**Last updated:** 2026-06-09
**Purpose:** copy one prompt into a zero-context Codex session after the shipped F1-F7/UX0 foundation reset.
**Baseline:** local `main` at or after `c4c7365c foundation: cut dispatch to inline procedures`.

The old [`FOUNDATION_RESET_LANE_PROMPTS.md`](./FOUNDATION_RESET_LANE_PROMPTS.md) file is historical. Do not redispatch F1-F7 from it.

---

## Shared preamble for every lane

Paste this before the lane-specific block.

```text
You are working in /Users/curtis/Desktop/intera-agent on Intera after the first Foundation Reset wave.

Start by running:
- git fetch origin
- git status --short
- git log --oneline -n 10

Read these docs before editing:
- doc/handoffs/GENERIC_HANDOFF.md
- doc/handoffs/MASTER_BUILD_HANDOFF.md
- doc/handoffs/POST_FOUNDATION_DISPATCH_PROMPTS.md
- doc/README.md
- doc/to-do/2026-06-08-foundation-reset-domain-model.md
- doc/spec/Intera_Harness_架构梳理.md
- doc/spec/Intera_UI_UX_Design_System.md

Current shipped baseline includes:
- UX0 Quiet Agent Studio primitives.
- F1 Hook/HookBinding schema and shared contracts.
- F2 HookEngine with PreToolUse, PostToolUse, and Stop checkpoints.
- F3 tool_call/tool_result API and trace normalization.
- F4 /api/admin/hooks and /admin/hooks; old /api/admin/policies returns 410; /admin/guardrails redirects.
- F6 .intera-agent.json import/export.
- F7 Scenario APIs, receipts, validation state, and activation soft gate.
- U1 Build / Operate / Settings shell and redirects.
- C1 Procedure Builder with ProcedureStep Hook binding UI.
- R1 dispatch_case_agent cut to inline Procedure start/select; no customer-facing background sub-agent dispatch.

Design direction correction:
- Use a unified light-first visual system across the entire Intera Console.
- Do not introduce dark immersive workspaces for Pilot Lab, Diff Viewer, Trace, Release moments, ConfigPilot, or Scenario receipts in P0.
- Use warm light canvas, graphite text, muted cyan accent, restrained amber/green/red signals, 8px controls, subtle row dividers, compact grouping, and slightly cooler or denser light surfaces where focus is needed.
- Dark surfaces are allowed only for small functional code editors, JSON previews, and terminal-like raw trace payload viewers.
- Product pages, drawers, receipts, Diff Viewer, and trace panels should remain light.

Do not redo F1-F7 work.
Do not preserve long-term Policy/Guardrail/Skill/stage/sub-agent compatibility unless this prompt explicitly asks for a temporary adapter.
Do not edit files outside your owned list. If an extra file is required, report before expanding scope.
Do not overwrite unrelated dirty work.

Security:
- Do not write plaintext secrets, SSH passwords, API keys, tokens, or customer credentials into git, docs, prompts, logs, command output, .env, or shell history.
- SSH host may be referenced as ssh ubuntu@43.134.51.138. The owner may provide credentials privately inside the active Codex session. If credentials are unavailable and deployment is explicitly required, stop at local verification and ask the owner through the secure session.
- Do not rotate server credentials.

Verification expectations:
- Add focused tests for behavior changes.
- npx tsc --noEmit -p apps/console/tsconfig.json
- env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
- npm run build:console
- For UI lanes: run browser verification/screenshots for changed routes.

End with:
- changed files
- exact verification commands and results
- residual risks
- whether you committed/pushed/deployed
```

---

## Dependency map

| Wave | Lanes | Can run in parallel? |
|---|---|---|
| 1 | R1, C1, U1 | Shipped locally. Do not redispatch unless explicitly repairing. |
| 2 | U2, U3, B1 | Yes if ownership is respected. B1 owns Brain/Memory only. |
| 3 | R2 | After R1 + C1 are green. Physical deletion lane is exclusive for schema/types/runtime leftovers. |
| 4 | Q1 | Last. Broad copy/docs/i18n/browser sweep. |

Coordinator rule: prefer fewer concurrent runtime sessions. One runtime owner is worth more than five clever merge conflicts.

Current local post-foundation commits:

- `d99ef834 ux: add build operate settings shell`
- `f24b2fd9 C1: Procedure Step hooks UI + guardrail-to-hook validation consistency`
- `c4c7365c foundation: cut dispatch to inline procedures`

---

## R1 - Procedure runtime and dispatch_case_agent cutover

```text
Lane: R1 - Procedure runtime and dispatch_case_agent cutover

Goal:
Make dispatch_case_agent stop spawning detached/background sub-agents. It should create or select a Case, attach CaseType/Procedure context, and keep the main Case Owner Agent handling the customer inline through ProcedureExecutor + HookEngine.

Owned files:
- apps/console/lib/agent/tool-interceptor.ts
- apps/console/lib/agent/loop.ts
- apps/console/lib/agent/case-agent-loop.ts
- apps/console/lib/agent/procedure-executor.ts
- apps/console/lib/agent/dry-run-executor.ts
- apps/console/lib/agent/tools.ts only for dispatch_case_agent copy/schema if needed
- apps/console/app/api/messages/route.ts only if required to continue inline after dispatch
- focused runtime tests under apps/console/lib/agent/__tests__/**

Do not touch:
- packages/shared/prisma/schema.prisma
- apps/console/app/admin/**
- apps/console/app/api/admin/**
- apps/console/lib/i18n/dictionaries.ts
- UI route shell files

Tasks:
1. Inventory the current dispatch_case_agent flow from tool definition -> tool-interceptor -> case creation -> orchestrator/CaseAgentLoop.
2. Remove customer-facing calls to OrchestratorAgent.dispatchInBackground from dispatch_case_agent handling.
3. Make dispatch_case_agent return an inline routing result containing caseId, caseType, procedure summary, and clear instruction that the main Case Owner Agent continues the procedure.
4. Ensure the next customer-visible assistant response still passes HookEngine Stop before send/persist.
5. Disable dispatch_subagent from customer-facing available Tools unless a test-only adapter explicitly needs it.
6. Update playground/dry-run copy so it no longer says production would spawn background agents.
7. Keep legacy stage/sub-agent files only as dead adapters if deletion is too broad for this lane; do not let them run on the customer path.
8. Add or update tests proving dispatch_case_agent does not call dispatchInBackground and that the Case continues inline.

Acceptance:
- A focused test spies on OrchestratorAgent.prototype.dispatchInBackground and proves dispatch_case_agent does not call it.
- A focused test proves dispatch_case_agent creates/selects a Case and yields Procedure context for inline continuation.
- grep shows no customer-facing runtime path calls dispatchInBackground except legacy/dead code explicitly documented in the receipt.
- No new skill_* events are emitted.
- Typecheck, keyless full test, and build pass.
```

---

## C1 - Procedure Builder and ProcedureStep Hook bindings

```text
Lane: C1 - Procedure Builder and ProcedureStep Hook bindings

Goal:
Make delivery staff configure CaseTypes/Procedures and step-level Hooks without touching old Policy/Guardrail concepts. ProcedureStep Hook configuration must be visible from the Procedure editing flow.

Owned files:
- apps/console/app/api/admin/case-types/**
- apps/console/app/admin/case-types/**
- apps/console/components/admin/*procedure*
- apps/console/components/admin/*case-type*
- apps/console/components/admin/*hook* only if creating a shared step-binding picker without changing the F4 Hook library behavior
- focused case-type/procedure UI and route tests

Do not touch:
- apps/console/lib/agent/**
- packages/shared/prisma/schema.prisma
- apps/console/components/console-sidebar.tsx
- apps/console/lib/i18n/dictionaries.ts unless a local label is unavoidable

Tasks:
1. Replace CaseType UI references to guardrails/policies with Hooks and HookBindings.
2. Stop new CaseType admin code from calling /api/admin/policies.
3. Add Procedure step editor support for "Hooks for this step".
4. Let the user bind an existing Hook to a ProcedureStep using the F4 HookBinding API.
5. Let the user create a Hook from the step context only if it can be done through /api/admin/hooks and then bound to the step.
6. Show inherited active Hooks from Agent and CaseType scopes as read-only context when practical.
7. Keep legacy CaseType.guardrails fields as read-only migration data only if still present in the DB; do not expose them as the primary editor.

Acceptance:
- A delivery user can create/edit a Procedure step and bind a Hook to that step.
- New UI/API code does not call /api/admin/policies.
- Existing CaseType create/update tests are updated to Hook vocabulary or explicitly marked legacy.
- Typecheck, keyless full test, build, and browser smoke for the Procedure route pass.
```

---

## U1 - Build / Operate / Settings shell and redirects

```text
Lane: U1 - App shell, IA routes, and redirects

Goal:
Implement the target Console IA without rewriting every page: Build / Operate / Settings, default Build -> Release, and redirects from old admin/ops routes.

Owned files:
- apps/console/components/console-sidebar.tsx
- apps/console/components/console-shell.tsx if present
- route wrappers under apps/console/app/build/**
- route wrappers under apps/console/app/operate/**
- route wrappers under apps/console/app/settings/**
- redirect files for old routes when needed
- small shell/navigation tests if existing patterns support them

Do not touch:
- apps/console/lib/agent/**
- packages/shared/prisma/**
- deep page internals unless a wrapper cannot render without a tiny import/export change

Tasks:
1. Default logged-in product route should be /build/release.
2. Top-level nav: Build, Operate, Settings.
3. Build destinations: Release, Pilot Lab, Components.
4. Components subroutes: Brain, Procedures, Tools, Hooks, Knowledge, Integrations.
5. Operate routes: Conversations, Human Handoff.
6. Settings route: Organization.
7. Add redirects from old admin/ops routes to target routes.
8. Use the new Hook/Tool/Procedure vocabulary in new nav copy. Leave full dictionary sweep to Q1 if it becomes broad.

Acceptance:
- Browser click-through proves the new nav can reach target routes.
- Old routes do not 404.
- Existing pages render through wrappers.
- Typecheck, keyless full test, build, and screenshots for 1440px and 1024px pass.
```

---

## U2 - Release command center and package actions

```text
Lane: U2 - Release command center and package actions

Goal:
Build /build/release as the first screen: live version, draft changes, validation status, package import/export, publish/rollback actions, and Config Diff Viewer.

Owned files:
- apps/console/app/build/release/**
- apps/console/components/release/**
- apps/console/components/config-diff/**
- app/api/admin/agent-configs/[id]/activate route only if needed for small response fields/tests
- app/api/admin/agent-templates/** only if needed for UI integration tests, not service rewrites
- focused release/package UI tests

Do not touch:
- apps/console/lib/agent/**
- packages/shared/prisma/**
- hooks/scenario service internals unless the UI contract is impossible to consume

Tasks:
1. Show live Agent version, draft version, release note, publisher, and validation state.
2. Surface latest Scenario receipt metadata and changed-since-validation warning.
3. Implement Package actions: Export, Import, Duplicate Version, Publish, Rollback preview.
4. Build reusable Config Diff Viewer grouped by Brain, Procedures, Tools, Hooks, Knowledge, Integrations.
5. Publish must be explicit. If validation requires override, require a non-empty override reason.
6. ConfigPilot entry can open a placeholder drawer if U3 has not landed.

Acceptance:
- /build/release renders with real API data where available and clearly isolated placeholders where not.
- Export and Import controls call the F6 endpoints.
- Publish uses the F7 soft gate metadata and requires override reason when stale/failing/unvalidated.
- Typecheck, keyless full test, build, and browser smoke pass.
```

---

## U3 - Pilot Lab, Scenario receipts, and ConfigPilot shell

```text
Lane: U3 - Pilot Lab, Scenario receipts, and ConfigPilot shell

Goal:
Turn Scenario APIs into an operator-facing Pilot Lab and establish ConfigPilot as a global drawer/workbench shell. ConfigPilot may propose drafts but must not publish.

Owned files:
- apps/console/app/build/pilot-lab/**
- apps/console/components/scenario-receipts/**
- apps/console/components/config-pilot/**
- apps/console/app/admin/scenarios/page.tsx only for redirect or reuse
- apps/console/app/api/admin/scenarios/** only if a UI-blocking field is missing
- focused Pilot Lab / Scenario UI tests

Do not touch:
- apps/console/lib/agent/**
- packages/shared/prisma/**
- release page internals except a shared ConfigPilot trigger if coordinated with U2

Tasks:
1. Pilot Lab subareas: ConfigPilot Workspace, Free Test, Test Cases, Receipts.
2. Use existing Scenario CRUD/run APIs from F7.
3. Receipts show Tool calls, Hook decisions, Knowledge evidence, human transfer, final status, and forbidden/required phrase checks when present.
4. ConfigPilot apply flow must stop at proposal -> diff -> confirm -> typed API save. It cannot publish.
5. Add a global drawer mount only if U1 shell exists or if the mount is isolated and easy to merge.

Acceptance:
- /build/pilot-lab renders saved Scenarios and latest receipts.
- User can run a Scenario and inspect evidence.
- ConfigPilot shell opens without live-publish capability.
- Typecheck, keyless full test, build, and browser smoke pass.
```

---

## B1 - Brain Memory and compact strategy UX

```text
Lane: B1 - Brain Memory and compact strategy UX

Goal:
Turn the existing memoryStrategy/compact foundation into an operator-facing Brain > Memory workspace. Delivery staff should configure memory as strategy, preservation rules, and testable behavior, not as a wall of low-level token knobs.

Owned files:
- apps/console/app/build/components/brain/**
- apps/console/app/admin/memory/page.tsx only for reuse/redirect/extraction into Brain
- apps/console/components/brain/**
- apps/console/components/memory/**
- apps/console/app/admin/agent/types.ts only for MemoryStrategy UI typing if needed
- apps/console/lib/i18n/dictionaries.ts only for Brain/Memory labels needed by this lane
- focused Brain/Memory UI tests

Do not touch:
- apps/console/lib/agent/**
- packages/shared/prisma/**
- runtime compact implementation unless a UI-blocking contract gap is discovered and reported first
- Release/Pilot Lab internals

Product decisions:
- Brain owns Memory, Profile, and Compact Test.
- Memory config is strategy-first: Short / Balanced / Long / Custom.
- Preserve rules are more important than raw token thresholds.
- confirmedFacts are business facts. Do not store procedureRun/runtime state inside confirmedFacts.
- procedureRun belongs to structured working memory/runtime state.
- P0 should not expose a free-form record_facts system tool unless explicitly approved; facts should come from user extraction, form answers, tool-result mapping, and human-task answers.

Tasks:
1. Move or wrap the existing /admin/memory experience under /build/components/brain as Brain > Memory.
2. Keep a compact top-level operator view:
   - Memory Mode: Short / Balanced / Long / Custom
   - Auto compact on/off
   - Compact model
   - Preserve toggles: Facts, Tool evidence, Procedure progress, Human handoff status, User profile signals
   - Fact extraction rules/model
3. Keep raw engineering parameters under Advanced only:
   - warning/error/blocking thresholds
   - token estimation knobs
   - compact temperature
   - circuit breaker failures
   - custom compact prompt
4. Add Brain > Profile placeholders or first slice:
   - long-term memory on/off
   - profile promotion rules
   - historical chat/case load amount
5. Add Compact Test first slice:
   - choose or paste a conversation sample
   - run compact using current memoryStrategy
   - show before/after summary
   - highlight whether critical facts/evidence/procedure progress were preserved
6. Reuse existing memoryStrategy fields where possible; do not invent a second config object unless there is a clear migration plan.
7. If /admin/memory remains, redirect or clearly mark it as legacy/admin route to avoid two competing memory surfaces.

Acceptance:
- /build/components/brain renders a Brain workspace with Memory as a first-class section.
- Delivery user can choose Short/Balanced/Long and save memoryStrategy.
- Advanced settings are hidden by default.
- Compact Test can run against a sample or clearly stubbed local fixture without publishing or activating anything.
- UI copy distinguishes business facts, procedure runtime state, tool evidence, and long-term profile memory.
- Typecheck, keyless full test, build, and browser smoke pass.
```

---

## R2 - Physical legacy cleanup

```text
Lane: R2 - Physical legacy cleanup

Start only after R1 and C1 are committed and green.

Goal:
Physically remove the old long-term model: Policy table/model, CaseType.guardrails/stage/sub-agent/SOP fields, ChatMemory skills*/continuation fields, stage runtime files, and sub-agent runtime files.

Owned files:
- packages/shared/prisma/schema.prisma
- packages/shared/prisma/migrations/*
- packages/shared/types/index.ts
- packages/shared/contracts/case-types.ts
- packages/shared/contracts/cases.ts
- packages/shared/contracts/policies.ts deletion if safe
- packages/shared/defaults/index.ts
- packages/shared/prisma/seed.ts
- apps/console/lib/agent/stage-executor.ts
- apps/console/lib/agent/orchestrator.ts
- apps/console/lib/agent/sub-agent.ts
- apps/console/lib/agent/react-loop.ts
- apps/console/lib/agent/tools/builtin/dispatch-subagent.ts
- apps/console/lib/agent/tools/builtin/finalize-case-agent.ts
- tests that only protect deleted legacy behavior

Do not touch:
- UI route shell/pages except compile fixes caused by removed types.
- release/pilot-lab work in progress.

Tasks:
1. Confirm R1 removed customer-facing runtime dependency on stage/sub-agent paths.
2. Add migration to drop legacy fields/tables only after backfill is safe.
3. Rename ChatMemory skillsCalled/skillResults physical fields to toolsCalled/toolResults or migrate to the agreed target.
4. Remove Policy model/table after Hook backfill is no longer needed.
5. Remove stage/sub-agent runtime files or leave tiny throwing shims only if imports need a transitional compile step.
6. Update seed/defaults to current Hook/Tool/Procedure vocabulary only.
7. Update import/export legacy namespace if physical fields disappear.

Acceptance:
- Fresh migrate + seed passes on Postgres.
- Existing non-empty migrated DB path is covered or clearly documented.
- grep shows no live code imports deleted stage/sub-agent runtime.
- Typecheck, keyless full test, build pass.
```

---

## Q1 - Final terminology, i18n, docs, and browser QA sweep

```text
Lane: Q1 - Final terminology, i18n, docs, and browser QA sweep

Start last after selected runtime and UI lanes land.

Goal:
Clean user-facing copy, docs, redirects, and responsive/browser quality so delivery staff no longer see the old foundation vocabulary except in historical archives.

Owned files:
- apps/console/lib/i18n/dictionaries.ts
- apps/console/app/ops/guide/page.tsx
- apps/console/components/admin/agent-onboarding.tsx
- small copy-only edits across current pages
- doc/README.md
- doc/handoffs/*
- doc/spec/*
- doc/to-do/*

Do not touch:
- runtime behavior
- schema/migrations
- large UI layout rewrites

Tasks:
1. Replace user-facing Guardrails/Policies with Hooks.
2. Replace user-facing Skills with Tools.
3. Replace old stage/sub-agent product descriptions with Procedure/Case Owner language.
4. Ensure en-US and zh-CN dictionary key parity.
5. Update guide docs and current handoffs to the shipped baseline.
6. Run terminology greps and list intentional historical/archive leftovers.
7. Browser-check target routes at 1440px, 1280px, and 1024px where practical.

Acceptance:
- New product UI and current docs use Hook/Tool/Procedure/CaseType vocabulary.
- Historical old terms are confined to archive/history or explicit legacy migration comments.
- Typecheck, keyless full test, build, and browser QA pass.
```

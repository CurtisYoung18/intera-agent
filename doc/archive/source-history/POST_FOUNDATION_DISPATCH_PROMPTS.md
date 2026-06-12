# Post-Foundation Dispatch Prompts

**Last updated:** 2026-06-10
**Purpose:** preserve repair-ready prompts after the shipped F1-F7/UX0 foundation reset and post-foundation lanes.
**Baseline:** local `main` at or after `ed9430bb Q3-B1: align legacy routes and navigation`.

The old [`FOUNDATION_RESET_LANE_PROMPTS.md`](./FOUNDATION_RESET_LANE_PROMPTS.md) file is historical. Do not redispatch F1-F7 from it.

**Status on 2026-06-10:** P1, R3, S2, U-Pilot, PKG1, BASE1, and Q3-B1 are already shipped on local `main`. The lane blocks below are historical repair prompts unless the coordinator explicitly reopens one. For current truth and next-step status, read [`MASTER_BUILD_HANDOFF.md`](../../handoffs/MASTER_BUILD_HANDOFF.md) first.

---

## Shared preamble for every lane

Paste this before the lane-specific block.

```text
You are working in /Users/curtis/Desktop/intera-agent on Intera after the first Foundation Reset wave.

Start by running:
- git fetch origin
- git status --short
- git log --oneline -n 10

Worktree boundary:
- Integration/refactor worktree: `/Users/curtis/Desktop/intera-agent`, branch `main`, tracking `origin/main`. Use this for S2, PKG1, Q3, UI/product/runtime feature work.
- Live-testing hotfix worktree: `/Users/curtis/Desktop/intera-agent-hotfix`, branch `hotfix/live-testing`, tracking `deploy/main`. Use this only for minimal online hotfixes that may be pushed/deployed.
- If you are doing feature/refactor work, stay in `/Users/curtis/Desktop/intera-agent`; do not deploy directly from that lane.
- If you are doing a hotfix, start with `git -C /Users/curtis/Desktop/intera-agent-hotfix pull --ff-only`, keep the diff minimal, do not do large refactors, do not touch schema/migrations unless explicitly approved, and report the hotfix commit hash.
- If a hotfix touches `apps/console/lib/agent/**` or `apps/console/app/api/messages/route.ts`, runtime work in main must pause for those files until the hotfix commit is cherry-picked back.
- After cherry-picking a hotfix into main, run typecheck, keyless full tests, and clean build.

Read these docs before editing:
- doc/handoffs/GENERIC_HANDOFF.md
- doc/handoffs/BROWSER_SMOKE_RUNBOOK.md
- doc/handoffs/MASTER_BUILD_HANDOFF.md
- doc/handoffs/POST_FOUNDATION_DISPATCH_PROMPTS.md
- doc/handoffs/ARCHITECT_AUDIT_2026-06-09.md
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
- U2 Release command center and Config Diff Viewer.
- U3 Pilot Lab, Scenario receipts, and ConfigPilot shell.
- B1 Brain Memory strategy workspace.
- R2 physical legacy cleanup: Policy/stage/sub-agent/skills physical runtime removed, with migration backfills/archive tables.
- Q1 terminology/docs/i18n sweep.
- Q2 light-first Build surface polish, logo/favicon copy-in, and loader/token-stream reference integration.
- Obsolete `/ops/guide` route removed.
- P1 ConfigPilot typed backend context/propose/apply draft flow.
- R3 ProcedureRun runtime overlay and real memory tools.
- S2 runtime-backed Scenario receipts.
- U-Pilot Pilot chat cockpit + Playground tab.
- PKG1 package completeness and version cap.
- BASE1 core console regression stabilization.
- Q3-B1 legacy route and navigation truth alignment.

Current Pilot correction:
- Logged-in/default authenticated route is `/build/pilot-lab`.
- Pilot Lab has two main tabs: `Pilot` for chat-based agent building, and `Playground` for manual dry-run testing/debug.
- ConfigPilot is not a global drawer in P0. Older drawer references in shipped U2/U3/Q2 prompts are historical and must not be used for new work.
- Existing Playground dry-run and Trace Sidebar capability must be preserved under the Pilot Lab `Playground` tab before any old Playground route is removed.
- Current Playground truth: it is the Runtime Truth Desk + Manual Test Bench for the selected Agent version. The UI is a compatibility reuse, but the runtime path is real; operational tool side effects are still mocked under `dryRun`, and runtime-backed receipts must stay distinct from fixture-only receipts.

Design direction correction:
- Use a unified light-first visual system across the entire Intera Console.
- Do not introduce dark immersive workspaces for Pilot Lab, Diff Viewer, Trace, Release moments, ConfigPilot, or Scenario receipts in P0.
- Use warm light canvas, graphite text, muted cyan accent, restrained amber/green/red signals, 8px controls, subtle row dividers, compact grouping, and slightly cooler or denser light surfaces where focus is needed.
- Dark surfaces are allowed only for small functional code editors, JSON previews, and terminal-like raw trace payload viewers.
- Product pages, Pilot work panels, receipts, Diff Viewer, and trace panels should remain light.
- Approved logo source: `/Users/curtis/Desktop/design/Globe loader`.
- Approved AI-generation loading sources for Playground and Pilot Lab: `/Users/curtis/Desktop/design/Organic Loaders (standalone).html` variants `01`, `02`, `05`, `06`, `10`, `11`, `12`, `17`, `20`.
- Approved AI-generation text streaming source for Playground and Pilot Lab: `/Users/curtis/Desktop/design/Text streaming (standalone).html` variant `07 token stream`.
- Treat those Desktop paths as design references only. If implementing, copy or recreate the minimal required SVG/CSS/animation primitives into the app codebase or asset pipeline; do not load runtime assets from Desktop paths.

Product/runtime decisions:
- Case is no longer a product-level concept. Code may keep durable Case shells temporarily where Message/ActionTrace persistence requires them, but UI/copy/future APIs should prefer Chat, User, ProcedureRun, HumanTask, Trace, and Memory.
- ProcedureRun state is session-lifecycle runtime state, not business memory. Do not store active/paused/completed ProcedureRun state inside confirmedFacts.
- confirmedFacts are business facts only.
- R3 should borrow Claude Code-style runtime semantics, not Claude Code source code: enqueue structured events, stamp epoch/uuid/origin metadata, separate explicit control interrupts from ordinary user messages, evaluate stable Hook lifecycle checkpoints with dynamic context, keep prompt-cache boundaries clear, and make memory Tools real.
- Do not vendor or copy code from `/Users/curtis/Desktop/claude-code-source-code-ref-only`; it is outside the repo and reference-only for architecture semantics.
- The runtime should expose ProcedureRun context to the main Agent as dynamic procedure todos/current state. The Agent decides whether a new message continues, supplements, pauses, resumes, or starts a Procedure inside the normal ReAct loop.
- Do not add a standalone LLM ProcedureRouter unless the owner explicitly reopens that decision.
- `record_facts` is not the target product/tool name. Use a controlled `remember` tool with explicit `scope: "chat" | "user"` if this lane adds memory writes.
- `remember(scope="chat")` writes what `read_chat_memory` can read. `remember(scope="user")` writes what `read_user_profile` can read.
- `finalize_case` should be retired/renamed toward `finalize_procedure` in new code and copy.
- Runtime-managed capabilities should be visible to delivery staff as locked/auditable platform capabilities, not editable business Tools. P0 examples: Procedure Run Tracker, Hook Engine, Memory Extractor, Scenario Runner.
- Agent-callable immutable system Tools should be visible as locked Tools. P0 examples: `start_procedure`, `finalize_procedure`, `ask_user_questions`, `create_human_task`, `read_chat_memory`, `read_user_profile`, and `remember`.

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
- Do not spend more than 10 minutes debugging local browser auth. If authenticated local smoke is blocked by secure-cookie localhost behavior, stop, cite BROWSER_SMOKE_RUNBOOK.md, and cover the lane with focused tests/build plus production HTTPS verification only if deploy is explicitly in scope.

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
| 2 | U2, U3, B1 | Shipped locally. Do not redispatch unless explicitly repairing. |
| 3 | R2 | Shipped locally. Do not redispatch unless explicitly repairing. |
| 4 | Q1, Q2 | Shipped. Do not redispatch unless explicitly repairing. |
| 5 | P1, R3, S2 | Shipped locally. Do not redispatch unless explicitly repairing. |
| 6 | U-Pilot, PKG1, Q3 | Shipped locally/main. Use these prompts only for focused repair, compatibility cleanup, or doc-truth follow-up. |

Coordinator rule: prefer fewer concurrent runtime sessions. One runtime owner is worth more than five clever merge conflicts.

Current local post-foundation commits:

- `d99ef834 ux: add build operate settings shell`
- `f24b2fd9 C1: Procedure Step hooks UI + guardrail-to-hook validation consistency`
- `c4c7365c foundation: cut dispatch to inline procedures`
- `6b3a7c2c U3: add pilot lab workspace`
- `baa74ba7 U2: add release command center`
- `575950f7 B1: add Brain memory strategy workspace`
- `b97c1e83 docs: update post-foundation dispatch handoffs`
- `810ac9cd R2 remove legacy policy runtime`
- `20c3455b Q1 terminology and docs sweep`
- `c276cedd Q2 polish light-first build surfaces`
- `02dc3182 cleanup: remove obsolete ops guide route`
- `864392c6 P1: add ConfigPilot typed draft flow`
- `f9ed457c R3: ship ProcedureRun runtime overlay`
- `64ee8f01 S2: add runtime-backed scenario receipts`
- `ec06aaf4 U-Pilot: add chat cockpit workspace`
- `ccd10c79 PKG1: complete agent package import export`
- `9041049e BASE1: stabilize core console regression paths`
- `ed9430bb Q3-B1: align legacy routes and navigation`

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
6. ConfigPilot entry should link into Pilot Lab with current release context if U3/Pilot UI is available; do not add a global drawer in new work.

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

Status:
Shipped as the first Pilot Lab shell. Superseded for new UI work by `U-Pilot - Pilot Chat Cockpit and Playground preservation`.

Goal:
Turn Scenario APIs into an operator-facing Pilot Lab. ConfigPilot may propose drafts but must not publish.

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
5. Do not add a global drawer in new work. Use the Pilot Lab route as the ConfigPilot home.

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
- ProcedureRun belongs to session-lifecycle runtime state, not durable business memory.
- If this lane mentions memory-write tooling, use `remember`, not `record_facts`. `remember` must require `scope: "chat" | "user"` and must not be used to persist ProcedureRun state.

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

Status:
Shipped locally as 810ac9cd R2 remove legacy policy runtime. Do not redispatch unless explicitly repairing.

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
8. Do not promote Case as a product concept while cleaning schema/runtime leftovers. If durable Case shells remain because Message/ActionTrace require caseId, document them as transitional persistence.
9. Do not store ProcedureRun state in confirmedFacts or durable user profile memory.
10. Rename or prepare new-code paths away from `finalize_case` toward `finalize_procedure` where safe within this lane.

Acceptance:
- Fresh migrate + seed passes on Postgres.
- Existing non-empty migrated DB path is covered or clearly documented.
- grep shows no live code imports deleted stage/sub-agent runtime.
- Typecheck, keyless full test, build pass.
```

---

## P1 - ConfigPilot typed configuration tools

```text
Lane: P1 - ConfigPilot typed configuration tools

Start after Q1, unless the coordinator explicitly confirms Q1 has no overlapping API/component ownership. This lane can run alongside Q2 only if it owns APIs and ConfigPilot components cleanly.

Goal:
Make ConfigPilot a permission-bound configuration assistant that can inspect the current Agent, propose draft changes, show a diff, and apply accepted changes through typed admin APIs. ConfigPilot must not publish.

Owned files:
- apps/console/components/config-pilot/**
- apps/console/app/build/pilot-lab/**
- apps/console/app/api/admin/config-pilot/**
- apps/console/lib/config-pilot/**
- apps/console/app/api/admin/agent-configs/**
- apps/console/app/api/admin/case-types/**
- apps/console/app/api/admin/tools/**
- apps/console/app/api/admin/hooks/**
- apps/console/app/api/admin/scenarios/**
- focused ConfigPilot API/UI tests

Do not touch:
- packages/shared/prisma/schema.prisma unless the coordinator explicitly assigns a schema slice
- apps/console/lib/agent/** runtime loop files
- release page layout except a shared link into Pilot Lab if unavoidable
- global IA/sidebar

Product constraints:
- ConfigPilot may read the full current Agent configuration allowed by the user's permissions.
- ConfigPilot may propose changes to Brain, prompts/model settings, memory strategy, Procedures, Tools, Hooks, Knowledge references, Integrations, Scenarios, and package drafts.
- Every write must follow: read current config -> propose -> diff -> explicit user accept -> typed API write draft -> mark validation stale.
- ConfigPilot must never self-publish, activate, deploy, or bypass Scenario validation.
- ConfigPilot must never raw-write the DB from model output. Use typed endpoints and zod contracts.
- Secrets must be shown as references/placeholders only.
- Runtime-managed capabilities are visible but locked. ConfigPilot cannot edit Procedure Run Tracker, Hook Engine, Memory Extractor, or Scenario Runner behavior.
- The ConfigPilot system prompt, tool schema, model selector, and proposal parser belong on the backend under `apps/console/lib/config-pilot/**`. Do not keep deterministic proposal generation or model-facing prompt text inside the React component.
- Model selection must be explicit and type-safe: prefer `CONFIG_PILOT_MODEL` when set, otherwise the selected Agent model, otherwise the shared default model. Missing `CONFIG_PILOT_MODEL` must not break `tsc`.
- Proposal responses must include `modelUsed` and a stable prompt/version identifier for auditability.
- The proposal model must produce a structured tool call or equivalent structured output only; free-form text proposals are not accepted.

Tasks:
1. Add a ConfigPilot read endpoint that returns the active/draft Agent configuration summary with permissions and locked capability metadata.
2. Add a proposal endpoint that accepts a natural-language operator request and returns a structured proposed change plus target surface.
3. Add or reuse a diff viewer so the user can inspect exactly what will change before accepting.
4. Add an apply endpoint that accepts only typed patches for known surfaces and writes draft config through existing admin services.
5. Mark validation stale after accepted writes.
6. Add focused tests for permission checks, accept-required behavior, typed patch validation, stale-validation marking, and no-publish guarantee.
7. Update the ConfigPilot/Pilot Lab UI to show current context, proposed changes, accept/reject, and receipt/run suggestions. Do not add a global drawer.
8. If a partial `apps/console/lib/config-pilot/**` or `apps/console/app/api/admin/config-pilot/**` skeleton already exists in the worktree, either take ownership of it and make it green or stop and report. Do not leave untracked code that breaks typecheck/build.
9. Ensure the final P1 receipt proves `/context`, `/propose`, and `/apply` are all wired, and that UI no longer falls back to the old hardcoded scenario proposal builder.

Acceptance:
- A delivery user can ask ConfigPilot to make a small Procedure/Hook/Tool/Memory draft change and must accept before it is applied.
- A rejected proposal writes nothing.
- Direct publish/activation attempts are refused.
- Locked runtime-managed capabilities render visibly but are not editable.
- `npx tsc --noEmit -p apps/console/tsconfig.json` must pass with `CONFIG_PILOT_MODEL` unset.
- `npm run build:console` must pass after deleting `.next`.
- Focused tests cover redacted context, structured proposal parsing, accept-required apply, protected Tool refusal, and validation-stale marking.
- Typecheck, keyless full test, build, and browser smoke for Pilot Lab/ConfigPilot pass.
```

---

## R3 - ProcedureRun runtime overlay, system Tools rename, and remember

```text
Lane: R3 - ProcedureRun runtime overlay, system Tools rename, and remember

Goal:
Upgrade Procedure execution from prompt-mode switching to a runtime overlay. The stable Core Agent prompt stays first. `start_procedure(procedureId)` creates/selects a ProcedureRun, then runtime appends structured ProcedureRun context at the prompt tail and deterministically resolves current step + Hook scopes around later Tool calls. Also make model-facing system Tools match the product model: `start_procedure`, `finalize_procedure`, and `remember(scope="chat" | "user")`.

Owned files:
- apps/console/lib/agent/session-store.ts
- apps/console/lib/agent/tools.ts
- apps/console/lib/agent/tool-interceptor.ts
- apps/console/lib/agent/loop.ts
- apps/console/lib/agent/case-agent-loop.ts only for compatibility extraction/removal
- apps/console/lib/agent/procedure-executor.ts
- apps/console/lib/agent/hook-engine.ts only if HookContext needs ProcedureRun timeline data
- apps/console/lib/agent/memory.ts
- apps/console/lib/agent/persistence-port.ts only if needed for real `remember`/read memory writes
- apps/console/lib/agent/prompt-resolver.ts
- apps/console/lib/agent/tools/builtin/**
- apps/console/app/api/messages/route.ts
- apps/console/app/api/cases/[id]/export/route.ts only if runtime state filtering is required
- packages/shared/contracts/cases.ts only if runtime state filtering is required
- packages/shared/prisma/seed.ts only to migrate seed Procedures to the current procedure schema or add parser-compatible fixtures
- packages/shared/defaults/index.ts
- focused runtime/prompt tests under apps/console/lib/agent/__tests__/**

Mental model:
- Stable core prompt: long-lived and cache-friendly.
- Stable model-visible Tool schema: the available Tool names/schemas are part of the cache boundary. Procedure-specific allowedTools should be enforced by runtime/Hook gates, not by dynamically hiding/showing Tool schemas after `start_procedure`.
- Stable procedure definition: loaded by procedureId and cacheable or appended only when active.
- Dynamic ProcedureRun state: currentStep, completed/skipped/blocked steps, facts, blockers, and recent evidence. This belongs at the prompt tail and changes every turn.
- Runtime owns the ProcedureRun timeline. The model proposes actions; runtime resolves step/hook constraints and updates the timeline.
- Treat ProcedureRun as a runtime protocol, similar in spirit to Claude Code's command queue + hook lifecycle + dynamic prompt boundary. Do not implement it as a temporary Procedure Agent, and do not copy CC source.
- Inputs are timeline events, not naked strings. Each queued event should carry stable metadata such as eventId/uuid, inputEpoch, origin, isMeta/control flag where applicable, runId/session id, and enqueue priority/policy.
- Ordinary customer messages are queue/reconcile events. They are not interrupts and must not abort active Tool execution by default.
- Only explicit control events such as operator stop, session close, or human takeover may abort the current turn/tool. Tool definitions may later expose `interruptBehavior: "block" | "cancel"`; default behavior should be block/non-cancel.
- Interleaved customer messages use generic epoch-based reconciliation, not semantic intent classification. Runtime does not decide whether a new message is a correction, cancellation, supplement, or new problem; it only tracks whether a Tool/action/step was based on the latest input epoch.
- R3 first version should not add a Prisma `ProcedureRun` table unless the coordinator explicitly approves a schema lane. Use `session-store` as the runtime authority for active ProcedureRun state. Durable `ActionTrace` may record evidence/audit events, but canonical active/paused ProcedureRun state is session lifecycle state.
- One chat/session can have one active ProcedureRun plus paused/pending ProcedureRuns. Do not create one durable Case per ProcedureRun and do not revive detached Procedure agents.
- Keep three layers separate:
  - `ProcedureRunState` is runtime authority for active/paused runs, currentStepId, inputEpoch, needsReconcile, stale evidence, and step status.
  - `ChatMemory` is chat-scoped working memory from compact(case) and `remember(scope="chat")`. It can help the model recover context but cannot decide canonical ProcedureRun step/state.
  - `UserProfile` is cross-chat long-term profile from compact(profile)/mergeProfile and `remember(scope="user")`. It must not store current ProcedureRun runtime state.
- Compact and memory are context layers, not the ProcedureRun state machine.

Tasks:
0. Before editing, inspect the reference-only CC files mentioned in the owner/architect notes only to understand semantics: command queue metadata/priority, explicit interrupt controls, hook lifecycle schemas, prompt static/dynamic boundary, and real memory. Do not copy implementation code.
1. Expose `start_procedure` as the primary model-facing Tool. Accept `procedureId`, reason, confidence, collected facts, and current Procedure action. Keep `dispatch_case_agent` only as a compatibility alias if necessary, and do not advertise it in new prompt/default copy.
2. `start_procedure` must not replace the system prompt, activate a separate Procedure agent persona, or prepend a dynamic Procedure header before the stable Core Agent prompt.
3. Define a first-class runtime `ProcedureRunState` with runId, procedureId, status, inputEpoch, lastReconciledInputEpoch, needsReconcile, currentStepId, per-step status, evidenceToolCallIds, facts, blockers, and unreconciled timeline events. Keep it session/runtime-scoped.
3a. Define a structured runtime event shape for input/control/timeline entries. Required fields should include a stable eventId/uuid, inputEpoch, origin, source, createdAt/enqueuedAt, runId/session id, and optional metadata such as isMeta/control and priority/enqueue policy. Use priority + FIFO only for scheduling; do not infer customer intent from priority.
4. Append structured ProcedureRun context at the prompt tail after stable core prompt + stable tool contract. Include current step, expected next tools/actions, blockers, and recent evidence.
4a. Add or preserve a clear static/dynamic prompt boundary in prompt assembly. Tests must prove the stable Core Agent prefix and stable Tool contract do not change after `start_procedure`; only the dynamic tail changes with ProcedureRun state.
4b. Keep the model-visible Tool list/schema stable across Procedure activation. Do not use `selectPromptAndTools()` or Procedure-specific filters to dynamically remove Tool schemas from the model after `start_procedure`. Enforce Procedure `allowedTools` through runtime/Hook gates with clear feedback.
5. Resolve HookContext deterministically before each Tool call: active ProcedureRun + requested Tool + currentStepId -> global/agent + procedure/caseType + procedureStep + tool Hook scopes.
6. Increment `inputEpoch` at enqueue time, not drain time. `/api/messages` must update session-store `latestInputEpoch` and append structured queued events before returning 202 for concurrent messages. The initial user message must also get an epoch before the AgentLoop starts.
6a. Upgrade `session-store` from a bare queued-message list to structured runtime events. The event shape must cover customer messages, customer form results, human task results, tool starts/results, text replies, hook decisions, reconcile actions, and explicit controls.
7. Stamp every Tool call/action/finalize attempt with `basedOnInputEpoch` at enqueue/start time. Streaming Tool execution starts before drain, so stale detection cannot wait until `waitForAll()`.
7a. Stamp customer-facing text replies with `basedOnInputEpoch` at generation start. Before committing/sending a final reply, check whether `inputEpoch` advanced. If the reply is stale, prefer withholding it and scheduling a reconcile turn; if streaming transport has already exposed tokens, do not advance the ProcedureRun and mark the reply stale in trace/timeline.
8. If a Tool result returns after `inputEpoch` advanced, save it as evidence but do not automatically advance/complete the step; mark `needsReconcile = true`.
9. If `needsReconcile` is true, block further Tool calls/finalization through runtime/Hook feedback until the model reconciles the latest timeline events. The prompt tail should say: "New customer messages arrived after the last tool/action began. Before calling another tool or finalizing, reconcile these messages with the active ProcedureRun."
9a. Add a structured runtime action to clear reconcile state, such as `reconcile_procedure_input({ runId, upToInputEpoch, decision, summary })`. This is not a memory write. It should append a reconcile timeline event, set `lastReconciledInputEpoch`, clear `needsReconcile` only when `upToInputEpoch >= inputEpoch`, and leave business facts to `remember`.
10. Do not build an interleaved-message intent classifier or ProcedureRouter. Reconciliation is generic epoch/version control, not semantic routing.
10a. Keep ordinary queued customer messages separate from explicit control requests. Do not abort active Tool execution for ordinary customer messages. If R3 adds control events, only operator stop/session close/human takeover style controls may abort, and cancellation should respect a Tool-level interrupt behavior with default block/non-cancel.
10b. Treat customer form results and human task results as input timeline events that increment `inputEpoch` before the next model turn. A human verdict or form result must not force `finalize_case`/`finalize_procedure` if newer customer input arrives afterward.
11. Update ProcedureRun timeline after each Tool result, Hook decision, human task result, form result, text reply, `remember`, reconciliation action, and `finalize_procedure`.
12. Make HookEngine stable. Do not represent active Procedure state by recreating HookEngine with a hidden `caseType` option. Pass dynamic ProcedureRun/caseType/currentStep context through `HookContext` for each evaluation.
12a. Preserve the P0 Hook lifecycle of PreToolUse, PostToolUse, and Stop. Do not expand P0 lifecycle unless explicitly required, but keep the runtime event shape compatible with future UserPromptSubmit, PreCompact, and PostCompact style hooks.
13. Replace ProcedureStep Hook resolution from todo/tool guessing with runtime timeline resolution. `procedureStepIds` must come from activeProcedureRun.currentStepId plus requestedTool compatibility, not from "all Procedure steps whose target equals this tool." `seedProcedureTodos()` is not a production source of truth.
14. Consolidate system Tool definitions. Remove or de-emphasize the duplicate `SYSTEM_TOOLS`/`BUILT_IN_TOOLS` mismatch, fix the bogus `read_user_profile.required = ["procedureId"]`, and protect locked system Tool names from DB Tool rows shadowing them.
15. Expose `finalize_procedure` as the primary terminal Tool. Keep `finalize_case` only as a compatibility alias if necessary.
15a. Remove default prompt copy that forces `finalize_case` after human resume. Human/form results are timeline input events; the Agent must reconcile current epoch before any terminal action.
15b. Make `start_procedure(procedureId)` idempotent by request/event id and active run state. Repeated model calls, retries, stale tool results, or duplicated network requests should return the existing active/paused run or a safe no-op instead of creating duplicate pending/paused ProcedureRuns.
16. Add `remember` with explicit `scope: "chat" | "user"`, key/value or facts payload, and a reason. Chat scope must feed `read_chat_memory`; user scope must feed `read_user_profile`.
16a. Reject or ignore attempts to use `remember` for ProcedureRun runtime state such as currentStepId, needsReconcile, active/paused/completed run state, stale evidence promotion, or pending ProcedureRun authority.
17. Make `read_chat_memory`, `read_user_profile`, and `remember` real system-managed Tools. Do not leave them as executor placeholders returning `{ ok: true, handled: "system_managed" }`. Either fill tool_result output in the executor with context-aware services or intercept and replace the tool_result before the model sees it.
17a. `read_chat_memory` should return chat-scoped confirmed facts, tools run, key events, compact summary, and open items. It must label memory as context, not ProcedureRun authority.
17b. `read_user_profile` should return identity, contact details, preferences, long-term history, and behavior patterns. It must not return active ProcedureRun runtime state.
17c. Harden compact output format for case/chat compacting. Prefer a strict text envelope such as `<summary>...</summary>` and keep compact tool-free. Compact may summarize confirmed facts, tools observed, open items, latest customer messages, and suggested next steps, but it must not assert canonical `currentStepId`, clear `needsReconcile`, complete active runs, or promote stale tool results.
18. Update default prompts and prompt resolver copy from Case/CaseType language to Procedure catalog + ProcedureRun/current task language where model-facing.
19. Change `buildPromptContext` and related prompt assembly params from ambiguous `orgId` to explicit `agentConfigId` where DB queries use `caseType.agentConfigId`.
20. Ensure seed Procedures use the current parser schema `{ steps: [{ id, action, target, ... }] }`, or add explicit legacy parser compatibility with tests. Do not ship seeded Procedures that parse to null.
21. Ensure `ProcedureRun` active/paused/completed state is not persisted as public `confirmedFacts`, durable UserProfile memory, or unfiltered API/export payloads. If any temporary internal key remains in ChatMemory/toolResults, filter it from case export, case detail contracts, dashboards, compact summaries, and public memory APIs.
22. When old raw `tool_result` blocks remain in the LLM message window or survive as summaries/memory, mark ProcedureRun evidence in the dynamic overlay as canonical, evidence_only, stale, or superseded. Model-visible history must not be enough to advance a step.
23. Document the R3 V1 deployment boundary near session-store: in-memory ProcedureRun state is acceptable only for single-process / restart-loses-active-runtime assumptions. Multi-instance or restart-resilient runtime requires Redis/lease or a later schema lane.
24. Add tests proving the old names are not advertised to the model while compatibility still works where intentionally retained.

Acceptance:
- Tool definitions shown to the model include `start_procedure`, `finalize_procedure`, `remember`, `read_chat_memory`, `read_user_profile`, `ask_user_questions`, and `create_human_task`.
- New prompt/default copy contains no customer-facing `dispatch_case_agent`, `finalize_case`, or `record_facts` instructions except explicit compatibility tests/comments.
- A runtime event test proves queued inputs carry eventId/uuid, inputEpoch, origin/source, enqueue timestamp, and run/session metadata; priority/enqueue policy is handled generically and FIFO is preserved within the same priority.
- An explicit-control test proves an ordinary queued customer message does not abort an active Tool, while an explicit operator/session/human-takeover control can block or cancel according to the Tool interrupt behavior.
- A test proves ProcedureRun internal state does not appear in Current Case/Procedure State, compact summaries, confirmedFacts DB fields, or public memory route payloads.
- A prompt test proves the stable Core Agent prompt prefix remains byte-stable before and after `start_procedure`; ProcedureRun state appears only in the dynamic tail context.
- A prompt-boundary test proves stable/cacheable prompt content is separated from dynamic ProcedureRun overlay; do not prepend dynamic Procedure text before the stable Core Agent prompt.
- A tool-schema-boundary test proves the model-visible Tool list/schema remains stable before and after Procedure activation; Procedure `allowedTools` violations are blocked by runtime/Hook feedback, not dynamic schema hiding.
- A runtime test proves a Tool call inside an active ProcedureRun sends the expected `procedureStepIds` into HookEngine and applies the matching ProcedureStep Hook binding.
- A timeline test proves currentStep/evidenceToolCallIds update after Tool result and `finalize_procedure`.
- A topic-switch test proves a new Procedure can pause the active run and append both active/paused context without prompt-mode switching.
- An epoch test proves a Tool result based on inputEpoch N does not advance the current step if a new user message has advanced the ProcedureRun to inputEpoch N+1; the result is stored as evidence and `needsReconcile` is set.
- An enqueue-time epoch test proves a second `/api/messages` POST increments session-store `latestInputEpoch` before AgentLoop drain.
- A session-store event test proves queued customer messages, form results, human task results, text replies, tool events, hook decisions, reconcile actions, and explicit controls share one structured runtime event shape.
- A text-reply epoch test proves a customer-visible reply based on inputEpoch N does not advance ProcedureRun if inputEpoch N+1 arrives before commit/send; if already streamed, the stale reply is traced and ProcedureRun remains unadvanced.
- A reconcile-gate test proves PreToolUse/finalize attempts are blocked while `needsReconcile` is true, with generic feedback to reconcile latest customer messages first.
- A reconcile-action test proves `reconcile_procedure_input({ upToInputEpoch })` is the only way to clear `needsReconcile`, clears it only up to the current epoch, and does not write chat/user memory.
- A prompt-tail test proves unreconciled timeline events are appended without classifying them as supplement/correction/cancel/new issue.
- A HookEngine test proves the engine instance stays stable while dynamic ProcedureRun/caseType/currentStep context changes per evaluation.
- A stale-visible-tool-result test proves that even if an old `tool_result` remains in the LLM message window or compact summary, runtime marks it evidence_only/stale and does not advance ProcedureRun until `reconcile_procedure_input` clears the current inputEpoch.
- A human/form timeline test proves human task results and form answers increment inputEpoch and cannot force finalization over newer customer input.
- An idempotency test proves repeated `start_procedure` requests with the same request/event id or same active run return the existing run/no-op without duplicate ProcedureRuns.
- A system Tool registry test proves DB rows named like locked system Tools cannot shadow `start_procedure`, `finalize_procedure`, `remember`, `read_chat_memory`, or `read_user_profile`.
- A memory tool test proves `remember(scope="chat")` is visible to `read_chat_memory`, and `remember(scope="user")` is visible to `read_user_profile`.
- A memory-boundary test proves `remember`, `read_chat_memory`, `read_user_profile`, and compact summaries cannot create, resume, complete, clear reconcile, or change the canonical currentStepId of a ProcedureRun.
- A compact-format test proves compact returns the expected strict summary envelope and does not emit ProcedureRun authority fields.
- A prompt resolver test proves Procedure catalog queries use `agentConfigId`, not orgId.
- A seed/parser test proves seeded Procedures parse into non-null Procedure definitions.
- An export/API test proves internal ProcedureRun keys are not leaked through case export or case detail payloads.
- Typecheck, keyless full test, and build pass.
```

---

## S2 - Scenario runtime runner and validation truthfulness

```text
Lane: S2 - Scenario runtime runner and validation truthfulness

Goal:
Turn Scenario validation from a deterministic receipt harness into a truthful runtime check for at least the first commercial path. Release must not imply "validated" from expected fixtures alone.

Owned files:
- apps/console/lib/scenarios/**
- apps/console/app/api/admin/scenarios/**
- apps/console/app/build/pilot-lab/**
- apps/console/components/scenario-receipts/**
- apps/console/lib/agent/playground-runner.ts only if reusing dry-run AgentLoop execution
- focused Scenario tests

Tasks:
1. Keep the deterministic harness, but label it clearly as fixture validation when no Agent runtime execution happened.
2. Add a runtime execution adapter that can run a Scenario through the existing dry-run/AgentLoop path and collect actual tool_call/tool_result, Hook decisions, human transfer, final status, and forbidden/required phrase evidence.
3. Save receipts with an executionMode such as `fixture` or `agentRuntime`.
4. Make Release/Pilot Lab distinguish fixture receipts from runtime receipts.
5. Preserve the soft gate semantics: activation can be overridden with reason, but the UI must show whether validation was fixture-only or runtime-backed.

Acceptance:
- A Scenario can produce a receipt from actual Agent runtime execution.
- A failed expected Tool/Hook/human-transfer check fails the receipt based on observed evidence, not expected fixtures.
- Release validation summary distinguishes fixture-only from runtime-backed validation.
- Typecheck, keyless full test, build, and browser smoke pass.
```

---

## U-Pilot - Pilot Chat Cockpit and Playground preservation

```text
Lane: U-Pilot - Pilot Chat Cockpit and Playground preservation

Goal:
Rebuild `/build/pilot-lab` as Intera's primary agent-building cockpit. Pilot Lab is the logged-in default route and has two main tabs:

1. `Pilot` - default. A ChatGPT-like conversation workspace where delivery staff build, modify, test, and revise the Agent through ConfigPilot.
2. `Playground` - manual testing/debug. It preserves the current Playground dry-run execution, Trace Sidebar, and evidence visualization.

Product decisions:
- No global ConfigPilot drawer in P0. ConfigPilot lives in Pilot Lab.
- Login/default authenticated route should go to `/build/pilot-lab`.
- Pilot can read full allowed Agent config and propose changes to Brain, prompt/model settings, memory strategy, Procedures, Tools, Hooks, Knowledge refs, Integrations refs, Scenarios, and package drafts.
- Pilot can write only through proposal -> diff -> explicit human accept -> typed backend draft APIs -> validation stale.
- Pilot must never publish, activate, deploy, rollback, or bypass Scenario validation.
- Keep the UI unified light-first. Do not introduce dark immersive workspaces.
- Preserve S2 semantics: runtime-backed receipts and fixture-only receipts must be visibly distinct.

Owned files:
- apps/console/app/build/pilot-lab/**
- apps/console/components/config-pilot/**
- apps/console/components/scenario-receipts/**
- apps/console/components/playground/** only if embedding/reusing Trace Sidebar
- apps/console/app/admin/playground/page.tsx only for redirect or reuse; do not delete capability
- apps/console/app/build/playground/** only for redirect or reuse; do not delete capability
- apps/console/app/api/admin/playground/** only if the UI needs small route shape compatibility; do not rewrite runner internals
- apps/console/components/console-sidebar.tsx only for removing global drawer entry or default navigation state
- login/default-route/middleware files only for redirecting authenticated users to `/build/pilot-lab`
- focused Pilot/Playground UI tests

Do not touch:
- packages/shared/prisma/**
- apps/console/lib/agent/loop.ts
- apps/console/app/api/messages/route.ts
- apps/console/lib/agent/session-store.ts
- ConfigPilot backend model/proposal/apply logic unless a UI call shape is broken
- Release publish/activate/deploy/rollback logic
- hotfix worktree `/Users/curtis/Desktop/intera-agent-hotfix`

Pilot tab requirements:
1. Center of the screen is a chat transcript and composer, similar to ChatGPT/Claude.
2. On first load, call ConfigPilot context and simulate/stream an opening Pilot message that explains what it read and what the user can ask.
3. Right work panel shows:
   - current Agent/draft/version/validation context
   - proposed changes
   - config diff
   - accept/reject/apply controls
   - latest Scenario receipts
   - runtime-backed vs fixture-only validation state
   - missing info / open questions
4. Apply stays disabled until the user explicitly accepts the proposed change.
5. UI must not call publish/activate/deploy/rollback endpoints.
6. Save/apply marks validation stale through the existing P1 flow.

Playground tab requirements:
1. Preserve the existing Playground dry-run capability. `runPlaygroundTurn` and `/api/admin/playground/run` or an equivalent adapter must still work.
2. Preserve Trace Sidebar / trace evidence visualization. It may be embedded as the right panel inside the Playground tab.
3. Preserve manual test input, dry-run Tool evidence, Hook decision visibility, and save/test transcript behavior where currently supported.
4. Do not delete old `/admin/playground` or `/build/playground` routes until parity is proven with tests and browser smoke. Hiding old routes from navigation or redirecting after parity is acceptable; deleting capability is not.
5. S2 runtime-backed Scenario receipts depend on the dry-run AgentLoop path and raw trace evidence. Do not break this dependency.

Acceptance:
- `/build/pilot-lab` renders with two tabs: `Pilot` and `Playground`.
- Logged-in/default authenticated route lands on `/build/pilot-lab`.
- Pilot tab shows streamed/simulated opening message, chat composer, proposal/diff panel, accept/apply flow, and runtime/fixture receipt labels.
- Playground tab can run a manual dry-run test and show trace/evidence using the existing Trace Sidebar capability.
- A regression test proves fixture-only receipt is not displayed as runtime validated.
- A regression test proves apply is disabled before accept and enabled after accept.
- A regression test proves no publish/activate/deploy/rollback call is made from Pilot.
- A regression test or browser smoke proves Playground trace capability survived the refactor.
- Typecheck, keyless full test, clean build pass.
- Browser smoke:
  - `/build/pilot-lab` desktop 1440
  - `/build/pilot-lab` mobile 390
  - Pilot tab no horizontal overflow and no console errors
  - Playground tab no horizontal overflow and trace panel visible
  - reduced-motion disables or degrades loader/token animations

End receipt:
- changed files
- what changed
- exact verification commands/results
- browser screenshot paths
- residual risks
- commit hash if committed
- whether runtime/API/schema high-conflict files were touched
```

---

## PKG1 - Package completeness and version cap

```text
Lane: PKG1 - Package completeness and version cap

Goal:
Make `.intera-agent.json` useful for delivery sharing and future marketplace readiness, and enforce the owner decision that one Agent keeps at most five historical versions.

Owned files:
- apps/console/lib/agent-template/**
- apps/console/app/api/admin/agent-templates/**
- apps/console/app/api/admin/agent-configs/[id]/fork/route.ts
- apps/console/components/release/**
- packages/shared/contracts/agent-template.ts
- templates/**
- focused package/version tests

Tasks:
1. Extend package export/import to include delivery-relevant Knowledge references, Integration/channel binding placeholders, Scenario definitions/receipts metadata where safe, and current legacy fenced snapshots.
2. Keep secrets as refs/placeholders only. Do not export raw credentials.
3. Enforce max five historical versions per Agent family. Define whether the active version counts separately, then implement the rule transactionally.
4. Ensure Duplicate Version, Import, and ConfigPilot Apply either respect the cap or return a clear typed error.
5. Update Release UI copy only if needed to explain package contents or version cap.

Acceptance:
- Package round-trip preserves Brain, Procedures, Tools, Hooks, HookBindings, Scenarios, Knowledge refs, Integration placeholders, and legacy fenced data.
- Version cap tests prove the sixth historical draft is rejected or pruned according to the implemented rule.
- Typecheck, keyless full test, build pass.
```

---

## Q3 - Legacy route/component cleanup and docs truth pass

Historical repair prompt: Q3-B1 route/nav truth is already shipped. Use this block only for follow-up cleanup, compatibility wrappers, or docs truth repairs.

```text
Lane: Q3 - Legacy route/component cleanup and docs truth pass

Goal:
Remove or redirect stale UI/code/doc surfaces that keep old concepts alive after Q1/Q2/R2/R3.

Owned files:
- apps/console/middleware.ts and tests only for redirects
- apps/console/app/admin/playground/**
- apps/console/app/admin/guardrails/**
- apps/console/components/admin/stage-config-editor.tsx
- apps/console/components/admin/agent-human-interaction-panel.tsx
- apps/console/lib/livechat/** showSkillStatus compatibility rename if scoped
- doc/handoffs/**
- doc/spec/**
- focused route/terminology tests

Tasks:
1. Keep `/admin/playground` and `/admin/guardrails` as redirects only, matching the target Build routes.
2. Confirm deleted stage/sub-agent/docked-preview remnants stay unreferenced, and delete any newly discovered dead UI only after grep proves no live imports.
3. Rename LiveChat internal `showSkillStatus` toward Tool status in code where safe; keep DB/API compatibility if needed.
4. Update `HARD_BUGS.md` so retired dispatch/background sub-agent issues are not listed as live.
5. Update historical docs only by adding "historical/superseded" framing; do not rewrite archive evidence.

Acceptance:
- Browser redirects for old routes pass.
- Active docs and active UI have no live Policy/Guardrail/Skill/stage/sub-agent product language except explicit legacy/archive sections.
- Typecheck, keyless full test, build pass.
```

---

## Q2 - Light-first UI polish pass

```text
Lane: Q2 - Light-first UI polish pass

Start after Q1, or run alongside Q1 only if Q1 owns dictionaries/docs while Q2 owns visual components and does not touch API/runtime/schema.

Goal:
Apply the approved designer direction across the existing Build workspace without changing IA, schema, runtime behavior, or API contracts.

Owned files:
- apps/console/app/build/release/**
- apps/console/app/build/pilot-lab/**
- apps/console/app/build/components/page.tsx
- apps/console/components/release/**
- apps/console/components/config-diff/**
- apps/console/components/config-pilot/**
- apps/console/components/scenario-receipts/**
- shared UI primitive CSS only if required and coordinated
- focused visual/UI tests where existing patterns support them

Do not touch:
- packages/shared/**
- apps/console/lib/agent/**
- apps/console/app/api/**
- global IA in console-sidebar unless the coordinator explicitly asks

Design target:
- Borrow the designer sketch's calmer enterprise density, typography rhythm, compact row grouping, and right-side ConfigPilot rail.
- Keep the current approved IA: Build has Release, Pilot Lab, Components. Component submodules stay inside the Components hub, not the global sidebar.
- Use unified light-first surfaces. No dark product panels.
- Prefer tables, grouped rows, subtle dividers, status color, and generous but efficient spacing over decorative cards.
- Keep controls at 8px radius or less unless existing primitives require otherwise.
- Use the approved logo source from `/Users/curtis/Desktop/design/Globe loader`.
- For AI generation / thinking / running states in Playground and Pilot Lab, use Organic Loader variants `01`, `02`, `05`, `06`, `10`, `11`, `12`, `17`, `20`.
- For model output streaming in Playground and Pilot Lab, use Text Streaming variant `07 token stream`.
- Preserve reduced-motion behavior and do not use these animations for ordinary page skeleton loading.

Tasks:
1. Normalize page headers, agent/version selectors, status chips, and command areas across Release and Pilot Lab.
2. Polish Config Diff Viewer and Scenario receipts into compact grouped light surfaces.
3. Add or refine the Pilot Lab right work panel pattern without making it mandatory on every viewport.
4. Improve responsive layout at 1440px, 1280px, 1024px, and mobile width where practical.
5. Apply the approved logo and AI-generation motion references where relevant.
6. Remove any leftover dark immersive workspace styling from P0 product pages, except small code/JSON/raw payload viewers.

Acceptance:
- Release, Pilot Lab, ConfigPilot, Diff Viewer, and Scenario receipt surfaces look like one product.
- No IA changes.
- Typecheck, keyless full test, build, and browser screenshots pass.
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

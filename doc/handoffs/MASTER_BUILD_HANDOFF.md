# Master Build Handoff — Intera Agent

**Last updated:** 2026-06-10
**Audience:** founder, architect, coding-team leads, parallel AI coding sessions
**Current macro priority:** Foundation Reset before commercial customer deployment

Read first:

1. [`GENERIC_HANDOFF.md`](./GENERIC_HANDOFF.md) - collaboration protocol, verification gates, repo context.
2. [`../README.md`](../README.md) - doc map and current vocabulary.
3. [`FOUNDATION_RESET_ROADMAP_CURRENT.md`](./FOUNDATION_RESET_ROADMAP_CURRENT.md) - current Mermaid roadmap from project start through remaining delivery checkpoints.
4. [`PLATFORM_DELIVERY_AUDIT_GOALS.md`](./PLATFORM_DELIVERY_AUDIT_GOALS.md) - strict phase-by-phase delivery goals, proof requirements, screenshot receipts, and the high-quality acceptance bar for first customer deployment.
5. [`CODEX_GOAL_DISPATCH.md`](./CODEX_GOAL_DISPATCH.md) - short Goal-mode prompt plus the long-running execution contract, strict stop conditions, and production proof requirements.
6. [`DELIVERY_UNCERTAINTY_LOG.md`](./DELIVERY_UNCERTAINTY_LOG.md) - running review queue for uncertain points, defaults, blockers, and owner decisions.
7. [`../strategy/2026-06-10-pilot-commercial-readiness-proposal.md`](../strategy/2026-06-10-pilot-commercial-readiness-proposal.md) - executable Gate A-D implementation guide and acceptance contract for commercial Pilot readiness.
8. [`BROWSER_SMOKE_RUNBOOK.md`](./BROWSER_SMOKE_RUNBOOK.md) - local browser-smoke/auth timebox rules.
9. [`POST_FOUNDATION_DISPATCH_PROMPTS.md`](./POST_FOUNDATION_DISPATCH_PROMPTS.md) - repair-ready prompts and historical lane prompts for zero-context coding sessions; do not redispatch shipped lanes without an explicit repair ask.
10. [`ARCHITECT_AUDIT_2026-06-09.md`](./ARCHITECT_AUDIT_2026-06-09.md) - current risk map and next-lane split before first commercial deployment.
11. [`COMPONENT_TRUTH_AUDIT_2026-06-10.md`](./COMPONENT_TRUTH_AUDIT_2026-06-10.md) - current implementation-truth audit for Build Components, Pilot Lab compatibility, and legacy entry points.
12. [`PLAYGROUND_TRUTH_AUDIT_2026-06-10.md`](./PLAYGROUND_TRUTH_AUDIT_2026-06-10.md) - current product/runtime truth for Pilot vs Playground, runtime-backed vs fixture-only validation, and compatibility leftovers.
13. [`FOUNDATION_RESET_LANE_PROMPTS.md`](./FOUNDATION_RESET_LANE_PROMPTS.md) - historical prompts for the shipped F1-F7/UX0 foundation lanes.
14. [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md) - active reset plan.
15. [`../spec/Intera_Harness_架构梳理.md`](../spec/Intera_Harness_架构梳理.md) - architecture source of truth.
16. [`../spec/Intera_UI_UX_Design_System.md`](../spec/Intera_UI_UX_Design_System.md) - Console IA, visual system, and UI refactor lanes.
17. [`CONSOLE_NATIVE_REBUILD_AND_REGRESSION_PLAN.md`](./CONSOLE_NATIVE_REBUILD_AND_REGRESSION_PLAN.md) - native page rebuild rule, backend contract matrix, and regression gates for Build / Operate / Settings.
18. [`CONSOLE_FINAL_REGRESSION_CHECKLIST.md`](./CONSOLE_FINAL_REGRESSION_CHECKLIST.md) - copy-paste final invariant, command gates, and route-by-route smoke checklist.

---

## 0. Current Priority

Intera is resetting its foundation before the first real customer commercial delivery.

The owner-approved reset:

- `Policy` / `Guardrail` -> `Hook`
- `Skill` -> `Tool`
- Hook checkpoints -> `PreToolUse`, `PostToolUse`, `Stop`
- Hook scopes -> agent, CaseType, ProcedureStep, Tool
- retire old stage/sub-agent customer-facing runtime
- keep `Case`, `CaseType`, `Procedure`, `Tool`
- introduce `.intera-agent.json` Agent Template Package
- make ConfigPilot a real typed-API configuration assistant inside Pilot Lab
- use Scenario Lab receipts as the delivery validation path

The owner-approved UI/UX direction is frozen in [`../spec/Intera_UI_UX_Design_System.md`](../spec/Intera_UI_UX_Design_System.md). Do not rediscover the navigation, theme, or ConfigPilot shape in coding lanes.

Current delivery constraint after UI2/Q3:

- every implementation or fix must meet the high-quality bar in [`PLATFORM_DELIVERY_AUDIT_GOALS.md`](./PLATFORM_DELIVERY_AUDIT_GOALS.md): functional, user-friendly, visually polished, operationally truthful, regression-safe, and backed by receipts/screenshots
- for Codex Goal-mode runs, keep the Goal input short and point to [`CODEX_GOAL_DISPATCH.md`](./CODEX_GOAL_DISPATCH.md); the detailed standards live in docs and must be followed exactly
- local tests and local browser smoke are preflight only; final acceptance must be repeated and proven on `https://demo.anytrans.ai`
- production acceptance is whole-platform responsibility: if validating one function exposes another broken function, stale UI, misleading state, or adjacent regression, fix and retest it instead of treating it as out of scope
- every subpage, tab, panel, modal, detail route, action menu, empty/loading/error state, and CRUD/test action must be production-tested; route-load screenshots alone are not acceptance
- every page's meaningful CRUD/test action needs screenshot or receipt proof; do not accept text-only claims for UI-facing CRUD
- uncertain points and default decisions must be recorded in [`DELIVERY_UNCERTAINTY_LOG.md`](./DELIVERY_UNCERTAINTY_LOG.md) as they are discovered, so the owner can review them in one pass
- current manual testing only gives partial confidence for Playground, Knowledge, and Hooks; all other surfaces remain unaccepted until production receipts prove full function coverage
- Procedure and LiveChat/Integrations are first-customer critical. LiveChat console joint configuration may wait until after this optimization pass, but Intera must already prove config readiness, webhook ingress toward `/api/messages`, response mapping, and Tool rich-message/render-hint output. Use `/Users/curtis/Desktop/live chat config backup.md` as the redacted test-config source when needed.
- Pilot commercial readiness is in scope for the same delivery push. Execute Gate A-D from [`../strategy/2026-06-10-pilot-commercial-readiness-proposal.md`](../strategy/2026-06-10-pilot-commercial-readiness-proposal.md) under the acceptance standards in [`PLATFORM_DELIVERY_AUDIT_GOALS.md`](./PLATFORM_DELIVERY_AUDIT_GOALS.md).
- Pilot construction comes before Pilot acceptance: do not spend final acceptance effort on an unfinished Pilot cockpit before its Gate A-D implementation exists.
- J1B Playground acceptance requires production setup first: seed/import `doc/tools-real/business-tools-backup.ts` into the production J1B Agent Draft, use `doc/测试用户ID.md` member ids, then run the 12 P0 scenarios with 3 accepted flows each plus one long-memory/30-customer-message stability run.
- treat Build / Operate / Settings target pages as needing native implementations, not wrapper routes around old `admin` or `ops` pages
- `/admin/*` and `/ops/*` may remain only as compatibility redirects or thin wrappers; product ownership must stay on the native Build / Operate / Settings surfaces
- the route rebuild is now locally complete; before broader production smoke, hold the line with the regression plan in [`CONSOLE_NATIVE_REBUILD_AND_REGRESSION_PLAN.md`](./CONSOLE_NATIVE_REBUILD_AND_REGRESSION_PLAN.md) and the checklist in [`CONSOLE_FINAL_REGRESSION_CHECKLIST.md`](./CONSOLE_FINAL_REGRESSION_CHECKLIST.md)

The previous standalone Procedure refactor is superseded and archived at [`../archive/superseded/2026-06-08-case-type-procedure-orchestration-refactor.md`](../archive/superseded/2026-06-08-case-type-procedure-orchestration-refactor.md). Do not dispatch from it.

---

## 1. Active Lanes

Before any coding session edits files, its owned files must be declared either here by the coordinator or in the lane prompt handed to that session. Do not make every parallel session edit this file only to claim a lane; that creates avoidable merge conflicts. Remove or refresh rows after the task is committed and verified.

| Lane | Owner/session | Status | Owned files | Notes |
|---|---|---|---|---|
| GOAL-P0-PILOT-GATE-A-D | Codex Goal thread `019eb1e6-12c0-7842-b98f-172cfb988f2b` | Active | `packages/shared/prisma/schema.prisma`, `packages/shared/prisma/migrations/20260610000000_add_pilot_persistence/**`, `packages/shared/contracts/pilot.ts`, `apps/console/lib/pilot/**`, `apps/console/app/api/admin/pilot/**`, `apps/console/app/api/admin/config-pilot/**`, `apps/console/lib/config-pilot/**`, `apps/console/app/build/pilot-lab/**`, `scripts/smoke-console-auth.mjs`, `doc/handoffs/DELIVERY_UNCERTAINTY_LOG.md`, `.artifacts/delivery-audit/2026-06-10/**`, `.artifacts/delivery-audit/2026-06-11/production-parity-audit/**`, `.artifacts/delivery-audit/2026-06-11/production-post-deploy/**`, `.artifacts/final-smoke/**`, `.learnings/ERRORS.md` | Gate A-D locally constructed, preflighted, committed as `8e8c43e2`, and deployed to production test with `git push deploy main`. Deploy hook applied migration `20260610000000_add_pilot_persistence`, built, restarted, and returned healthy DB status. Final Gate A-D production acceptance remains pending because `SMOKE_BASE_URL=https://demo.anytrans.ai ... npm run smoke:console` failed at login with HTTP 401 invalid credentials, so current production screenshots/workflows/persistence proof are still missing. |

Rules:

- One file cannot be owned by two lanes at once.
- `packages/shared/prisma/schema.prisma` is exclusive to the schema lane.
- `apps/console/lib/agent/*` is high-collision; declare exact files.
- `apps/console/lib/i18n/dictionaries.ts` should be handled by the final sweep unless a lane absolutely needs visible copy.
- If a lane needs an extra file after starting, re-check this table and the active lane prompts first.

### Dual Worktree Coordination

Current worktrees:

- Integration/refactor worktree: `/Users/curtis/Desktop/intera-agent`, branch `main`, tracking `origin/main`.
- Live-testing hotfix worktree: `/Users/curtis/Desktop/intera-agent-hotfix`, branch `hotfix/live-testing`, tracking `deploy/main`.

Rules:

- Use `main` worktree for S2, PKG1, Q3, UI/product/runtime feature work.
- Use hotfix worktree only for minimal online testing hotfixes that may be pushed/deployed.
- Start hotfix work with `git -C /Users/curtis/Desktop/intera-agent-hotfix pull --ff-only`.
- Hotfix commit hashes must be reported back. Integration/main then cherry-picks them to avoid losing production fixes.
- If a hotfix touches `apps/console/lib/agent/**` or `apps/console/app/api/messages/route.ts`, pause overlapping R/S runtime work until the hotfix is cherry-picked back.
- Feature/refactor work does not deploy directly.
- Schema/migration work is not parallel and is forbidden in hotfix unless separately approved.
- After cherry-picking hotfixes into `main`, run typecheck, keyless tests, and clean `build:console`.

Current hygiene note, 2026-06-10:

- `claude-code-source-code-ref-only/` has been moved out of the repo to `/Users/curtis/Desktop/claude-code-source-code-ref-only` and is ignored. Keep it as reference-only material outside the worktree.
- The old `hotfix/live-testing` branch is stale relative to current `main` (`ahead 7, behind 32`). Main contains adapted backports at `6615ae7d` and `3d765164`; do not merge or cherry-pick the stale branch wholesale without re-auditing against the current UI2/native-route code.
- The active hotfix worktree at `/Users/curtis/Desktop/intera-agent-hotfix` is currently on `codex/profile-menu-adaptive-spacing` with local commit `461ee581` ahead of `deploy/main`; treat that as a separate pending hotfix decision, not as part of the old 7-commit hotfix backport.

---

## 2. Dispatch Order

The current visual checkpoint map is [`FOUNDATION_RESET_ROADMAP_CURRENT.md`](./FOUNDATION_RESET_ROADMAP_CURRENT.md). The active implementation plan is [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md).

Foundation lanes already shipped to `origin/main` through `d42c543e foundation: add hooks admin ui`:

- UX0: Quiet Agent Studio primitives.
- F1: Hook/HookBinding schema and shared contracts.
- F2: HookEngine runtime checkpoints.
- F3: Tool trace/event normalization.
- F4: Hooks API/admin UI; old policies API returns 410; `/admin/guardrails` redirects.
- F6: `.intera-agent.json` import/export.
- F7: Scenario soft gate and receipts.

Post-foundation lanes shipped on `main` after the first foundation wave:

- `d99ef834`: U1 Build / Operate / Settings shell and redirects.
- `f24b2fd9`: C1 Procedure Builder with ProcedureStep Hook bindings and Hook validation copy.
- `c4c7365c`: R1 `dispatch_case_agent` cut to inline Procedure start/select; no customer-facing background sub-agent dispatch.
- `6b3a7c2c`: U3 Pilot Lab workspace.
- `baa74ba7`: U2 Release command center.
- `575950f7`: B1 Brain Memory strategy workspace.
- `b97c1e83`: dispatch handoff/docs update.
- `810ac9cd`: R2 physical legacy cleanup; Policy/stage/sub-agent/skills physical runtime removed.
- `20c3455b`: Q1 terminology/docs/i18n sweep.
- `c276cedd`: Q2 light-first Build surface polish.
- `02dc3182`: obsolete `/ops/guide` route removed.
- `864392c6`: P1 ConfigPilot typed draft flow.
- `f9ed457c`: R3 ProcedureRun runtime overlay and real memory tools.
- `64ee8f01`: S2 runtime-backed Scenario receipts.
- `ec06aaf4`: U-Pilot Pilot chat cockpit + Playground tab.
- `ccd10c79`: PKG1 package completeness and version cap.
- `9041049e`: BASE1 core console regression stabilization.
- `f27570b1`: Release/version-control docs truth refresh.
- `ed9430bb`: Q3-B1 legacy route + navigation truth alignment.
- `6615ae7d`: live console polish hotfix backport adapted to current main IA.

| Lane | Scope | Parallel? | Notes |
|---|---|---|---|
| R1 | Procedure runtime + `dispatch_case_agent` cutover | Shipped locally | Removes detached/background sub-agent customer path; runtime continues inline through ProcedureExecutor + HookEngine. |
| C1 | Procedure Builder + step Hook bindings | Shipped locally | Updates case-type/procedure admin path to use HookBinding, especially ProcedureStep scope. |
| U1 | Build / Operate / Settings shell and redirects | Shipped locally | Establishes target IA without turning every page into one giant refactor. |
| U2 | Release command center + package actions | Shipped locally | Uses existing package export/import and Scenario validation metadata. |
| U3 | Pilot Lab + Scenario receipts | Shipped locally | Uses existing Scenario APIs; its old drawer/workbench shell direction is superseded by U-Pilot. |
| B1 | Brain Memory + compact strategy UX | Shipped locally | Turns memoryStrategy into Brain > Memory strategy, preserve rules, and Compact Test. |
| R2 | Physical legacy cleanup | Shipped locally | Removes Policy/stage/sub-agent/skills physical runtime and backfills/archive legacy data. |
| Q1 | Final terminology, i18n, docs, browser QA sweep | Shipped | Cleans user-facing copy, guide docs, redirects, and responsive states after R2. |
| Q2 | Light-first UI polish pass | Shipped | Applies the designer sketch direction without IA/schema/runtime/API changes. |
| P1 | ConfigPilot typed configuration tools | Shipped locally | Backend prompt/model/context/propose/apply typed draft writes; never publish. |
| R3 | ProcedureRun runtime overlay + system Tool rename + `remember` | Shipped locally | Keeps stable Core Agent prompt, appends dynamic ProcedureRun context at tail, resolves step Hooks by runtime timeline, handles interleaved messages with inputEpoch/reconcile gate, and exposes `start_procedure`, `finalize_procedure`, `remember`. |
| S2 | Runtime-backed Scenario receipts | Shipped locally | Distinguishes fixture receipts from actual Agent runtime validation. |
| U-Pilot | Pilot Chat Cockpit + Playground tab | Shipped locally | `/build/pilot-lab` is the logged-in default; `Pilot` and `Playground` live in the same workspace and preserve dry-run + Trace Sidebar capability. |
| PKG1 | Package completeness + version cap | Shipped locally | Completes package surfaces and enforces the five-version history cap. |
| BASE1 | Core console regression stabilization | Shipped locally | Locks in post-PKG1/U-Pilot regression fixes on the active Build surfaces. |
| Q3 | Legacy route/component/doc truth cleanup | Shipped locally | Q3-B1 aligned route/nav truth; Q3-B final removes dead UI remnants and refreshes current docs to real status. |
| UI2-A | Shared material system and shell chrome | Shipped locally | Converged approved sidebar/org-picker/identity material language into shared primitives, Console shell, sidebar, toolbar, and page chrome. |
| UI2-B | Build surface visual convergence | Shipped locally | Applies UI2 material language to Release, Pilot Lab, Components, and Playground compatibility surfaces without IA/runtime changes. |
| UI2-C | Operate, Settings, Auth visual convergence | Shipped locally | Applies UI2 material language to Conversations, Handoff, Organization, Login, and Org Picker without API/runtime changes. |
| UI2-D | Visual QA consistency sweep | Shipped locally | Checks spacing, icons, hover/active/selected/collapsed/empty/loading/mobile/reduced-motion states and screenshots. |

Recommended coding-team shape:

- R1, C1, U1, U2, U3, B1, R2, Q1, Q2, `/ops/guide` cleanup, P1, R3, S2, U-Pilot, PKG1, BASE1, and Q3-B1 are already shipped on local `main`.
- Q3-B final completes the remaining dead-component cleanup and docs truth pass on the current branch; future work should be focused repair only unless the owner reopens product scope.
- UI2 is now reopened product scope on `main`: visual-system convergence only. Do not run it on `hotfix/live-testing`.
- UI2-A, UI2-B, UI2-C, and UI2-D are shipped locally. Final integration gate is the next checkpoint before push/deploy.
- Hotfix worktree remains for online minimal repair and small UI bug fixes only. Backport hotfix commits into main with adaptation; do not merge old deploy/main wholesale into main.
- Use [`POST_FOUNDATION_DISPATCH_PROMPTS.md`](./POST_FOUNDATION_DISPATCH_PROMPTS.md) only for repair-oriented zero-context sessions. Do not redispatch from the shipped F1-F7 prompts or from already-shipped post-foundation lane blocks.

---

## 3. Frozen Product Decisions

- First design user: implementation / delivery staff.
- First customer target: one real commercial delivery package within roughly two weeks.
- First industry template: Gaming / iGaming support.
- First launch boundary: information collection, read-only lookup, structured human transfer.
- Security/compliance: reserve architecture, do not let it block first functionality.
- ConfigPilot / Pilot Lab: important first-class surface and logged-in default. It can read the current Agent configuration and write draft config through permission check -> proposal -> diff -> human accept -> typed API -> Scenario receipt. It must never self-publish.
- Procedure count: keep small at first; too many CaseTypes/Procedures will weaken intent routing.
- ProcedureStep-level Hook configuration must be visible in the Procedure Builder.
- First launch supports declarative, restricted JavaScript, and HTTP Hooks.
- Marketplace is reserved, not launched. `.intera-agent.json` should support internal sharing now and future selling later.
- Historical/legacy fields may be exported under `legacy`; new top-level package fields must use current names.
- UI/UX: first screen is Build -> Pilot Lab; top-level nav is Build / Operate / Settings; Components has Brain, Procedures, Tools, Hooks, Knowledge, Integrations; Operate has Conversations and Human Handoff only.
- Pilot Lab has two main tabs: `Pilot` for ChatGPT-like agent building, and `Playground` for manual dry-run testing/debug with existing Trace Sidebar capability. ConfigPilot is not a global drawer in P0.
- Playground is the current Runtime Truth Desk + Manual Test Bench. Pilot Lab now owns the shared native workspace, while `/admin/playground` is a compatibility wrapper. It runs the selected Agent version through the real AgentLoop/prompt/runtime path with `dryRun` side-effect mocking, and persists/restores Playground session messages plus traces. Treat it as runtime truth, not config-authoring truth.
- Brain owns memory and compact configuration. Expose strategy-level controls first: Memory Mode, Compact model, Preserve rules, Fact extraction rules, Profile, and Compact Test. Keep raw token thresholds and circuit-breaker knobs under Advanced.
- `confirmedFacts` are business facts. `ProcedureRun`/runtime state is not a business fact and must not be stored in confirmedFacts.
- `ProcedureRun` state is session-lifecycle runtime state. It may be summarized into chat memory when useful, but the canonical active/paused/completed ProcedureRun state belongs to the runtime-managed Procedure Run Tracker.
- Compact, ChatMemory, UserProfile, and model-visible raw `tool_result` history are context/evidence layers, not ProcedureRun authority. They must not create, resume, complete, clear reconcile, advance currentStepId, or promote stale evidence.
- Memory boundary: `ProcedureRunState` answers "where execution is now"; `ChatMemory` answers "what this chat has remembered"; `UserProfile` answers "who this user is over time."
- Procedure is a runtime overlay, not a prompt-mode transformation. `start_procedure` creates/selects a ProcedureRun; it must not replace the stable Core Agent prompt or prepend a dynamic Procedure header before that prompt.
- R3 should follow a runtime-protocol model inspired by Claude Code semantics, not copied source code: structured queue events, epoch/uuid/origin metadata, explicit control interrupts only, stable Hook lifecycle with dynamic context, stable/dynamic prompt boundary, and real memory tools.
- Keep context in three layers: stable Core Agent prompt; stable/cacheable Procedure definition; dynamic ProcedureRun state appended at the prompt tail.
- Keep the model-visible Tool list/schema stable across Procedure activation. Procedure allowedTools are enforced by runtime/Hook gates, not by dynamically hiding Tool schemas.
- The runtime should inject ProcedureRun context as dynamic procedure todos/current state, so the main Agent can decide whether a new message continues, supplements, pauses, resumes, or starts a Procedure.
- Hook scopes for ProcedureStep must be resolved by runtime from active ProcedureRun timeline + currentStepId + requested Tool, not by trusting the model to remember the Procedure prompt.
- Interleaved messages use generic epoch-based reconciliation, not semantic routing. Every customer message/form/human result increments `inputEpoch`; each Tool/action records `basedOnInputEpoch`; stale results can become evidence but cannot advance a step until the model reconciles latest timeline events.
- `needsReconcile` must clear through a structured runtime action, e.g. `reconcile_procedure_input({ upToInputEpoch, decision, summary })`; it is not a memory write and not a natural-language assertion.
- Customer-facing text replies also record `basedOnInputEpoch`. Stale replies must not advance ProcedureRun; withhold them before send where possible, otherwise trace them as stale.
- Ordinary customer messages are not interrupts. They should be queued and reconciled. Only explicit control events such as operator stop, session close, or human takeover may abort or cancel active Tool execution.
- R3 first version should keep active ProcedureRun state in runtime/session-store rather than adding a Prisma table. It must increment `inputEpoch` at enqueue time, not AgentLoop drain time.
- First commercial launch assumes one long-lived Node/Next server process for the Console runtime. The in-memory rate limiter, `/api/messages` runtime sessions, and active ProcedureRun tracker are approved only under that single-instance topology.
- Do not move `/api/messages` or active ProcedureRun execution to serverless, multi-instance, rolling multi-worker, or horizontally scaled deployment until a Redis/lease-backed or schema-backed runtime authority and shared rate limiter are implemented.
- AgentLoop post-turn compact/profile persistence is currently fire-and-forget. This is acceptable only for the long-lived single-process launch target; before serverless deployment or strict read-after-write memory guarantees, either await those writes before returning or move them to a durable worker/queue.
- `session-store` must be upgraded from a bare message queue into structured runtime events, including customer messages, form results, human task results, text replies, Tool events, Hook decisions, reconcile actions, and explicit controls.
- Human task results and form answers are input events, not finalization shortcuts. They increment `inputEpoch` before any terminal action.
- `start_procedure` must be idempotent by request/event id and active run state.
- In-memory ProcedureRun state is an R3 V1 deployment tradeoff for single-process/restart-loses-active-runtime only; multi-instance or restart resilience needs Redis/lease or a later schema lane.
- HookEngine should be stable for the AgentConfig; active ProcedureRun/caseType/currentStep/reconcile context is passed through `HookContext` per evaluation.
- `read_chat_memory`, `read_user_profile`, and `remember` must be real system Tools before being advertised as a product loop. Placeholder `{ ok: true, handled: "system_managed" }` results are not enough.
- `remember(scope="chat")` writes ChatMemory only; `remember(scope="user")` writes UserProfile only; neither may write ProcedureRun runtime state.
- Compact output should be tool-free and strict enough to parse/QA, preferably inside `<summary>...</summary>`. It can summarize facts, tools observed, open items, latest customer messages, and suggested next steps, but not canonical ProcedureRun state.
- Do not introduce a standalone LLM ProcedureRouter. The main Agent should selectively load the compact Procedure catalog plus active/paused ProcedureRun state and choose the next action inside the normal ReAct loop.
- `record_facts` is not the product name. The controlled memory-write tool should be `remember`, with explicit `scope: "chat" | "user"`. `remember(scope="chat")` writes what `read_chat_memory` later reads; `remember(scope="user")` writes what `read_user_profile` later reads.
- Runtime-managed capabilities should be visible to delivery staff as locked/auditable platform capabilities, but not editable business Tools. P0 capability examples: Procedure Run Tracker, Hook Engine, Memory Extractor, Scenario Runner.
- Agent-callable immutable system Tools should be visible as locked Tools. P0 examples: `start_procedure`, `finalize_procedure`, `ask_user_questions`, `create_human_task`, `read_chat_memory`, `read_user_profile`, and `remember`.
- `Case` is no longer a product-level concept. Code may keep durable Case shells temporarily for Message/ActionTrace persistence, but UI/copy/future APIs should prefer Chat, User, ProcedureRun, HumanTask, Trace, and Memory.
- Visual direction: Quiet Agent Studio, unified light-first across the Console. Pilot Lab, Diff Viewer, Trace detail, ConfigPilot, Scenario receipts, and publish/rollback moments use focused light workspaces with slightly cooler or denser light surfaces, not dark mode.
- UI2 visual convergence direction: the sidebar / org picker / identity menu material language is now the source for the whole Console. Use milky warm-light translucent surfaces, subtle blur, white fine borders, shallow inner highlights, soft shadows, generous controlled radii, and full soft active states instead of hard stripes or dark blocks.
- Approved brand/motion assets: logo source is `/Users/curtis/Desktop/design/Globe loader`; Playground and Pilot Lab AI-generation loaders use `/Users/curtis/Desktop/design/Organic Loaders (standalone).html` variants `01`, `02`, `05`, `06`, `10`, `11`, `12`, `17`, `20`; AI-generation text streaming uses `/Users/curtis/Desktop/design/Text streaming (standalone).html` variant `07 token stream`.
- Config Diff Viewer and Command Bar are first-class UI primitives.
- Product UI supports `en-US` and `zh-CN`; business configuration content is not auto-translated.
- Local native-route truth on `main`: Brain, Procedures, Tools, Knowledge, Hooks, Integrations, Settings Organization, the Operate conversation/detail family, the Handoff detail page, and the Pilot Lab Playground workspace are all native routes. Legacy `/admin/*` and `/ops/*` paths remain compatibility wrappers or redirects only.

---

## 4. Current Known State

Shipped foundations already useful for the reset:

- Safe local Postgres foundation shipped 2026-06-08. See [`../what's done/2026-06-08-foundation-safe-local-db.md`](../what's%20done/2026-06-08-foundation-safe-local-db.md).
- Procedure additive Phases 1-3 shipped through `373d2eed`: Procedure contracts/columns exist, ProcedureExecutor prompt path is wired, and case-scoped legacy guardrail activation exists. Foundation Reset lanes must treat those as migration inputs, not as the target architecture.
- Foundation reset first wave shipped through `d42c543e`: Hooks schema/API/UI, HookEngine checkpoints, Tool trace vocabulary, package import/export, Scenario soft gate, and Quiet Agent Studio primitives.
- Post-foundation commits through `ed9430bb`: target IA shell, ProcedureStep Hook binding UI, inline Procedure runtime cutover, Release command center, Pilot chat cockpit + Playground tab, Brain Memory strategy workspace, R2 physical legacy cleanup, Q1 terminology sweep, Q2 light-first polish, obsolete guide removal, ConfigPilot typed backend draft flow, ProcedureRun runtime overlay, runtime-backed Scenario receipts, package completeness/version cap, BASE1 regression stabilization, and legacy route/navigation truth alignment.
- Trace single-contract and playground hardening work shipped. See the relevant receipts under [`../what's done/`](../what's%20done/).
- Agent-scoped architecture exists in code, but verify orgId -> agentConfig ownership whenever touching admin sub-module routes.
- Logged-in default is `/build/pilot-lab`; Pilot Lab has `Pilot` and `Playground` tabs in the same workspace.
- Release owns package actions and version control. ConfigPilot no longer mounts as a global drawer.
- Q3 cleanup keeps `/admin/*` and `/ops/*` legacy paths as compatibility redirects/wrappers while preserving Playground dry-run, Trace Sidebar, and the playground API/runtime surface.
- 2026-06-10 Components truth audit: the shipped exceptions are now documented explicitly. Procedures still presents `Procedure Type` vocabulary, Tools still lacks Tool-scope Hook binding controls, Hooks still has no simulation panel and still mounts the shared HookBuilder, Integrations/Web Chat is still embed-script-first, and Playground remains the sole approved compatibility import. See [`COMPONENT_TRUTH_AUDIT_2026-06-10.md`](./COMPONENT_TRUTH_AUDIT_2026-06-10.md).
- 2026-06-10 Playground truth audit: Pilot owns draft authoring, Playground owns runtime/manual testing, Release owns publish/version truth. Runtime-backed Scenario receipts currently run through the real Playground path while operational tool side effects remain mocked. See [`PLAYGROUND_TRUTH_AUDIT_2026-06-10.md`](./PLAYGROUND_TRUTH_AUDIT_2026-06-10.md).
- UI2 is complete locally. Final integration gate and deploy can proceed after confirming no newer hotfix commits need backport.

Live landmines to keep in mind:

- Durable Case shells still exist on some route-level persistence paths because current Message/ActionTrace schema depends on `caseId`; solve this in a later schema/runtime lane, not by reintroducing background sub-agents.
- Playground remains a large component and should not be casually expanded.
- Legacy guardrail live-confirm gaps should be converted into Hook Scenario coverage during the reset.
- ConfigPilot backend prompt/model/context/propose/apply is shipped; the current risk is UI product shape. Pilot Lab must become the chat cockpit and must preserve Playground dry-run + Trace Sidebar capability.
- Scenario receipts now distinguish runtime-backed validation from fixture-only validation. Keep that distinction visible in Release and Pilot Lab.

---

## 5. Commercial Delivery Chain

The first usable delivery chain should feel like this:

```text
Delivery person imports Gaming Support Starter.intera-agent.json
  -> chooses/forks Agent version
  -> edits CaseTypes + Procedures
  -> creates Tools from API docs or static fixtures
  -> binds Hooks at agent / CaseType / ProcedureStep / Tool scopes
  -> runs Scenario Lab
  -> inspects receipt and trace failures
  -> uses ConfigPilot to propose focused fixes
  -> validates again
  -> activates for customer channel
  -> exports customer-customized .intera-agent.json
```

Coding-team work should protect this path. Features outside this chain are secondary until the first customer deployment is real.

---

## 6. Verification Expectation

For code lanes, follow [`GENERIC_HANDOFF.md`](./GENERIC_HANDOFF.md):

- typecheck
- keyless tests
- build
- changed-files list
- production/browser verification when pages or runtime behavior change
- Scenario receipt where applicable

For doc-only changes, run link/terminology greps and report the remaining old terms that are intentionally historical.

---

## 7. History And Receipts

Do not keep long historical task tables in this file. Use:

- [`../what's done/`](../what's%20done/) for shipped receipts.
- [`../archive/superseded/`](../archive/superseded/) for replaced plans.
- [`HARD_BUGS.md`](./HARD_BUGS.md) for live landmines.
- [`../strategy/2026-06-08-long-term-architecture-review.md`](../strategy/2026-06-08-long-term-architecture-review.md) for the strategic diagnosis.

This file should stay short enough that a coding agent can safely read it before every task.

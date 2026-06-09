# Master Build Handoff — Intera Agent

**Last updated:** 2026-06-09
**Audience:** founder, architect, coding-team leads, parallel AI coding sessions
**Current macro priority:** Foundation Reset before commercial customer deployment

Read first:

1. [`GENERIC_HANDOFF.md`](./GENERIC_HANDOFF.md) - collaboration protocol, verification gates, repo context.
2. [`../README.md`](../README.md) - doc map and current vocabulary.
3. [`BROWSER_SMOKE_RUNBOOK.md`](./BROWSER_SMOKE_RUNBOOK.md) - local browser-smoke/auth timebox rules.
4. [`POST_FOUNDATION_DISPATCH_PROMPTS.md`](./POST_FOUNDATION_DISPATCH_PROMPTS.md) - current copy-ready prompts for the next zero-context coding sessions.
5. [`ARCHITECT_AUDIT_2026-06-09.md`](./ARCHITECT_AUDIT_2026-06-09.md) - current risk map and next-lane split before first commercial deployment.
6. [`FOUNDATION_RESET_LANE_PROMPTS.md`](./FOUNDATION_RESET_LANE_PROMPTS.md) - historical prompts for the shipped F1-F7/UX0 foundation lanes.
7. [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md) - active reset plan.
8. [`../spec/Intera_Harness_架构梳理.md`](../spec/Intera_Harness_架构梳理.md) - architecture source of truth.
9. [`../spec/Intera_UI_UX_Design_System.md`](../spec/Intera_UI_UX_Design_System.md) - Console IA, visual system, and UI refactor lanes.

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
- make ConfigPilot a real typed-API configuration assistant
- use Scenario Lab receipts as the delivery validation path

The owner-approved UI/UX direction is frozen in [`../spec/Intera_UI_UX_Design_System.md`](../spec/Intera_UI_UX_Design_System.md). Do not rediscover the navigation, theme, or ConfigPilot shape in coding lanes.

The previous standalone Procedure refactor is superseded and archived at [`../archive/superseded/2026-06-08-case-type-procedure-orchestration-refactor.md`](../archive/superseded/2026-06-08-case-type-procedure-orchestration-refactor.md). Do not dispatch from it.

---

## 1. Active Lanes

Before any coding session edits files, its owned files must be declared either here by the coordinator or in the lane prompt handed to that session. Do not make every parallel session edit this file only to claim a lane; that creates avoidable merge conflicts. Remove or refresh rows after the task is committed and verified.

| Lane | Owner/session | Status | Owned files | Notes |
|---|---|---|---|---|
| _none_ | - | - | - | Add a row before starting implementation work. |

Rules:

- One file cannot be owned by two lanes at once.
- `packages/shared/prisma/schema.prisma` is exclusive to the schema lane.
- `apps/console/lib/agent/*` is high-collision; declare exact files.
- `apps/console/lib/i18n/dictionaries.ts` should be handled by the final sweep unless a lane absolutely needs visible copy.
- If a lane needs an extra file after starting, re-check this table and the active lane prompts first.

---

## 2. Dispatch Order

The active implementation plan is [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md).

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

| Lane | Scope | Parallel? | Notes |
|---|---|---|---|
| R1 | Procedure runtime + `dispatch_case_agent` cutover | Shipped locally | Removes detached/background sub-agent customer path; runtime continues inline through ProcedureExecutor + HookEngine. |
| C1 | Procedure Builder + step Hook bindings | Shipped locally | Updates case-type/procedure admin path to use HookBinding, especially ProcedureStep scope. |
| U1 | Build / Operate / Settings shell and redirects | Shipped locally | Establishes target IA without turning every page into one giant refactor. |
| U2 | Release command center + package actions | Shipped locally | Uses existing package export/import and Scenario validation metadata. |
| U3 | Pilot Lab + Scenario receipts | Shipped locally | Uses existing Scenario APIs; ConfigPilot starts as a drawer/workbench shell. |
| B1 | Brain Memory + compact strategy UX | Shipped locally | Turns memoryStrategy into Brain > Memory strategy, preserve rules, and Compact Test. |
| R2 | Physical legacy cleanup | Shipped locally | Removes Policy/stage/sub-agent/skills physical runtime and backfills/archive legacy data. |
| Q1 | Final terminology, i18n, docs, browser QA sweep | Shipped | Cleans user-facing copy, guide docs, redirects, and responsive states after R2. |
| Q2 | Light-first UI polish pass | Shipped | Applies the designer sketch direction without IA/schema/runtime/API changes. |
| P1 | ConfigPilot typed configuration tools | Next / in progress | Adds backend prompt/model/context/propose/apply typed draft writes; never publish. Must be green before push/deploy. |
| R3 | ProcedureRun runtime overlay + system Tool rename + `remember` | After P1 ownership is clear | Keeps stable Core Agent prompt, appends dynamic ProcedureRun context at tail, resolves step Hooks by runtime timeline, and exposes `start_procedure`, `finalize_procedure`, `remember`. |
| S2 | Runtime-backed Scenario receipts | After R3 or parallel if no runtime file overlap | Distinguishes fixture receipts from actual Agent runtime validation. |
| PKG1 | Package completeness + version cap | Can run after P1 | Completes package surfaces and enforces max five historical versions. |
| Q3 | Legacy route/component/doc truth cleanup | Last | Removes stale active surfaces and updates drifted landmine docs. |

Recommended coding-team shape:

- R1, C1, U1, U2, U3, B1, R2, Q1, Q2, and `/ops/guide` cleanup are already shipped on main.
- P1 should run alone or with strict ownership because it touches ConfigPilot APIs, backend prompt/model, apply service, and UI.
- R3 touches high-collision runtime files and should not overlap with another runtime lane. It is an architecture lane, not a copy-only rename lane.
- S2 and PKG1 can run after P1/R3 boundaries are clear.
- Q3 should run after the product/runtime names are stable.
- Use [`POST_FOUNDATION_DISPATCH_PROMPTS.md`](./POST_FOUNDATION_DISPATCH_PROMPTS.md) for current lane prompts. Do not redispatch from the shipped F1-F7 prompts.

---

## 3. Frozen Product Decisions

- First design user: implementation / delivery staff.
- First customer target: one real commercial delivery package within roughly two weeks.
- First industry template: Gaming / iGaming support.
- First launch boundary: information collection, read-only lookup, structured human transfer.
- Security/compliance: reserve architecture, do not let it block first functionality.
- ConfigPilot: important first-class surface, can read the current Agent configuration and write draft config through permission check -> proposal -> diff -> human accept -> typed API -> Scenario receipt. It must never self-publish.
- Procedure count: keep small at first; too many CaseTypes/Procedures will weaken intent routing.
- ProcedureStep-level Hook configuration must be visible in the Procedure Builder.
- First launch supports declarative, restricted JavaScript, and HTTP Hooks.
- Marketplace is reserved, not launched. `.intera-agent.json` should support internal sharing now and future selling later.
- Historical/legacy fields may be exported under `legacy`; new top-level package fields must use current names.
- UI/UX: first screen is Build -> Release; top-level nav is Build / Operate / Settings; Components has Brain, Procedures, Tools, Hooks, Knowledge, Integrations; Operate has Conversations and Human Handoff only.
- Brain owns memory and compact configuration. Expose strategy-level controls first: Memory Mode, Compact model, Preserve rules, Fact extraction rules, Profile, and Compact Test. Keep raw token thresholds and circuit-breaker knobs under Advanced.
- `confirmedFacts` are business facts. `ProcedureRun`/runtime state is not a business fact and must not be stored in confirmedFacts.
- `ProcedureRun` state is session-lifecycle runtime state. It may be summarized into chat memory when useful, but the canonical active/paused/completed ProcedureRun state belongs to the runtime-managed Procedure Run Tracker.
- Procedure is a runtime overlay, not a prompt-mode transformation. `start_procedure` creates/selects a ProcedureRun; it must not replace the stable Core Agent prompt or prepend a dynamic Procedure header before that prompt.
- Keep context in three layers: stable Core Agent prompt; stable/cacheable Procedure definition; dynamic ProcedureRun state appended at the prompt tail.
- The runtime should inject ProcedureRun context as dynamic procedure todos/current state, so the main Agent can decide whether a new message continues, supplements, pauses, resumes, or starts a Procedure.
- Hook scopes for ProcedureStep must be resolved by runtime from active ProcedureRun timeline + currentStepId + requested Tool, not by trusting the model to remember the Procedure prompt.
- Do not introduce a standalone LLM ProcedureRouter. The main Agent should selectively load the compact Procedure catalog plus active/paused ProcedureRun state and choose the next action inside the normal ReAct loop.
- `record_facts` is not the product name. The controlled memory-write tool should be `remember`, with explicit `scope: "chat" | "user"`. `remember(scope="chat")` writes what `read_chat_memory` later reads; `remember(scope="user")` writes what `read_user_profile` later reads.
- Runtime-managed capabilities should be visible to delivery staff as locked/auditable platform capabilities, but not editable business Tools. P0 capability examples: Procedure Run Tracker, Hook Engine, Memory Extractor, Scenario Runner.
- Agent-callable immutable system Tools should be visible as locked Tools. P0 examples: `start_procedure`, `finalize_procedure`, `ask_user_questions`, `create_human_task`, `read_chat_memory`, `read_user_profile`, and `remember`.
- `Case` is no longer a product-level concept. Code may keep durable Case shells temporarily for Message/ActionTrace persistence, but UI/copy/future APIs should prefer Chat, User, ProcedureRun, HumanTask, Trace, and Memory.
- Visual direction: Quiet Agent Studio, unified light-first across the Console. Pilot Lab, Diff Viewer, Trace detail, ConfigPilot, Scenario receipts, and publish/rollback moments use focused light workspaces with slightly cooler or denser light surfaces, not dark mode.
- Approved brand/motion assets: logo source is `/Users/curtis/Desktop/design/Globe loader`; Playground and Pilot Lab AI-generation loaders use `/Users/curtis/Desktop/design/Organic Loaders (standalone).html` variants `01`, `02`, `05`, `06`, `10`, `11`, `12`, `17`, `20`; AI-generation text streaming uses `/Users/curtis/Desktop/design/Text streaming (standalone).html` variant `07 token stream`.
- Config Diff Viewer and Command Bar are first-class UI primitives.
- Product UI supports `en-US` and `zh-CN`; business configuration content is not auto-translated.

---

## 4. Current Known State

Shipped foundations already useful for the reset:

- Safe local Postgres foundation shipped 2026-06-08. See [`../what's done/2026-06-08-foundation-safe-local-db.md`](../what's%20done/2026-06-08-foundation-safe-local-db.md).
- Procedure additive Phases 1-3 shipped through `373d2eed`: Procedure contracts/columns exist, ProcedureExecutor prompt path is wired, and case-scoped legacy guardrail activation exists. Foundation Reset lanes must treat those as migration inputs, not as the target architecture.
- Foundation reset first wave shipped through `d42c543e`: Hooks schema/API/UI, HookEngine checkpoints, Tool trace vocabulary, package import/export, Scenario soft gate, and Quiet Agent Studio primitives.
- Post-foundation commits through `02dc3182`: target IA shell, ProcedureStep Hook binding UI, inline Procedure runtime cutover, Release command center, Pilot Lab, Brain Memory strategy workspace, R2 physical legacy cleanup, Q1 terminology sweep, Q2 light-first polish, and obsolete guide removal.
- Trace single-contract and playground hardening work shipped. See the relevant receipts under [`../what's done/`](../what's%20done/).
- Agent-scoped architecture exists in code, but verify orgId -> agentConfig ownership whenever touching admin sub-module routes.

Live landmines to keep in mind:

- Durable Case shells still exist on some route-level persistence paths because current Message/ActionTrace schema depends on `caseId`; solve this in a later schema/runtime lane, not by reintroducing background sub-agents.
- Playground remains a large component and should not be casually expanded.
- Legacy guardrail live-confirm gaps should be converted into Hook Scenario coverage during the reset.
- ConfigPilot is currently the highest-risk incomplete surface: it must own backend prompt/model/context/propose/apply/UI wiring before it is trusted by delivery staff.
- Scenario receipts are useful but must be labeled truthfully until runtime-backed Scenario execution lands.

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

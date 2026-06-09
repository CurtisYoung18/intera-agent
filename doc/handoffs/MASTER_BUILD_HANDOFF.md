# Master Build Handoff — Intera Agent

**Last updated:** 2026-06-09
**Audience:** founder, architect, coding-team leads, parallel AI coding sessions
**Current macro priority:** Foundation Reset before commercial customer deployment

Read first:

1. [`GENERIC_HANDOFF.md`](./GENERIC_HANDOFF.md) - collaboration protocol, verification gates, repo context.
2. [`../README.md`](../README.md) - doc map and current vocabulary.
3. [`POST_FOUNDATION_DISPATCH_PROMPTS.md`](./POST_FOUNDATION_DISPATCH_PROMPTS.md) - current copy-ready prompts for the next zero-context coding sessions.
4. [`FOUNDATION_RESET_LANE_PROMPTS.md`](./FOUNDATION_RESET_LANE_PROMPTS.md) - historical prompts for the shipped F1-F7/UX0 foundation lanes.
5. [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md) - active reset plan.
6. [`../spec/Intera_Harness_架构梳理.md`](../spec/Intera_Harness_架构梳理.md) - architecture source of truth.
7. [`../spec/Intera_UI_UX_Design_System.md`](../spec/Intera_UI_UX_Design_System.md) - Console IA, visual system, and UI refactor lanes.

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

Post-foundation lanes committed locally on `main` after `origin/main`:

- `d99ef834`: U1 Build / Operate / Settings shell and redirects.
- `f24b2fd9`: C1 Procedure Builder with ProcedureStep Hook bindings and Hook validation copy.
- `c4c7365c`: R1 `dispatch_case_agent` cut to inline Procedure start/select; no customer-facing background sub-agent dispatch.

| Lane | Scope | Parallel? | Notes |
|---|---|---|---|
| R1 | Procedure runtime + `dispatch_case_agent` cutover | Shipped locally | Removes detached/background sub-agent customer path; runtime continues inline through ProcedureExecutor + HookEngine. |
| C1 | Procedure Builder + step Hook bindings | Shipped locally | Updates case-type/procedure admin path to use HookBinding, especially ProcedureStep scope. |
| U1 | Build / Operate / Settings shell and redirects | Shipped locally | Establishes target IA without turning every page into one giant refactor. |
| U2 | Release command center + package actions | After or alongside U1 | Uses existing package export/import and Scenario validation metadata. |
| U3 | Pilot Lab + Scenario receipts | After or alongside U1 | Uses existing Scenario APIs; ConfigPilot can start as a drawer/workbench shell. |
| B1 | Brain Memory + compact strategy UX | After U1, parallel with U2/U3 | Turns memoryStrategy into Brain > Memory strategy, preserve rules, and Compact Test. |
| R2 | Physical legacy cleanup | After R1 and C1 | Drops old stage/sub-agent/Policy/guardrail/skill fields only after runtime and UI no longer depend on them. |
| Q1 | Final terminology, i18n, docs, browser QA sweep | Last | Cleans user-facing copy, guide docs, redirects, and responsive states. |

Recommended coding-team shape:

- Start R1 first if only one runtime owner is available.
- C1 and U1 can run in parallel only if they do not edit the same route files.
- Hold R2 until R1 and C1 have green receipts; physical deletion before runtime cutover is avoidable risk.
- Q1 remains last because dictionaries, guide copy, and redirects are broad-collision files.
- Use [`POST_FOUNDATION_DISPATCH_PROMPTS.md`](./POST_FOUNDATION_DISPATCH_PROMPTS.md) for current lane prompts. Do not redispatch from the shipped F1-F7 prompts.

---

## 3. Frozen Product Decisions

- First design user: implementation / delivery staff.
- First customer target: one real commercial delivery package within roughly two weeks.
- First industry template: Gaming / iGaming support.
- First launch boundary: information collection, read-only lookup, structured human transfer.
- Security/compliance: reserve architecture, do not let it block first functionality.
- ConfigPilot: important first-class surface, can write config through proposal -> diff -> confirm -> typed API -> Scenario receipt.
- Procedure count: keep small at first; too many CaseTypes/Procedures will weaken intent routing.
- ProcedureStep-level Hook configuration must be visible in the Procedure Builder.
- First launch supports declarative, restricted JavaScript, and HTTP Hooks.
- Marketplace is reserved, not launched. `.intera-agent.json` should support internal sharing now and future selling later.
- Historical/legacy fields may be exported under `legacy`; new top-level package fields must use current names.
- UI/UX: first screen is Build -> Release; top-level nav is Build / Operate / Settings; Components has Brain, Procedures, Tools, Hooks, Knowledge, Integrations; Operate has Conversations and Human Handoff only.
- Brain owns memory and compact configuration. Expose strategy-level controls first: Memory Mode, Compact model, Preserve rules, Fact extraction rules, Profile, and Compact Test. Keep raw token thresholds and circuit-breaker knobs under Advanced.
- `confirmedFacts` are business facts. `procedureRun`/runtime state belongs in internal structured working memory, not confirmedFacts.
- P0 should not expose an unrestricted `record_facts` system tool. Facts should come from user-message extraction, form answers, tool-result mapping, and human-task answers unless the owner explicitly approves a controlled memory-write tool.
- Visual direction: Quiet Agent Studio, unified light-first across the Console. Pilot Lab, Diff Viewer, Trace detail, ConfigPilot, Scenario receipts, and publish/rollback moments use focused light workspaces with slightly cooler or denser light surfaces, not dark mode.
- Config Diff Viewer and Command Bar are first-class UI primitives.
- Product UI supports `en-US` and `zh-CN`; business configuration content is not auto-translated.

---

## 4. Current Known State

Shipped foundations already useful for the reset:

- Safe local Postgres foundation shipped 2026-06-08. See [`../what's done/2026-06-08-foundation-safe-local-db.md`](../what's%20done/2026-06-08-foundation-safe-local-db.md).
- Procedure additive Phases 1-3 shipped through `373d2eed`: Procedure contracts/columns exist, ProcedureExecutor prompt path is wired, and case-scoped legacy guardrail activation exists. Foundation Reset lanes must treat those as migration inputs, not as the target architecture.
- Foundation reset first wave shipped through `d42c543e`: Hooks schema/API/UI, HookEngine checkpoints, Tool trace vocabulary, package import/export, Scenario soft gate, and Quiet Agent Studio primitives.
- Post-foundation local commits through `c4c7365c`: target IA shell, ProcedureStep Hook binding UI, and inline Procedure runtime cutover.
- Trace single-contract and playground hardening work shipped. See the relevant receipts under [`../what's done/`](../what's%20done/).
- Agent-scoped architecture exists in code, but verify orgId -> agentConfig ownership whenever touching admin sub-module routes.

Live landmines to keep in mind:

- Durable Case shells still exist on some route-level persistence paths because current Message/ActionTrace schema depends on `caseId`; solve this in a later schema/runtime lane, not by reintroducing background sub-agents.
- Playground remains a large component and should not be casually expanded.
- Legacy guardrail live-confirm gaps should be converted into Hook Scenario coverage during the reset.

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

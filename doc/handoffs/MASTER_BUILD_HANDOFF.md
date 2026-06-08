# Master Build Handoff — Intera Agent

**Last updated:** 2026-06-08
**Audience:** founder, architect, coding-team leads, parallel AI coding sessions
**Current macro priority:** Foundation Reset before commercial customer deployment

Read first:

1. [`GENERIC_HANDOFF.md`](./GENERIC_HANDOFF.md) - collaboration protocol, verification gates, repo context.
2. [`../README.md`](../README.md) - doc map and current vocabulary.
3. [`FOUNDATION_RESET_LANE_PROMPTS.md`](./FOUNDATION_RESET_LANE_PROMPTS.md) - copy-ready prompts for parallel zero-context coding sessions.
4. [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md) - active reset plan.
5. [`../spec/Intera_Harness_架构梳理.md`](../spec/Intera_Harness_架构梳理.md) - architecture source of truth.
6. [`../spec/Intera_UI_UX_Design_System.md`](../spec/Intera_UI_UX_Design_System.md) - Console IA, visual system, and UI refactor lanes.

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

| Lane | Scope | Parallel? | Notes |
|---|---|---|---|
| F0 | Reset preflight, docs, old-plan lockout | First | This cleanup establishes the doc ground. Re-check before implementation. |
| F1 | Schema and shared contracts | Exclusive schema lane | Creates Hook/HookBinding and package/contracts foundation. |
| F2 | HookEngine and runtime checkpoints | After F1 contracts | Wires `PreToolUse`, `PostToolUse`, `Stop`. |
| F3 | Tool naming and trace/event reset | Parallel after F1 | Renames Skill language and `skill_*` events to Tool vocabulary. |
| F4 | Hooks API and admin UI | Parallel after F1/F2 contract shape | `/admin/hooks`, typed API, binding manager, ProcedureStep Hook picker. |
| F5 | Procedure runtime cleanup | After F1/F2/F3 | Retires stage/sub-agent customer path and makes ProcedureExecutor the case runtime. |
| F6 | `.intera` export/import | After F1/F3 | Template package with tools/hooks/hookBindings/scenarios and legacy namespace. |
| F7 | Scenario soft gate | After F6 or in parallel with stable contracts | Validation states, receipts, changed-since-validation marker. |
| F8 | I18N, docs, navigation sweep | Last | Rename UI copy/routes, redirects, docs cleanup, old API deletion/410. |

Recommended coding-team shape:

- Start F1 first and keep it narrow.
- Run F2/F3/F4 in parallel only after F1 contract names are stable.
- Hold F5 until the runtime naming from F2/F3 is settled.
- Run F8 last to avoid dictionary and navigation conflicts.
- UI/UX lanes should follow [`../spec/Intera_UI_UX_Design_System.md`](../spec/Intera_UI_UX_Design_System.md). Start only the primitive/token lane early; route/navigation/page lanes should wait until Foundation Reset vocabulary and APIs are stable.

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
- Visual direction: Quiet Agent Studio, with a light product shell and deep immersive workspaces for Pilot Lab, Diff Viewer, Trace detail, and publish/rollback moments.
- Config Diff Viewer and Command Bar are first-class UI primitives.
- Product UI supports `en-US` and `zh-CN`; business configuration content is not auto-translated.

---

## 4. Current Known State

Shipped foundations already useful for the reset:

- Safe local Postgres foundation shipped 2026-06-08. See [`../what's done/2026-06-08-foundation-safe-local-db.md`](../what's%20done/2026-06-08-foundation-safe-local-db.md).
- Procedure additive Phases 1-3 shipped through `373d2eed`: Procedure contracts/columns exist, ProcedureExecutor prompt path is wired, and case-scoped legacy guardrail activation exists. Foundation Reset lanes must treat those as migration inputs, not as the target architecture.
- Trace single-contract and playground hardening work shipped. See the relevant receipts under [`../what's done/`](../what's%20done/).
- Agent-scoped architecture exists in code, but verify orgId -> agentConfig ownership whenever touching admin sub-module routes.

Live landmines to keep in mind:

- `dispatch_case_agent` detached sub-agent behavior is still a live issue until F5 retires it. See [`HARD_BUGS.md`](./HARD_BUGS.md).
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

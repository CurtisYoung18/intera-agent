# Intera Documentation Map

**Last updated:** 2026-06-10
**Purpose:** keep the docs usable for parallel AI coding teams after the shipped Foundation Reset baseline and the Q3 truth-cleanup pass.

## Read order

1. [`handoffs/GENERIC_HANDOFF.md`](./handoffs/GENERIC_HANDOFF.md) - stable repo context and collaboration rules.
2. [`handoffs/MASTER_BUILD_HANDOFF.md`](./handoffs/MASTER_BUILD_HANDOFF.md) - current macro priority, active lanes, and dispatch order.
3. [`handoffs/FOUNDATION_RESET_ROADMAP_CURRENT.md`](./handoffs/FOUNDATION_RESET_ROADMAP_CURRENT.md) - Mermaid roadmap from project start through remaining P0 delivery checkpoints.
4. [`handoffs/PLATFORM_DELIVERY_AUDIT_GOALS.md`](./handoffs/PLATFORM_DELIVERY_AUDIT_GOALS.md) - strict first-customer delivery goals, screenshot/receipt requirements, and high-quality acceptance bar.
5. [`handoffs/CODEX_GOAL_DISPATCH.md`](./handoffs/CODEX_GOAL_DISPATCH.md) - short Goal-mode prompt plus strict long-run execution contract and stop conditions.
6. [`handoffs/DELIVERY_UNCERTAINTY_LOG.md`](./handoffs/DELIVERY_UNCERTAINTY_LOG.md) - running review queue for uncertain points, defaults, blockers, and owner decisions.
7. [`strategy/2026-06-10-pilot-commercial-readiness-proposal.md`](./strategy/2026-06-10-pilot-commercial-readiness-proposal.md) - executable Gate A-D implementation guide and acceptance contract for the commercial Pilot cockpit.
8. [`handoffs/POST_FOUNDATION_DISPATCH_PROMPTS.md`](./handoffs/POST_FOUNDATION_DISPATCH_PROMPTS.md) - repair-ready prompt history after the shipped baseline; do not redispatch shipped lanes from it without an explicit repair ask.
9. [`to-do/2026-06-08-foundation-reset-domain-model.md`](./to-do/2026-06-08-foundation-reset-domain-model.md) - the owner-approved reset plan and historical migration record.
10. [`spec/Intera_Harness_架构梳理.md`](./spec/Intera_Harness_架构梳理.md) - current product and architecture source of truth.
11. [`spec/Intera_UI_UX_Design_System.md`](./spec/Intera_UI_UX_Design_System.md) - current Console IA, visual system, and UI refactor lanes.
12. [`strategy/2026-06-08-long-term-architecture-review.md`](./strategy/2026-06-08-long-term-architecture-review.md) - strategic diagnosis that led to the reset.
13. [`handoffs/HARD_BUGS.md`](./handoffs/HARD_BUGS.md) - live landmines that still matter while the reset is underway.

## Current vocabulary

Use these names in new docs, APIs, UI, traces, and package manifests:

| Current term | Meaning |
|---|---|
| `Runtime shell` | Transitional durable persistence record. New product copy should prefer Chat, User, ProcedureRun, HumanTask, Trace, and Memory. |
| `Procedure type` | Configurable issue category and routing target. |
| `Procedure` | Soft customer-service process attached to a Procedure type. |
| `ProcedureStep` | A selectable/configurable step inside a Procedure. |
| `Tool` | Any Agent-callable capability. |
| `Hook` | Hard control layer for PreToolUse, PostToolUse, and Stop checkpoints. |
| `HookBinding` | Activation link from Hook to agent, Procedure type, ProcedureStep, or Tool. |
| `.intera-agent.json` | Portable Agent Template Package for delivery reuse and future marketplace support. |
| `Scenario` | Delivery validation case and receipt source. |
| `ConfigPilot` | Conversational configuration assistant that writes only through typed APIs. |
| `Quiet Agent Studio` | First-launch UI theme: unified light-first product shell with focused light workspaces. |

Legacy names may appear in historical receipts, raw input, archived plans, and the original philosophy reference: `Skill`, `Policy`, `Guardrail`, `stage`, `sub-agent`, `preFinalize`.

## Current product truth

- Logged-in default route is `/build/pilot-lab`, with `Pilot` and `Playground` tabs in the same workspace.
- `Release` owns version history, publish/rollback flow, and package import/export actions.
- `ConfigPilot` is a Pilot Lab workspace, not a global drawer.
- Legacy `/admin/*` and `/ops/*` paths are compatibility redirects/wrappers only; current docs should teach the Build / Operate / Settings IA.

## Directory guide

| Path | Status | How to use |
|---|---|---|
| [`handoffs/`](./handoffs/) | Live | Coordination docs for humans and coding agents. |
| [`to-do/`](./to-do/) | Live | Active implementation plans only. Superseded plans do not stay here. |
| [`spec/`](./spec/) | Live/reference | Product architecture and channel samples. |
| [`strategy/`](./strategy/) | Live/reference | Strategic diagnosis and sequencing notes. |
| [`needs/`](./needs/) | Raw input | Original customer and validation requirements. Do not treat as normalized specs. |
| [`tools-real/`](./tools-real/) | Reference | Real API/tool notes from the current gaming/iGaming sample domain. |
| [`GPTBots知识库API/`](./GPTBots知识库API/) | Vendor reference | GPTBots knowledge API notes. |
| [`what's done/`](./what's%20done/) | Historical receipts | Shipped work logs. Useful evidence, not current truth. |
| [`archive/superseded/`](./archive/superseded/) | Archived | Plans/spec supplements replaced by the Foundation Reset. |

## Governance rules

- Keep `to-do/` small and current.
- Move finished implementation plans to `what's done/`.
- Move replaced plans/specs to `archive/superseded/`.
- Do not duplicate roadmap detail into every handoff; link to the reset plan.
- Historical receipts may keep old terminology if changing it would distort evidence.

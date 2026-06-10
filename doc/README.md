# Intera Documentation Map

**Last updated:** 2026-06-10
**Purpose:** keep the docs usable for parallel AI coding teams after the shipped Foundation Reset baseline.

## Read order

1. [`handoffs/GENERIC_HANDOFF.md`](./handoffs/GENERIC_HANDOFF.md) - stable repo context and collaboration rules.
2. [`handoffs/MASTER_BUILD_HANDOFF.md`](./handoffs/MASTER_BUILD_HANDOFF.md) - current macro priority, active lanes, and dispatch order.
3. [`handoffs/FOUNDATION_RESET_ROADMAP_CURRENT.md`](./handoffs/FOUNDATION_RESET_ROADMAP_CURRENT.md) - Mermaid roadmap from project start through remaining P0 delivery checkpoints.
4. [`handoffs/POST_FOUNDATION_DISPATCH_PROMPTS.md`](./handoffs/POST_FOUNDATION_DISPATCH_PROMPTS.md) - current copy-ready prompts after the F1-F7/UX0/R1-C1-U1-U3-B1-R2 baseline.
5. [`to-do/2026-06-08-foundation-reset-domain-model.md`](./to-do/2026-06-08-foundation-reset-domain-model.md) - the owner-approved reset plan and historical migration record.
6. [`spec/Intera_Harness_架构梳理.md`](./spec/Intera_Harness_架构梳理.md) - current product and architecture source of truth.
7. [`spec/Intera_UI_UX_Design_System.md`](./spec/Intera_UI_UX_Design_System.md) - current Console IA, visual system, and UI refactor lanes.
8. [`strategy/2026-06-08-long-term-architecture-review.md`](./strategy/2026-06-08-long-term-architecture-review.md) - strategic diagnosis that led to the reset.
9. [`handoffs/HARD_BUGS.md`](./handoffs/HARD_BUGS.md) - live landmines that still matter while the reset is underway.

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

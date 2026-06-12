# Intera Documentation Map

**Last updated:** 2026-06-12
**Purpose:** keep the docs usable for parallel AI coding teams after the Foundation Reset and during the architecture consolidation program.

## Read order

1. [`spec/Intera_Harness_架构梳理.md`](./spec/Intera_Harness_架构梳理.md) - current product and architecture source of truth.
2. [`handoffs/FOUNDATION_RESET_ROADMAP_CURRENT.md`](./handoffs/FOUNDATION_RESET_ROADMAP_CURRENT.md) - the single live roadmap.
3. [`handoffs/MASTER_BUILD_HANDOFF.md`](./handoffs/MASTER_BUILD_HANDOFF.md) - current dispatch, active lanes, and coordination rules.
4. [`handoffs/DELIVERY_UNCERTAINTY_LOG.md`](./handoffs/DELIVERY_UNCERTAINTY_LOG.md) - running review queue for uncertain points, defaults, blockers, and owner decisions.
5. [`spec/2026-06-12-architecture-consolidation-modules-spec.md`](./spec/2026-06-12-architecture-consolidation-modules-spec.md) - module dispatch spec M1-M7.

## Current vocabulary

Use these names in new docs, APIs, UI, traces, and package manifests:

| Current term | Meaning |
|---|---|
| `Runtime shell` | Transitional durable persistence record. New product copy should prefer Chat, User, ProcedureRun, HumanTask, Trace, and Memory. |
| `Procedure type` | Configurable issue category and routing target. |
| `Procedure` | Soft customer-service process attached to a Procedure type. This is the only API, schema, runtime, package, and trace identifier. |
| `ProcedureStep` | A selectable/configurable step inside a Procedure. |
| `Tool` | Any Agent-callable capability. |
| `Hook` | Hard control layer for PreToolUse, PostToolUse, and Stop checkpoints. |
| `HookBinding` | Activation link from Hook to agent, Procedure type, ProcedureStep, or Tool. |
| `.intera-agent.json` | Portable Agent Template Package for delivery reuse and future marketplace support. |
| `Scenario` | Delivery validation case and receipt source. |
| `ConfigPilot` | Conversational configuration assistant that writes only through typed APIs. |
| `Quiet Agent Studio` | First-launch UI theme: unified light-first product shell with focused light workspaces. |

UI copy may render `Procedure` as "Playbook" through i18n dictionary values only. Do not introduce new `playbook` code identifiers, route names, schema fields, runtime event names, package keys, or trace keys.

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
| [`archive/`](./archive/) | Archived | Source history, superseded plans, and evidence indexes. Start at [`archive/README.md`](./archive/README.md). |
| [`archive/superseded/`](./archive/superseded/) | Archived | Plans/spec supplements replaced by the Foundation Reset. |

## Governance rules

- Keep `to-do/` small and current.
- Move finished implementation plans to `what's done/`.
- Move replaced plans/specs to `archive/superseded/`.
- Do not duplicate roadmap detail into every handoff; link to the reset plan.
- Historical receipts may keep old terminology if changing it would distort evidence.
- Final terminology sweeps must include `rg -i "playbook" apps packages --type ts`; only i18n dictionary values may remain.

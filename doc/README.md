# Intera Documentation Map

**Last updated:** 2026-06-26
**Purpose:** keep the docs lean and usable for a solo build heading into first-tenant delivery. Only live reference, the current plan, known issues, and one archive — everything else is retired.

## Read order

1. [`spec/Intera_Harness_架构梳理.md`](./spec/Intera_Harness_架构梳理.md) — current product and architecture source of truth.
2. [`handoffs/HARD_BUGS.md`](./handoffs/HARD_BUGS.md) — open landmines live in the tree.
3. [`handoffs/DELIVERY_UNCERTAINTY_LOG.md`](./handoffs/DELIVERY_UNCERTAINTY_LOG.md) — open decisions, temporary defaults, and owner-review items.
4. [`strategy/2026-06-08-long-term-architecture-review.md`](./strategy/2026-06-08-long-term-architecture-review.md) — diagnosis of why the project plateaued and the sequence out.
5. Active plans/specs: [`to-do/2026-06-26-agentops-harness-mvp-execution-plan.md`](./to-do/2026-06-26-agentops-harness-mvp-execution-plan.md), [`to-do/2026-06-12-consolidation-m1-m7-execution-plan.md`](./to-do/2026-06-12-consolidation-m1-m7-execution-plan.md), [`spec/2026-06-12-architecture-consolidation-modules-spec.md`](./spec/2026-06-12-architecture-consolidation-modules-spec.md), [`spec/2026-06-12-ui-refactor-spec.md`](./spec/2026-06-12-ui-refactor-spec.md).

## Current vocabulary

Use these names in new docs, APIs, UI, traces, and package manifests:

| Current term | Meaning |
|---|---|
| `Procedure type` | Configurable issue category and routing target. |
| `Procedure` | Soft customer-service process attached to a Procedure type. The only API, schema, runtime, package, and trace identifier. |
| `ProcedureStep` | A selectable/configurable step inside a Procedure. |
| `Tool` | Any Agent-callable capability. |
| `Hook` | Hard control layer for PreToolUse, PostToolUse, and Stop checkpoints. |
| `HookBinding` | Activation link from Hook to agent, Procedure type, ProcedureStep, or Tool. |
| `.intera-agent.json` | Portable Agent Template Package for delivery reuse. |
| `Scenario` | Delivery validation case and receipt source. |
| `ConfigPilot` | Protocol, review UI, and optional light assistant that writes only through typed APIs. |
| `AgentOps Control Plane` | Agent-scoped API/CLI/MCP/evidence/proposal/replay/review layer for humans and external harness agents. |
| `intera-ops` | Planned CLI/MCP surface for Codex/Claude Code-style agents to inspect, propose, and replay through scoped tokens. |
| `Forensic Pack` | Read-only incident bundle for transcript, trace, Tool/Hook/KB evidence, metrics, SaaS links, and config refs. |
| `Debug Trace Pack` | High-permission provider/debug evidence bundle with redaction, audit, and retention controls. |
| `Quiet Agent Studio` | First-launch UI theme: unified light-first product shell with focused light workspaces. |

UI copy may render `Procedure` as "Playbook" through i18n dictionary values only. Do not introduce new `playbook` code identifiers, route names, schema fields, runtime event names, package keys, or trace keys.

Legacy names may appear in archived plans and the original philosophy reference: `Skill`, `Policy`, `Guardrail`, `stage`, `sub-agent`, `preFinalize`.

## Current product truth

- Logged-in default route is `/build/pilot-lab`, with `Pilot` and `Playground` tabs in the same workspace.
- `Release` owns version history, publish/rollback flow, and package import/export actions.
- `ConfigPilot` is a Pilot Lab workspace and review UI over the AgentOps Control Plane, not a global drawer or internal Codex-class agent.
- External harness agents should eventually use `intera-ops` / MCP / AgentOps APIs for scoped reads, typed draft proposals, forensic/debug packs, metrics, and replay receipts.
- Legacy `/admin/*` and `/ops/*` paths are compatibility redirects/wrappers only; current docs teach the Build / Operate / Settings IA.

## Directory guide

A solo project needs only four kinds of doc: **reference**, the **live plan**, **known issues**, and **archive**.

| Path | Kind | How to use |
|---|---|---|
| [`spec/`](./spec/) | Reference | Product architecture (`Intera_Harness_架构梳理.md`), active UI/consolidation specs, design system, channel samples. |
| [`needs/`](./needs/) | Reference (raw) | Original customer and validation requirements. Not normalized specs. |
| [`tools-real/`](./tools-real/) | Reference | Real API/tool notes for the current iGaming sample tenant. |
| [`GPTBots知识库API/`](./GPTBots知识库API/) | Reference (vendor) | GPTBots knowledge API notes. |
| [`to-do/`](./to-do/) | Live plan | Active implementation plans only. |
| [`handoffs/`](./handoffs/) | Known issues | Now just `HARD_BUGS.md` (open landmines) + `DELIVERY_UNCERTAINTY_LOG.md` (open decisions). |
| [`strategy/`](./strategy/) | Reference | Strategic diagnosis and sequencing notes. |
| [`archive/`](./archive/) | Archive | Write-only history. Start at [`archive/README.md`](./archive/README.md). |

### Archive subfolders

| Path | Holds |
|---|---|
| [`archive/shipped/`](./archive/shipped/) | Shipped-work logs (was `what's done/`). Evidence, not current truth. |
| [`archive/superseded/`](./archive/superseded/) | Plans/specs replaced by later work. |
| [`archive/parked/`](./archive/parked/) | Deferred-not-dead specs (e.g. the Pilot commercial-readiness proposal). |
| [`archive/retired-handoffs/`](./archive/retired-handoffs/) | Multi-agent coordination/dispatch/audit docs from the team-mode era. |

## Governance rules

- Keep `to-do/` small and current.
- When work ships, move its plan to `archive/shipped/`.
- When a plan/spec is replaced, move it to `archive/superseded/`; when it is deferred, move it to `archive/parked/`.
- `archive/` is write-only — never dispatch new work from it.
- Delivery-proof receipts and screenshots live under `.artifacts/` (gitignored, kept locally), not in `doc/`.
- Final terminology sweeps must include `rg -i "playbook" apps packages --type ts`; only i18n dictionary values may remain.

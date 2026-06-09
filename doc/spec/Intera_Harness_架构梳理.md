# Intera Harness Architecture

**Last updated:** 2026-06-09
**Status:** CURRENT source of truth for product architecture and domain language
**Audience:** founder, architect, delivery lead, and AI coding teams
**Related plan:** [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md)
**Related UI/UX spec:** [`Intera_UI_UX_Design_System.md`](./Intera_UI_UX_Design_System.md)

This document replaces the older mixed Harness/Procedure notes as the current architecture map. Historical docs may still contain `Skill`, `Policy`, `Guardrail`, `stage`, `sub-agent`, or `preFinalize`; new code and new docs should not.

---

## 0. Product Thesis

Intera is a customer-service AgentOps platform.

The Console should let a delivery person build, adapt, validate, deploy, and maintain a customer-service AI Agent for a real enterprise account. The first commercial slice is not a generic chatbot builder. It is a practical delivery chain for one customer:

```text
Import starter template
  -> adapt Agent with UI + ConfigPilot
  -> configure Procedure types, Procedures, Tools, Hooks, Human Transfer
  -> validate in Scenario Lab
  -> activate for LiveChat / API channel
  -> export a customer-customized .intera-agent.json package
```

First launch boundary:

- information collection
- read-only lookup
- structured human transfer
- Scenario receipt before or after activation

High-risk business actions can exist as Tool/Hook concepts, but should be gated or routed to humans in the first customer deployment.

---

## 1. Core Vocabulary

| Term | Meaning |
|---|---|
| `Runtime shell` | Transitional durable persistence record where current storage still requires it. Product copy and future APIs should prefer Chat, User, ProcedureRun, HumanTask, Trace, and Memory. |
| `Procedure type` | Configurable issue category and routing target, such as `deposit_issue` or `account_access`. |
| `Procedure` | Soft business process attached to a Procedure type. It guides the Agent; it is not a rigid flowchart. |
| `ProcedureStep` | One ordered step inside a Procedure. Delivery staff can attach Hooks to steps. |
| `Tool` | Any Agent-callable capability: API lookup, static fixture, platform operation, human transfer, or future workflow. |
| `Hook` | Hard control layer for PreToolUse, PostToolUse, and Stop checkpoints. |
| `HookBinding` | Activation relationship from a Hook to an agent, Procedure type, ProcedureStep, or Tool. |
| `Scenario` | Test case and acceptance receipt used by Scenario Lab. |
| `ConfigPilot` | Conversational configuration assistant. It writes only through typed admin/scenario/trace APIs. |
| `.intera-agent.json` | Portable Agent Template Package for internal delivery reuse and future marketplace support. |

Current code names should match these terms wherever the Foundation Reset touches files.

---

## 2. Product Shape

### 2.1 First design user

The primary first user is the implementation / delivery person, not an end-customer admin with unlimited freedom.

They need to:

- start from an industry template
- connect or mock customer backend APIs
- configure a small number of high-confidence Procedure types
- tune Procedures and Hooks from real scenarios
- hand over a validated Agent to a real customer quickly
- share/export the result internally

### 2.2 First industry template

The first template should focus on Gaming / iGaming support.

Suggested starting Procedure types:

- deposit not credited
- withdrawal status
- KYC / account verification
- promotion turnover / bonus requirement
- game issue / round issue
- account access

Do not create too many Procedure types initially. More Procedure options increase routing ambiguity and make Scenario validation harder.

---

## 3. Runtime Architecture

Intera should optimize around a single strong ProcedureRun Agent.

```text
Customer message
  -> channel adapter
  -> /api/messages
  -> Discovery
  -> ProcedureRun selection/opening
  -> Procedure type + Procedure
  -> shared ReAct loop
  -> Tool calls guarded by Hooks
  -> Stop Hooks
  -> customer reply or human transfer
```

The Agent keeps judgment. A Procedure gives recommended order, required evidence, and domain handling patterns; it does not force node-by-node traversal.

The target runtime removes detached customer-facing background fan-out. Parallel workers may return later only as durable, observable back-office jobs with clear result consumption, cancellation, and operator visibility.

### 3.1 Discovery

Discovery decides whether the user needs:

- regular FAQ / knowledge answer
- a new ProcedureRun
- continuation of an existing ProcedureRun
- human transfer / waiting-human acknowledgement

When operational work is needed, the Agent selects a Procedure type and therefore a Procedure.

### 3.2 `start_procedure`

Target model-facing Tool:

```text
start_procedure(procedureId)
  -> create or select the ProcedureRun
  -> attach Procedure type + Procedure
  -> continue inline through the main customer-facing Agent
```

`dispatch_case_agent` may exist only as a temporary compatibility alias. New prompt/default copy should teach `start_procedure`.

It must not spawn a detached background worker for the default customer turn.

---

## 4. Procedure Model

Procedure is soft orchestration.

```ts
type ProcedureAction =
  | 'use'
  | 'read'
  | 'ask'
  | 'decide'
  | 'tag'
  | 'escalate'
  | 'finalize'

interface ProcedureStep {
  id: string
  action: ProcedureAction
  target?: string
  guidance?: string
  when?: string
  required?: boolean
}

interface Procedure {
  steps: ProcedureStep[]
}
```

Example:

```text
Procedure: Deposit Not Credited
1. ask       Collect member id, amount, currency, payment method, approximate time
2. use       get_latest_deposit
3. read      transaction_history
4. decide    Match customer claim against platform evidence
5. escalate  Transfer if evidence conflicts or payment provider status is unclear
6. finalize  Explain the current result and next step
```

The Agent may:

- skip a step whose `when` condition is false
- reuse evidence already present in Memory
- ask the customer before a missing required input
- switch Procedure type if the problem is reclassified
- escalate when a Hook or Tool failure requires a human

Procedure Builder should show Hook controls at the ProcedureStep level. The data model remains top-level Hook + HookBinding; the step UI is a convenient binding surface.

---

## 5. Hook Model

Hook is the customer-service control layer.

Intera adopts Claude Code-style Hook names, but only implements customer-service-critical checkpoints first:

```ts
type HookCheckpoint = 'PreToolUse' | 'PostToolUse' | 'Stop'
```

| Checkpoint | When | Used for |
|---|---|---|
| `PreToolUse` | Before a Tool runs | prerequisites, high-risk Tool blocking, input validation, transfer-before-investigation checks |
| `PostToolUse` | After a Tool returns | evidence conflict checks, output validation, normalization, escalation triggers |
| `Stop` | Before any customer-visible answer is committed/sent | final answer safety, evidence completeness, unsupported promise prevention, human-transfer fallback |

`preFinalize` is removed. Former finalization rules migrate to `Stop` because ordinary customer-visible replies can also contain unsafe conclusions.

### 5.1 Hook decisions

```ts
type HookDecisionAction = 'allow' | 'warn' | 'block' | 'escalate'
```

- `allow`: continue.
- `warn`: continue and trace risk.
- `block`: do not run the Tool or do not send the current answer; inject Hook feedback and let the Agent repair within bounded retries.
- `escalate`: trigger or require human transfer.

### 5.2 Hook scope

Hooks are top-level resources. Bindings activate them.

```ts
type HookScopeType = 'agent' | 'caseType' | 'procedureStep' | 'tool'
```

Runtime activation:

```text
active hooks =
  agent bindings
  + active Procedure type bindings
  + active ProcedureStep bindings
  + matching Tool bindings
```

Lower scopes cannot silently disable higher-scope Hooks. If any active Hook blocks, the checkpoint blocks.

### 5.3 Hook handlers

First launch supports three handler kinds:

```ts
type HookHandler =
  | { kind: 'declarative'; check: HookCheck; effect: HookEffect }
  | { kind: 'code'; runtime: 'javascript'; source: string }
  | { kind: 'http'; endpoint: string; method: 'POST'; headers?: Record<string, string>; secretRefs?: HookSecretRef[]; timeoutMs: number }
```

- Declarative Hook: preferred for delivery staff and ConfigPilot.
- Code Hook: restricted JavaScript function only. No filesystem, shell, raw DB, or arbitrary network access.
- HTTP Hook: external customer rule/risk/approval service. Secrets are referenced, not embedded.

External calls go through HTTP Hook, not Code Hook.

---

## 6. Tool Model

Tool is the Agent-callable capability model.

Target Tool modes:

| Mode | Launch status | Meaning |
|---|---|---|
| `static_fixture` | P0/P1 | Deterministic JSON fixture for demos and Scenario tests. |
| `http` | P0/P1 | One external API endpoint with typed input/output schema. |
| `system_managed` / `channel` | P0/P1 | Built-in platform operation such as human transfer, asking questions, or LiveChat handoff. |
| `workflow` | Planned | Multi-step Tool internals: HTTP calls, conditions, retries, mapping, validation. |
| `code_transform` | Planned | Restricted transform code for normalizing Tool input/output. |

Important distinction:

- Procedure is ProcedureRun orchestration: what the Agent should do.
- Tool workflow is implementation-level orchestration inside one Tool: how backend data is fetched and normalized.

Swagger / OpenAPI import should produce ordinary HTTP Tools first. Workflow Tools can be a future consolidation path.

---

## 7. Memory Notebook And Trace

The Agent should reason from structured Memory and Trace, not only raw chat history.

```ts
interface CaseNotebook {
  facts: string[]
  missingFacts: string[]
  toolResults: Record<string, unknown>
  hypotheses: string[]
  procedureProgress: Record<string, 'pending' | 'done' | 'skipped' | 'blocked'>
  riskFlags: string[]
  nextBestAction?: string
}
```

Foundation Reset naming:

- `skillsCalled` -> `toolsCalled`
- `skillResults` -> `toolResults`
- `skill_call` -> `tool_call`
- `skill_result` -> `tool_result`

Do not emit new `skill_*` trace events after the reset. Historical traces may have read-only adapters if migration cost is high.

---

## 8. ConfigPilot

ConfigPilot is the conversational configuration assistant inside Console / Scenario Lab.

It can:

- inspect current Agent configuration
- explain Procedure, Tool, Hook, Human Transfer, and trace behavior
- generate Procedure drafts from natural language or failed scenarios
- propose Brain/model/prompt/memory changes through typed patches
- generate HTTP Tool drafts from Swagger / OpenAPI fragments
- create Static Fixtures from example responses
- create and bind declarative/code/HTTP Hooks
- run one-off scenarios and saved regression suites
- explain Scenario failures and propose the smallest config change
- export a validated `.intera-agent.json` package

It cannot:

- open a server shell
- read or write server files
- write DB rows directly
- bypass typed admin/scenario/trace APIs
- publish, activate, deploy, roll back, or bypass Scenario validation

The ConfigPilot model prompt, model selector, context builder, structured proposal parser, and apply service live on the backend. The React workbench is only the review/accept UI.

Mutation contract:

```text
proposal
  -> structured diff
  -> user confirmation
  -> typed API save
  -> Scenario receipt
  -> rollback path
```

This keeps development velocity high without turning ConfigPilot into an unsafe remote operator.

---

## 9. `.intera` Agent Template Package

The package is an Agent Template Package for internal delivery reuse and future marketplace support. It is not a DB dump.

Use `.intera-agent.json` as the first concrete file name.

Top-level fields use current names only:

```json
{
  "schemaVersion": "intera.agentTemplate.v1",
  "metadata": {
    "name": "Gaming Support Starter",
    "industry": "gaming",
    "marketplace": {
      "category": "customer-support"
    }
  },
  "agent": {},
  "caseTypes": [],
  "tools": [],
  "hooks": [],
  "hookBindings": [],
  "scenarios": [],
  "secrets": [],
  "legacy": {
    "caseTypes": [],
    "policies": [],
    "guardrails": [],
    "skills": [],
    "stageConfigs": [],
    "subAgents": []
  }
}
```

Marketplace is reserved, not launched. The package should still make future marketplace work natural: metadata, industry, tags, publisher/license placeholders, and template-level Scenario receipts.

Secrets and customer credentials should be placeholders or secret refs.

---

## 10. Scenario Lab

Scenario Lab is the acceptance gate for delivery.

First launch uses soft blocking:

- every customer delivery package should have a Scenario suite
- imports and config edits mark the Agent as `Changed since last validation`
- running the suite creates a receipt
- activation is not hard-blocked; owner/admin can override

States:

- `Validated`
- `Changed since last validation`
- `Validation failed`
- `Not validated`

Scenarios should be few but representative. Too many shallow scenarios create false confidence and slow delivery.

---

## 11. Human Transfer

Human transfer is a first-class Tool and an expected first-launch path.

The transfer should include:

- customer request
- active Procedure type
- completed Procedure steps
- missing facts
- Tool evidence
- Hook decisions and risk flags
- recommended next human action

The customer-visible experience should be explicit: the Agent is transferring/escalating the case to a human specialist because the current evidence or rule boundary requires it.

---

## 12. Channel Model

LiveChat is a channel adapter, not a separate Agent runtime.

The current direction:

```text
LiveChat webhook
  -> channel session
  -> /api/messages
  -> same Agent runtime
  -> renderer maps Tool results / forms / transfer events back to LiveChat UI
```

See [`LiveChat 客户对话流程（Sampled Flow）.md`](./LiveChat%20客户对话流程（Sampled%20Flow）.md) for the channel sample. That file should follow this architecture, not define an alternate runtime.

---

## 13. Implementation Reset

The Foundation Reset is intentionally allowed to physically rename schema, routes, runtime events, UI copy, and tests.

Primary changes:

- `Policy` / `Guardrail` -> `Hook`
- `Skill` -> `Tool`
- `preTool` / `postTool` / `preFinalize` -> `PreToolUse` / `PostToolUse` / `Stop`
- old `stage` runtime -> ProcedureExecutor
- detached customer-facing sub-agent fan-out -> retired
- `.intera-agent.json` package -> introduced

No long-term dual-read or dual-write compatibility should survive the reset unless the reset plan explicitly says so. Old data can be preserved under `.intera.legacy` and archived docs.

Dispatch details live in [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md).

---

## 14. Legacy Mapping

| Legacy | Current |
|---|---|
| `Skill` | `Tool` |
| `skillsCalled` | `toolsCalled` |
| `skillResults` | `toolResults` |
| `skill_call` | `tool_call` |
| `skill_result` | `tool_result` |
| `Policy` | `Hook` |
| `Guardrail` | `Hook` |
| `preTool` | `PreToolUse` |
| `postTool` | `PostToolUse` |
| `preFinalize` | `Stop` |
| stage-level guardrail | ProcedureStep HookBinding |
| detached sub-agent fan-out | durable async job only if reintroduced later |

---

## 15. Do Not Build Yet

Defer:

- public marketplace
- payment, licensing, storefront, reviews, ratings
- broad lifecycle Hook surface beyond `PreToolUse`, `PostToolUse`, and `Stop`
- async Hook workers
- arbitrary HTTP/code Hook execution without the launch restrictions
- complex permission workflow for every mutation
- generalized workflow Tool builder if HTTP Tool + Static Fixture is enough for the first customer

The first goal is a clean, commercially usable foundation, not maximum surface area.

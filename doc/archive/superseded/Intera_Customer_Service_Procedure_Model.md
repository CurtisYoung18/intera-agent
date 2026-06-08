> **SUPERSEDED 2026-06-08:** This spec supplement has been merged into [`../../spec/Intera_Harness_架构梳理.md`](../../spec/Intera_Harness_架构梳理.md). It is preserved for traceability only. Do not treat its `Guardrail`/`Policy`/`Skill` wording as current architecture.

# Intera Customer Service Procedure Model

**Date:** 2026-06-08
**Status:** Architecture direction / spec supplement
**Scope:** Customer-service case execution, Procedure design, sub-agent retirement

This note records the current product and runtime direction for Intera after reviewing the Fin AI public Procedure model and the current Intera codebase.

## 0. Ultra Goal

Intera's long-term product goal is to become an **AgentOps workbench for customer-service AI agents**.

The Console should not only let operators fill forms. The near-term named capability is **ConfigPilot**: a conversational configuration and validation assistant inside Scenario Lab / Console. ConfigPilot should not open a server shell, should not read or write server files, and should not execute arbitrary commands. It can only call Intera's typed admin, scenario, and trace APIs under RBAC, audit logging, versioning, and explicit user confirmation.

The longer-term Claude Code-like goal remains useful as a product north star, but the first valuable slice is not a terminal. It is a safe AgentOps chat surface that can inspect, propose, test, and apply Intera configuration changes.

Target capability:

```
Delivery person -> ConfigPilot
  -> inspect current Agent configuration
  -> propose and apply Procedure / Tools / Guardrails / Human Transfer changes
  -> import API contracts such as Swagger / OpenAPI into Tool definitions
  -> run Scenario Lab tests and regression suites
  -> inspect traces and failures
  -> explain why a case escalated, failed, or finalized
  -> produce a safe diff / receipt / rollback path for every mutation
```

ConfigPilot is allowed to participate directly in configuration, not only analysis. Example: when a delivery engineer pastes a Swagger / OpenAPI fragment or an API call contract into the chat, ConfigPilot can generate a Tool draft for the current Agent, including `name`, `description`, `mode=http`, `endpoint`, `httpMethod`, `inputSchema`, `outputSchema`, headers / secret references, timeout, optional static fixture, and a Scenario Lab test. The mutation is applied only through typed admin APIs after showing the diff and receiving confirmation.

The ultra goal matters because it defines the end-state: **Intera is not just a chatbot console; it is an operations system for building, shipping, and maintaining customer-service agents.**

## 1. Positioning

Intera should be optimized around a **single strong Case Owner Agent**:

```
Discovery -> Case Type / Procedure selection -> Single Case Owner execution
  -> Hooks / Guardrails -> Human handoff when needed
```

The product should not become a rigid flow-chatbot, and it should not make customer turns depend on detached background sub-agents. The best customer-service shape is:

- **Procedure gives the model direction**: the recommended order, tools, evidence, and business-specific handling pattern.
- **The Agent keeps judgment**: skip already-satisfied steps, ask clarifying questions, switch case type, retry after tool failure, or escalate.
- **Guardrails enforce hard boundaries**: block unsafe actions, require evidence, require human review, and prevent unsupported promises.
- **Case Memory / Notebook gives continuity**: the model reasons from facts, missing facts, tool results, progress, risk flags, and next best action.
- **Human handoff is a first-class transfer tool**: `create_human_task` should first work as the customer-service escalation / transfer-to-human tool. The transfer should be evidence-bearing where possible: case summary, evidence, risk flags, and recommended action.

## 2. Fin-Inspired Procedure Interpretation

Fin's public Procedure docs describe Procedures as a way for **one Fin AI Agent** to follow a structured instruction flow with data connectors, conditions, code, and handoff. Their sub-procedure concept is closer to a reusable helper function than to a separate parallel specialist agent: it runs within the parent Procedure context and returns control to the parent flow.

Useful references:

- [Fin Procedures FAQs](https://www.intercom.com/help/en/articles/13617008-fin-procedures-faqs)
- [Fin Procedures explained](https://fin.ai/help/en/articles/13976187-fin-procedures-explained)
- [How to run sub-procedures](https://www.intercom.com/help/en/articles/13459827-how-to-run-sub-procedures)

Implication for Intera:

**Procedure execution should be inline, single-agent execution.** Intera may support reusable sub-procedures later, but they should behave like helper procedures inside the same Case Owner runtime, not as detached sub-agents.

## 3. Recommended Runtime Model

### 3.1 Discovery

The Agent first decides whether the user needs:

- regular FAQ / knowledge answer
- a new case
- continuation of an existing case
- human handoff / waiting-human acknowledgement

When a case is needed, the Agent selects a `CaseType` and therefore a `Procedure`.

### 3.2 Procedure

A `Procedure` is a soft plan, not a flowchart. It should contain ordered steps with a closed action vocabulary:

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
Procedure: Account Access
1. Use: verify_customer
2. Read: kyc_status
3. Read: document_quality
4. Use: verification_guidelines
5. Finalize: explain resolution
```

The Agent may adapt:

- skip a step whose `when` condition is false
- use evidence already present in Case Memory
- ask the user before a missing required input
- switch Procedure if the user's problem is reclassified
- escalate when a guardrail or tool failure requires a human

### 3.3 Guardrails

Guardrails are the hard control layer. They should be case-type activated:

```
active guardrails = platform safety floor + active CaseType.guardrails[]
```

Examples:

- no high-risk account changes without human review
- cannot finalize without required investigation evidence
- cannot promise compensation / refund unless tool or human evidence supports it
- must cite basis before resolution
- must create a human task for specified risk states

### 3.4 Human Transfer Tool

For the current customer-service product, `create_human_task` is prioritized as a **transfer / escalation tool**.

Target behavior:

- the Agent calls `create_human_task` when the case requires a human operator, a guardrail mandates human review, or the Agent cannot continue safely
- the customer-visible experience can be "we are transferring / escalating this to a human specialist"
- the operator receives the strongest handoff the Agent can produce at that moment: customer request, completed Procedure steps, tool evidence, risk flags, and suggested next action
- after the human result is available, the Agent may resume and translate the result back to the customer, but that resume flow is secondary to making the transfer work well first

### 3.5 Case Notebook

The Agent should reason from a structured case notebook rather than only from chat history:

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

This is the customer-service analogue of how a senior support agent works: what is known, what is missing, what has been checked, what is risky, and what should happen next.

### 3.6 Tool Modes and Workflow Tools

Tools should support more than one execution shape. The product label should avoid the word `mock` for operators; use **Static Fixture** for fixed test responses.

Target tool modes:

- `static_fixture`: returns a configured JSON fixture for demos, Scenario Lab, and deterministic regression tests.
- `http`: calls one external API endpoint.
- `workflow` **(planned)**: executes a configured sequence of steps inside one Tool. Steps may include HTTP calls, conditional branches, retries, field mapping, validation, and output normalization.
- `code_transform` **(planned, restricted)**: runs limited transform code such as `input + responses -> normalized output`; this is for delivery engineers, not regular operators, and should be sandboxed, versioned, auditable, and testable.
- `system_managed` / `channel`: built-in Intera capabilities such as `create_human_task`, `finalize_case`, `ask_user_questions`, LiveChat transfer, and other platform-managed operations.

Important distinction:

- **Procedure** is case-level orchestration: what the Case Owner Agent should do for the customer.
- **Tool workflow** is implementation-level orchestration inside one Tool: how to collect, combine, and normalize backend data before returning it to the Agent.

Example:

```text
Procedure step:
  Use: verify_customer

verify_customer workflow:
  1. HTTP: get_customer_profile
  2. HTTP: get_kyc_status
  3. HTTP: get_document_quality
  4. Transform: normalize into { verified, reason, riskFlags }
```

Workflow tools should be written into the product spec now, but they do not need to be the first implementation slice. The first slice can still configure `static_fixture` and `http` Tools, while ConfigPilot imports Swagger / OpenAPI into standard HTTP Tool definitions and prepares a future migration path into workflow Tools.

## 4. Sub-Agent Policy

### 4.1 Customer-facing runtime

Do **not** use detached sub-agent fan-out in the normal customer-service turn.

Reasons:

- customer-service cases usually need stable ownership more than parallel experts
- detached work can outlive the HTTP response and be lost on deploy / restart
- background findings can fail to surface to the customer
- multiple writers create race risk against shared case memory
- token spend increases without a proportional customer outcome

### 4.2 What to retire

The current `dispatch_case_agent -> OrchestratorAgent.dispatchInBackground` path should be retired. Keep the **semantic intent** of `dispatch_case_agent` as "open / route a case", but remove the background sub-agent spawn.

Target behavior:

```
dispatch_case_agent(caseType)
  -> create / select the case
  -> attach the case's Procedure
  -> continue inline through the main Case Owner Agent
```

### 4.3 When sub-agents may come back

Sub-agents can be reconsidered only for explicit back-office work, not default customer turn execution:

- long-running fraud investigation
- batch evidence collection
- compliance review that intentionally runs async
- offline report generation

If reintroduced, they should be modeled as observable jobs with durable state, result consumption, cancellation, and operator visibility.

## 5. Console Implications

The Case Type editor should become a Procedure Builder:

- ordered step list
- action selector
- typed target picker
- guidance field
- optional `when`
- required toggle
- guardrail activation multi-select
- preview of what the Case Owner Agent will see

The UI should avoid presenting stages as rigid state-machine nodes. Operators are configuring an Agent's working procedure, not drawing a chatbot flow.

### 5.1 Scenario Lab + ConfigPilot

Scenario Lab should become the place where delivery engineers test whether an Agent behaves correctly across realistic customer cases. ConfigPilot should live next to it as the conversational configuration assistant.

ConfigPilot responsibilities:

- read current Agent configuration through typed admin APIs
- explain Procedure, Tool, Guardrail, Human Transfer, and trace behavior
- generate configuration proposals from natural language, examples, traces, Swagger / OpenAPI fragments, or failed scenarios
- apply approved changes through typed admin APIs, never through shell or file writes
- run one-off scenarios and saved regression suites
- explain failures and recommend the smallest config change
- produce an audit trail: before/after diff, who approved it, what scenarios were run, and how to roll back

ConfigPilot mutation policy:

- analysis can run freely within the user's RBAC scope
- mutations must be proposed as diffs first
- applying a mutation requires explicit confirmation
- all writes target the current Agent version or a forked Agent version
- secrets are referenced through secret keys / integration bindings, not pasted into generated Tool headers

Swagger / OpenAPI import flow:

```text
User pastes API contract
  -> ConfigPilot extracts endpoint, method, auth, request schema, response schema
  -> proposes a Tool definition for the current Agent
  -> optionally creates a Static Fixture from example response
  -> creates a Scenario Lab test that calls the Tool through the Agent runtime
  -> user approves
  -> ConfigPilot calls typed admin API to save the Tool
  -> Scenario Lab runs the validation and records the receipt
```

## 6. Design Principle

The product should maximize model capability by giving the model:

- enough structure to act like a domain expert
- enough evidence to avoid guessing
- enough freedom to handle messy customer reality
- enough guardrails to stay safe

In short:

**Procedure is soft orchestration. Guardrails are hard boundaries. The Case Owner Agent is the execution subject.**

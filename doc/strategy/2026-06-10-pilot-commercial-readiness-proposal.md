# Pilot Commercial Readiness Implementation Guide

**Date:** 2026-06-10
**Status:** working implementation guide, acceptance contract, and coding-agent self-audit target
**Audience:** founder, architect, delivery lead, and coding-team coordinators
**Related truth:** [`../spec/Intera_Harness_架构梳理.md`](../spec/Intera_Harness_%E6%9E%B6%E6%9E%84%E6%A2%B3%E7%90%86.md), [`../spec/Intera_UI_UX_Design_System.md`](../spec/Intera_UI_UX_Design_System.md), [`../handoffs/MASTER_BUILD_HANDOFF.md`](../handoffs/MASTER_BUILD_HANDOFF.md), [`../handoffs/PLAYGROUND_TRUTH_AUDIT_2026-06-10.md`](../handoffs/PLAYGROUND_TRUTH_AUDIT_2026-06-10.md)

---

## 0. Thesis

Current `Pilot` is **not empty**, but it is also **not yet a commercially complete Pilot engine**.

Today it behaves as a typed draft copilot:

```text
read current draft context
  -> send one operator request to ConfigPilot
  -> get one typed proposal
  -> human reviews diff
  -> human accepts
  -> typed apply writes draft only
```

That is already useful, but it is still one layer below a truly commercial Pilot.

For commercial use, `Pilot` should become a **stateful delivery cockpit** for the implementation person. It should help them understand the current Agent, ask clarifying questions, stage precise changes, validate them against Scenario receipts, and hand the result to Release without ever owning publish/deploy authority or impersonating the customer runtime.

The target is not "build another `/api/messages` runtime inside Console."
The target is "build the best operator-facing configuration and validation loop for one real customer delivery."

---

## 1. Current Truth

### 1.1 What already exists

- `/build/pilot-lab` is the logged-in default and already has `Pilot` + `Playground`.
- `ConfigPilot` already has real backend endpoints:
  - `GET /api/admin/config-pilot/context`
  - `POST /api/admin/config-pilot/propose`
  - `POST /api/admin/config-pilot/apply`
- `propose` already calls a model and enforces typed output with zod validation and repair retries.
- `apply` already writes draft-only changes through typed backend services.
- `Pilot` already exposes diff review, explicit accept, and scenario-run controls.
- `Playground` already owns runtime truth and receipt evidence under `dryRun` side-effect mocking.

### 1.2 What is still missing

The commercial gap is not "missing a button." The missing part is the **operator workflow engine** around those APIs.

Current `Pilot` still lacks:

- durable multi-turn `Pilot` session state
- backend conversation history for the operator workflow
- clarification-first behavior when the request is ambiguous
- object-aware inspection beyond one large context snapshot
- proposal revision across turns
- structured "why this change / what to validate next" workflow memory
- first-class failed-receipt diagnosis loop
- release handoff summary and package-readiness summary
- collaboration affordances for another delivery person to resume the work
- a clear commercial proof model inside the Pilot flow itself

### 1.3 Direct consequence

Right now `Pilot` can help produce a patch.
It cannot yet behave like a trustworthy delivery partner for a real customer rollout.

That is the difference between:

- "useful internal config assistant"
- and "commercially usable Pilot cockpit"

---

## 2. Commercial Readiness Bar

`Pilot` is commercially ready only when a delivery person can do this end to end:

```text
import starter template
  -> ask Pilot what the current draft already supports
  -> ask for a targeted change in plain language
  -> get clarification if the request is underspecified
  -> review a minimal proposal and diff
  -> apply draft-only changes
  -> run runtime-backed Scenario validation
  -> ask Pilot to explain failure or risk
  -> iterate once or twice
  -> receive a release/package handoff summary
  -> move into Release for publish decision
```

If a delivery person still needs to leave `Pilot` and manually reconstruct state in their head after every step, the cockpit is not commercially ready yet.

---

## 3. Product Boundary

To keep the scope commercially sharp, `Pilot` should **not** become:

- a publish/deploy/rollback surface
- a shell/file/DB operator
- a second customer-facing agent runtime
- a generic multi-agent workflow platform
- a freeform marketplace builder
- a place that silently mutates live config without explicit human accept

The product boundary stays:

```text
Pilot owns draft authoring and guided validation.
Playground owns runtime truth.
Release owns version/package/publish truth.
```

That boundary is important. If `Pilot` becomes too powerful too early, it will become harder to trust, harder to explain, and harder to validate.

---

## 4. Proposal

### 4.1 Phase A - Pilot Session Engine

**Priority:** P0 required before first paid delivery
**Goal:** turn `Pilot` from stateless request-response into a resumable operator session

#### Deliver

- Introduce durable `PilotSession` state for each draft Agent version.
- Persist:
  - operator messages
  - Pilot replies
  - proposal references
  - accept/apply events
  - linked Scenario receipt ids
  - a short session summary for resume
- On reload, the operator should return to the same `Pilot` thread, not a blank assistant shell.
- Session state should be tied to `agentConfigId`, `orgId`, and actor identity.

#### Why this matters

Commercial delivery work is not one prompt. It is iterative and collaborative.
If the operator loses their reasoning trail every refresh, `Pilot` stays demo-grade.

#### Suggested backend shape

Add a small admin-side persistence model such as:

```text
PilotSession
  id
  orgId
  agentConfigId
  createdByUserId
  status
  title
  summary
  latestProposalId
  latestReceiptRunId
  createdAt
  updatedAt

PilotMessage
  id
  sessionId
  role (user | pilot | system)
  kind (message | clarification | proposal | accept | apply | receipt)
  content
  structuredPayload
  createdAt
```

This should be durable storage, not ephemeral UI state. Unlike customer runtime authority, operator cockpit history benefits from reliable persistence and team resumability.

#### Delivery proof checklist

- A delivery person can open `Pilot`, send two or more turns, refresh the page, and resume the same thread.
- A second staff member with access can open the same draft and understand the latest `Pilot` state.
- The right-side panel can reopen the latest proposal and linked receipts from session state.
- Screenshots: first turn, resumed thread, linked proposal, linked receipt.

---

### 4.2 Phase B - Guided Config Orchestration

**Priority:** P0 required
**Goal:** make `Pilot` behave like a guided configuration partner instead of a single-shot patch generator

#### Deliver

- Add clarification mode before proposal generation when the operator request is underspecified.
- Add backend-owned internal read tools for `Pilot`, such as:
  - inspect current Brain settings
  - inspect one Procedure or one Tool
  - inspect one Hook and its bindings
  - compare Draft vs Live version
  - inspect latest validation summary
  - inspect one receipt or failed expectation
- Let `Pilot` revise a proposal instead of forcing the operator to restart from zero.
- Keep the write path unchanged:

```text
clarify
  -> inspect
  -> propose
  -> diff
  -> human accept
  -> typed apply
```

#### Why this matters

A commercial operator rarely asks perfectly. Typical requests sound like:

- "Make withdrawals safer"
- "Use the deposit evidence flow from the last failed receipt"
- "Don't let the bot promise a refund here"

If `Pilot` cannot narrow those requests before patching, it will produce noisy or risky proposals and quickly lose operator trust.

#### Example target behavior

```text
Operator: Make the withdrawal flow stricter.
Pilot: Do you want me to tighten the Procedure, add a Hook at Stop, or update the final response wording?
Operator: Add a Stop Hook that blocks unsupported payout promises.
Pilot: I inspected the current withdrawal Procedure and the latest failed receipt. I drafted one Hook and one binding proposal.
```

#### Delivery proof checklist

- An ambiguous operator request triggers a clarification question instead of an immediate patch.
- After clarification, the proposal references the correct surface and objects.
- The operator can ask "revise this proposal to..." and get an updated diff instead of starting over.
- Screenshots: ambiguity -> clarification -> revised proposal -> diff.

---

### 4.3 Phase C - Validation-Native Pilot Loop

**Priority:** P0 required
**Goal:** make validation a first-class part of the `Pilot` conversation, not a side button

#### Deliver

- `Pilot` can trigger Scenario runs intentionally, not only through manual side-panel action.
- `Pilot` can explain:
  - fixture-only receipt
  - runtime-backed receipt
  - mocked side-effect boundary
  - why validation is stale after apply
- `Pilot` can read a failed receipt and propose the smallest next change.
- `Pilot` can recommend whether the right next step is:
  - another config change
  - a Playground manual test
  - Release review
  - human caution because evidence is still weak

#### Why this matters

Commercial readiness is not "the patch applied."
Commercial readiness is "the operator can prove the patch is good enough to move forward."

#### Example target behavior

```text
Operator: Run the deposit handoff Scenario against the current draft.
Pilot: Runtime-backed receipt failed. The Agent collected evidence correctly, but the Stop Hook did not escalate when provider status was ambiguous.
Pilot: I recommend one Hook update patch and then rerunning the same Scenario.
```

#### Delivery proof checklist

- A runtime-backed Scenario can be launched from the `Pilot` workflow.
- `Pilot` can summarize why it passed or failed in operator language.
- A receipt-linked follow-up proposal is generated from the failed run.
- The UI clearly distinguishes runtime-backed and fixture-only evidence.
- Screenshots: trigger run, failed receipt summary, proposed fix, rerun result.

---

### 4.4 Phase D - Release And Package Handoff

**Priority:** P0.5 / before first real customer publish
**Goal:** make `Pilot` good at finishing work, not only suggesting patches

#### Deliver

- Add a `Ready for Release review` summary generated by `Pilot`.
- Summary should include:
  - changed surfaces
  - latest relevant receipts
  - known risks
  - missing secrets/integrations
  - whether the draft appears package-export ready
- Add explicit handoff links into:
  - Release
  - relevant Component surface
  - related receipt
  - related Playground session if one exists

#### Why this matters

Commercial operators need closure.
The cockpit should help them move from "I made changes" to "I know what should happen next."

#### Delivery proof checklist

- After one or more applies, `Pilot` can generate a release handoff summary.
- The summary links to the exact draft version and latest receipts.
- The summary never publishes or activates by itself.
- Screenshots: handoff summary, linked Release view, linked receipt.

---

### 4.5 Phase E - Operator Hardening

**Priority:** P1 but should be designed now
**Goal:** make `Pilot` dependable under real internal use

#### Deliver

- expose proposal-validation errors and repair reasons in operator-friendly form
- model fallback or retry policy for malformed proposal output
- session audit trail for who accepted/applied what
- explicit "last changed since validation" and "receipt may be stale" messaging
- latency budget and timeout behavior that degrades clearly instead of hanging
- copy that makes `Pilot` feel trustworthy, not magical

#### Delivery proof checklist

- A malformed proposal does not silently fail; the operator gets a clear reason.
- Audit shows who accepted and who applied the draft.
- A stale receipt warning remains visible after further edits.
- Screenshots: repair-state UI, stale-state UI, audit event.

---

## 5. Recommended Technical Shape

### 5.1 Keep the write path typed

Do not weaken the current strongest part of the design.

`Pilot` should still write only through:

```text
proposal
  -> typed patches
  -> diff review
  -> explicit accept
  -> typed apply
  -> validation stale marker
```

The existing `context / propose / apply` contracts are a good nucleus.
The missing work is around sessioning, orchestration, and validation linkage.

### 5.2 Add a Pilot orchestration layer, not another customer agent runtime

The backend should own a `Pilot` capability surface rather than only a few hand-written inspect helpers.

At P0, the preferred source of truth for that capability surface is:

```text
everything the Console already exposes as a configurable, inspectable, or testable server-backed capability
```

That means `Pilot` should be able to dynamically call the same domain capabilities that already power configurable Console surfaces.

The first examples still look like this:

- `read_current_draft_summary`
- `inspect_surface_object`
- `compare_live_and_draft`
- `inspect_latest_receipt`
- `draft_config_proposal`
- `revise_config_proposal`
- `summarize_release_readiness`

But the long-term shape is broader:

- UI and `Pilot` should share the same server-owned capability layer
- `Pilot` should not depend on page automation, DOM scraping, or fake button-click simulation
- adding a new configurable Console surface should make it eligible for `Pilot` tool exposure through the same capability registry

These are operator-workflow and admin capability tools, not business Tools for `/api/messages`.

For the read-and-plan path, `Pilot` should intentionally borrow the **experience** of Claude Code-style exploratory loops:

- keep reading until the model no longer wants more allowed inspection context
- let the model traverse multiple related config surfaces in one turn
- let the model assemble one coherent batch proposal for one operator intent

But it should not borrow Claude Code-style authority over arbitrary mutation. The exploration loop may feel like `cc`; the mutation contract must still remain typed, explicit, and draft-only.

### 5.3 Reuse existing truth sources

Do not fork new truth stores when existing ones already define reality:

- draft/live/version truth -> Release + agent config/version services
- runtime truth -> Playground + `/api/admin/playground/*`
- receipt truth -> Scenario services
- typed config mutation truth -> current ConfigPilot apply path

`Pilot` should orchestrate these sources, not reimplement them.

---

## 6. Explicit Non-Go Zones

To keep this proposal commercially sharp, avoid these traps:

- Do not turn `Pilot` into a shell agent.
- Do not let `Pilot` publish, activate, deploy, or roll back.
- Do not make `Pilot` own Playground runtime behavior.
- Do not add a generalized no-code workflow builder in this phase.
- Do not hide proposal uncertainty; ask clarifying questions instead.
- Do not overload the first commercial slice with enterprise governance before the core delivery loop is solid.

---

## 7. Acceptance Goals

### Goal 1 - Stateful Pilot Session

`Pilot` conversation survives refresh and can be resumed by the same delivery person.

**Proof**

- same thread after reload
- latest proposal still visible
- latest linked receipt still visible

### Goal 2 - Clarification Before Patch

`Pilot` asks for clarification when the operator request is ambiguous.

**Proof**

- one ambiguous request
- one clarification question
- one corrected proposal after answer

### Goal 3 - Receipt-Driven Fix Loop

`Pilot` can use a failed runtime-backed receipt to recommend the next change.

**Proof**

- trigger runtime-backed Scenario
- show failed receipt summary
- generate one small follow-up proposal
- rerun receipt

### Goal 4 - Draft-Only Trust

`Pilot` never mutates Live and never publishes.

**Proof**

- apply changes appear only in Draft
- Release remains the only publish surface
- UI copy and audit trail make this obvious

### Goal 5 - Release Handoff

`Pilot` can summarize what changed, what was validated, and what still blocks release.

**Proof**

- release handoff summary
- linked draft version
- linked receipts
- missing secret/integration warning if relevant

---

## 8. Recommended Sequence

If the goal is "commercial Pilot, fast but truthful," the sequence should be:

1. `Phase A - Pilot Session Engine`
2. `Phase B - Guided Config Orchestration`
3. `Phase C - Validation-Native Pilot Loop`
4. `Phase D - Release And Package Handoff`
5. `Phase E - Operator Hardening`

This keeps us on the smallest viable path from:

```text
typed patch assistant
  -> delivery cockpit
```

without reopening the whole platform.

---

## 9. Bottom Line

Intera does not need `Pilot` to become a second general-purpose agent runtime.

It needs `Pilot` to become the **best possible delivery-facing draft and validation cockpit** for one real customer rollout.

That means:

- persistent operator sessions
- clarification before mutation
- receipt-native iteration
- crisp draft/live boundaries
- strong handoff into Release

Current `ConfigPilot` is a solid foundation.
Commercial `Pilot` begins when we wrap that foundation in durable operator workflow, not when we add more raw model cleverness.

---

## 10. Approved Decisions So Far

The following rules are already approved and should now be treated as implementation constraints, not open design questions.

### 10.1 Model policy

- All Console-internal, non-visualized, non-customer-runtime LLM calls should use one shared internal default model.
- That internal default should be `deepseek-v4-flash`.
- `Pilot`, `LLM Hook` evaluation, internal clarification/repair, and future internal Console-only LLM flows should use the same resolver.
- These internal flows must not inherit the selected customer Agent model.
- Customer runtime `/api/messages` model selection remains separate.
- User-configurable model fields in Brain or other product surfaces remain separate.
- P0 should allow one shared emergency override such as `CONSOLE_INTERNAL_MODEL`.
- P0 should not keep one env override per subsystem such as separate `CONFIG_PILOT_MODEL`-style escapes.

### 10.2 Pilot session and persistence

- Multi-turn `Pilot` persistence is P0 required.
- Persistence should use formal durable storage such as Prisma/Postgres-backed tables, not local JSON files or `.intera-agent-runtime`.
- `Pilot` should use one canonical active session per writable draft version.
- Historical sessions may exist, but only one session is the active canonical thread for the current draft.
- Entering `Pilot` should return the operator to the canonical session by default.

### 10.3 Permissions

- `owner` and `admin` may view, ask, propose, accept, and apply.
- `owner` and `admin` also own all state-mutating `Pilot` actions in P0, including plan changes, handoff generation, session takeover, and manual compact.
- `operator` may view the session, diffs, receipts, and handoff state, but cannot propose or apply in P0.
- `operator` remains strict read-only in P0 for all actions that mutate:
  - `PilotSession`
  - `PilotProposal`
  - `PilotTodoPlan`
  - `PilotTodoItem`
  - `PilotHandoff`
  - `Pilot` memory state
- `viewer` should have no `Pilot` access in P0, or only read-only access with no composer.

### 10.4 Draft authority and stale protection

- `Pilot` remains draft-only.
- Human-language messages such as "apply it" must not write config directly.
- True writes must still come only from explicit UI controls.
- P0 keeps the two-step control:
  - `accept proposal`
  - `apply accepted draft`
- Every proposal should carry a `baseDraftFingerprint`.
- `apply` must fail if the current draft fingerprint no longer matches the proposal base.
- Revisions create new proposal records rather than mutating prior ones.

### 10.5 Validation policy

- Every successful `apply` immediately marks validation stale.
- Only receipts generated after the relevant `apply` may restore validation.
- `Pilot` must distinguish:
  - `Not validated`
  - `Validated but fixture-only`
  - `Runtime-backed validated`
- `Pilot` may not claim `ready for release` unless a new runtime-backed passing receipt exists after the last `apply`.
- Fixture-only evidence is useful debugging proof, but not release-readiness proof.

### 10.6 Scenario scope

- `Pilot` may create or update named persisted `Scenario` records.
- `Pilot` may not secretly create ephemeral hidden scenarios for self-use.
- Any validation run must bind to a named, visible, durable `Scenario`.
- If validation coverage is missing, `Pilot` should first propose a `Scenario` asset, then wait for accept/apply, then run it.

### 10.7 Playground and Release boundary

- `Pilot` may trigger `Scenario` runs, but only explicitly and transparently.
- `Pilot` must state whether a run is `fixture-only` or `runtime-backed`.
- `runtime-backed` still means real runtime path under `dryRun` boundaries with mocked side effects.
- `Pilot` must not auto-run validation secretly after `apply`.
- `Pilot` may recommend manual multi-turn testing in `Playground`, but may not merge manual Playground testing and Scenario receipts into one evidence bucket.
- `Release` remains the only publish surface.

### 10.8 Collaboration model

- A `PilotSession` is shared and visible to authorized staff.
- Only one user is the active editor at a time.
- Another authorized user may explicitly `Take over session`.
- Takeover is recorded in the session timeline and audit trail.
- This is a collaboration control, not a hidden lock.
- `take_over_session` should require a short explicit reason in P0.
- That reason should be recorded both in the visible timeline and in `AuditLog`.

### 10.9 Pilot memory boundary

- `Pilot` must have its own `PilotSessionMemory`.
- It must stay fully independent from customer-facing `Intera Agent` memory.
- It must not reuse customer `ChatMemory`.
- It must not reuse customer `UserProfile`.
- It must not become configuration truth, validation truth, or publish truth.

### 10.10 Pilot memory shape

- `PilotSessionMemory` should use three layers:
  - `L0 pinned artifacts`
  - `L1 recent raw turns`
  - `L2 compact session summary`
- `L0 pinned artifacts` are never dropped.
- `L0 pinned artifacts` should not live only inside the summary.
- `PilotSession` should keep explicit top-level pointers for the most important anchors, such as:
  - `currentTodoPlanId`
  - `currentActiveTodoItemId`
  - `latestProposalId`
  - `latestReceiptRunId`
  - `latestHandoffId`
- A small `pinnedState` JSON may hold the remaining non-primary pinned continuity data.
- `PilotSession.summary` should be a structured JSON summary rather than only a long free-form Markdown block.
- That structured summary should at minimum support:
  - `confirmedGoals`
  - `openQuestions`
  - `currentPlanSummary`
  - `latestProposalSummary`
  - `latestValidationSummary`
  - `nextRecommendedStep`
- Compact is for operator workflow continuity, not for storing config truth.
- Compact failures move the session into `memory_degraded`.
- When degraded, the UI should expose a `Manual compact` action.
- Forced compact runs should be operator-triggered, not silently background-triggered.
- `memory_degraded` is a hard gate for deeper propose/revise work once the system can no longer safely extend the thread.
- A successful `manual_compact` should:
  - update the session summary
  - clear `memory_degraded`
  - append a visible `compact` timeline message
- `manual_compact` should not reset the session, current plan, current item, proposal chain, or handoff history.
- A failed `manual_compact` keeps the session in `memory_degraded`.
- `manual_compact` should be a zero-business-parameter action in P0.
- It should not accept free-form summary-edit text or custom compact prompts from the operator.
- It should operate only on the target session and rebuild summary state from the current raw turns, pinned artifacts, and linked truth objects.

### 10.11 Durability policy

- `Pilot` session writes, proposal links, receipt links, and memory compaction results must use awaited durable persistence.
- `Pilot` must not use fire-and-forget persistence for session-critical state.
- If persistence or compaction fails, the failure should surface clearly in session state and UI rather than pretending the thread is safely resumable.

### 10.12 Proposal history

- Proposals and revisions form an immutable append-only chain.
- Old proposals remain viewable even when stale, rejected, or superseded.
- UI may default to the latest writable proposal, but the history must remain inspectable and auditable.
- `PilotProposal.status` should stay minimal in P0:
  - `drafted`
  - `accepted`
  - `applied`
  - `rejected`
  - `stale`
  - `superseded`
- `accept_proposal` must be a durable backend action, not only a frontend checkbox state.
- Acceptance should record at least:
  - `acceptedByUserId`
  - `acceptedAt`
- `apply_proposal` may run only against a proposal that is still in `accepted`.
- `apply_proposal` should be a one-time consume action.
- One proposal may succeed at `apply` only once.
- After success, repeat requests should return a stable already-applied result instead of mutating draft again.
- `revise_proposal` should always create a new child proposal.
- Revising an older proposal should immediately make the old one `superseded`.
- Acceptance does not carry forward across revisions; the new proposal must be reviewed and accepted again.
- Every `PilotProposal` must belong to exactly one `PilotSession`.
- `todoItemId` may be null only when the session is still operating without a current `TodoPlan`.
- Once a current `TodoPlan` exists, every new proposal must attach to the current active item.
- One proposal must not belong to multiple todo items.
- If a proposal later becomes `stale`, `superseded`, or `rejected`, prior acceptance no longer keeps it writable.
- Each proposal may contain multiple typed patches only when they serve one single clear operator intent.
- P0 should reject broad shotgun proposals that span unrelated surfaces in one step.
- Allowed multi-surface combinations should stay narrow and strongly related, such as:
  - `Hook` + `HookBinding`
  - `Procedure` + related `Scenario`
  - `Tool` + related `Scenario`
- Every proposal should still declare one `primary surface`.

### 10.13 Draft rebinding

- `PilotSession` should ultimately bind to the current writable draft version.
- If the session starts while the operator is viewing a live version, they may still inspect and draft a proposal.
- Once the first `apply` forks a draft from live, the session must rebind to the new `draftAgentConfigId`.
- The session timeline must record that fork/rebind event explicitly.

### 10.14 Handoff artifacts

- `Ready for Release review` must create a durable `PilotHandoff` artifact, not just a transient chat answer.
- A handoff artifact should at minimum record:
  - `sessionId`
  - `draftAgentConfigId`
  - `draftFingerprint`
  - referenced proposal ids
  - referenced receipt ids
  - handoff summary
  - readiness verdict
  - created time
  - created by
- `PilotHandoff` should keep both:
  - a human-readable `handoffSummary`
  - structured `blockers` and `risks`
- Older handoff artifacts remain viewable even after a newer one becomes current.
- `generate_handoff` may be used before the session is truly ready.
- When used early, it should still create a durable artifact, but with `readinessVerdict = not_ready`.
- `PilotHandoff` should be a snapshot artifact.
- Once written, its recorded draft fingerprint, proposal coverage, receipt coverage, blockers, risks, and verdict do not mutate in place.
- Later changes may make that handoff outdated, but they should not rewrite the old artifact.
- `PilotHandoff` should use an explicit `isCurrent` flag in P0.
- For one session, at most one handoff may have `isCurrent = true`.
- If later proposal or draft activity invalidates the current handoff, it should lose `isCurrent` immediately, even before a replacement handoff is generated.
- After a handoff is generated, the session enters `handoff_ready`.
- If later changes happen, the current handoff becomes `outdated` and the session returns to `in_progress`.
- `PilotHandoff.readinessVerdict` should stay minimal in P0:
  - `not_ready`
  - `ready_for_release_review`
- Reasons should live in structured `blockers` and `risks`, not in an oversized verdict enum.
- `blockers` entries should at minimum support:
  - `code`
  - `message`
  - optional `linkedObjectRef`
- `risks` entries should at minimum support:
  - `code`
  - `message`
  - `severity`
  - optional `linkedObjectRef`
- P0 should standardize these lightweight cross-object references as structured `ObjectRef` objects rather than stringly typed `"proposal:123"` values.
- `ObjectRef` should at minimum support:
  - `type`
  - `id`
  - optional `label`
- Allowed `ObjectRef.type` values in P0 should stay small:
  - `session`
  - `proposal`
  - `todo_item`
  - `handoff`
  - `receipt`
  - `scenario`
  - `agent_config`
- `PilotHandoff` is primarily a session-and-draft artifact, not a private artifact of one todo item.
- If a current `TodoPlan` exists, the handoff should record which todo items it covers.
- A `ready_for_release_review` handoff should not be generated while a required todo item is still `active`.
- A `ready_for_release_review` handoff should not ignore unresolved required `blocked` items.
- At handoff time, remaining current-plan items should be either:
  - `completed`
  - `skipped` with visible reason
- Only non-required items may remain incomplete without blocking a ready handoff.

### 10.15 Multi-intent handling

- Multi-intent operator input should not be forced into one oversized proposal.
- If the intents can be cleanly separated, `Pilot` should create an explicit visible `TodoPlan`.
- `PilotTodoPlan` itself should stay lightweight in P0.
- P0 should not add a large `PilotTodoPlan.status` enum.
- Plan-level "current or historical" state should be expressed primarily through `isCurrent`.
- Fine-grained progress should live on `PilotTodoItem`, not on the plan header.
- Each `TodoPlan` item must represent one single operator intent.
- Each `PilotTodoItem` should carry `isRequired: boolean`.
- `PilotTodoItem.type` should stay minimal in P0:
  - `inspection`
  - `config_change`
  - `scenario_authoring`
  - `validation_run`
  - `release_handoff`
- `PilotTodoItem` should keep explicit primary artifact references where relevant:
  - `latestProposalId`
  - `latestReceiptRunId`
  - `latestHandoffId`
  - `targetScenarioName`
- A small `metadata` JSON may exist for supporting detail, but primary truth should not live only in free-form JSON.
- Only one `TodoPlan` item may be active at a time in P0.
- P0 item statuses should stay minimal:
  - `pending`
  - `active`
  - `blocked`
  - `completed`
  - `skipped`
- Each item still follows the normal hard path:
  - clarify if needed
  - proposal
  - accept
  - apply
  - validation
- `Pilot` must not silently execute an entire multi-item plan without explicit step-by-step operator visibility.
- If one item is still ambiguous, `Pilot` should clarify that item specifically rather than collapsing the entire plan back into one large clarification.
- `blocked` must always carry a visible reason such as:
  - `needs_clarification`
  - `waiting_for_manual_compact`
  - `waiting_for_validation`
- `skipped` must always carry a visible reason.
- `completed` means that one item reached its own delivery bar, not that the whole session is done.
- A `PilotSession` may have historical `TodoPlan` records, but only one current `TodoPlan` in P0.
- If a new multi-intent request arrives while a current plan exists, it should be appended only when the operator is clearly continuing the same plan.
- If the operator wants a separate plan, the current one should be historical first, then a new one becomes current.

### 10.16 Minimal persistence set

- P0 should use a small explicit persistence model rather than one giant catch-all JSON blob.
- The approved minimum table set is:
  - `PilotSession`
  - `PilotMessage`
  - `PilotProposal`
  - `PilotTodoPlan`
  - `PilotTodoItem`
  - `PilotHandoff`
- Guided elicitation and build-planning expand that minimum set with:
  - `AgentBuildBrief`
  - `TemplateRecommendation`
  - `TemplateTailoringPlan`
  - `ScratchBuildPlan`
- P0 should keep these as explicit independent tables or models.
- P0 should not collapse them into one polymorphic `Artifact` catch-all table with type-switched JSON payloads.
- P0 should not introduce a parallel `BuildSession` table.
- P0 should not add a separate `PilotSessionMemory` table.
- Session summary, compact state, manual compact state, and `memory_degraded` state should live on `PilotSession`.
- `PilotSession.status` should stay minimal:
  - `in_progress`
  - `handoff_ready`
  - `archived`
- `memory_degraded` should be a separate health field, not a session status.
- `blocked` should be expressed by the active `TodoPlanItem`, not by the session status.
- Receipt truth remains in existing `Scenario` and receipt storage.
- Publish truth remains in `Release`.
- P0 should not add a separate `PilotEvent` table.
- Readable session timeline events should live in `PilotMessage`.
- Immutable business truth should still live in dedicated tables such as `PilotProposal`, `PilotTodoPlan`, `PilotTodoItem`, and `PilotHandoff`.
- Low-level mutation audit should continue to rely on existing `AuditLog`.
- `PilotMessage` should use a dual-track shape:
  - `content` for operator-readable text
  - `structuredPayload` for durable event metadata and object references
- `PilotMessage.role` should stay minimal:
  - `user`
  - `pilot`
  - `system`
- `PilotMessage.kind` should at least cover:
  - `message`
  - `clarification`
  - `proposal`
  - `accept`
  - `apply`
  - `receipt`
  - `takeover`
  - `compact`
  - `handoff`

### 10.17 Canonical session uniqueness

- For one writable draft version, there should be exactly one canonical current `PilotSession`.
- For one Agent family in `pre_build_family` scope, there should also be exactly one canonical current `PilotSession`.
- Historical sessions may exist only after they are archived and no longer current.
- `Take over` should not create a second session.
- Ordinary work should always continue in the same canonical current session unless an operator explicitly archives it and starts a new one.
- P0 should model this explicitly with `PilotSession.isCurrent`.
- Database-level uniqueness should enforce that, for the same `orgId + agentConfigId`, at most one row has `isCurrent = true`.
- Database-level uniqueness should also enforce that, for the same `orgId + agentFamilyId + bindingScope = pre_build_family`, at most one row has `isCurrent = true`.
- This should use a partial unique index in migration SQL rather than relying only on application logic.
- Entering the first draft-bound build should rebind the same current session rather than leaving a second `pre_build_family` current row behind.
- `archive_session` should be a true historicalization action in P0.
- After archive:
  - `isCurrent = false`
  - `status = archived`
- Archived sessions remain readable but should not be directly reopened for fresh mutation work.
- Continuing the work later should happen through a new current session that may reference the archived one as history.

### 10.18 P0 API action set

- `Pilot` P0 should expose a small explicit action set rather than a giant generic action RPC.
- Session actions:
  - `get_or_create_current_session`
  - `take_over_session`
  - `archive_session`
- Plan actions:
  - `create_plan`
  - `append_plan_items`
  - `activate_plan_item`
  - `skip_plan_item`
- Proposal actions:
  - `propose`
  - `revise_proposal`
  - `accept_proposal`
  - `apply_proposal`
- Validation, handoff, and memory actions:
  - `link_or_run_scenario`
  - `generate_handoff`
  - `manual_compact`
- Route shape should follow the existing Console admin style:
  - resource routes
  - explicit action subroutes such as `/propose`, `/apply`, `/run`, `/activate`
- P0 should avoid a generic `/api/admin/pilot/actions` catch-all endpoint.

### 10.19 Pilot engine shape

- `Pilot engine` should be a bounded orchestration engine.
- It should not reuse the customer-facing `/api/messages` full runtime loop as its authority model.
- It should not adopt a generic autonomous coding-agent or open-source "cc replacement" engine as its authority model.
- For reading and planning, `Pilot` should intentionally provide a Claude Code-style exploratory experience.
- Inside one turn, `Pilot` may run an extended `inspect -> reason -> inspect again -> choose next action` exploratory loop as an implementation detail.
- That limited internal reasoning must still terminate in explicit business actions such as:
  - `clarify`
  - `inspect`
  - `propose`
  - `revise_proposal`
  - `accept_proposal`
  - `apply_proposal`
  - `link_or_run_scenario`
  - `generate_handoff`
  - `manual_compact`
- No open-ended exploratory loop should gain authority to mutate draft, validation, or release state outside those named actions.

### 10.20 Controller topology

- P0 should use one server-owned `PilotController`.
- P0 should not introduce a multi-agent planner/executor/supervisor topology.
- Inside one operator turn, the controller may perform extended read-only exploratory inspection work.
- But one turn should end in one primary result only, such as:
  - one clarification question
  - one visible `TodoPlan` draft
  - one proposal or proposal revision
  - one validation summary plus one recommended next step
  - one handoff summary
- A single turn should not silently chain multiple write-class mutations such as revising, accepting, applying, and validating in one hidden flow.
- `Pilot` should behave like a stateful delivery controller, not a small swarm of autonomous agents.

### 10.21 Decision authority

- `PilotController` should be deterministic-first and model-second.
- Before any model call, the controller should deterministically decide which action class is currently legal.
- That deterministic gate should check at least:
  - permission level
  - whether the session is `memory_degraded`
  - whether there is a current active todo item
  - whether the relevant proposal is stale
  - whether clarification is required first
  - whether the session is currently limited to validation follow-up or handoff invalidation handling
- Only after that gate passes should the model be invoked for the allowed language task.
- The model may generate or explain within the allowed action class, but it should not choose hidden state transitions outside controller rules.
- The model should not be the authority for deciding to accept, apply, publish, or bypass validation.

### 10.22 Exploratory loop budget

- `Pilot` should support a Claude Code-style exploratory read loop for understanding the current Agent.
- That exploratory loop may use a comparatively high read budget, with a default hard cap of `100` iterations.
- The loop may continue while the model keeps requesting allowlisted read or inspect tools.
- The exploratory loop must stop as soon as the model no longer expresses a valid read-tool intent.
- The exploratory loop must also stop early if the controller detects:
  - permission mismatch
  - `memory_degraded`
  - stale or invalid session state that requires user-visible recovery first
  - a request for non-allowlisted or write-class tool access
- Even after a long exploratory loop, the turn must still terminate in one explicit operator-facing result:
  - clarification
  - visible `TodoPlan`
  - proposal or revision
  - validation summary with next step
  - handoff summary
- The exploratory loop may enable batch changes, but only by producing one reviewable proposal chain for one operator intent.

### 10.23 Capability surface

- `Pilot` should be able to dynamically call all server-backed capabilities that the Console already exposes as configurable, inspectable, or testable surfaces.
- The preferred abstraction is a shared server-owned capability layer, not page-level UI automation.
- The UI and `Pilot` should be two clients of the same capability surface:
  - the UI uses it for rendering, editing, and testing
  - `Pilot` uses it for inspection, comparison, planning, proposal drafting, and validation follow-up
- `Pilot` should not rely on DOM scraping, browser simulation, or fake form submission against Console pages.
- When a new Console surface becomes properly configurable through the backend, it should become eligible for `Pilot` discovery and dynamic use through the same registry.
- Capability exposure may still differentiate:
  - read/inspect/test capabilities
  - write/draft/apply capabilities
- Dynamic discoverability should increase `Pilot` coverage, but it must not weaken the existing typed write path.

### 10.24 Capability registry

- `Pilot` capability discovery should be backed by a manifest-tagged server registry.
- Each registered capability should declare at least:
  - `capabilityKey`
  - `surface`
  - `mode` such as `read`, `test`, or `write`
  - `llmVisible` such as `full`, `redacted`, or `metadata_only`
  - `requiresDraft`
  - `requiresExplicitAccept`
  - `callableByPilot`
- The exploratory loop should automatically use only capabilities whose registry metadata allows safe read or test usage.
- `write` capabilities may still exist in the registry, but they should not become free mutation powers for the loop.
- Registry metadata should be strong enough that a coding agent can decide, without guesswork:
  - whether the UI may call it
  - whether `Pilot` may call it
  - whether it is safe for exploratory looping
  - how much of its output may be surfaced to the model
  - whether it ultimately requires typed proposal and explicit apply
- Adding a new Console capability should include adding or updating its registry manifest as part of the same lane.

### 10.25 Tool granularity

- `Pilot` should not expose one giant generic dispatcher such as `call_capability(capabilityKey, payload)` as its main model-facing tool.
- Instead, `Pilot` should expose a small number of named capability families whose semantics remain legible to operators and coding agents.
- Example families include:
  - `inspect_config_surface`
  - `inspect_config_object`
  - `compare_config_versions`
  - `inspect_validation_artifact`
  - `draft_batch_proposal`
  - `revise_batch_proposal`
  - `run_named_scenario`
  - `generate_release_handoff`
- Registry metadata should still drive discoverability, object lookup, and allowed targets under those families.
- This keeps the experience dynamic without turning the model-facing API into a black-box RPC surface.

### 10.26 Batch proposal shape

- `Pilot` should support batch proposals for one clear operator intent.
- A batch proposal should not be one flat undifferentiated patch pile.
- It should be structured as an intent-scoped change set.
- The proposal should declare at top level:
  - `intentSummary`
  - `batchRationale`
  - `blastRadius`
  - `validationPlan`
- Inside the proposal, changes should be organized into explicit `changeGroups`.
- Each `changeGroup` should at minimum declare:
  - `groupKey`
  - `whyIncluded`
  - `targetSurface`
  - `targetObjects`
  - `expectedEffect`
- Typed patches still remain the mutation primitive, but they should be grouped under those explicit change groups rather than presented as one opaque flat list.
- If a batch proposal cannot explain why all included objects belong to one operator intent, it is too broad for P0.

### 10.27 Proposal-bound validation plan

- Every batch proposal should carry a structured `validationPlan`.
- `validationPlan` should not be a loose prose suggestion only.
- It should at minimum declare:
  - `requiredScenarios`
  - `recommendedScenarios`
  - `manualPlaygroundChecks`
  - `releaseBlockingCondition`
- Every `requiredScenario` should resolve to:
  - an existing named durable `Scenario`, or
  - a named `Scenario` that the same proposal creates or updates
- The validation plan should make clear:
  - which Scenarios are minimally required before the batch can be considered validated
  - which checks are recommended but non-blocking
  - which manual Playground checks still matter
  - what evidence threshold is required before `ready_for_release_review`
- Receipt linkage, handoff generation, and later self-audit should all be able to trace back to this proposal-bound validation plan.

### 10.28 Batch apply semantics

- A batch proposal may be reviewed by explicit change group, but P0 accept/apply semantics should remain whole-proposal.
- `accept_proposal` should accept the entire proposal, not a selected subset of change groups.
- `apply_proposal` should apply the entire accepted proposal, not a partial subset.
- If the operator wants to drop or split some groups, the correct path is:
  - `revise_proposal`
  - produce a narrower replacement proposal
  - accept and apply that new proposal
- P0 should not support partial batch apply.
- This keeps proposal coverage, receipt coverage, handoff coverage, and audit history unambiguous.

### 10.29 Exploratory stop condition

- The exploratory loop should stop when evidence is sufficient for the current legal action.
- It should not keep inspecting only because more reading might still be possible.
- Sufficiency should be evaluated relative to the current allowed action class.
- For `clarification`, sufficient evidence means:
  - the request ambiguity is understood
  - the next clarifying question is concrete and decision-relevant
- For `proposal` or `revision`, sufficient evidence means:
  - the primary intent is understood
  - target objects are identified well enough
  - blast radius is estimable
  - validation plan can be attached
- For `validation summary`, sufficient evidence means:
  - the relevant receipt, Scenario, and stale state are known
- For `handoff`, sufficient evidence means:
  - current draft identity is known
  - proposal coverage is known
  - receipt coverage is known
  - blockers and risks can be stated truthfully
- This stop condition is in addition to hard loop ceilings such as iteration caps.

### 10.30 Inspection trace

- Every exploratory turn should leave a structured inspection trace.
- The trace should at minimum record:
  - which tool family was invoked
  - which capability or object was targeted
  - which visibility level was returned, such as `full`, `redacted`, or `metadata_only`
  - which step caused the controller to judge that evidence was now sufficient
- The trace does not need to be expanded by default in the main chat view.
- But it should be preserved well enough that authorized users, debugging flows, and coding-agent self-audit can reopen it later.
- The trace should support explaining:
  - why a clarification question was asked
  - why a proposal targeted these objects
  - why a receipt failure summary concluded what it did
  - why the controller stopped reading and returned a result
- A strong Claude Code-style exploratory experience without replayable inspection trace is not commercially trustworthy enough for P0.

### 10.31 Guided elicitation mode

- `Pilot` should support a first-class guided elicitation mode for building or reshaping an Agent with the operator step by step.
- This mode is broader than ordinary clarification for one patch request.
- Its job is to actively gather:
  - business goals
  - target channels
  - supported scenarios
  - escalation policy
  - tool and integration needs
  - tone and response constraints
  - validation expectations
- The user experience may intentionally resemble calling structured "skills" such as `brainstorm` or `grill-me` style guided questioning.
- In implementation terms, this should become a server-owned `Pilot` conversation strategy or prompt-pack family, not an uncontrolled external autonomy surface.
- Guided elicitation should produce durable artifacts as it progresses, such as:
  - confirmed goals in session memory
  - visible open questions
  - draft `TodoPlan` items
  - draft capability recommendations
  - a first proposal-ready configuration scope
- `Pilot` should be able to stay proactive in this mode by asking the next most decision-relevant question rather than waiting passively for perfectly formed requirements.
- This mode should be available both:
  - when starting from a template and tailoring it
  - when building a new Agent definition from a sparse brief
- Guided elicitation still must not bypass the existing draft, proposal, apply, validation, and handoff boundaries.

### 10.32 Explicit operating modes

- `Pilot` should expose a small set of explicit user-visible operating modes.
- Example P0 modes include:
  - `Build From Brief`
  - `Template Tailoring`
  - `Critique Existing Agent`
  - `Validation Triage`
  - `Release Review`
- The controller may recommend switching modes, but it should not silently hide the current mode from the operator.
- Mode should mainly influence:
  - questioning style
  - priority dimensions of information gathering
  - completion criteria for the current turn or plan
- Mode should not weaken the core hard boundaries around:
  - draft authority
  - proposal and apply flow
  - validation truth
  - handoff truth
- A user should be able to tell whether `Pilot` is currently trying to co-build, critique, validate, or prepare release review.

### 10.33 AgentBuildBrief artifact

- Guided elicitation should progressively produce a structured `AgentBuildBrief` artifact.
- `AgentBuildBrief` is not the final configuration truth.
- It is the durable bridge between requirement discovery and configuration proposal work.
- `AgentBuildBrief` should be a first-class independent persistent artifact, not just a field inside `PilotSession.summary` or `pinnedState`.
- `AgentBuildBrief` should primarily bind to the Agent family or project-level build effort, not to one single `PilotSession`.
- At minimum, it should capture:
  - `businessGoal`
  - `targetChannels`
  - `supportedUseCases`
  - `outOfScopeUseCases`
  - `escalationPolicy`
  - `requiredToolsAndIntegrations`
  - `toneAndResponseConstraints`
  - `validationExpectations`
  - `openQuestions`
- The brief should evolve as guided elicitation progresses rather than being regenerated from scratch each turn.
- `PilotSessionMemory` may summarize the brief, but the brief itself should be a first-class durable artifact rather than only a chat-derived memory blob.
- `AgentBuildBrief` should have its own revision or history trail in P0, even if that history is lightweight.
- One Agent family should have one current brief in P0 while older brief revisions remain inspectable.
- `AgentBuildBrief` should use explicit `isCurrent` semantics rather than relying only on latest timestamp wins.
- When a newer brief revision replaces the current one, the older brief should record explicit supersession metadata such as `supersededAt` and optional `supersededById`.
- Database-level uniqueness should enforce that, for the same `agentFamilyId`, at most one brief row has `isCurrent = true`.
- `PilotSession` should point to the current brief it is editing, but the brief should outlive any one session.
- `AgentBuildBrief` should act as the formal bridge into:
  - template recommendation
  - template tailoring
  - proposal-ready scope formation
  - initial validation planning
- A resumed operator or coding agent should be able to understand what kind of Agent is being built from the current brief without replaying the whole conversation.

### 10.34 Brief confirmation gate

- Guided elicitation may update the current `AgentBuildBrief` across multiple turns.
- But before `Pilot` moves into:
  - template recommendation
  - template tailoring
  - initial build proposal generation
  - build-oriented `TodoPlan` generation
  there should be an explicit `Confirm brief` gate.
- `Confirm brief` marks one current brief revision as the active baseline for the next build phase.
- After confirmation, `Pilot` may use that confirmed brief revision to recommend templates, generate starter build proposals, and shape the first build plan.
- `Confirm brief` does not require every `openQuestion` to be resolved.
- But before template recommendation begins, the brief must be recommendation-safe.
- Recommendation-safe means at least these dimensions are already confirmed well enough:
  - `businessGoal`
  - `targetChannels`
  - `supportedUseCases`
  - `outOfScopeUseCases`
  - `escalationPolicy`
- Remaining `openQuestions` may continue to exist only if they do not materially change template selection.
- If unresolved questions could still alter the recommended template direction, `Pilot` should continue elicitation rather than recommending templates prematurely.
- If requirements later change materially, `Pilot` should create a newer brief revision rather than silently overwriting the confirmed baseline.
- If the new revision changes build-critical scope, `Pilot` should require reconfirmation before treating that new brief as the active build baseline.
- This gate is meant to stop the build basis from drifting invisibly while configuration work is already underway.

### 10.35 Template-first build entry

- After a brief is confirmed, `Pilot` should default to `template-first, scratch-second`.
- The default build path should be:
  - `Confirm brief`
  - `Recommend templates`
  - `Explain fit and mismatch`
  - `Choose template or choose scratch`
  - `Tailor or build`
- `Pilot` should attempt to recommend the closest existing starter or template before proposing a true from-scratch build.
- Only when:
  - no existing template is a strong enough fit, or
  - the operator explicitly asks to build from scratch
  should `Pilot` move into scratch-first generation.
- This keeps `Pilot` aligned with commercial delivery efficiency and reuse of existing industry assets.
- A from-scratch path is still valid, but it should be an intentional branch rather than the silent default.

### 10.36 TemplateRecommendation artifact

- Every template recommendation step should produce a durable `TemplateRecommendation` artifact.
- It should not exist only as one transient chat answer.
- For one confirmed brief revision, there should be at most one current `TemplateRecommendation` in P0 while older recommendation attempts remain inspectable as history.
- `TemplateRecommendation` should use explicit `isCurrent` semantics rather than relying only on latest timestamp wins.
- When a newer recommendation replaces the current one for the same confirmed brief revision, the older artifact should record explicit supersession metadata such as `supersededAt` and optional `supersededById`.
- Database-level uniqueness should enforce that, for the same `briefRevisionId`, at most one recommendation row has `isCurrent = true`.
- At minimum, the artifact should record:
  - `briefRevisionId`
  - `candidateTemplates`
  - `recommendedTemplateId`
  - `fitSummary`
  - `mismatchSummary`
  - `whyNotScratch`
  - `whyScratch` when no template is recommended
- The artifact should make it possible to understand:
  - which templates were considered
  - why one template was recommended first
  - why other candidates were weaker
  - why scratch build was or was not justified
- Operator choice after recommendation should reference this artifact rather than relying only on free-form chat memory.
- Later self-audit, handoff, and build provenance should be able to point back to the exact recommendation artifact used at build entry.

### 10.37 TemplateTailoringPlan artifact

- When the operator chooses a template path, `Pilot` should first produce a durable `TemplateTailoringPlan` artifact before large-scale proposal/apply work begins.
- The tailoring plan should not be replaced by ad hoc chat reasoning.
- For one selected template + brief revision path, there should be at most one current `TemplateTailoringPlan` in P0 while older tailoring-plan revisions remain inspectable as history.
- `TemplateTailoringPlan` should use explicit `isCurrent` semantics rather than relying only on latest timestamp wins.
- When a newer tailoring plan replaces the current one for the same template path, the older artifact should record explicit supersession metadata such as `supersededAt` and optional `supersededById`.
- Database-level uniqueness should enforce that, for the same `selectedTemplateId + briefRevisionId` path, at most one tailoring-plan row has `isCurrent = true`.
- At minimum, it should record:
  - `selectedTemplateId`
  - `briefRevisionId`
  - `fitAreas`
  - `mismatchAreas`
  - `requiredTailoringGroups`
  - `recommendedTailoringGroups`
  - `firstValidationTargets`
- The tailoring plan should explain:
  - which parts of the selected template already fit the confirmed brief
  - which parts must be changed immediately
  - which changes are recommended but not strictly required for the first usable slice
  - which validation targets should be exercised first after tailoring
- After the operator completes explicit build entry on the template path, `requiredTailoringGroups` may directly expand into the first build `TodoPlan` items and first batch proposal drafts.
- `recommendedTailoringGroups` should not automatically enter the current active build plan by default.
- They should remain visible as suggestions on the tailoring plan until an explicit follow-up action promotes them into plan scope.
- After `promote to plan`, those promoted items should still default to `isRequired = false`.
- Promotion alone means they entered executable plan scope, not that they automatically became release-blocking required work.
- They should become `isRequired = true` only when:
  - the operator explicitly marks them required, or
  - later validation, critique, or release evidence shows they have become blocking work
- P0 should not add an extra global `Confirm tailoring plan` gate between build entry and those first proposal-ready artifacts.
- The tailoring plan authorizes planning and proposal generation, not direct mutation.
- Every actual configuration change still must pass through explicit proposal review, `accept_proposal`, and `apply_proposal`.
- Batch proposals, build `TodoPlan` items, and first validation planning should grow out of this tailoring plan rather than skipping directly from template selection to opaque config mutation.

### 10.38 ScratchBuildPlan artifact

- When the operator chooses a scratch path, `Pilot` should first produce a durable `ScratchBuildPlan` artifact before broad proposal/apply work begins.
- The scratch plan is the scratch-path counterpart to `TemplateTailoringPlan`.
- For one scratch path + brief revision, there should be at most one current `ScratchBuildPlan` in P0 while older scratch-plan revisions remain inspectable as history.
- `ScratchBuildPlan` should use explicit `isCurrent` semantics rather than relying only on latest timestamp wins.
- When a newer scratch build plan replaces the current one for the same scratch path, the older artifact should record explicit supersession metadata such as `supersededAt` and optional `supersededById`.
- Database-level uniqueness should enforce that, for the same scratch-path scope under one `briefRevisionId`, at most one scratch-plan row has `isCurrent = true`.
- At minimum, it should record:
  - `briefRevisionId`
  - `proposedFoundationSurfaces`
  - `requiredBuildGroups`
  - `recommendedBuildGroups`
  - `initialToolingPlan`
  - `initialValidationTargets`
- The scratch plan should explain:
  - which foundation surfaces need to exist first
  - which build groups are required for the first usable slice
  - which build groups are recommended but not required initially
  - which tools and integrations are needed in the first build wave
  - which validation targets should be exercised first
- After the operator completes explicit build entry on the scratch path, `requiredBuildGroups` may directly expand into the first build `TodoPlan` items and first batch proposal drafts.
- `recommendedBuildGroups` should not automatically enter the current active build plan by default.
- They should remain visible as suggestions on the scratch plan until an explicit follow-up action promotes them into plan scope.
- After `promote to plan`, those promoted items should still default to `isRequired = false`.
- Promotion alone means they entered executable plan scope, not that they automatically became release-blocking required work.
- They should become `isRequired = true` only when:
  - the operator explicitly marks them required, or
  - later validation, critique, or release evidence shows they have become blocking work
- P0 should not add an extra global `Confirm scratch plan` gate between build entry and those first proposal-ready artifacts.
- The scratch plan authorizes planning and proposal generation, not direct mutation.
- Every actual configuration change still must pass through explicit proposal review, `accept_proposal`, and `apply_proposal`.
- Build `TodoPlan` items, first batch proposals, and first validation planning on the scratch path should grow out of this `ScratchBuildPlan` rather than jumping directly from "choose scratch" to opaque config mutation.

### 10.39 Explicit build-entry action

- A template recommendation artifact should not silently start build work by itself.
- After recommendation, `Pilot` should remain in a pending selection state until the operator makes an explicit build-entry choice.
- The operator should explicitly choose one of:
  - `Start from recommended template`
  - `Start from scratch`
- If the operator chooses a template path, entry into real build work should still require an explicit action such as:
  - `Create or reuse draft from template`
- If the operator chooses a scratch path, entry into real build work should still require an explicit action such as:
  - `Create blank draft build lane`
- Recommendation remains advice.
- Build entry should be a distinct audited action that records:
  - which brief revision was active
  - which recommendation artifact was in force
  - which tailoring plan was created if the path is template-based
  - which scratch build plan was created if the path is scratch-based
  - whether the operator chose template or scratch
  - which draft or build lane was created or reused
- This keeps requirement discovery, template recommendation, and actual build entry from collapsing into one opaque hidden transition.

### 10.40 Pre-build session rebinding

- `Build From Brief` may begin before any writable draft exists.
- In that early phase, `Pilot` may use a family-scoped pre-build session.
- That pre-build session should still reuse the normal `PilotSession` table rather than introducing a separate session model.
- `PilotSession` should therefore support a small binding discriminator such as:
  - `bindingScope = pre_build_family | draft`
- That pre-build session should primarily bind:
  - the Agent family or build effort
  - the current `AgentBuildBrief`
  - the current operating mode
- While `bindingScope = pre_build_family`:
  - `agentConfigId` may be null
  - `agentFamilyId` or equivalent build-effort binding should be present
- Once the operator executes a real build-entry action and the system creates or reuses the first writable draft, that same session should rebind to the resulting `draftAgentConfigId`.
- The session timeline should record this transition explicitly, for example:
  - `pre-build session -> draft-bound build session`
- After rebinding, the session should follow the normal canonical writable-draft session rules already defined elsewhere in this guide.
- This keeps brief-driven build flows and draft-bound mutation flows in one continuous audited thread instead of splitting them into unrelated chat histories.

---

## 11. Construction Rules

This section is the coding-agent execution contract. Future implementation lanes should be judged against these rules before they are judged against convenience or speed.

### 11.1 Truth hierarchy

- Draft truth comes from the current DB-backed writable draft.
- Validation truth comes from named `Scenario` assets plus persisted receipts.
- Publish truth comes from `Release`.
- `PilotSessionMemory` is continuity help only.
- No summary, compact output, or proposal rationale may override current draft or receipt truth.

### 11.2 Allowed mutation path

The only allowed mutation path remains:

```text
clarify if needed
  -> inspect
  -> draft typed proposal
  -> diff review
  -> explicit accept
  -> explicit UI apply
  -> validation becomes stale
  -> explicit validation run
```

Any implementation that allows:

- direct natural-language writes
- hidden live mutation
- hidden publish/activate
- hidden validation bypass

is out of spec.

### 11.3 Session contract

Each canonical session must be able to answer all of the following without reconstructing state from raw logs by hand:

- what draft version is this session currently editing
- who is the active editor
- what was the last applied proposal
- which receipt is the latest relevant one
- whether validation is stale
- whether memory is degraded
- what the next recommended step is

### 11.4 Memory contract

`PilotSessionMemory` may remember:

- confirmed operator intent
- unresolved clarification points
- prior proposal summaries
- apply outcomes
- validation and receipt references
- suggested next actions

`PilotSessionMemory` may not become authority for:

- exact current config values
- live vs draft version selection
- receipt pass/fail state without rechecking storage
- release readiness without rechecking storage

### 11.5 Self-audit rule for coding agents

Any coding agent implementing this guide should repeatedly ask:

1. Does this feature preserve the draft/live/release boundary?
2. Does it preserve explicit human acceptance before writes?
3. Does it preserve receipt truth as a named, visible artifact?
4. Does it keep `Pilot` memory separate from customer runtime memory?
5. Can another delivery person resume the canonical thread without hidden context?
6. If compaction or persistence fails, does the UI remain truthful about degraded continuity?

If the answer to any one of these is no, the implementation is not complete.

### 11.6 Proposal granularity rule

Before allowing a proposal to reach accept/apply, the system should be able to say:

- what one operator intent this proposal serves
- what the `primary surface` is
- why each additional patch is required for the same intent

If the proposal cannot explain that clearly, it is too broad for P0.

### 11.7 Handoff rule

Before calling a session `handoff_ready`, the system should be able to point to:

- the exact draft version
- the latest relevant proposal chain
- the exact receipts used for readiness reasoning
- the known blockers or residual risks

If later edits happen, the system must invalidate that handoff explicitly rather than leaving the old summary looking current.

### 11.8 TodoPlan rule

Before turning a multi-intent user input into action, the system should decide:

- can this be handled as one single clear intent, or
- should it become a visible `TodoPlan`

If it becomes a `TodoPlan`, each item should be auditable on its own:

- one intent
- one active item at a time
- clear status
- clear proposal chain if mutation happens
- clear receipt linkage if validation happens

If the system cannot explain the plan at item level, it is too vague to execute safely.

### 11.9 TodoPlan completion rule

Completion must match the type of work claimed by the item.

- `inspection` or `explanation` item:
  - a durable visible result exists
  - no unresolved clarification remains
- `config change` item:
  - the change reached explicit `accept + apply`
  - if the item claims to fix a behavioral issue, a new relevant receipt result must also be linked
- `scenario authoring` item:
  - the named `Scenario` asset was created or updated successfully
  - if the item promises validation, a receipt must also be linked
- `release handoff` item:
  - a new `PilotHandoff` artifact exists
  - if later edits happen, that item should no longer appear current without regeneration

If an item claims more than the stored artifacts can prove, it is not complete yet.

### 11.10 Persistence modeling rule

The persistence model should stay explicit enough that a coding agent can answer:

- where the canonical session lives
- where the readable timeline lives
- where immutable proposals live
- where multi-intent work decomposition lives
- where release-review handoff artifacts live
- where readable operator-facing timeline events live
- where current build briefs live
- where template recommendation artifacts live
- where template tailoring plans live
- where scratch build plans live

If one table tries to absorb too many of these responsibilities, the model is too vague for P0.

`PilotMessage` should remain readable without replaying hidden JSON only, but also structured enough that the UI and later automation can reopen linked proposals, receipts, and handoffs without guessing from free text.

P0 should prefer explicit artifact tables over a generic polymorphic artifact bucket. If later consolidation is desired, it should happen only after the P0 artifact semantics are already stable and proven.

### 11.11 Canonical lookup rule

Given an `orgId` and writable `agentConfigId`, the backend should be able to resolve the current canonical `PilotSession` with one direct query and no ambiguity.

If the implementation allows two simultaneous current sessions for the same writable draft, it is out of spec.

For pre-build flows, given an `orgId`, `agentFamilyId`, and `bindingScope = pre_build_family`, the backend should also be able to resolve the one canonical current pre-build `PilotSession` with one direct query and no ambiguity.

The preferred lookup keys are:

```text
orgId + agentConfigId + isCurrent = true

orgId + agentFamilyId + bindingScope = pre_build_family + isCurrent = true
```

Session `status` still matters, but it should not be the only mechanism for determining "which thread is current right now."

### 11.12 Action surface rule

P0 `Pilot` actions should stay explicit and legible at the route level.

The backend should avoid:

- one giant generic `actions` endpoint
- hidden multi-step side effects behind ambiguous verbs
- mixing session, proposal, plan, validation, and handoff semantics into one payload contract

If an operator or coding agent cannot easily tell which action mutated which object, the API is too opaque for P0.

The preferred API style is:

```text
resource route
  + explicit action subroute
```

rather than:

```text
generic actions RPC
```

### 11.13 Engine rule

The implementation should be able to explain, in one sentence, what kind of engine `Pilot` is:

```text
a bounded operator-workflow orchestrator
```

and should not require anyone to describe it as:

- a second customer runtime
- a shell or coding autonomy engine
- an open-ended ReAct loop with vague authority

Limited internal multi-step reasoning is acceptable only if:

- it uses read-only inspection or safe internal planning steps
- it remains bounded to the current turn or explicit follow-up action
- it never bypasses the named business actions and storage artifacts defined in this guide

If the implementation is easier to describe as "we reused the main agent loop and tried to constrain it later," it is probably the wrong P0 shape.

### 11.14 Controller rule

For any given operator turn, the backend should be able to explain:

- what the one primary outcome of this turn was
- which read-only inspection steps were used to reach it
- which business artifact, if any, was created or advanced

If one turn leaves behind multiple ambiguous partial mutations, the controller is too loose for P0.

### 11.15 Decision rule

Before the model is asked to speak or generate, the backend should already know which class of outcome is legal for this turn.

That means the implementation should be able to answer:

- why this turn was allowed to clarify, inspect, propose, revise, summarize validation, or generate handoff
- why other actions were not legal at the same time
- which deterministic gate prevented unsafe progress if the user asked for too much

If the model is effectively deciding the workflow state machine on its own, the implementation is out of spec.

### 11.16 Exploratory loop rule

`Pilot` may feel like Claude Code while it is reading, traversing, and synthesizing the current Agent configuration.

That is acceptable only if all of the following remain true:

- the loop is restricted to allowlisted read or inspect capabilities
- the controller still owns legality and stop conditions
- the loop cannot directly mutate draft or release state
- the final output still lands in one explicit business artifact or one explicit blocking response

If "it feels like cc" starts to mean "the model can mutate whatever it discovers," the implementation has crossed the line from exploratory cockpit to unsafe autonomy.

### 11.17 Capability rule

When adding or reviewing a `Pilot` tool surface, the coding agent should first ask:

- does this capability already exist behind a real Console backend surface
- can the UI and `Pilot` share the same domain capability instead of duplicating logic
- is this capability clearly classified as read, test, or write
- if it is write-capable, does it still terminate in typed proposal/apply rather than free mutation

If a new `Pilot` ability is implemented by simulating page clicks or recreating page-only logic, it is the wrong shape for P0.

### 11.18 Registry rule

Before a capability is exposed to `Pilot`, the implementation should be able to answer from registry metadata alone:

- what this capability is called
- which Console surface it belongs to
- whether it is read, test, or write
- whether it is callable by `Pilot`
- how much of its result may be exposed to the model
- whether using it requires an existing draft or explicit human acceptance later

If those answers live only in scattered code branches or UI assumptions, the capability surface is too opaque for safe dynamic discovery.

### 11.19 Tool-family rule

When exposing dynamic `Pilot` tooling, the implementation should preserve both:

- dynamic discovery through registry metadata
- stable, named model-facing tool families

If the resulting model-facing API is easiest to describe as "the model can call one universal dispatcher with arbitrary payloads," the tool surface is too opaque for P0.

### 11.20 Batch proposal rule

When `Pilot` produces a batch proposal, the coding agent should be able to answer:

- what single operator intent this batch serves
- how the batch is decomposed into named change groups
- which objects each group targets
- what effect each group is expected to have
- what validation plan corresponds to the batch as a whole

If those answers are not visible in proposal structure, the batch is too opaque to review safely.

### 11.21 Validation-plan rule

When a proposal claims to improve or fix behavior, the implementation should be able to answer directly from proposal structure:

- which named Scenarios must be run
- which are only recommended
- which manual Playground checks still matter
- what condition blocks release review if evidence is still missing

If validation expectations live only in chat text and not in structured proposal data, later receipt review and handoff generation will be too fragile for P0.

### 11.22 Batch apply rule

When reviewing a batch proposal, the coding agent should be able to answer:

- whether the operator accepted the whole proposal
- whether the whole accepted proposal was applied
- which replacement proposal superseded it if the scope changed

If the implementation allows partial application of one proposal without first generating a revised proposal artifact, receipt and handoff truth will become ambiguous.

### 11.23 Exploratory stop rule

When reviewing an exploratory loop implementation, the coding agent should be able to answer:

- what action class this loop was gathering evidence for
- why the collected evidence was sufficient to stop
- why the controller returned a result now instead of continuing to inspect

If the only stop explanation is "the model stopped asking for tools" or "the iteration cap was hit," the implementation is too weakly grounded for P0.

### 11.24 Inspection trace rule

For any exploratory turn that materially affects clarification, proposal scope, validation explanation, or handoff reasoning, the coding agent should be able to reopen a trace that shows:

- what was inspected
- in what sequence it was inspected
- what sensitivity tier was exposed to the model
- what evidence threshold was satisfied by the end

If the implementation can produce a result but cannot later explain which inspected evidence led to it, the exploratory loop is too opaque for commercial use.

### 11.25 Guided elicitation rule

When `Pilot` is operating in guided elicitation mode, the coding agent should be able to answer:

- what kind of Agent-building goal the operator is pursuing
- which key requirement dimensions have already been confirmed
- which open questions still block a proposal-ready configuration scope
- why the next question is the most decision-relevant one
- which durable artifacts were updated as a result of the elicitation turn

If "guided build" is implemented only as vague free chat without explicit requirement capture, open-question tracking, and handoff into proposal-ready artifacts, it is not commercially strong enough for P0.

### 11.26 Mode rule

When reviewing a `Pilot` flow, the coding agent should be able to answer:

- which explicit mode the session or current turn is in
- why that mode was chosen or recommended
- what completion bar applies in that mode
- which hard product boundaries still remain unchanged despite the mode

If mode selection is effectively hidden prompt magic and the operator cannot tell whether `Pilot` is building, critiquing, validating, or preparing release review, the experience is too opaque for commercial use.

### 11.27 AgentBuildBrief rule

When guided elicitation is used to shape a new or heavily revised Agent, the coding agent should be able to answer from stored artifacts:

- what business goal the Agent is meant to serve
- which channels and use cases are in scope
- which cases are explicitly out of scope
- what escalation and response constraints have already been confirmed
- which tool, integration, and validation needs are already known
- which open questions still block proposal-ready scope

If those answers exist only in raw chat turns and not in a durable brief artifact, the co-building workflow is too fragile for commercial use.

The coding agent should also be able to answer:

- where the current brief artifact lives
- how it differs from older brief revisions
- which current session is actively shaping it
- which Agent family or build effort currently owns it
- which brief revision is current
- which older brief revisions remain inspectable as history
- why the current brief superseded the previous one
- what explicit `isCurrent` and supersession fields prove that relationship
- what DB-level uniqueness constraint prevents two current briefs for the same Agent family

If the brief exists only as summary text tucked inside session state, it is not a strong enough artifact for commercial co-building.

### 11.28 Brief-confirmation rule

Before `Pilot` begins template recommendation, template tailoring, or initial build proposal generation from a sparse brief, the coding agent should be able to answer:

- which brief revision is currently confirmed
- whether that confirmed brief is already recommendation-safe
- whether the current build work is still based on that confirmed revision
- whether later requirement changes created a newer unconfirmed revision
- whether reconfirmation is required before further build automation proceeds

If build generation continues while the underlying brief is drifting without an explicit confirmation boundary, the workflow is too unstable for commercial use.

The coding agent should also be able to answer:

- which unresolved questions still remain
- why those remaining questions do not materially affect template recommendation

If template recommendation starts while unresolved questions could still change the recommended build direction, the gate is too weak for commercial use.

### 11.29 Template-first rule

When `Pilot` begins building from a confirmed brief, the coding agent should be able to answer:

- which existing templates were considered
- why one template was recommended first, if any
- what mismatch remained between the confirmed brief and the recommended template
- whether the operator explicitly chose a scratch path instead

If `Pilot` jumps straight into scratch build without checking reusable templates first, the workflow is too wasteful for the intended commercial slice.

### 11.30 Template-recommendation rule

When `Pilot` recommends templates, the coding agent should be able to answer from stored artifacts:

- which brief revision the recommendation was based on
- which template candidates were compared
- which candidate was recommended and why
- why the non-selected candidates lost
- why scratch build was rejected or chosen
- which recommendation artifact is current for that confirmed brief revision
- which older recommendation attempts remain inspectable as history
- what explicit `isCurrent` and supersession fields prove that relationship
- what DB-level uniqueness constraint prevents two current recommendations for the same brief revision

If template recommendation exists only as an ephemeral chat suggestion, build provenance and later review will be too weak for commercial use.

### 11.31 Template-tailoring-plan rule

When `Pilot` proceeds from template selection into real build work, the coding agent should be able to answer from stored artifacts:

- which selected template the tailoring plan is based on
- which parts of the template already fit the confirmed brief
- which mismatch areas require immediate tailoring
- which tailoring groups are required vs recommended
- which first validation targets were attached to the template path
- whether required tailoring groups were allowed to expand directly into first build `TodoPlan` items and proposal drafts after build entry
- whether recommended tailoring groups stayed out of the active build plan until explicitly promoted
- whether promoted recommended groups still defaulted to optional plan items rather than silently becoming required
- which tailoring plan artifact is current for that template path
- which older tailoring-plan revisions remain inspectable as history
- what explicit `isCurrent` and supersession fields prove that relationship
- what DB-level uniqueness constraint prevents two current tailoring plans for the same template path
- why no extra global tailoring confirmation was required before those first proposal-ready artifacts

If template selection is followed directly by configuration mutation without an explicit tailoring plan artifact, the template path is too opaque for commercial use.

### 11.32 Scratch-build-plan rule

When `Pilot` proceeds from a scratch choice into real build work, the coding agent should be able to answer from stored artifacts:

- which brief revision the scratch build plan is based on
- which foundation surfaces were proposed first
- which build groups are required vs recommended
- which initial tooling and integration work was planned
- which first validation targets were attached to the scratch path
- whether required build groups were allowed to expand directly into first build `TodoPlan` items and proposal drafts after build entry
- whether recommended build groups stayed out of the active build plan until explicitly promoted
- whether promoted recommended groups still defaulted to optional plan items rather than silently becoming required
- which scratch build plan artifact is current for that scratch path
- which older scratch-plan revisions remain inspectable as history
- what explicit `isCurrent` and supersession fields prove that relationship
- what DB-level uniqueness constraint prevents two current scratch plans for the same scratch path

If a scratch path jumps from "choose scratch" straight into broad configuration mutation without an explicit `ScratchBuildPlan` artifact, the scratch workflow is too opaque for commercial use.

### 11.33 Build-entry rule

Before real build work begins from a brief-driven flow, the coding agent should be able to answer:

- which explicit build-entry action the operator chose
- whether the path was template-based or scratch-based
- which brief revision and template recommendation artifact were active at entry
- which tailoring plan artifact was active if the path was template-based
- which scratch build plan artifact was active if the path was scratch-based
- which draft or build lane was created or reused as a result
- whether first required tailoring work was allowed to expand immediately into `TodoPlan` items or proposal drafts after entry

If `Pilot` can move from recommendation to active build mutation without a distinct user-visible build-entry action, the transition is too opaque for commercial use.

### 11.34 Pre-build-session rule

For a brief-driven build flow, the coding agent should be able to answer:

- whether the current session is still pre-build or already draft-bound
- which Agent family and brief artifact the pre-build session belongs to
- which explicit build-entry action caused rebinding to the first writable draft
- which timeline event records that rebinding
- whether the implementation reused the same `PilotSession` row rather than migrating between parallel session models

If a brief-first build flow and a draft-bound build flow cannot be explained as one continuous audited session lifecycle, the session model is too fragmented for commercial use.

---

## 12. Gate Delivery Plan

This section turns the approved design into an execution order that a coding agent can follow without guessing.

The gates are strict:

- do not skip a gate
- do not claim a later gate complete while an earlier gate still has unresolved blockers
- do not mark the overall goal complete until every gate has:
  - code landed
  - automated proof
  - manual proof
  - checklist completion
  - a written gate receipt

### 12.1 Gate A - Schema And Contracts

**Objective:** create a durable, machine-enforceable data and API foundation for commercial `Pilot`.

**Primary deliverables**

- schema and migration support for:
  - `PilotSession`
  - `PilotMessage`
  - `PilotProposal`
  - `PilotTodoPlan`
  - `PilotTodoItem`
  - `PilotHandoff`
  - `AgentBuildBrief`
  - `TemplateRecommendation`
  - `TemplateTailoringPlan`
  - `ScratchBuildPlan`
- all required `isCurrent`, supersession, and binding-scope fields
- DB-level partial unique indexes for every current-only artifact path
- route contracts and zod schemas for:
  - session actions
  - plan actions
  - proposal actions
  - validation and handoff actions
  - build-brief and build-entry actions
  - template recommendation and planning artifacts
- capability registry manifest contract
- internal model resolver contract for Console-internal LLM usage

**Suggested implementation scope**

- schema
- migrations
- route contracts
- service-layer input and output types
- capability-registry metadata types

**Automated proof required**

- migration applies cleanly
- schema and contract tests pass
- uniqueness tests prove duplicate current rows are rejected
- typecheck passes

**Manual proof required**

- evidence that each new artifact has an explicit persistence model
- evidence that no generic polymorphic artifact bucket was used for P0

**Gate A exit criteria**

- every required artifact exists in schema or model code
- every current-only artifact path has a DB-level uniqueness strategy
- every new route/action has a typed contract
- no P0-critical artifact still lives only in session JSON

**Gate A blocker examples**

- schema ambiguity around current/history semantics
- no DB-level uniqueness for current artifacts
- route payloads still rely on untyped free-form JSON where P0 needs explicit structure

### 12.2 Gate B - Session And Planning

**Objective:** make `Pilot` resumable, collaborative, and capable of build planning before and after the first draft exists.

**Primary deliverables**

- canonical `PilotSession` lifecycle:
  - `pre_build_family`
  - `draft`
  - rebind from pre-build to draft-bound
- session takeover and archive behavior
- `PilotSessionMemory` durability and `memory_degraded` behavior
- `AgentBuildBrief` lifecycle:
  - current
  - history
  - confirm-brief gate
- explicit mode support:
  - `Build From Brief`
  - `Template Tailoring`
  - `Critique Existing Agent`
  - `Validation Triage`
  - `Release Review`
- `TemplateRecommendation` lifecycle
- `TemplateTailoringPlan` lifecycle
- `ScratchBuildPlan` lifecycle
- `TodoPlan` and `TodoItem` lifecycle, including promote-to-plan behavior
- inspection trace persistence and replayability

**Suggested implementation scope**

- session services
- planning-artifact services
- mode selection and mode persistence
- planning-state transitions
- timeline message emission

**Automated proof required**

- session lifecycle tests
- pre-build to draft rebind tests
- build-brief current/history tests
- planning-artifact current/history tests
- `memory_degraded` and manual compact tests
- promote-to-plan tests

**Manual proof required**

- refresh and resume same thread
- resume current brief and current planning artifacts after reload
- show explicit pre-build to draft-bound transition in timeline

**Gate B exit criteria**

- a coding agent can explain the current session and current planning state without replaying raw chat
- one agent family cannot accidentally end up with two current pre-build sessions
- one draft cannot accidentally end up with two current draft-bound sessions
- planning artifacts can all be reopened with clear current/history semantics

**Gate B blocker examples**

- pre-build and draft-bound work require two different session models
- planning artifacts have no current/history discipline
- inspection trace cannot be reopened or attributed

### 12.3 Gate C - Proposal And Validation Flow

**Objective:** make `Pilot` capable of CC-style exploration while keeping mutation, validation, and handoff fully auditable.

**Primary deliverables**

- bounded `PilotController`
- deterministic-first action gating
- CC-style exploratory loop with:
  - allowlisted tool families
  - capability registry discovery
  - evidence-sufficient stop
  - inspection trace
- batch proposal structure:
  - `intentSummary`
  - `changeGroups`
  - `validationPlan`
- proposal history and supersession
- whole-proposal accept/apply semantics
- validation stale rules
- proposal-bound validation plan execution and linkage
- Scenario linkage rules
- handoff generation rules
- template-path expansion:
  - required tailoring groups -> first plan/proposal artifacts
  - recommended groups remain optional until promotion
- scratch-path expansion:
  - required build groups -> first plan/proposal artifacts
  - recommended groups remain optional until promotion

**Suggested implementation scope**

- controller
- exploratory loop
- registry-backed tool families
- proposal drafting and revision
- validation linkage
- handoff linkage

**Automated proof required**

- exploratory loop stop-condition tests
- controller legality tests
- batch proposal structure tests
- proposal stale and supersession tests
- whole-proposal apply tests
- validationPlan linkage tests
- handoff snapshot and invalidation tests

**Manual proof required**

- one ambiguous request -> clarification
- one broad read/explore turn -> coherent batch proposal
- one receipt-driven fix loop
- one template path from tailoring plan to first proposal
- one scratch path from scratch plan to first proposal

**Gate C exit criteria**

- `Pilot` can explore like `cc` without gaining hidden write authority
- every write-class change still terminates in proposal/accept/apply
- every validation claim can point to named Scenarios or receipts
- every handoff can point to exact draft/proposal/receipt coverage

**Gate C blocker examples**

- universal dispatcher with arbitrary payloads
- model chooses illegal workflow transitions without controller gate
- validation expectations still live only in chat prose

### 12.4 Gate D - UI And Self-Audit

**Objective:** make the system operable, reviewable, and provably complete for internal delivery use.

**Primary deliverables**

- `Pilot Lab` UI for:
  - explicit mode visibility
  - current session and planning artifact visibility
  - build brief review and confirmation
  - template recommendation and selection
  - template tailoring plan review
  - scratch build plan review
  - artifact drill-down
  - inspection trace drill-down
  - memory degraded state and manual compact
  - proposal review, accept, and apply
  - validation and handoff views
- clear copy that distinguishes:
  - draft vs live
  - runtime-backed vs fixture-only
  - required vs recommended work
  - current vs history artifacts
- end-to-end screenshots or recordings for every gate-critical workflow
- final implementation checklists inside this document
- coding-agent self-audit loop usage notes
- final commercial-readiness receipt format

**Suggested implementation scope**

- `Pilot Lab` surfaces
- artifact viewers
- mode affordances
- timeline and trace viewers
- receipt and handoff linking UI
- acceptance docs

**Automated proof required**

- UI-state integration tests where practical
- route/UI contract tests
- regression coverage for major state transitions

**Manual proof required**

- screenshots for each major mode
- screenshots for build-brief confirmation
- screenshots for template and scratch paths
- screenshots for inspection trace drill-down
- screenshots for proposal, validation, and handoff flow
- screenshots for memory-degraded and manual-compact state

**Gate D exit criteria**

- an operator can follow the full build or tailoring flow without hidden state
- a coding agent can map every UI state back to its persisted artifacts
- the final checklist and receipt template are complete

**Gate D blocker examples**

- critical artifact state is invisible in UI
- current/history ambiguity remains visible to operators
- no proof bundle exists for manual acceptance

### 12.5 No-Skip Rule

The overall objective is not complete unless:

- Gate A is complete
- Gate B is complete
- Gate C is complete
- Gate D is complete

No gate may be declared complete if any earlier gate still has unresolved blockers.

---

## 13. Acceptance Checklists

This section is intentionally checklist-shaped so a coding agent can mark concrete completion rather than rely on intuition.

### 13.1 Gate A Checklist

- [ ] All required artifact tables or models exist.
- [ ] No P0 artifact relies on a generic polymorphic artifact bucket.
- [ ] `PilotSession` supports `bindingScope = pre_build_family | draft`.
- [ ] Every planning artifact has explicit `isCurrent` fields.
- [ ] Every planning artifact has explicit supersession fields.
- [ ] DB-level uniqueness exists for current `PilotSession` rows by draft scope.
- [ ] DB-level uniqueness exists for current `PilotSession` rows by pre-build family scope.
- [ ] DB-level uniqueness exists for current `AgentBuildBrief` rows by agent family.
- [ ] DB-level uniqueness exists for current `TemplateRecommendation` rows by brief revision.
- [ ] DB-level uniqueness exists for current `TemplateTailoringPlan` rows by template path.
- [ ] DB-level uniqueness exists for current `ScratchBuildPlan` rows by scratch path.
- [ ] All route contracts are typed and validated.
- [ ] Capability registry manifest contract exists.
- [ ] Console-internal model resolver contract exists.
- [ ] Migration and contract test receipt is captured.

### 13.2 Gate B Checklist

- [ ] Canonical session lookup works for `pre_build_family`.
- [ ] Canonical session lookup works for `draft`.
- [ ] Pre-build session rebinding to first draft works.
- [ ] Session takeover is durable and audited.
- [ ] Session archive is durable and audited.
- [ ] `memory_degraded` behavior is durable and truthful.
- [ ] Manual compact works and clears degraded state on success.
- [ ] `AgentBuildBrief` current/history lifecycle works.
- [ ] `Confirm brief` gate works.
- [ ] Template recommendation current/history lifecycle works.
- [ ] Template tailoring plan current/history lifecycle works.
- [ ] Scratch build plan current/history lifecycle works.
- [ ] `TodoPlan` current/history lifecycle works.
- [ ] `promote to plan` behavior works.
- [ ] Inspection trace is persisted and reopenable.
- [ ] Resume-after-refresh proof is captured.

### 13.3 Gate C Checklist

- [ ] Deterministic-first controller gate exists.
- [ ] Exploratory loop uses registry-backed tool families.
- [ ] Exploratory loop honors evidence-sufficient stop.
- [ ] Exploratory loop leaves inspection trace.
- [ ] Batch proposals use intent-scoped change sets.
- [ ] Batch proposals carry structured `validationPlan`.
- [ ] Proposal supersession and stale rules work.
- [ ] Whole-proposal accept/apply semantics work.
- [ ] Validation stale rules work after apply.
- [ ] Scenario linkage rules work.
- [ ] Receipt linkage rules work.
- [ ] Handoff snapshot generation works.
- [ ] Handoff invalidation after later edits works.
- [ ] Template path required groups expand correctly after build entry.
- [ ] Template path recommended groups stay optional until promotion.
- [ ] Scratch path required groups expand correctly after build entry.
- [ ] Scratch path recommended groups stay optional until promotion.
- [ ] Receipt-driven fix loop proof is captured.

### 13.4 Gate D Checklist

- [ ] Current mode is visible in UI.
- [ ] Current brief is visible in UI.
- [ ] Confirmed brief state is visible in UI.
- [ ] Current recommendation artifact is visible in UI.
- [ ] Current tailoring or scratch plan is visible in UI.
- [ ] Current plan items and required vs recommended state are visible in UI.
- [ ] Proposal review, accept, and apply controls are visible and truthful.
- [ ] Inspection trace can be expanded or reopened.
- [ ] `memory_degraded` state is visible.
- [ ] Manual compact affordance is visible.
- [ ] Validation state distinguishes fixture-only and runtime-backed.
- [ ] Handoff artifact and blockers/risks are visible.
- [ ] Screenshot proof bundle exists for all major flows.
- [ ] Final commercial-readiness receipt template exists.
- [ ] Coding-agent self-audit checklist exists and is usable.

### 13.5 Final Completion Checklist

- [ ] Gate A receipt exists.
- [ ] Gate B receipt exists.
- [ ] Gate C receipt exists.
- [ ] Gate D receipt exists.
- [ ] All automated tests named by the gates are green.
- [ ] All manual screenshots or recordings named by the gates are captured.
- [ ] No unresolved blocker remains in any gate receipt.
- [ ] The final `Pilot` commercial-readiness receipt is written.

---

## 14. Coding-Agent Self-Audit Loop

This section is the operating procedure a coding agent should follow while implementing the goal.

### 14.1 Before Starting A Gate

Before touching code for a gate, the coding agent should write down:

- which gate is active
- which artifacts or flows this gate owns
- which earlier gates must already be complete
- which tests and manual proof this gate will need before completion

If that summary cannot be written clearly, the gate is not yet scoped well enough.

### 14.2 During A Gate

The coding agent should repeatedly ask:

1. Which artifact is the current truth for this step?
2. Did I preserve explicit human acceptance before any write?
3. Did I preserve draft/live/release boundaries?
4. Did I preserve current/history semantics?
5. Did I preserve DB-level uniqueness where current truth must be singular?
6. Can the resulting state be reopened in UI and in code without guessing?

If any answer becomes no, stop implementation and fix that drift before continuing.

### 14.3 Gate Completion Procedure

A gate is complete only when the coding agent has done all of the following:

1. Implemented the required code.
2. Run the gate's automated proof.
3. Captured the gate's manual proof.
4. Checked every item in the gate checklist.
5. Written a short gate receipt.

The receipt should include at minimum:

- `gate`
- `date`
- `status`
- `code scope`
- `automated proof`
- `manual proof`
- `known residual risks`
- `next gate`

### 14.4 Stop Conditions

A coding agent must not claim success if any of the following is true:

- a required current/history artifact is still implicit
- a current uniqueness rule exists only in app logic and not in durable constraints where the guide requires DB enforcement
- a build path still depends on hidden chat memory instead of explicit artifacts
- a write path bypasses proposal/accept/apply
- a validation claim cannot point to named Scenario or receipt evidence
- a handoff claim cannot point to exact draft/proposal/receipt coverage
- a critical UI state has no persisted backing artifact
- a required screenshot or recording proof is missing

### 14.5 Final Objective Completion Rule

The overall goal is complete only when:

- all four gates are complete
- all gate receipts exist
- the final completion checklist is fully checked
- there are no unresolved blockers
- a fresh coding agent can read this document and determine what was built, how to verify it, and what evidence proves commercial readiness

If any of those is false, the objective is not yet 100 percent complete.

---

## 15. Final Receipt Template

When the work is complete, produce one final receipt in this shape:

```text
Pilot Commercial Readiness Receipt

Date:
Implementation Owner:
Repo Revision:

Gate A:
  status:
  automated proof:
  manual proof:
  residual risks:

Gate B:
  status:
  automated proof:
  manual proof:
  residual risks:

Gate C:
  status:
  automated proof:
  manual proof:
  residual risks:

Gate D:
  status:
  automated proof:
  manual proof:
  residual risks:

Final Statement:
  Is Pilot commercially ready for the intended P0 slice?
  If yes, why?
  If no, what exact blockers remain?
```

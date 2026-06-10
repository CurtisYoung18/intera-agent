# Architect Audit - 2026-06-09

**Scope:** post-Q2 Intera Console and runtime audit before first real commercial deployment.

**Current baseline:** `02dc3182 cleanup: remove obsolete ops guide route`.

**Important working-tree note:** during this audit, an uncommitted ConfigPilot skeleton was present under `apps/console/lib/config-pilot/**` and `apps/console/app/api/admin/config-pilot/**`. Treat it as an in-progress P1 lane, not as shipped baseline, until it is committed with green gates.

**2026-06-10 follow-up:** P1, R3, S2, U-Pilot, PKG1, BASE1, and Q3-B1 are now shipped on local `main`. Treat the audit sections below as dated risk context; use [`MASTER_BUILD_HANDOFF.md`](./MASTER_BUILD_HANDOFF.md) for current dispatch truth.

---

## Executive Read

Intera's foundation is much cleaner after R2/Q1/Q2: Hook/Tool/Procedure vocabulary is mostly aligned, Build surfaces are light-first, Release/Pilot/Brain exist, and the old detached sub-agent runtime has been cut from the customer path.

The remaining risk is not raw development capacity. It is product/runtime truthfulness:

1. ConfigPilot must become a real backend-controlled assistant, not a hardcoded UI proposal generator.
2. Model-facing system Tools must match the new product model: `start_procedure`, `finalize_procedure`, `remember`.
3. Procedure execution must become a runtime overlay, not a prompt-mode transformation.
4. ProcedureRun state must be runtime/session state, not durable business memory.
5. Scenario validation must distinguish fixture receipts from real Agent runtime receipts.
6. Package/version behavior must support delivery sharing without hidden gaps.

Until those six are handled, the Console can demo well, but a delivery person may trust surfaces that are not yet true enough for customer deployment.

---

## P0 Before Customer Deployment

### 1. ConfigPilot Backend Is Incomplete

At audit time, shipped UI still used `apps/console/components/config-pilot/config-pilot-workbench.tsx` with a local deterministic scenario proposal path.

Follow-up status on 2026-06-10:

- P1 shipped the typed `/api/admin/config-pilot/context`, `/propose`, and `/apply` flow.
- Pilot Lab is now wired to those backend routes.
- The old local deterministic workbench surface has been removed in the Q3-B final cleanup.

Required direction:

- Backend owns ConfigPilot system prompt, model selector, structured proposal parser, context redaction, and typed apply service.
- React owns presentation, diff review, and explicit accept/reject.
- No frontend hardcoded proposal builder should remain as the production path.

Dispatch: use `P1 - ConfigPilot typed configuration tools` in `POST_FOUNDATION_DISPATCH_PROMPTS.md`.

### 2. System Tool Names Still Leak Old Product Model

Current runtime still advertises or uses:

- `dispatch_case_agent`
- `finalize_case`
- `confirmedFacts` language in human task memory ingestion

Target model-facing Tools:

- `start_procedure`
- `finalize_procedure`
- `remember(scope="chat" | "user")`
- `read_chat_memory`
- `read_user_profile`
- `ask_user_questions`
- `create_human_task`

Compatibility aliases may exist internally, but new prompt/default copy should not teach the model old names.

Dispatch: use `R3 - ProcedureRun runtime overlay, system Tools rename, and remember`.

### 3. Procedure Must Become A Runtime Overlay

The current inline Procedure cutover is good enough for MVP routing, but the next architecture step should not be "Core Agent transforms into Procedure Agent." The better model is:

```text
stable Core Agent prompt
+ stable Tool contract
+ stable/cacheable Procedure definition when active
+ dynamic ProcedureRun state appended at prompt tail
```

`start_procedure(procedureId)` should create/select a ProcedureRun. Later turns stay in the same Core Agent conversation. Runtime appends current ProcedureRun state and resolves Hook scopes around Tool calls.

Required direction:

- Treat ProcedureRun as a runtime protocol inspired by Claude Code-style semantics, not as code copied from the reference folder: structured queue events, input epoch/uuid/origin metadata, explicit control interrupts, stable Hook lifecycle with dynamic context, prompt static/dynamic boundary, and real memory tools.
- Do not prepend a dynamic Procedure header before the stable Core Agent prompt.
- Do not replace the system prompt or activate a separate Procedure persona after `start_procedure`.
- Keep the model-visible Tool list/schema stable across Procedure activation. Procedure `allowedTools` should be enforced by runtime/Hook gates, not by dynamically changing Tool schemas after `start_procedure`.
- Define a first-class ProcedureRun timeline with currentStepId, per-step status, evidenceToolCallIds, facts, and blockers.
- Each timeline/input event should carry stable metadata such as eventId/uuid, inputEpoch, origin/source, run/session id, enqueue time, and optional priority/isMeta/control markers. Priority is scheduling metadata, not intent classification.
- Resolve ProcedureStep Hooks deterministically from active ProcedureRun + current step + requested Tool.
- Update the timeline after Tool results, Hook decisions, human tasks, `remember`, and `finalize_procedure`.
- Handle interleaved messages with generic epoch-based reconciliation: each input event increments `inputEpoch`; Tool/action/finalize attempts record `basedOnInputEpoch`; stale results become evidence but cannot advance steps until the latest input events are reconciled.
- Customer-facing text replies also need `basedOnInputEpoch`. If a newer input arrives before commit/send, withhold the stale reply where possible; if already streamed, trace it and do not advance ProcedureRun.
- Do not add an interleaved-message intent classifier. The runtime tracks version freshness, not whether a new message is a supplement, correction, cancellation, or new issue.
- Add a structured reconcile action such as `reconcile_procedure_input({ runId, upToInputEpoch, decision, summary })`. `needsReconcile` should not clear from natural-language model claims and this action must not write chat/user memory.
- Do not treat ordinary customer messages as interrupts. Queue/reconcile them. Only explicit control events such as operator stop, session close, or human takeover may abort active execution, and cancellation should be opt-in per Tool behavior.
- Preserve P0 Hook lifecycle as `PreToolUse`, `PostToolUse`, and `Stop`; keep the event model compatible with future `UserPromptSubmit`, `PreCompact`, and `PostCompact` without expanding scope now.
- Increment `inputEpoch` when messages/form results/human results are enqueued, not when AgentLoop drains them. Streaming Tool execution can finish before drain sees the new input.
- Upgrade session-store from a bare queued-message list to structured runtime events.
- Treat human task results and form answers as input events that increment epoch; do not force terminal action from old human/default resume prompt copy if newer customer input exists.
- Make `start_procedure` idempotent by request/event id and active run state.
- Use session-store as R3 V1 runtime authority unless a schema lane is explicitly approved; filter any temporary internal state from case export, case detail payloads, dashboards, compaction, and public memory APIs.
- Keep compact, ChatMemory, UserProfile, and raw model-visible `tool_result` history out of ProcedureRun authority. They can provide context/evidence, but cannot create, resume, complete, clear reconcile, advance currentStepId, or promote stale evidence.
- Label ProcedureRun evidence in the dynamic overlay as canonical, evidence_only, stale, or superseded, because old `tool_result` blocks may still be visible to the model through the message window or summary.
- Document that in-memory ProcedureRun state is only acceptable for a single-process/restart-loses-active-runtime first slice; multi-instance or restart-resilient deployment requires Redis/lease or schema work.
- Keep HookEngine stable and pass active ProcedureRun/caseType/currentStep/reconcile data through HookContext per evaluation instead of recreating HookEngine to switch Procedure context.
- Make `read_chat_memory`, `read_user_profile`, and `remember` real read/write tools in R3, or do not advertise the loop as closed.
- Enforce memory boundaries: `remember(scope="chat")` writes ChatMemory, `remember(scope="user")` writes UserProfile, and neither writes ProcedureRun runtime state.
- Harden compact output with a strict text envelope such as `<summary>...</summary>` where practical. Compact may summarize facts, observed tools, open items, latest customer messages, and suggested next steps, but not canonical ProcedureRun fields.
- Fix prompt context naming so Procedure catalog queries use explicit `agentConfigId`, and ensure seeded Procedures parse under the current Procedure schema.

Dispatch: use `R3 - ProcedureRun runtime overlay, system Tools rename, and remember`.

### 4. ProcedureRun State Boundary Is Not Fully Safe

R1 correctly moved ProcedureRun state out of public `confirmedFacts`, but current implementation stores internal ProcedureRun state through `ChatMemoryManager.setInternalState()`, which writes into `toolResults`.

That is hidden from some prompt/rendering paths, but it is still durable memory-like storage. Owner decision: ProcedureRun active/paused state should live only in the session/runtime lifecycle. If a compact summary mentions the work, it must be a summary, not canonical runtime state.

Required direction:

- Keep active/paused/current ProcedureRun in a runtime/session tracker.
- Exclude `__intera_*` runtime keys from public memory, compact summaries, dashboards, and persisted confirmed facts.
- Add tests proving the boundary.

Dispatch: R3 owns this with the runtime overlay.

### 5. Scenario Validation Can Create False Confidence

The first Scenario runner is useful, but it is currently a deterministic harness unless observed evidence is injected. That means Release can show a validation state that may not reflect a real Agent execution path.

Required direction:

- Keep fixture validation, but label it.
- Add an Agent-runtime execution mode for at least the first commercial workflow.
- Receipts should record `executionMode`.
- Release should distinguish fixture-only validation from runtime-backed validation.

Dispatch: use `S2 - Scenario runtime runner and validation truthfulness`.

### 6. Package And Version Readiness Still Has Gaps

`.intera-agent.json` is directionally correct, but package export/import is not yet complete for delivery sharing:

- Scenarios are still not fully persisted through package import/export.
- Knowledge and Integration surfaces are still partial/placeholder in Release diffs.
- Agent version history cap of five historical versions is not enforced.

Dispatch: use `PKG1 - Package completeness and version cap`.

---

## P1 Hardening

### Hook HTTP Secret Refs

Hook contracts reserve `secretRefs`, but HTTP Hook execution currently uses handler headers directly. This is acceptable only as a short P0 reservation. Before broader enterprise rollout, add a secret resolver that maps refs to stored credentials without logging raw values.

### Scenario Store Durability

Scenario storage is JSON-backed under `.intera-agent-runtime/`. That is fine for a single-VM first slice only if the runtime path is persisted and backed up. Multi-instance or serious customer deployment needs Prisma-backed Scenarios/Receipts or an explicit durable storage contract.

### Legacy Route/Component Cleanup

Redirects exist for `/admin/playground` and `/admin/guardrails`. Q3-B follow-up has since removed the dead ConfigPilot workbench/drawer path and other unreferenced legacy UI components, but two cleanup boundaries remain relevant:

- large `apps/console/app/admin/playground/page.tsx` still exists as the compatibility implementation source for Pilot Lab `Playground`
- LiveChat `showSkillStatus` internal field names and some archived docs still need careful historical framing so they are not mistaken for current product truth

Dispatch history: this pointed to `Q3 - Legacy route/component cleanup and docs truth pass` at audit time. Current follow-up should only reopen the remaining cleanup if `MASTER_BUILD_HANDOFF.md` still lists it as active.

---

## Verification Snapshot

Against clean committed baseline before in-progress P1 files:

- `git status --short --branch` showed `main...origin/main`.
- `git diff --check` passed.
- `npx tsc --noEmit -p apps/console/tsconfig.json` passed.
- `env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test` passed: 86 files passed, 5 skipped; 679 tests passed, 28 skipped.

After uncommitted P1 files appeared:

- `npx tsc --noEmit -p apps/console/tsconfig.json` fails in `apps/console/lib/config-pilot/apply.ts` and `apps/console/lib/config-pilot/model.ts`.
- `npm run build:console` fails on the same P1 type issue.

Do not push or deploy until the active P1 worktree is either committed green or removed by its owner.

---

## Recommended Next Dispatch Order

1. **P1 repair/complete**: finish ConfigPilot backend/UI/apply route and make gates green.
2. **R3**: implement ProcedureRun runtime overlay, rename system Tools, add `remember`, clean ProcedureRun runtime-state boundary.
3. **S2**: runtime-backed Scenario receipts.
4. **PKG1**: package completeness and version cap.
5. **Q3**: legacy route/component/doc truth cleanup.

Run P1 alone if possible. R3 touches high-collision runtime files and should not overlap with another runtime lane.

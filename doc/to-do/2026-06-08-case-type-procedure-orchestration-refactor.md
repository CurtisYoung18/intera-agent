# Case-Type Orchestration Long-Term Refactor — Procedure-Driven Single Agent, Retire Sub-Agent Fan-out, Case-Type-Scoped Guardrails

**Date:** 2026-06-08 | **Branch:** `main` | **Author:** architect (plan only — code executed by the coding-agent team) | **Status:** 📋 PLAN — awaiting owner review, then dispatch.

> Read [`GENERIC_HANDOFF.md §0`](../handoffs/GENERIC_HANDOFF.md) first. This plan touches **`schema.prisma` (the documented hotspot)** and the **core agent loop / policy engine** — declare lanes in `MASTER_BUILD_HANDOFF.md` Active Lanes before any file is touched, and sequence the schema + loop phases as single owned lanes.
>
> **⛓️ Hard dependency:** This plan overlaps [`2026-06-08-model-page-long-term-refactor.md`](./2026-06-08-model-page-long-term-refactor.md) on `loop.ts`, `buildModePrompt.ts`, `prompt-resolver.ts`, and the case-types pages. **Do not run this plan's Phase 4–6 until the model-page refactor has landed (esp. its Phase 5 schema + Phase 2 prompt cleanup).** Phases 0–3 here are additive and can run in parallel on non-overlapping files if lanes are declared. This is "page 2/N" of the long-term console pass (playground was 1/N).
>
> 🧭 **Architect corrections (owner-approved 2026-06-08, from [`doc/2026-06-08-long-term-architecture-review.md`](../2026-06-08-long-term-architecture-review.md)):**
> 1. **No draft-gate.** Phase 6 ships against the existing version system, not a `useDraftGate` hook (it was removed and does not exist). §3.5 + Phase 6 updated.
> 2. **Parallel sequencing with the foundation lane (P0).** Phases 0–3 (additive) run **concurrently with the safe-local-DB / dev-prod-parity foundation lane** on non-overlapping files. **Gate Phases 4–6 on the foundation landing** — they need real local-DB e2e and SELECT-only prod (memory `project_local_db_is_production`), which the foundation provides. Without it, Phase 0/2/3/5 inherit the verification-skip pattern.
> 3. **Fold in loop decomposition (G10/TODO-17).** Phase 5 already rewrites `loop.ts`; collapse the dual ReAct loops (`react-loop.ts`/`sub-agent.ts` vs the main `do…while`) and the misnamed `ConversationLoop`/`CaseAgentLoop` strategy objects into "Core loop + `ProcedureExecutor` on one engine" — don't defer it.

---

## 1. Why (diagnosis)

A single concept — *how a case type is executed* — has accreted **three overlapping, partly-contradictory implementations**, all hung on `CaseAgentLoop`. This is the bottleneck.

### 1.1 Three coexisting execution models

| Model | Trigger | Runtime | Reality |
|---|---|---|---|
| **A. Stage state-machine** (`executionMode:'stage'`, default) | all 6 seeded case types | `StageExecutor` ([stage-executor.ts](../../apps/console/lib/agent/stage-executor.ts)): fixed `stages`, per-stage tool allowlist, `evidenceRequirements`, transition eval (rule / LLM gate / circuit breaker), escalating nudges | **the only path actually running** — and the heaviest |
| **B. SOP / `cc` mode** (`executionMode:'cc'`) | **0 seeded case types** (only test factory [agent-loop.ts:26](../../apps/console/lib/agent/__tests__/factories/agent-loop.ts)) | main agent follows free-text `sop` + self-managed todos + full toolset ([case-agent-loop.ts:127](../../apps/console/lib/agent/case-agent-loop.ts)) | built but **unshipped**; closest to Fin + to our own philosophy |
| **C. Sub-agent fan-out** | `dispatch_case_agent` ([tool-interceptor.ts:108](../../apps/console/lib/agent/tool-interceptor.ts)) + per-stage `subAgents` | `OrchestratorAgent` ([orchestrator.ts](../../apps/console/lib/agent/orchestrator.ts)): parallel/serial, fork cache, `dispatchInBackground`, message bus, dashboard polling | **effectively dead code** (evidence below) |

### 1.2 The sub-agent subsystem is dormant/vestigial (the key finding)

- `DEFAULT_ORCHESTRATOR_CONFIG = { enabled: true, … }` ([defaults/index.ts:724](../../packages/shared/defaults/index.ts)) — on by default — **yet none of the 6 seeded case types define any `subAgents`** in `DEFAULT_STAGE_CONFIGS` ([defaults/index.ts:363](../../packages/shared/defaults/index.ts)). So per-stage parallel investigation never fires — `startDedicatedAgents()` early-returns ([case-agent-loop.ts:350](../../apps/console/lib/agent/case-agent-loop.ts)).
- The only sub-agent that runs is the **single background `case_agent_*`** spawned by `dispatch_case_agent` — not "parallel specialists," just "run the whole case in the background."
- It sets `needsContinuation = true` ([orchestrator.ts:419](../../apps/console/lib/agent/orchestrator.ts)) with the comment *"the worker will pick it up"* — but **`needsContinuation` has zero readers** (no cron/worker/route consumes it). Cross-request results land in `ChatMemory.skillResults['subagent:*']` but are never surfaced back to the customer. **The continuation chain is broken.**
- Residue: deprecated `SubAgent.investigate*` dual loop ([sub-agent.ts:138](../../apps/console/lib/agent/sub-agent.ts)); ghost prompt references to "sub-agent findings / txnId reverse-lookup" in the deposit `investigating` stage that nothing produces ([defaults/index.ts:403](../../packages/shared/defaults/index.ts)); admin `subAgents` config UI ([sub-agent-form.tsx](../../apps/console/components/admin/sub-agent-form.tsx)) with no live consumer.
- The real, working path is inline: `app/api/messages/route.ts → AgentLoop → CaseAgentLoop` ([messages/route.ts:731](../../apps/console/app/api/messages/route.ts)).

**Conclusion:** the product already runs on a single main agent. The question is not "should we add sub-agents," it is "stop maintaining a heavy, half-wired subsystem nobody uses."

### 1.3 The stage machine contradicts the project's own philosophy

`doc/spec/Intera_Harness_架构梳理.md` (philosophy section, still canonical) states: *"不做 Flow-Chatbot（预先设计好的流程图 + 规则树 + 节点跳转）… Agent 根据当前目标和证据动态决定下一步。"* The default `StageExecutor` is **exactly** a flow-chart + rule-tree + node-jumping engine. Mode B (Procedure/SOP) is the one that matches the philosophy *and* Fin's demo ("Procedure: Deposit Controls" = one agent following an ordered SOP of `Use / Read / Tag` steps, **not** a sub-agent fan-out).

### 1.4 The stage machine's only real residual job is *scoping* — already covered by hooks

Stage does two things that overlap with the G11 guardrail engine:
1. **Tool scoping** — `StageExecutor.filterTools()` ([stage-executor.ts:139](../../apps/console/lib/agent/stage-executor.ts)) positive-allowlists tools per stage.
2. **Guardrail scoping** — `loadStageGuardrails()/clearStageGuardrails()` ([policy.ts:492](../../apps/console/lib/agent/policy.ts)) push/pop `stage:*` hooks on transition.

But **every real guardrail in `DEFAULT_POLICIES` is already agent-global + tool-targeted** (investigate_before_escalation, evidence_required_before_resolution, no_compensation_promise, must_cite_basis, no_high_risk) — none uses stage scope, and the seeded `stageConfigs[*].guardrails` arrays are empty. The G11 hook model ([policy.ts](../../apps/console/lib/agent/policy.ts)) already supports `(tool × phase)` targeting via `match.tools` + `when ∈ {preTool, postTool, preFinalize}`. **So hooks already do the stage machine's hard-constraint job** — meaning stages can be removed without losing enforcement, and **no rigid "escape hatch" mode is needed**.

### 1.5 Terminology + config-surface debt

`executionMode` carries 4 drifting names for overlapping ideas: schema comment says `"stage" | "step"` ([schema.prisma:138](../../packages/shared/prisma/schema.prisma)), code checks `'cc'` ([prompt-selector.ts:66](../../apps/console/lib/agent/prompt-selector.ts)) and normalizes `'sop'→'cc'` ([tool-interceptor.ts:453](../../apps/console/lib/agent/tool-interceptor.ts)). `DEFAULT_ORCHESTRATOR_CONFIG.enabled=true` contradicts the new-case-type form default `{"enabled":false}` ([case-types/page.tsx:78](../../apps/console/app/admin/case-types/page.tsx)). `ChatMemory` carries both `todos` and `agentTodos` + `dashboardVersion` ([schema.prisma:262](../../packages/shared/prisma/schema.prisma)) only the sub-agent path used.

## 2. Decisions taken (owner-approved 2026-06-08)

| # | Decision | Choice |
|---|---|---|
| D1 | Orchestration backbone | **Procedure/SOP is canonical, executed by a single main agent (Case Owner). Demote/retire the stage state-machine.** |
| D2 | Sub-agent subsystem | **Retire** the fan-out (`OrchestratorAgent`, per-stage `subAgents`, `dispatch_case_agent` background spawn, `dispatchInBackground`, `needsContinuation`, message bus, fork cache). Re-introduce only for a genuine parallel/heavy use case (YAGNI). |
| D3 | Procedure configurability | **Structured Procedure** (ordered steps, closed action vocab) **+ per-step natural-language guidance.** |
| D4 | Seed migration | **Seeds are discardable** — author fresh Procedure-based case types; no golden-snapshot fidelity constraint. (Phase 0 confirms prod has no precious org-authored case types.) |
| D5 | Guardrail ↔ case-type binding | **Case-type-centric:** each case type stores an **activated-guardrail name list**; the guardrail library stays agent-global; platform safety-floor is always-on. |
| D6 | Rigid escape hatch | **None.** `Procedure (soft order) + Hooks (hard gates)` fully replace stage gating (see §1.4). |

**Architect-recommended detailed choices (open to change at spec review):**
- **D-a — `dispatch_case_agent` reshape.** Keep the tool, strip the background-agent spawn: it becomes a thin "open/route case" action that sets `caseType` + `procedure` on the **inline** loop. Preserves the discovery→case hand-off semantics; deletes the broken background path.
- **D-b — Loop consolidation in-scope.** Since Phase 5 touches `loop.ts` anyway, fold G10 (loop decomposition) cleanup into it: collapse `CaseAgentLoop` dual-prompt + `StageExecutor` into one `ProcedureExecutor`; rationalize `loop.ts` / `case-agent-loop.ts` / `conversation-loop.ts` / `react-loop.ts` to **Core (discovery) loop + Procedure-execution loop**, both on the shared `AgentLoop.runReActLoop` engine.
- **D-c — `when` checkpoints unchanged.** A Procedure step *is* a tool call, so `preTool`/`postTool` already bracket every step and `preFinalize` covers closure — **no new `perStep` checkpoint.**

## 3. Target architecture

### 3.1 Procedure schema (replaces `stages` / `stageConfigs` / `orchestratorConfig` / `sop` / `executionMode` / `sopMaxAutoTurns`)

New shared contract (`packages/shared/contracts/case-types.ts` + `packages/shared/types/index.ts`):

```ts
// One closed, operator-legible action vocabulary.
type ProcedureAction =
  | 'use'      // call a tool/skill                target = tool name
  | 'read'     // gather data (read-only tool / KB / memory / prior case)  target = source id
  | 'ask'      // collect from customer            target = form/field set (ask_user_questions)
  | 'decide'   // natural-language branch point    target?: label; when carries the condition
  | 'tag'      // label the case/customer          target = tag value
  | 'escalate' // hand to a human                  target = queue (create_human_task)
  | 'finalize' // close the case                   target?: 'resolved'|'consultation' (finalize_case/_consultation)

interface ProcedureStep {
  id: string                 // stable, unique within the procedure
  action: ProcedureAction
  target?: string            // typed by action (tool name / source / tag / queue …)
  guidance?: string          // per-step natural-language instruction (D3)
  when?: string              // optional NL precondition ("only if balance unchanged")
  required?: boolean         // feeds completion check + guardrail derivation
}

interface Procedure {
  steps: ProcedureStep[]     // ordered; agent follows but may adapt (skip when false, reorder if evidence present, loop back)
}
```

Case-level declarative fields that **stay** on `CaseType`: `requiredFacts`, `defaultGoal` (→ `goal`), `escalateOn`, plus new `guardrails: string[]` (§3.2) and `maxAutoTurns` (replaces `sopMaxAutoTurns`, the safety bound). `requireHumanReview` is **removed as a boolean** — expressed as an activated `preFinalize` guardrail (§3.2).

`schema.prisma` `CaseType` ([schema.prisma:117](../../packages/shared/prisma/schema.prisma)): **add** `procedure String?` (JSON `Procedure`), `guardrails String @default("[]")` (JSON `string[]`), `maxAutoTurns Int @default(10)`. **Drop** (Phase 5) `stages`, `stageConfigs`, `orchestratorConfig`, `sop`, `executionMode`, `sopMaxAutoTurns`, `requireHumanReview`.

### 3.2 Hook / guardrail model — case-type-scoped, single registry (D5)

- **One guardrail registry, agent-scoped, loaded once.** The active set for a turn = **platform safety-floor (always-on)** ∪ **the active case type's `guardrails[]`**. No imperative push/pop.
- **`PolicyEngine.create` becomes case-aware:** `PolicyEngine.create(agentConfigId, activeGuardrailNames?: string[])`. With no active case (discovery), only safety-floor + any guardrail flagged always-on load. **Delete** `loadStageGuardrails()` / `clearStageGuardrails()` ([policy.ts:492-515](../../apps/console/lib/agent/policy.ts)) and the `stageLoadedHookNames` state.
- **`match` stays `{ tools?, ifPattern? }`** — the case-type activation list supplies case scope, so **no `match.caseTypes` is needed.** (`match.steps` is deferred — see §7.)
- **`requireHumanReview` → derived guardrail.** Seed a platform guardrail `human_review_before_finalize` (`when:'preFinalize'`, `check.requireTools:['create_human_task']`); case types that need it list it in `guardrails[]`. Removes the special-case branch in `CaseAgentLoop.handleFinalizeCase` ([case-agent-loop.ts:660](../../apps/console/lib/agent/case-agent-loop.ts)).
- **Orphan safety (the cost of D5):** the case-types API validates `guardrails[]` references only existing guardrail names; deleting a guardrail surfaces which case types reference it (block or warn). New helper + guard test.
- **Tool availability:** drop per-stage positive allowlisting. The agent gets the full relevant toolset; the Procedure guides *when* to call *what*; hard prohibitions are `denyTools` guardrails. `StageExecutor.filterTools` ([stage-executor.ts:139](../../apps/console/lib/agent/stage-executor.ts)) is deleted with the stage machine.

### 3.3 Runtime — `ProcedureExecutor` (+ loop consolidation, D-b)

New `apps/console/lib/agent/procedure-executor.ts` replacing `stage-executor.ts` + the case branch of `case-agent-loop.ts`:
- **Renders** the `Procedure` into the case-mode system prompt (ordered steps + per-step `guidance`, Fin-style numbered list) and **seeds the todo list** from the steps.
- **Completion check:** all `required` steps satisfied (their tool called / fact present) **and** `finalize` reached. Replaces evidence/skill checks + `evaluateTransition` + the nudge ladder.
- **Adaptation:** the agent follows order but may skip a step whose `when` is false, merge already-present evidence, or loop back. Parallel independent `use`/`read` steps execute via native parallel `tool_use` (no sub-agents).
- **Procedure × Hooks interplay:** Procedure = soft order; hooks = hard gates. When the agent jumps ahead, the `preTool` hook blocks → `feedbackMessage` ([policy.ts:439](../../apps/console/lib/agent/policy.ts)) → agent does the prerequisite and retries. **This block→feedback→retry loop replaces the escalating stage nudge** ([stage-executor.ts:480](../../apps/console/lib/agent/stage-executor.ts)).
- Reuses `AgentLoop.runReActLoop` ([loop.ts:1315](../../apps/console/lib/agent/loop.ts)).

`prompt-selector.ts` ([prompt-selector.ts](../../apps/console/lib/agent/prompt-selector.ts)) collapses to: discovery (no case) → `conversationLoop`; consultation (waiting human) → ack-only; **case active → ProcedureExecutor** (single branch; the `executionMode==='cc'` / stage split at lines 66/78 is deleted).

### 3.4 `dispatch_case_agent` reshape (D-a)

`handleDispatchCaseAgent` ([tool-interceptor.ts:108](../../apps/console/lib/agent/tool-interceptor.ts)): keep case creation + `case_created` SSE; **delete** the `OrchestratorAgent` construction, `planInvestigation`, `dispatchInBackground`, and `sub_agent_start` emission (lines ~168-230). It sets the resolved `caseType` + `procedure` for the inline loop to pick up. `processDispatchSubagent` ([tool-interceptor.ts:405](../../apps/console/lib/agent/tool-interceptor.ts)) and the `dispatch_subagent` tool are deleted.

### 3.5 Console — Procedure Builder + guardrail activation

`apps/console/app/admin/case-types/[name]/page.tsx`: replace stage/JSON editors with a **Procedure Builder** — a drag-reorderable step list; each row = `{ action (select), target (typed picker), guidance (text), when (text), required (toggle) }`; plus a **guardrail activation** multi-select sourced from the agent's guardrail library (orphan-safe). ~~Reuse the draft→publish gate the model-page refactor introduces.~~ **CORRECTED (architect, owner-approved 2026-06-08): there is no draft→publish gate — the model page's gate was built then removed (`f22adf59`); `useDraftGate` does not exist.** Ship the Procedure Builder against the **existing version system** (`agent-version-picker` fork/activate), the same way every other config page persists today. Delete `sub-agent-form.tsx` + `sub-agent-summary-list.tsx`.

## 4. Affected-files map (ripple — enumerate so nothing silently breaks)

**Shared contracts/types/schema:** `packages/shared/contracts/case-types.ts` (Procedure + guardrails fields), `packages/shared/types/index.ts` (`Procedure`/`ProcedureStep`/`ProcedureAction`; drop `executionMode`, `CaseSchemaConfig.stages*`, `SubAgentConfig`, `SubAgentTask`, `SubAgentResult`, orchestrator types), `packages/shared/prisma/schema.prisma` (CaseType fields §3.1; ChatMemory drop `agentTodos`/`dashboardVersion`/`needsContinuation`/`continuationLock`), new migration(s), `packages/shared/prisma/seed.ts` + `packages/shared/defaults/index.ts` (rewrite `DEFAULT_CASE_TYPES` as Procedures; delete `DEFAULT_STAGE_CONFIGS`, `DEFAULT_ORCHESTRATOR_CONFIG`; add `human_review_before_finalize` to `DEFAULT_POLICIES`), `packages/shared/prisma/sqlite-schema-compat.ts`.

**Agent runtime:** **delete** `orchestrator.ts`, `sub-agent.ts`, `stage-executor.ts`; **create** `procedure-executor.ts`; **rewrite** `case-agent-loop.ts` (→ thin Procedure host), `prompt-selector.ts` (single case branch), `tool-interceptor.ts` (§3.4), `policy.ts` (case-aware `create`, delete stage-guardrail methods §3.2); **edit** `loop.ts` (drop `mergeNewSubAgentResults`/sub-agent SSE at [loop.ts:294](../../apps/console/lib/agent/loop.ts), wire `ProcedureExecutor`), `react-loop.ts`/`conversation-loop.ts` (consolidation D-b), `streaming-tool-executor.ts` + `sub-agent.ts` ChecklistStrategy refs, `dry-run-executor.ts` ([dry-run-executor.ts:31](../../apps/console/lib/agent/dry-run-executor.ts) `dispatch_case_agent` mock), `tool-classifications.ts` ([tool-classifications.ts:7](../../apps/console/lib/tool-classifications.ts)).

**API routes:** `app/api/messages/route.ts` (`schemaFromCaseTypeRow` [route.ts:86](../../apps/console/app/api/messages/route.ts) → procedure; drop `executionMode`), `app/api/admin/case-types/route.ts` + `[name]/route.ts` (Procedure + `guardrails[]` validation, orphan check), `app/api/admin/policies/[name]/route.ts` (orphan-on-delete).

**UI:** `app/admin/case-types/[name]/page.tsx` (Procedure Builder), `app/admin/case-types/page.tsx` (drop `orchestratorConfig` default [page.tsx:78](../../apps/console/app/admin/case-types/page.tsx)), **delete** `components/admin/sub-agent-form.tsx` + `sub-agent-summary-list.tsx` + `agent-synthetic-templates-panel.tsx` (sub-agent refs), `components/ops/runtime-guide-diagrams.tsx` ([:329](../../apps/console/components/ops/runtime-guide-diagrams.tsx)) + `app/ops/guide/page.tsx` (doc the new model).

**i18n:** `lib/i18n/dictionaries.ts` — remove stage/sub-agent/executionMode keys; add Procedure-builder + guardrail-activation keys (en + zh, equal counts — shared hotspot, **pre-declare keys** in your lane).

**Tests:** delete `orchestrator`/`sub-agent`/`stage-executor` tests; add the guard tests in §5; update `case-types-route.test.ts` ([case-types-route.test.ts:9](../../apps/console/app/api/admin/case-types/__tests__/case-types-route.test.ts)) + factories ([factories/agent-loop.ts](../../apps/console/lib/agent/__tests__/factories/agent-loop.ts)).

## 5. Phased plan (each phase independently shippable + two-phase-verified)

> Two-phase verification per [`GENERIC_HANDOFF §0.3`](../handoffs/GENERIC_HANDOFF.md): Phase-1 local gate (`tsc` 0 · keyless `npm test` green · `build:console`) **and** Phase-2 prod browser verification on `demo.anytrans.ai`. Every safety/isolation change ships an e2e guard test with red→green proof (§0.4).

### Phase 0 — Read-only inventory (architect, no code) — ✅ DONE 2026-06-08
> **Inventory:** prod (owner-confirmed read, memory `project_local_db_is_production`) + local seed = **2 case types only** (`deposit_issue`, `general_inquiry`), both `executionMode='stage'`, **no `sop`, empty `stageConfigs`** → **D4 "seeds discardable" confirmed** (no org-authored content to preserve). Per-agent guardrail set (the activation-list source) = `investigate_before_resolve` (preFinalize) + `no_high_risk_account_change` (preTool). No case type on `executionMode='cc'`. Formal prod SELECT-only re-query deferred to pre-Phase-5 (needs tunnel creds; current state already greenlights additive Phases 1–3).
- **Goal:** evidence before destruction (esp. validate D4 "seeds discardable").
- **Steps:** read-only, **SELECT-only** via prod tunnel (local `DATABASE_URL` → prod — see memory `project_local_db_is_production`; **no writes**): `SELECT agent_config_id, type, "executionMode", (sop IS NOT NULL) AS has_sop, length(stage_configs) FROM case_types;` — confirm no org-authored case type carries hand-tuned `stageConfigs`/`sop` worth preserving. `SELECT name FROM policies WHERE enabled;` — catalog guardrail names for the activation lists. Confirm no case type already on `executionMode='cc'` in prod.
- **Verify:** inventory pasted into this doc before Phase 5 runs. If precious org case types exist, escalate to owner (D4 assumed throwaway).

### Phase 1 — Procedure contract + additive schema (no behavior change) — ✅ SHIPPED 2026-06-08 (`6e317b33`)
> Types (`ProcedureAction`/`ProcedureStep`/`Procedure` in `types/index.ts`); zod (`procedureSchema`/`procedureStepSchema` + `parseProcedure`/`parseGuardrails`/`findOrphanGuardrails` in `contracts/case-types.ts`); additive `CaseType.{procedure,guardrails,maxAutoTurns}` (migration `20260608000001`, applied on prod). 12 guard tests (red→green). tsc 0 · keyless 649 · build ✓ · `/admin/case-types` no regression. Fields dormant until Phase 2.
- **Goal:** land the `Procedure`/`ProcedureStep` types + zod contract + additive `CaseType.procedure`/`guardrails`/`maxAutoTurns` columns. Old fields untouched.
- **Guard tests (red→green):** zod round-trips a Procedure; validation **rejects** an unknown `action` and a step missing `id`; `guardrails[]` validation **rejects** a name not in the agent's policy set (orphan check).
- **Verify:** Phase-1 local gate; `db:generate` (standalone embed gotcha #1); deploy; no operator-visible change.

### Phase 2 — `ProcedureExecutor` runtime (additive path, flag-gated by presence of `procedure`) — ✅ SHIPPED 2026-06-08 (`1709b911`+`d4696f9e`)
> `procedure-executor.ts` (render steps / seed todos / required-tool derivation / completion gate); `case-agent-loop` builds it when `caseSchema.procedure` set (`isProcedureMode`/`buildProcedurePrompt`); `prompt-selector` cc branch renders the Procedure; `schemaFromCaseTypeRow` maps the fields; `case-types` POST/PUT persist them (procedure ⟹ `executionMode='cc'`). **Implementation choice:** a procedure reuses the existing **cc** execution path (no new loop branch) — minimal, additive. 8 unit + 2 selector-integration guards; tsc 0 · keyless 659 · build ✓ · prod persistence round-trip verified. **Residual:** live case-mode run not visually confirmed (playground dry-run can't activate a case; needs a non-dry-run turn) — deterministically covered by the selector guard.
- **Goal:** when a `CaseType.procedure` exists, the inline loop runs it via `ProcedureExecutor`; case types without a procedure still use the stage path (additive, no deletion yet).
- **Steps:** create `procedure-executor.ts` (render prompt + seed todos + completion check); branch in `prompt-selector.ts` / `case-agent-loop.ts` on `procedure` presence; reuse `AgentLoop.runReActLoop`.
- **Guard tests:** a procedure `[ask→use(get_latest_deposit)→finalize]` drives the agent through exactly those tool calls; completion is **blocked** until the `required` `use` step's tool has returned and `finalize` is called; a step whose `when` is unmet is skipped without a nudge.
- **Verify:** two-phase; author ONE case type as a Procedure in prod, run it end-to-end through the playground + a live web-chat turn.

### Phase 3 — Case-aware `PolicyEngine` + case-type guardrail activation (additive)
- **Goal:** active guardrail set = safety-floor ∪ case type's `guardrails[]`; seed `human_review_before_finalize`.
- **Steps:** `PolicyEngine.create(agentConfigId, activeGuardrailNames)`; load only the active subset + always-on; delete `loadStageGuardrails`/`clearStageGuardrails`; wire `messages/route.ts` to pass the active case type's `guardrails[]`.
- **Guard tests (red→green):** a case type activating `investigate_before_escalation` **blocks** `create_human_task` before an investigation tool ran; a guardrail **not** in the list does **not** fire; the safety-floor (`no_high_risk_account_change`) fires even when the list is empty; orphan-on-delete surfaces referencing case types.
- **Verify:** two-phase; on the Phase-2 prod Procedure case, trip a guardrail → confirm block + escalation + audit row.

### Phase 4 — Reshape `dispatch_case_agent` + retire sub-agent fan-out (gated on model-page landing)
- **Goal:** remove the dead background-agent path; cases run inline only.
- **Steps:** strip orchestrator spawn from `handleDispatchCaseAgent` (§3.4); delete `orchestrator.ts`, `sub-agent.ts`, `processDispatchSubagent`, the `dispatch_subagent` tool, sub-agent SSE in `loop.ts:294`, and `ChatMemory` writes to `needsContinuation`/`agentTodos`/`dashboardVersion`.
- **Guard tests:** `dispatch_case_agent` opens a case + the inline loop enters Procedure mode with **no** background agent spawned and **no** `needsContinuation` write; deleted-symbol grep is clean.
- **Verify:** two-phase; discovery → open a case → confirm it runs inline to resolution; `/ops/chats` trace shows no orphaned `sub_agent_*`.

### Phase 5 — Delete stage machine + author Procedure seeds + loop consolidation (single owned lane; schema hotspot; **after model-page Phase 5**)
- **Goal:** reach the clean terminal state — one execution path.
- **Steps:** rewrite the 6 `DEFAULT_CASE_TYPES` as Procedures + `guardrails[]` (fresh per D4; carry over KB `caseTypeTag`s); delete `stage-executor.ts`, `DEFAULT_STAGE_CONFIGS`, `DEFAULT_ORCHESTRATOR_CONFIG`, the stage/SOP dual-prompt + `evaluateStage*` in `case-agent-loop.ts`; collapse `loop.ts`/`case-agent-loop.ts`/`conversation-loop.ts`/`react-loop.ts` to Core loop + `ProcedureExecutor` (D-b / G10); migration drops `stages`/`stageConfigs`/`orchestratorConfig`/`sop`/`executionMode`/`sopMaxAutoTurns`/`requireHumanReview` (+ ChatMemory dead columns). Update `types`, `sqlite-compat`, `seed`, all tests.
- **Guard tests:** case-active assembly uses only the Procedure path (no stage branch reachable); fork/create of a case type preserves `procedure`+`guardrails` and omits dropped columns; `pg_dump` taken pre-migration.
- **Verify:** `db:generate` → `build:console` → keyless suite; deploy; prod smoke — open **each** of the 6 re-authored case types and run to resolution; confirm guardrails + human handoff still fire.

### Phase 6 — Console Procedure Builder + guardrail activation UI
- **Goal:** operator can author Procedures + activate guardrails.
- **Steps:** §3.5; **ship against the existing version system** (`agent-version-picker` fork/activate) — **NOT** a `useDraftGate` hook (it doesn't exist; owner-approved 2026-06-08 to drop the gate); delete sub-agent admin components.
- **Guard tests (e2e):** build a 4-step procedure + activate 2 guardrails → save → run in playground → steps execute in order, deactivated guardrails silent.
- **Verify:** two-phase; prod — author a new case type as a Procedure from scratch, save, run a live turn.

## 6. Sequencing, risk, rollback
- **Order is load-bearing:** 0 → 1 → 2 → 3 → (model-page refactor lands) → 4 → 5 → 6. Phases 1–3 are additive (new columns/paths) and revert by commit; they may run in parallel with model-page on **non-overlapping** files (declare lanes; do **not** co-edit `loop.ts`/`buildModePrompt.ts`).
- **Biggest risks:** (a) Phase 5 loop collapse + schema migration colliding with the model-page lane — **mitigate by gating Phase 4–6 on model-page completion** and one lane carrying `loop.ts`; (b) deleting enforcement that something quietly relied on — mitigate by Phase 3 guardrail parity + prod guardrail smoke before Phase 5.
- **Rollback:** Phases 1–4 revert by commit. Phase 5 migration needs a tested down-path (or forward-fix) + pre-applied `pg_dump` (daily backups exist).
- **Parallel-lane:** `schema.prisma` = Phases 1 & 5 own it exclusively (sequence them). `dictionaries.ts` = pre-declare keys.

## 7. Out of scope (flag as follow-ups)
- **Multi-case concurrency** (spec "方案 A" — one user, several live case loops) — unchanged here.
- **Re-introducing sub-agents** for a *genuine* parallel/heavy task, behind an explicit capability — only when a real use case appears (YAGNI).
- **`decide` as a structured branch DSL** and **`match.steps` step-scoped guardrails** — start with natural-language `when` + tool-scoped hooks; structure later only if operators need it.
- **Refresh `Intera_Harness_架构梳理.md`** specifics (paths/tool names/app split are pre-consolidation) — philosophy stays canonical; tracked in §8 handoff updates.

## 8. Definition of done
- One case-prompt + execution path: **Procedure via `ProcedureExecutor`**. `StageExecutor`, `OrchestratorAgent`, `SubAgent`, `executionMode`, `sop*`, per-stage `subAgents`/allowlist **gone from schema + code**.
- Guardrails are **case-type-activated** (`CaseType.guardrails[]`) over a single agent-global registry + always-on safety floor; `requireHumanReview` is a derived guardrail; orphan refs validated.
- `dispatch_case_agent` opens a case inline with **no** background agent; `needsContinuation` and dead `ChatMemory` columns removed.
- 6 case types re-authored as Procedures and **prod-verified** end-to-end (incl. guardrail trip + human handoff).
- Console **Procedure Builder** + guardrail activation live on the existing version system (fork/activate); no draft-gate dependency.
- Handoffs updated: `GENERIC_HANDOFF §1` engine description corrected; `MASTER_BUILD_HANDOFF` status + this guide moved to `doc/what's done/`; schema-comment/`executionMode` drift removed.

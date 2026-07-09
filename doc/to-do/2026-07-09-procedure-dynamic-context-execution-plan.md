# Procedure Dynamic Context Execution Plan

**Status:** Implemented locally, pending production deploy receipt (2026-07-09)
**Source of truth:** `doc/spec/Intera_Harness_架构梳理.md`
**Purpose:** convert the J1N schema/topK hotfix learnings into the next runtime architecture pass: Procedure-driven dynamic context, model-led handoff decisions, and lazy Tool schema exposure.

## Confirmed Decisions

1. Remove the `explicit_human_request` Procedure branch path. The main model should decide when to call `create_human_task`; runtime keeps validation, dedupe, ownership checks, and evidence recording.
2. Treat a Procedure switch as loading a Procedure-specific capability pack through Tools. This is similar to a skill-loading behavior conceptually, but do not introduce `Skill` as a code-level identifier. When the active Procedure changes, replace the injected Procedure guidance/capabilities instead of accumulating every Procedure description in the core prompt. Default replacement depth is current Procedure plus a one-line paused summary of the previous Procedure; expand an older paused Procedure only when the customer explicitly returns to it.
3. Proceed with Tool schema lazy loading. Provider-visible schemas should be selected from the current runtime mode and active Procedure context, not sent as a full fixed registry.
4. Keep the unified knowledge direction. Knowledge sources remain consolidated behind `search_knowledge`; discovery mode exposes all source enums, and Procedure mode may add Procedure guidance while still using the single unified Tool.
5. Trust the model for classification and routing as much as possible. Avoid regex-heavy intent routers; runtime should enforce safety and consistency, not own broad semantic classification.
6. Continue dynamic `topK`. Keep J1N's current pattern: source default `topK=8`, model-controlled `topK`, runtime clamp `1-15`, and monitoring of actual chunk usage.
7. Update UI and trace surfaces in parallel so operators can see which dynamic context blocks, Procedure capability pack, Tool schemas, `search_knowledge` source/topK, and token footprint were active for a turn.
8. Keep `ask_user_questions` and `create_human_task` always-on. Collection ergonomics and handoff safety are more important than the small schema cost.
9. Hide provider-visible legacy `kb_search_*` immediately. `search_knowledge` fully replaces the model-facing KB surface; runtime compatibility for old transcripts can remain non-provider-visible only where needed.
10. Use average prompt footprint per assistant message as the primary acceptance metric. Track billed input and total cost as secondary metrics because traffic mix can move them independently.

## Target Shape

### Runtime Context Compiler

- Compile a minimal per-turn context bundle before the provider call.
- Core prompt carries stable identity, language, safety, memory, handoff discipline, and Tool-use principles only.
- Discovery turns receive a compact Procedure manifest sufficient to choose `start_procedure`.
- Active Procedure turns receive only the active `ProcedureRun` tail, current step, required facts, available actions, completion rules, and relevant source/tool guidance.
- Switching Procedure replaces the prior Procedure-specific capability pack unless a paused Procedure summary is explicitly needed.
- Completed/paused Procedure summaries should be compact and evidence-oriented, not full historical SOP text.

### Tool Schema Loader

- Always-on candidate Tools: `start_procedure`, `search_knowledge`, `ask_user_questions`, `create_human_task`, `read_user_profile`, `remember`, and `get_current_time`.
- Member/business Tools are exposed only when the active Procedure or current Procedure action needs them.
- `finalize_procedure` is exposed only when active Procedure context needs it, not during broad discovery.
- `read_chat_memory` remains a runtime tool but is not part of the discovery always-on provider schema unless a later Procedure/action explicitly needs it.
- Knowledge source visibility stays fully exposed in discovery through `search_knowledge`; Procedure guidance can steer the source without splitting the Tool.
- Runtime keeps rejecting unavailable Tools even if a stale model message or old transcript mentions them.
- Tool filtering must be observable in trace: count, names, reason, and approximate schema footprint.

## Construction Lanes

### Lane A - Remove Explicit Human Branch

- [x] Remove `explicit_human_request` Procedure branch usage from J1N seed Procedures and shared examples.
- [x] Remove or neutralize `explicit_human_request` as a runtime-signal blocker/finalization branch condition where it currently decides control flow.
- [x] Keep `create_human_task` as the durable handoff authority.
- [x] Add tests proving: explicit human request in text does not auto-branch; model-authored `create_human_task` succeeds; duplicate pending task is deduped; handoff promise without Tool remains blocked or repaired by existing Hook rules.

### Lane B - Procedure Capability Pack Injection

- [x] Define the runtime context compiler contract for discovery vs active Procedure turns.
- [x] Move Procedure-specific SOP guidance out of the always-present core prompt into the active Procedure tail.
- [x] On `start_procedure`, inject only the selected Procedure capability pack and current-step guidance.
- [x] On Procedure switch, replace the active pack and retain only compact paused-run summaries when useful.
- [x] Add regression tests for prompt tail size, active Procedure replacement, paused Procedure summaries, and stale ProcedureRun protection.

### Lane C - Lazy Tool Schema Expansion

- [x] Make provider-visible Tool schemas depend on runtime context: discovery, active Procedure, and current action.
- [x] Keep conservative always-on Tools available in discovery.
- [x] Expose member-specific business Tools only after Procedure selection or when the Procedure action requires them.
- [x] Keep unified `search_knowledge`; source availability and descriptions should narrow with Procedure context.
- [x] Preserve compatibility execution for old tool names only behind runtime, not provider-visible schema.

### Lane D - UI And Trace Observability

- [x] Add Trace UI rows for context compiler output: mode, active Procedure, context blocks, selected Tool schemas, schema count, and approximate schema tokens.
- [x] Show `search_knowledge` source, `topK`, result count, latency, and chunk-reduction summary.
- [x] Remove remaining old `kb_search_*` UI affordances except compatibility/debug labels where explicitly needed.
- [ ] Add a comparison view for prompt footprint before/after Procedure context compilation.

### Lane E - Validation And Rollout

- [x] Run focused unit tests for Procedure routing, Tool filtering, Hook handoff safety, unified knowledge, and prompt builder behavior.
- [ ] Run J1B local simulation before production rollout when the local AgentOps simulator is available; owner approved direct production rollout with rollback readiness for this hot path.
- [ ] Roll out directly with rollback readiness after owner approval; dynamic schema filtering defaults on, and legacy KB provider schemas stay hidden.
- [ ] Monitor token footprint, Tool schema count, `topK`, handoff rate, Devanagari leakage, English handoff leakage, and customer-visible failure samples.

## Old-Center Remove List

Remove or retire these centers in the same implementation sequence that introduces the new context compiler behavior:

- Provider-visible legacy `kb_search_*` schema paths.
- Procedure branches or examples that depend on `explicit_human_request` as an automatic runtime branch.
- Prompt blocks that enumerate full business Tool catalogs outside active Procedure context.
- UI labels that imply separate KB tools are still the operator/model surface.
- Tests whose only purpose is to prove the old fixed full-schema behavior.

## Open Questions For Owner Review

- None open from the 2026-07-09 owner review. Decisions are captured above.

## Current Baseline From J1N Hotfix

- Provider-visible Tool count fell from about `23.96` to `9.20` per LLM request in the 16.87h post-hotfix window.
- Approximate schema footprint fell from about `4,429` to `2,800` tokens per LLM request.
- Average prompt footprint fell from about `9,545` to `7,703` tokens per LLM request.
- `search_knowledge` actual average `topK` was about `4.68`; no observed calls used `topK` above `8`.
- Remaining quality follow-up: Romanized Nepali enforcement and English handoff leakage are separate from the schema/context optimization.

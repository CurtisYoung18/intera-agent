> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# AgentLoop Decomposition — Remove Fact Extraction + ReAct Loop Alignment

> **Architect hand-off.** Coding agent executes the tasks below in order. Files are listed per task; within a task, files are disjoint → parallel OK. Steps use `- [ ]`. Architect verified current state against live tree.

**Goal:** Remove the in-loop LLM fact extraction (belongs to sub-agents, not the main loop), delete dead deprecated code, and align the ReAct loop with Claude Code's pattern — only iterate when the model returns `tool_use`, exit on `end_turn`.

---

## Verified current state

| Finding | Evidence |
|---------|----------|
| Fact extraction runs unconditionally on every message | `loop.ts:209-210` — `ingestUserMessageFacts(userMessage, requiredFacts)`, no `isCaseActive` guard |
| No case → default fact targets → still fires LLM call | `memory.ts:147` — `requiredFacts?.length ? requiredFacts : ['txnId','amount','paymentMethod','date']` |
| Fact extraction failure crashes the main loop | `loop.ts:639` sets `streamFatalError` → `:757` exits with `error` transition |
| Deprecated sub-agent code still present | `loop.ts:225-227` — marked `[DEPRECATED]`, kept as no-op |
| `stopReason` parsed but ignored for loop control | `stream-handler.ts:204-205` correctly parses `stop_reason`; `loop.ts:601` records it but never uses it for exit decisions |
| While loop always runs at least once | `loop.ts:237` — `while (iterationCount < maxIterations)`, text-only responses fall through to `message_stop` line 1385 then loop again |
| CC pattern: loop only on tool_use | Claude Code exits on `end_turn`, loops only when `tool_use` present |

---

## WAVE 1 — Delete dead code (pure removal, no logic change)

### Task 1a — Remove fact extraction from main loop
**Owns:** `lib/agent/loop.ts`.

- [ ] Delete lines 208-210 (`ingestUserMessageFacts` call + `requiredFacts` extraction). Do NOT comment out — delete.
- [ ] Delete line 212-217 (form answer re-apply comment + `preIngestedFacts` block) — form answers are already handled by `messages/route.ts:624-631` before the loop starts.
- [ ] Delete lines 219-223 (`memory_update` SSE event) — this was reporting extracted facts; without extraction, there's nothing to report here.
- [ ] Remove unused `preIngestedFacts` parameter from `run()` signature.

**Acceptance:** tsc clean, `grep -n "ingestUserMessageFacts\|preIngestedFacts" lib/agent/loop.ts` returns nothing.

### Task 1b — Delete deprecated sub-agent dispatch
**Owns:** `lib/agent/loop.ts`.

- [ ] Delete lines 225-227 (the `[DEPRECATED]` comment block).

**Acceptance:** tsc clean, `grep -n "DEPRECATED\|Per-stage sub-agent" lib/agent/loop.ts` returns nothing.

---

## WAVE 2 — Align ReAct loop with CC pattern

### Task 2a — Extract first LLM call before the while loop
**Owns:** `lib/agent/loop.ts`.

Currently the LLM stream (lines ~340-610) is inside the `while (iterationCount < maxIterations)` block. Extract the first call outside:

- [ ] Move the first LLM stream call (prompt build + API call + stream consume) to BEFORE the while loop.
- [ ] After the first stream: if `stopReason === 'end_turn'` or `stopReason === 'max_tokens'` → send `message_stop` and `return` immediately. No loop at all for text-only responses.
- [ ] If `stopReason === 'tool_use'` → wait for tools, synthesize S1 results, push tool_result messages, then enter the while loop.
- [ ] Inside the while loop: LLM call → check stopReason → `end_turn`/`max_tokens` → return; `tool_use` → execute tools → continue.

**Acceptance:** 
- A simple "hello" message runs exactly 1 LLM call, not `maxIterations` times.
- A message requiring tools enters the loop only after the first tool_use.
- `tsc` clean.
- Existing livechat + agent tests pass.

### Task 2b — Remove `caseSchema?.executionMode === 'cc'` dead branches (if any)
**Owns:** `lib/agent/loop.ts`.

- [ ] Check whether `executionMode: 'cc'` is ever set on any active case type. If not, delete the `cc`-mode branch in the while loop (prompt building, SOP tool filtering, todo processing). If it IS in use, leave it.
- [ ] Verify by checking DB: `SELECT id, type, "executionMode" FROM "CaseType" WHERE "executionMode" = 'cc' AND enabled = true;`

**Acceptance:** Confirmed cc-mode branch is either live (kept) or dead (removed).

---

## WAVE 3 — Fact extraction as sub-agent task (design only, implement later)

This wave is **design-only** — no implementation in this plan. The decision:

- Fact extraction should fire **only when a case is active** (`isCaseActive === true`).
- It should be triggered by `CaseAgentLoop` (or `OrchestratorAgent`) as a background sub-agent task, NOT inline in the main loop.
- The model should be the agent's configured model (or a sub-agent override), not a separate hardcoded default.
- Failure should not block the main user-visible response.

**Open question for architect:** Should this be a `dispatch_case_agent` sub-agent, or a lightweight inline call within `CaseAgentLoop`? Defer to a separate spec.

---

## Verification (two-phase)

- **Local gate:** `pnpm vitest run apps/console/lib/agent/__tests__/unit` + `tsc --noEmit` green.
- **Production browser test:** Send a simple "hello" → should get text response with exactly 1 LLM call. Send a tool-requiring message → should enter ReAct loop and complete. No `[CaseMemory]` errors in logs.

---

## Open decisions

1. **Fact extraction re-implementation** — Deferred to separate spec. The current `ChatMemory.ingestUserMessageFacts` method is NOT deleted (other code may call it); only the call site in loop.ts is removed.
2. **`preIngestedFacts` parameter** — Removing from `run()` signature may break callers in `messages/route.ts`. Check before deleting.
3. **`memory_update` SSE event** — If the frontend depends on this event for UI state, removing it will cause a visual regression. Check before deleting.

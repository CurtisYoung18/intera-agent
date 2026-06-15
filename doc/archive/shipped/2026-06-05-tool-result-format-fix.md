> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Tool Result Format Fix — Unify ReAct Loop Message Format

> **Architect hand-off.** Coding agent executes the tasks below in order. Files are listed per task; within a task, files are disjoint → parallel OK. Steps use `- [ ]`. Architect verified current state against live tree.

**Goal:** Fix the critical bug where tool failures (e.g., kb_search HTTP errors) cause the ReAct loop to terminate prematurely. Root cause: `addToolResultMessages()` creates assistant text messages instead of Anthropic API-format user tool_result blocks.

---

## Verified current state

| Finding | Evidence |
|---------|----------|
| `addToolResultMessages` creates assistant text messages | `message-builder.ts:28-33` — `role:'assistant'`, content: `"Tool X result: {json}"` |
| S1 synthesis correctly creates user tool_result blocks | `loop.ts:688-713` — structured `{type:'tool_result', tool_use_id, content, is_error}` |
| S1 synthesis only fires for MISSING results | `loop.ts:688` — `if (missingReasons.size > 0)` |
| Successfully executed tools (including errors) go through wrong path | `loop.ts:1054` — `addToolResultMessages(this.messages, toolResults)` |
| react-loop.ts uses correct format | `react-loop.ts:148-155` — creates user messages with tool_result content blocks |
| buildApiMessages has no tool_result transformation | `message-builder.ts:46-56` — passes content through as-is |

---

## WAVE 1 — Create unified tool result builder

### Task 1a — New module: `tool-result-manager.ts`

**Owns:** `apps/console/lib/agent/tool-result-manager.ts` (new file)

Create a module that builds Anthropic API-format tool result messages:

- [ ] Export `buildToolResultMessages(results: ToolExecutionResult[]): Message[]`
- [ ] For each result, create a `role:'user'` message with content being an array of `tool_result` blocks:
  ```typescript
  {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: result.toolUse?.id ?? result.name,
      content: JSON.stringify(unwrapToolExecutionPayload(result.output)),
      is_error: (result.output as any)?.ok === false,
    }],
    createdAt: new Date(),
  }
  ```
- [ ] Export `buildToolResultMessageFromSynthesis(synthesisBlocks: ToolResultBlock[]): Message` — wraps S1 synthesis output into the same format
- [ ] Export `buildPolicyFeedbackMessage(feedback: string): Message` — wraps policy feedback as a user message
- [ ] Re-export `unwrapToolExecutionPayload` from `streaming-tool-executor` for convenience

**Acceptance:** `tsc --noEmit -p apps/console/tsconfig.json` → 0 errors. New file compiles cleanly.

---

## WAVE 2 — Integrate into AgentLoop

### Task 2a — Replace addToolResultMessages in loop.ts

**Owns:** `apps/console/lib/agent/loop.ts`, `apps/console/lib/agent/message-builder.ts`

- [ ] Import `buildToolResultMessages` from `./tool-result-manager`
- [ ] At `loop.ts:1054`, replace `addToolResultMessages(this.messages, toolResults)` with:
  ```typescript
  const toolResultMsgs = buildToolResultMessages(toolResults)
  for (const msg of toolResultMsgs) this.messages.push(msg)
  ```
- [ ] At `loop.ts:718-721`, replace the policy feedback push with `buildPolicyFeedbackMessage`
- [ ] Keep `addToolResultMessages` in `message-builder.ts` but mark as `@deprecated` — may be used by other callers
- [ ] Verify no other callers of `addToolResultMessages` exist: `grep -rn "addToolResultMessages" apps/console/`

**Acceptance:** tsc clean. The S1 synthesis path (lines 688-713) now handles ALL tool results (both missing and completed), since `buildToolResultMessages` produces the correct format. The `missingReasons.size > 0` check can be simplified: always synthesize, using real results where available and error messages where not.

### Task 2b — Simplify S1 synthesis to always run

**Owns:** `apps/console/lib/agent/loop.ts`

Currently S1 synthesis only runs when there are missing reasons. After Task 2a, ALL tool results use the correct format via `buildToolResultMessages`. The S1 synthesis should be refactored:

- [ ] After `toolExecutor.waitForAll()`, ALWAYS call `synthesizeMissingToolResults` — but now `missingReasons` may be empty, in which case it just wraps the completed results into the correct format
- [ ] Remove the separate `addToolResultMessages` call (it's been replaced by the unified path)
- [ ] Ensure the message sequence is:
  1. `assistantMessage` (with tool_use blocks) — pushed at line 1053
  2. User message with `tool_result` blocks — from unified synthesis
  3. Policy feedback user messages — if any
- [ ] Verify `assertToolResultInvariant` still passes

**Acceptance:** Message format matches Anthropic API expectations. `assertToolResultInvariant` passes. tsc clean.

---

## WAVE 3 — Align react-loop.ts

### Task 3a — Verify react-loop.ts consistency

**Owns:** `apps/console/lib/agent/react-loop.ts`

- [ ] Verify that `react-loop.ts` already produces correct-format tool result messages (it should — lines 148-155)
- [ ] If there are differences from the unified format in `tool-result-manager.ts`, align them
- [ ] Add import of shared types from `tool-result-manager.ts` if applicable

**Acceptance:** Both loops produce identical message format. tsc clean.

---

## Verification (two-phase)

### Phase 1 — Local gate
- `npx tsc --noEmit -p apps/console/tsconfig.json` → 0 errors
- `env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test` → all passing
- `npm run build:console` → success

### Phase 2 — Production browser test
1. Open playground, send a message that triggers kb_search tools
2. If kb_search returns an error, verify the model produces a helpful response (not just end_turn)
3. Verify tool trace sidebar still shows correct status (executing → completed/error)
4. Verify no console errors in browser dev tools

---

## Changed files (expected)

| File | Change |
|------|--------|
| `apps/console/lib/agent/tool-result-manager.ts` | **NEW** — unified tool result builder |
| `apps/console/lib/agent/loop.ts` | Replace addToolResultMessages with unified format |
| `apps/console/lib/agent/message-builder.ts` | Mark addToolResultMessages as @deprecated |
| `apps/console/lib/agent/react-loop.ts` | Verify/align format (minor) |

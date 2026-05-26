# S1 — Tool-Result Invariant

> **Wave 1, sub-project 1 of 6.** Part of the Intera-vs-CC alignment audit.
> **Predecessor**: 2026-05-26 audit decomposition (S1–S6).
> **Scope cut**: stream-truncation gets a synthetic result here; the retry/fallback policy itself is S2.

---

## 0. The invariant (one sentence)

> **For every `tool_use` block the model emits, exactly one `tool_result` block with the same `tool_use_id` is present in the next user message that goes to the LLM API.**

If we cannot produce a real result, we synthesize one. We never call the API with an unmatched `tool_use`.

---

## 1. Why this is a P0 stability bug

The Anthropic Messages API enforces that every `tool_use` in an assistant message has a matching `tool_result` in the next user message. When the invariant breaks:

1. The API rejects the next call with HTTP 400 — *or*
2. (Worse) The provider accepts it but the model behaves as if the tool silently failed → fabricates output, claims it called a tool it never called, or loops trying to re-invoke.

This is the root cause of the symptom **"Intera says it wants to call a tool but actually it didn't"**.

### Where the invariant breaks today

| # | Site | Current behavior | Why it breaks the invariant |
|---|---|---|---|
| 1 | Policy-blocked tool ([loop.ts:697-725](apps/chat/lib/agent/loop.ts#L697)) | Injects a user feedback message, does NOT push a `tool_result` for the blocked `tool_use_id`. `continue`s the inner switch. | Next API call has `tool_use` without `tool_result`. |
| 2 | Stream truncated mid-`tool_use` ([loop.ts:633-733](apps/chat/lib/agent/loop.ts#L633)) | `content_block_stop` never arrives → block stays in `blocks` Map with `completed: false`. Tool is never enqueued. | Assistant message contains the partial `tool_use` (because `fullText` includes everything streamed) but no matching `tool_result`. |
| 3 | Tool name unknown ([streaming-tool-executor.ts:71-82](apps/chat/lib/agent/streaming-tool-executor.ts#L71)) | Pushes a synthetic error result. ✓ Already correct. | — |
| 4 | Zod schema rejection ([streaming-tool-executor.ts:179-197](apps/chat/lib/agent/streaming-tool-executor.ts#L179)) | Pushes a synthetic error result. ✓ Already correct. | — |
| 5 | HTTP/mock execution exception ([streaming-tool-executor.ts:221-229](apps/chat/lib/agent/streaming-tool-executor.ts#L221)) | Pushes an `ok: false` result. ✓ Already correct. | — |
| 6 | Stream error before any `tool_use` enqueued ([loop.ts:769-803](apps/chat/lib/agent/loop.ts#L769)) | Drains `toolExecutor.waitForAll().catch(() => {})` then `break`s out of the outer while-loop. Any `tool_use` block already streamed is now orphaned. | Next iteration sees assistant message with orphaned `tool_use`. |
| 7 | Sibling tool errors mid-batch | No sibling-abort. All concurrent tools run to completion. | Invariant not broken, but tools that would have errored anyway waste budget. (Out of scope for S1 — note below.) |
| 8 | `evaluateContinuation` returns `complete_task` / `stop` while tools are still in-flight ([loop.ts:2033](apps/chat/lib/agent/loop.ts#L2033)) | Loop breaks; in-flight tools may still resolve into `toolResults` but their outputs go unused. | If next iteration ever runs (e.g. via resume) those tools' `tool_use_id`s have no matching result. |

### What CC does that we don't

[`claude-code-source-code-ref-only/query.ts:123-149`](claude-code-source-code-ref-only/query.ts#L123) defines `yieldMissingToolResultBlocks` — a generator that walks every assistant message, finds every `tool_use` block, and yields a synthetic `tool_result` for each. CC calls this from three different recovery sites (lines 900, 984, 1025) — every place the query loop has to bail without naturally producing results.

[`claude-code-source-code-ref-only/services/tools/StreamingToolExecutor.ts:153-216`](claude-code-source-code-ref-only/services/tools/StreamingToolExecutor.ts#L153) defines `createSyntheticErrorMessage` with three discrete reasons (`sibling_error`, `user_interrupted`, `streaming_fallback`) — each gets a specific user-facing error string so the model knows what happened.

We're going to import the same two primitives.

---

## 2. Design

### 2.1 New primitive: `synthesizeMissingToolResults`

**Location**: `apps/chat/lib/agent/tool-result-invariant.ts` (new file).

```ts
import type { Message, ToolUse } from '@intera/shared/types'

export type SynthesisReason =
  | 'policy_blocked'      // PolicyEngine.preTool denied execution
  | 'incomplete_tool_use' // stream truncated before content_block_stop
  | 'stream_aborted'      // outer stream error before tool ran
  | 'loop_terminated'     // ExecutionPolicy returned complete/stop while in-flight
  | 'sibling_error'       // a concurrent sibling failed (reserved — used by S2)

const ERROR_STRINGS: Record<SynthesisReason, string> = {
  policy_blocked:
    'Tool blocked by policy. See feedback message in conversation for details.',
  incomplete_tool_use:
    '<tool_use_error>Tool input was truncated by a connection error. Please re-invoke the tool with complete input.</tool_use_error>',
  stream_aborted:
    '<tool_use_error>The stream ended before this tool could execute. The conversation will continue without its result.</tool_use_error>',
  loop_terminated:
    '<tool_use_error>The agent loop terminated before this tool completed. Result discarded.</tool_use_error>',
  sibling_error:
    '<tool_use_error>Cancelled: a sibling tool call errored.</tool_use_error>',
}

export interface SynthesisInput {
  /** All tool_use blocks the model produced this iteration. */
  toolUses: ToolUse[]
  /** Tool execution results that completed normally (real or executor-synthesized). */
  completedResults: Array<{ toolUseId: string; output: unknown; isError: boolean }>
  /** Mapping of tool_use_id → reason for missing result. */
  missingReasons: Map<string, SynthesisReason>
}

/**
 * Produces the tool_result blocks for a single follow-up user message,
 * guaranteeing one tool_result per tool_use.
 *
 * Caller is responsible for wrapping the returned blocks in a user Message.
 */
export function synthesizeMissingToolResults(
  input: SynthesisInput,
): ToolResultBlock[] {
  // For each toolUse, find a completed result or synthesize from missingReasons.
  // Throw (and trace) if neither exists — that's a programmer error.
}
```

### 2.2 New invariant check: `assertToolResultInvariant`

**Location**: same file.

Pure function that runs **immediately before every API call** in `loop.ts`. Walks the message list backward to find the last assistant message; checks every `tool_use` block in it has a matching `tool_result` in the messages that follow. Throws if the invariant is violated.

Wired in only behind `process.env.INTERA_INVARIANT_CHECK === '1'` for the first month so production traffic doesn't pay the cost; in dev/test it's always on.

### 2.3 Fixes per failure site

**Fix #1 — Policy-blocked tool** ([loop.ts:697-725](apps/chat/lib/agent/loop.ts#L697)):

Currently:
```ts
if (preToolEval.summary === 'blocked') {
  // ... emit policy_blocked event ...
  if (preToolEval.feedbackMessage && assistantMessage) {
    if (!assistantPushed) {
      this.messages.push(assistantMessage)
      assistantPushed = true
    }
    this.messages.push(this.makeUserMessage(preToolEval.feedbackMessage))
  }
  continue
}
```

Change to:
```ts
if (preToolEval.summary === 'blocked') {
  // ... emit policy_blocked event ...
  // Record reason — the post-stream sweep will synthesize the tool_result.
  missingReasons.set(toolUse.id, 'policy_blocked')
  // Still emit the feedback as a separate user message (the model needs to see WHY).
  // But the feedback message must come AFTER the tool_result, not replace it.
  pendingPolicyFeedback.push(preToolEval.feedbackMessage)
  continue
}
```

The `missingReasons` map is iteration-scoped, declared at the top of the `while` loop body.

**Fix #2 — Stream truncated mid-`tool_use`**:

After stream loop exits, walk `blocks` Map. For any `tool_use` block with `completed: false`:
- If `content` is partially-formed JSON → still try to enqueue (current `JSON.parse(... || '{}')` fallback handles this for some cases).
- If `content` is empty or unparseable → record `missingReasons.set(block.id, 'incomplete_tool_use')`.

**Fix #6 — Outer stream error**:

In the `catch (streamErr)` block at [loop.ts:769](apps/chat/lib/agent/loop.ts#L769):
- Walk `blocks` Map for any `tool_use` blocks (completed or not).
- For each: `missingReasons.set(block.id, 'stream_aborted')`.
- Then the post-stream synthesis builds the user message and pushes it.
- Then `break` (current behavior). Next user message in the conversation will be a real one; the assistant message + synthetic tool_results survive in the history.

**Fix #8 — Loop terminated while tools in-flight**:

In the `evaluateContinuation` paths that return `complete_task` / `stop`:
- Call `toolExecutor.waitForAll()` first (Intera already does in some paths).
- If any tool didn't finish (timeout, abort), record `loop_terminated`.

### 2.4 Post-stream synthesis flow (new)

Replace the current ad-hoc "push tool results and continue" pattern. New flow at the bottom of each iteration:

```ts
// 1. Wait for all tool executions to finish (or abort).
const toolResults = await toolExecutor.waitForAll()

// 2. Collect all tool_use_ids the model produced this iteration.
const toolUseIds = [...blocks.values()]
  .filter((b) => b.type === 'tool_use')
  .map((b) => b.id)

// 3. Build a map of completed results.
const completedMap = new Map(
  toolResults.map((r) => [r.toolUse?.id ?? r.name, r.output]),
)

// 4. For any tool_use_id without a completed result AND without a missingReasons
//    entry, record 'stream_aborted' (defensive default).
for (const id of toolUseIds) {
  if (!completedMap.has(id) && !missingReasons.has(id)) {
    missingReasons.set(id, 'stream_aborted')
  }
}

// 5. Build one user message with ALL tool_result blocks.
const toolResultBlocks = synthesizeMissingToolResults({
  toolUses: [...blocks.values()].filter((b) => b.type === 'tool_use'),
  completedResults: toolResults.map((r) => ({
    toolUseId: r.toolUse?.id ?? '',
    output: r.output,
    isError: (r.output as { ok?: boolean })?.ok === false,
  })),
  missingReasons,
})

this.messages.push(this.makeUserToolResultsMessage(toolResultBlocks))

// 6. Now (after the tool results) push any policy feedback messages.
for (const feedback of pendingPolicyFeedback) {
  this.messages.push(this.makeUserMessage(feedback))
}

// 7. Run invariant assertion in dev.
if (this.invariantCheckEnabled) {
  assertToolResultInvariant(this.messages)
}
```

### 2.5 New helper: `makeUserToolResultsMessage`

Currently `makeUserMessage(content: string)` only builds text-only user messages. Add a sibling that takes `ToolResultBlock[]` and builds a proper structured user message. Touch [loop.ts:`makeUserMessage`](apps/chat/lib/agent/loop.ts) — find it via grep.

### 2.6 Apply the same fix to `runReActLoop` (sub-agent path)

`AgentLoop.runReActLoop` ([loop.ts:1619](apps/chat/lib/agent/loop.ts#L1619)) is a parallel implementation used by sub-agents and consultation. It has the same failure modes 1, 2, 6 (the sub-agent doesn't use PolicyEngine.preTool — uses ChecklistPolicy.handleTerminalTool instead, which has its own block path). Apply the same synthesis flow there.

---

## 3. Out of scope (explicit)

- **Stream → non-streaming retry** (CC's `streaming_fallback`). That's S2.
- **Sibling abort** (CC's `siblingAbortController`). Useful, but not invariant-related. Defer to S3 or a separate ticket.
- **`canUseTool` permission UX** (CC's interactive permission prompts). N/A for customer-service; we have PolicyEngine.
- **Per-tool concurrency policy** (CC's `isConcurrencySafe(input)` dynamic flag). That's S4.

---

## 4. Acceptance criteria

### 4.1 Unit tests

- [ ] `synthesizeMissingToolResults` produces N tool_result blocks for N tool_uses, regardless of how many came from `completedResults` vs `missingReasons`.
- [ ] Throws when a tool_use has neither a completed result nor a missing reason.
- [ ] `assertToolResultInvariant` returns silently for a valid message list.
- [ ] `assertToolResultInvariant` throws with a specific message naming the unmatched `tool_use_id` for an invalid list.

### 4.2 Integration tests

- [ ] **Policy block**: configure a `deny_skills: ["refund_money"]` guardrail; ask the agent to refund. Assert: assistant message contains `tool_use:refund_money`, next user message contains `tool_result:refund_money:policy_blocked`, then a separate user message contains the policy feedback text, then the next API call succeeds (no 400).
- [ ] **Stream truncation**: mock the Anthropic client to throw `APIConnectionError` after emitting `content_block_start` for a tool_use but before `content_block_stop`. Assert: next user message has a `tool_result:incomplete_tool_use` for that id; the loop continues into the next iteration without error.
- [ ] **Outer stream abort**: mock the SSE callback to throw `AbortError` after emitting one full tool_use block but before message_stop. Assert: that tool_use gets `stream_aborted` synthetic result; loop terminates with `transition: 'connection_lost'`; persisted messages are still API-valid.
- [ ] **Multiple concurrent tools, one errors**: agent calls 3 read-only tools in parallel, one throws. Assert: all 3 produce results (1 ok, 1 ok, 1 error — *not* `sibling_error`, that's S3); invariant holds.

### 4.3 Production smoke test

After deploy, scan one week of `case_*` debug logs:
- [ ] Zero API calls with unmatched `tool_use` blocks.
- [ ] `loop_decision` traces with `reason: 'no_tools'` no longer correlate with cases where the model's text said "I'll call X" (manual sampling, n=20).

---

## 5. File map

### New
- `apps/chat/lib/agent/tool-result-invariant.ts` — primitives.
- `apps/chat/lib/agent/__tests__/tool-result-invariant.test.ts` — unit tests.
- `apps/chat/lib/agent/__tests__/tool-result-integration.test.ts` — integration tests with mocked Anthropic client.

### Modified
- `apps/chat/lib/agent/loop.ts` — fixes #1, #2, #6, #8; wire post-stream synthesis at the end of each iteration in both `run` (main loop) and `runReActLoop` (sub-agent loop).
- `apps/chat/lib/agent/streaming-tool-executor.ts` — minor: ensure `toolUse.id` is populated on every result (currently optional on `ToolExecutionResult`).
- `packages/shared/types/index.ts` — add `ToolResultBlock` and `SynthesisReason` types if not already present.

### Untouched
- `policy.ts`, `case-agent-loop.ts`, `sub-agent.ts`, `orchestrator.ts` — behavior preserved; only the call site that follows their decisions changes.
- Database schema, Prisma models, API contracts — unchanged.
- All console UI — unchanged.

---

## 6. Risk + rollback

**Risk 1**: the invariant check in dev catches latent invariant breaks we didn't account for. *Mitigation*: gate the assertion behind `INTERA_INVARIANT_CHECK` env var; log-and-continue mode in staging before throwing in dev.

**Risk 2**: synthetic `policy_blocked` results change how the model reasons about policy violations vs the current "feedback message" pattern. *Mitigation*: keep the feedback message — the synthetic result is short ("Tool blocked by policy. See feedback message…"), the feedback message carries the real explanation, and the model sees both in order.

**Risk 3**: post-stream synthesis adds ~50ms per iteration. *Mitigation*: it's O(n) in tool_use blocks, n is typically <5; negligible.

**Rollback**: feature-flag the new synthesis path via `INTERA_TOOL_RESULT_SYNTHESIS=0`. Old behavior is one `git revert` away.

---

## 7. Estimated effort

| Task | Effort |
|---|---|
| `tool-result-invariant.ts` + unit tests | 1 day |
| Wire into main `run` loop | 1 day |
| Wire into `runReActLoop` | 0.5 day |
| Integration tests (3 scenarios) | 1 day |
| Smoke test + adjustments | 1.5 days |
| **Total** | **~1 week** |

---

## 8. Hand-off to implementer

Read this whole doc, then:
1. Start with `tool-result-invariant.ts` + its unit tests. TDD: write the test first, watch it fail, implement.
2. Wire into the main loop's post-stream block (loop.ts around line 853). Fix #1 (policy) first because it's the most observable.
3. Add the integration tests. Run them — they will catch fixes you missed.
4. Wire into `runReActLoop`. Same pattern.
5. Enable `INTERA_INVARIANT_CHECK=1` in dev. Manually exercise the chat. Address any throws.
6. Open PR with the smoke-test results from a one-day staging soak.

Do NOT do these in the same PR:
- Refactoring `loop.ts` structure (that's S3).
- Adding retry logic (that's S2).
- Changing the tool interface (that's S4).

# S2 — Centralized Retry & Fallback

> **Wave 1, sub-project 2 of 6.** Part of the Intera-vs-CC alignment audit.
> **Predecessor**: S1 (tool-result invariant) — recommended to ship first so synthesis-on-failure is in place.
> **Out of scope**: loop structure refactor (S3), tool interface (S4), channel binding (S5).

---

## 0. The goal (one sentence)

> **Every API call to the LLM goes through one wrapper that classifies errors, retries with backoff, falls back from streaming to non-streaming when needed, and surfaces a typed terminal outcome the caller can switch on — never a silent break.**

When this is in place, the symptom **"Intera quits the loop for no reason"** disappears, because there's exactly one place where "give up" can happen, and it emits a trace + a typed result first.

---

## 1. Why this is P0 stability

### 1.1 Current state — what's broken

**Five different LLM-call sites in [loop.ts](apps/chat/lib/agent/loop.ts), each with its own (or no) retry logic:**

| Line | Caller | Method | Retry today |
|---|---|---|---|
| 514 | main `run()` stream | `messages.stream` | Manual `while (streamAttempt < 2)` — opens the stream, errors mid-stream break the switch |
| 1751 | `runReActLoop()` stream (sub-agent + consultation) | `messages.stream` | Same 2-attempt pattern, duplicated |
| 2404 | `classifyMessage` | `messages.create` | No retry |
| 2465 | `sanitizeLeakedContext` | `messages.create` | No retry |
| 2556 | (find via grep — secondary classifier) | `messages.create` | No retry |
| 2683 | LLM-eval policy | `messages.create` | No retry |

**Symptoms this causes:**

- *Loop exits "for no reason"*: a transient `APIConnectionError` mid-stream (ECONNRESET, EPIPE) throws into the `catch (streamErr)` at line 769 — which `break`s out of the outer `while` loop. The user sees the loop end with no useful message. Trace shows `Stream aborted (connection lost)`.
- *Classifiers and evaluators silently degrade*: when `classifyMessage` fails, the catch returns a default value. The case proceeds with potentially-wrong routing. No retry, no signal.
- *No streaming → non-streaming fallback*: when the stream itself is the problem (provider-specific bugs, mid-stream truncation), there's no way to recover by re-issuing the same request non-streamed. Today the only recovery is "try the stream once more, same way".
- *No model fallback*: if the primary model returns 529 (overloaded), we re-attempt the same overloaded model. Customer-service traffic is bursty; this matters.
- *No header-aware backoff*: `retry-after` headers are ignored. We use a flat `1000 * streamAttempt` ms wait.

### 1.2 What CC does that we don't

**[`claude-code-source-code-ref-only/services/api/withRetry.ts`](claude-code-source-code-ref-only/services/api/withRetry.ts) — a single ~700-line wrapper that:**

1. **Wraps `getClient + operation` as an async generator**, yielding `SystemAPIErrorMessage` so the REPL can show "Retrying… 30s" without blocking. Returns the success result on the final yield.
2. **Classifies errors** via `shouldRetry()` (line 696):
   - `APIConnectionError` → retry
   - 408 timeout → retry
   - 5xx with `x-should-retry: true` → retry
   - Stale connection (ECONNRESET/EPIPE) → drop keep-alive, refresh client, retry
   - 401/403 → refresh OAuth, retry
   - 529 "overloaded" → retry up to `MAX_529_RETRIES`, then trigger model fallback
   - 400 "max_tokens exceed context limit" → adjust `max_tokens` and retry (no compact needed)
   - Everything else → throw `CannotRetryError`
3. **Per-QuerySource policy**: foreground sources (user-blocking) retry 529s aggressively; background sources (classifiers, summaries) bail immediately on 529 to avoid cascade amplification.
4. **`FallbackTriggeredError`**: thrown when N consecutive 529s exceed threshold. Caller catches it and re-runs with `fallbackModel`.
5. **`getRetryDelay`**: exponential backoff with jitter, honors `retry-after` header.

### 1.3 What this S2 spec ports vs adapts

CC's pattern is the right shape, but it carries CC-specific concerns we don't need:

| CC feature | Intera S2 |
|---|---|
| OAuth401 refresh, Bedrock/Vertex auth | **Drop.** We use a single env-var API key. |
| Fast-mode cache-preservation logic | **Drop.** No fast-mode tier in customer-service. |
| `isClaudeAISubscriber()` gates | **Drop.** Single-tenancy per customer. |
| Persistent retry mode (5min waits, heartbeat yields) | **Drop in S2.** Background jobs can re-architect later. |
| `SystemAPIErrorMessage` yielding for REPL UI | **Replace** with an SSE event `retry_pending`: `{ attempt, delayMs, errorClass }` so the chat widget can show "Reconnecting…". |
| Per-QuerySource retry table | **Keep, simplify.** Two classes: `foreground` (the main user-facing loop, including sub-agents that block on user wait) vs `background` (sanitizer, classifier, policy-eval). |
| `parseMaxTokensContextOverflowError` adjustment | **Keep** — already a real Intera bug-fix path. |
| 529 → model fallback | **Keep** — wire to `config.fallbackModel` (new field). |
| `discard()` of streaming attempts | **Keep, wired to S1**: when retry needs to abandon a partially-streamed response, S1's `synthesizeMissingToolResults` handles any orphaned `tool_use` blocks. |

---

## 2. Design

### 2.1 Shape of the wrapper

**New file**: `apps/chat/lib/agent/api/with-retry.ts`

```ts
import Anthropic from '@anthropic-ai/sdk'
import { APIError, APIConnectionError, APIUserAbortError } from '@anthropic-ai/sdk'

export type QuerySource =
  | 'main_loop'         // user-blocking, foreground
  | 'sub_agent_loop'    // user-blocking (orchestrator waits)
  | 'consultation_loop' // user-blocking
  | 'classifier'        // background (message-mode classifier)
  | 'sanitizer'         // background
  | 'policy_eval'       // background (LLM-evaluated guardrails)
  | 'compact'           // memory compaction — background but cannot drop

export type ErrorClass =
  | 'transient_network'   // ECONNRESET, EPIPE, APIConnectionError
  | 'overloaded'          // 529, "overloaded_error" in message
  | 'rate_limit'          // 429
  | 'context_overflow'    // 400 with input + max_tokens > context_limit
  | 'auth'                // 401 / 403
  | 'timeout'             // 408
  | 'server_error'        // 5xx (not 529)
  | 'malformed_request'   // 400 (other)
  | 'aborted'             // APIUserAbortError
  | 'unknown'

export interface RetryOptions {
  querySource: QuerySource
  model: string
  fallbackModel?: string
  signal?: AbortSignal
  maxRetries?: number             // default per-source (see table below)
  onRetryPending?: (info: {       // SSE bridge — non-blocking
    attempt: number
    delayMs: number
    errorClass: ErrorClass
    message: string
  }) => void
  /** Used by stream → non-streaming fallback to keep total 529 count consistent across attempts. */
  initialConsecutive529?: number
}

export interface RetryContext {
  model: string                    // may change if fallback triggers
  maxTokensOverride?: number       // set by context_overflow handler
  attempt: number
}

export class CannotRetryError extends Error {
  constructor(
    public readonly errorClass: ErrorClass,
    public readonly originalError: unknown,
    public readonly retryContext: RetryContext,
  ) {
    super(`Cannot retry (${errorClass}): ${originalError instanceof Error ? originalError.message : String(originalError)}`)
    this.name = 'CannotRetryError'
    if (originalError instanceof Error && originalError.stack) this.stack = originalError.stack
  }
}

export class FallbackTriggeredError extends Error {
  constructor(
    public readonly originalModel: string,
    public readonly fallbackModel: string,
    public readonly reason: 'consecutive_529' | 'context_overflow_no_room',
  ) {
    super(`Model fallback: ${originalModel} → ${fallbackModel} (${reason})`)
    this.name = 'FallbackTriggeredError'
  }
}

/**
 * Wraps an LLM operation with classified retry + fallback.
 *
 * For streaming: the operation should accept the client and a RetryContext,
 * call client.messages.stream, and return the consumed stream's terminal state
 * (assistant message + usage + stopReason). The caller is responsible for
 * emitting SSE events as the stream progresses; if the stream throws mid-way,
 * withRetry catches and may retry the whole operation.
 *
 * For non-streaming: same shape, return the final Message.
 */
export async function withRetry<T>(
  operation: (client: Anthropic, ctx: RetryContext) => Promise<T>,
  options: RetryOptions,
  getClient: () => Anthropic,
): Promise<T> {
  // implementation below
}
```

### 2.2 Per-source retry policy

```ts
const RETRY_POLICY: Record<QuerySource, {
  maxRetries: number
  retryOn: Set<ErrorClass>
  bailOn529: boolean
}> = {
  main_loop:         { maxRetries: 5, retryOn: SET_OF(transient_network,overloaded,rate_limit,timeout,server_error,context_overflow), bailOn529: false },
  sub_agent_loop:    { maxRetries: 5, retryOn: same as main, bailOn529: false },
  consultation_loop: { maxRetries: 5, retryOn: same as main, bailOn529: false },
  classifier:        { maxRetries: 2, retryOn: SET_OF(transient_network,timeout),    bailOn529: true },
  sanitizer:         { maxRetries: 2, retryOn: SET_OF(transient_network,timeout),    bailOn529: true },
  policy_eval:       { maxRetries: 3, retryOn: SET_OF(transient_network,timeout,server_error), bailOn529: true },
  compact:           { maxRetries: 5, retryOn: SET_OF(transient_network,timeout,overloaded,server_error,context_overflow), bailOn529: false },
}
```

**Rationale:**
- Foreground sources are what the user is waiting on; they tolerate more retries and overloaded waits.
- Background sources should bail on 529 — re-running classifiers during an overload cascade is amplification without user-visible benefit.
- `compact` is special: it's background but failure is catastrophic (the next request will exceed context). Retries through overload.

### 2.3 Classification logic

```ts
function classifyError(err: unknown): ErrorClass {
  if (err instanceof APIUserAbortError) return 'aborted'
  if (err instanceof APIConnectionError) {
    // Inspect cause for ECONNRESET/EPIPE
    return 'transient_network'
  }
  if (err instanceof APIError) {
    if (err.status === 529 || /"type":"overloaded_error"/.test(err.message || '')) return 'overloaded'
    if (err.status === 429) return 'rate_limit'
    if (err.status === 408) return 'timeout'
    if (err.status === 401 || err.status === 403) return 'auth'
    if (err.status === 400) {
      if (parseMaxTokensContextOverflow(err)) return 'context_overflow'
      return 'malformed_request'
    }
    if (err.status >= 500) return 'server_error'
  }
  // Some providers send raw fetch errors
  const msg = String(err).toLowerCase()
  if (msg.includes('econnreset') || msg.includes('epipe')) return 'transient_network'
  return 'unknown'
}
```

### 2.4 Backoff

`getRetryDelay(attempt, retryAfterHeader, errorClass)`:

```
if retryAfterHeader present and parseable → use it (clamped to 60s)
else exponential: min(500ms * 2^(attempt-1), 32_000ms) + jitter (0–25% of base)
overloaded class adds extra +1000ms floor
```

`retry-after` is read from `error.headers?.get('retry-after')`.

### 2.5 Stream → non-streaming fallback

A new option `StreamRetryOptions extends RetryOptions`:

```ts
interface StreamRetryOptions extends RetryOptions {
  /**
   * When the stream itself throws after producing partial output, retry as
   * a non-streaming call. Required because some providers (MiniMax variants)
   * truncate streams under load, and the same input succeeds non-streamed.
   */
  fallbackToNonStreaming?: boolean
}
```

Flow: `withRetryStream` runs the streaming operation; on the **last** retry attempt (or on a specific class like `'transient_network'` after the model produced ≥1 content block), it switches to a non-streaming `messages.create` call with the same payload.

When the fallback fires, the partial assistant content produced by the streaming attempt is **discarded** (matching CC's `discard()`); S1's synthesis path produces tool_results for any orphaned `tool_use` blocks.

The SSE consumer sees `retry_pending` then either a fresh stream or — when fallback fires — a single `message_delta` with the full assistant content and stop_reason.

### 2.6 Model fallback

`config.fallbackModel` is a new optional field on `AgentConfig` (existing `evaluationModel` is a *different* concept — keep it).

Trigger: consecutive `'overloaded'` errors reach `MAX_529_RETRIES = 3`, **and** `options.fallbackModel` is set. The wrapper throws `FallbackTriggeredError`. The caller is expected to catch it once, swap the model in `RetryContext`, and re-invoke the wrapper with `initialConsecutive529: 0`. (Callers don't fall back automatically — keeping the swap explicit at the call site makes the trace cleaner.)

For the main loop, the wrapping looks like:
```ts
try {
  result = await withRetryStream(streamOp, { querySource: 'main_loop', model, fallbackModel, signal, onRetryPending: emit })
} catch (err) {
  if (err instanceof FallbackTriggeredError) {
    this.deps.config.model = err.fallbackModel  // sticky for the rest of this case turn
    result = await withRetryStream(streamOp, { ...same, model: err.fallbackModel, initialConsecutive529: 0 })
  } else {
    throw err
  }
}
```

### 2.7 Context-overflow handler

When `errorClass === 'context_overflow'`:
1. Parse `error.message` for `<inputTokens> + <maxTokens> > <contextLimit>`.
2. Compute `availableContext = contextLimit - inputTokens - SAFETY_BUFFER(1000)`.
3. If `availableContext >= FLOOR_OUTPUT_TOKENS(3000)`: set `ctx.maxTokensOverride = availableContext`, retry (does not count against `maxRetries`).
4. Else: **throw `FallbackTriggeredError` with reason `'context_overflow_no_room'`** if `fallbackModel` is set; otherwise throw `CannotRetryError`.

Today Intera reacts to 413/context_length_exceeded with `reactiveCompact()` ([loop.ts:537-540](apps/chat/lib/agent/loop.ts#L537)) — keep that, but call it from the wrapper instead of inline. S2 owns the trigger; the compaction implementation stays where it is.

### 2.8 Replacing all five call sites

The wrapper has two convenience entry points:
- `withRetryStream(op, opts, getClient)` — for `messages.stream`
- `withRetryCreate(op, opts, getClient)` — for `messages.create`

Each call site swap:

```ts
// BEFORE (loop.ts:514-551, ~40 lines)
let stream
let streamAttempt = 0
while (streamAttempt < 2) {
  streamAttempt++
  try { stream = this.anthropicClient.messages.stream({...}, { signal }); break }
  catch (err) { /* 40 lines of inline handling */ }
}

// AFTER (~6 lines)
const stream = await withRetryStream(
  (client, ctx) => client.messages.stream(
    { model: ctx.model, max_tokens: ctx.maxTokensOverride ?? config.maxOutputTokens, system, messages, tools, ...thinking },
    { signal: this.abortController.signal },
  ),
  { querySource: 'main_loop', model: config.model, fallbackModel: config.fallbackModel, signal, onRetryPending: emit },
  () => this.anthropicClient,
)
```

All five sites switch to `withRetryCreate` / `withRetryStream`. The 413/reactive-compact and `1000 * streamAttempt` blocks delete.

### 2.9 Surfacing retry to the user

A new SSE event type:

```ts
{
  type: 'retry_pending',
  data: { attempt: 2, delayMs: 4000, errorClass: 'overloaded', message: 'Service overloaded, retrying in 4s' },
  timestamp: '...'
}
```

The chat widget renders this as a transient inline notice. Once the next attempt produces `message_start`, the notice clears.

### 2.10 New AgentConfig field

```ts
// packages/shared/types/index.ts (extend AgentConfigData)
fallbackModel?: string  // Optional. Used by main + sub-agent loops on consecutive 529s.
```

Console: expose in the new **Brain** drawer (per [console-audit-v5](doc/to-do/2026-05-26-console-audit-v5.md)) — Generation sub-section, dropdown next to `evaluationModel`. Empty = no fallback. Engine reads it from `config.fallbackModel`. No migration needed (optional column with default null).

---

## 3. Failure-trace contract

Every terminal outcome of `withRetry` writes one trace entry before returning/throwing:

| Outcome | Trace event | payload |
|---|---|---|
| Success on attempt 1 | (none) | — |
| Success after retries | `api_retry_recovered` | `{ attempts, totalDelayMs, lastErrorClass }` |
| `CannotRetryError` | `api_call_failed` | `{ errorClass, attempts, message, querySource }` |
| `FallbackTriggeredError` (caught by caller) | `api_model_fallback` | `{ originalModel, fallbackModel, reason }` |
| `APIUserAbortError` | `api_aborted` | `{ querySource, attempts }` |

The main loop's outer error handler maps these to `LoopResult.transition`:
- `CannotRetryError`'s class → `'waiting_human'` with reason from `errorClass`.
- `APIUserAbortError` → `'connection_lost'`.
- Unhandled → `'error'` (with the trace already written).

**No silent breaks. Every exit from the loop has a trace.**

---

## 4. Acceptance criteria

### 4.1 Unit tests
- [ ] `classifyError` returns the right class for each of: `APIConnectionError`, mock `APIError` with statuses {400 ctx-overflow, 400 other, 401, 408, 429, 500, 529, 503}, `APIUserAbortError`, `new Error('ECONNRESET')`.
- [ ] `getRetryDelay` returns the header value when `retry-after` is parseable; exponential otherwise; jitter in [0, 0.25× base]; overloaded class adds floor.
- [ ] `withRetry` retries on each `retryOn` class for the given source, gives up after `maxRetries`, and emits the right trace.
- [ ] `withRetry` throws `CannotRetryError` immediately on a class NOT in `retryOn`.
- [ ] Consecutive 529s trigger `FallbackTriggeredError` after `MAX_529_RETRIES` if `fallbackModel` is set; throw `CannotRetryError` otherwise.
- [ ] `context_overflow` retry adjusts `maxTokensOverride` and does NOT count against `maxRetries`.

### 4.2 Integration tests
- [ ] **Main loop transient 529**: mock client throws 529 twice, succeeds third time. Assert: loop completes one iteration, 2× `retry_pending` SSE events emitted, trace shows `api_retry_recovered: {attempts: 3}`.
- [ ] **Stream truncates, fallback to non-streaming**: mock the stream to throw `APIConnectionError` after emitting one `tool_use` block. Assert: S1's synthesis emits `incomplete_tool_use` for that tool; S2's `fallbackToNonStreaming` re-issues as `messages.create`; final assistant message contains the non-stream output; loop continues.
- [ ] **Model fallback on 529**: config `model: 'M2.7', fallbackModel: 'haiku'`. Mock 3 consecutive 529s on M2.7, then haiku succeeds. Assert: `FallbackTriggeredError` thrown once, caller re-invokes with haiku, trace shows `api_model_fallback`. `this.deps.config.model` is sticky-`'haiku'` for the rest of the case turn.
- [ ] **Background source bails**: `classifyMessage` mocked to throw 529. Assert: no retry, returns default classification, trace shows `api_call_failed: {errorClass: 'overloaded', querySource: 'classifier'}`. Main loop continues unaffected.
- [ ] **User abort mid-retry**: mock 529 → during 4s backoff, signal aborts. Assert: `APIUserAbortError` propagates within 100ms of abort, no further retries, trace shows `api_aborted`.

### 4.3 Production smoke test (after 1 week)
- [ ] Zero `loop_decision: Exit: LLM API error` traces without a preceding `api_call_failed`. (No silent exits.)
- [ ] Sample 50 cases; verify retry frequency by `errorClass` matches expectations (overloaded retries dominate during peak hours).
- [ ] No regression in P95 case turn latency (centralized backoff shouldn't be slower than scattered ad-hoc retries).

---

## 5. File map

### New
- `apps/chat/lib/agent/api/with-retry.ts` — wrapper, classifier, backoff, types.
- `apps/chat/lib/agent/api/error-classifier.ts` — `classifyError`, `parseMaxTokensContextOverflow`. (Split from with-retry for testability.)
- `apps/chat/lib/agent/__tests__/with-retry.test.ts` — unit tests.
- `apps/chat/lib/agent/__tests__/retry-integration.test.ts` — integration tests with mocked Anthropic.

### Modified
- `apps/chat/lib/agent/loop.ts` — replace 5 call sites with wrapper calls; delete inline `streamAttempt` blocks; map `CannotRetryError` / `FallbackTriggeredError` to `LoopResult.transition`. Estimated ~150 lines net deletion.
- `apps/chat/lib/agent/consultation-agent.ts` — same swap if it has its own call sites (verify with grep).
- `packages/shared/types/index.ts` — add `fallbackModel?: string` to `AgentConfigData`; add `'retry_pending'` to `SSEEvent` union.
- `apps/console/app/admin/agent/page.tsx` + `agent-blueprint.tsx` — add `fallbackModel` dropdown in the Brain drawer (per console-audit-v5 spec).

### Untouched
- DB schema (Prisma column for `fallbackModel` is optional, default null — no migration needed if using JSON config blob; one trivial migration if it's a column).
- `streaming-tool-executor.ts` — no changes; S1 already covered tool-side error synthesis.
- `policy.ts`, all `case-agent-loop.ts` business logic.
- Console aside from the one new dropdown.

---

## 6. Risk + rollback

**Risk 1**: a centralized wrapper might mask a class of error that needs *different* handling at a specific site. *Mitigation*: the per-`querySource` policy table is explicit. New sites pick a source; new sources add a row.

**Risk 2**: `FallbackTriggeredError` requires the caller to re-invoke. If the caller forgets, the model degrades to whatever it last was. *Mitigation*: the wrapper's TypeScript signature returns `Promise<T>`; the error type is thrown not returned. Lint rule: any call to `withRetry*` with `fallbackModel` set must be in a try/catch that handles `FallbackTriggeredError`. Add an eslint custom rule or a Plop scaffold.

**Risk 3**: stream→non-streaming fallback changes the user-perceived latency (no streaming text). *Mitigation*: only happens on the last retry attempt OR on `transient_network` after partial output. Trace `api_fallback_to_create` so we can measure frequency.

**Risk 4**: `model` becomes sticky after fallback for the *case turn* but resets next turn. If `fallbackModel` is consistently used, the trace clarifies why; the operator can promote it to `model` in the console.

**Rollback**: feature flag `INTERA_CENTRAL_RETRY=0` falls back to the old inline retry code paths (keep them around for one release behind a `if (process.env.INTERA_CENTRAL_RETRY !== '0')` guard). Remove after two weeks of green production.

---

## 7. Estimated effort

| Task | Effort |
|---|---|
| `error-classifier.ts` + unit tests | 0.5 day |
| `with-retry.ts` (core wrapper) + unit tests | 1.5 days |
| Stream → non-streaming fallback path + tests | 1 day |
| Wire main loop + sub-agent loop (2 sites) | 1 day |
| Wire 3 background call sites (classifier, sanitizer, policy-eval) | 0.5 day |
| Console `fallbackModel` dropdown | 0.5 day |
| Integration tests (5 scenarios) | 1 day |
| Smoke test + adjustments | 1 day |
| **Total** | **~1.5 weeks** |

---

## 8. Hand-off to implementer

Order of work:
1. Build `error-classifier.ts` first. TDD — every error class needs a test before the function exists.
2. Build `with-retry.ts` core (no streaming fallback yet). Unit-test against a fake Anthropic client. The fake should be programmable: "throw 529 on attempt 1, return result on attempt 2", etc.
3. Add streaming variant `withRetryStream` (just delegates to `withRetry` with a slightly different op signature).
4. Wire the main loop's primary stream call (line 514). Run the existing e2e test (the case-flow integration test under `apps/chat/__tests__/` if it exists, otherwise manual chat exercise). Make sure no regressions.
5. Wire `runReActLoop` (line 1751). Same shape.
6. Wire the 3 background sites — these are the easiest because they're not streaming.
7. Add streaming → non-streaming fallback. This needs S1 landed (it relies on S1's synthesis to handle orphaned tool_uses when the streaming attempt is discarded).
8. Console dropdown + e2e test.
9. Production smoke for one week. Watch the new trace events.

Do NOT do these in the same PR:
- Loop slimming (S3).
- Tool interface changes (S4).
- New retry behaviors for *new* error classes — only port what's documented here. Anything new is a follow-up.

If S1 hasn't shipped yet when starting S2: skip step 7 (streaming→non-streaming fallback) and add it back when S1 is in. The other 6 steps stand alone.

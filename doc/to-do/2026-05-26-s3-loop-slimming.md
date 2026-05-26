# S3 — Loop Slimming

> **Wave 1, sub-project 3 of 6.** Part of the Intera-vs-CC alignment audit.
> **Depends on**: S1 (tool-result invariant) and S2 (centralized retry) — both should land first; their primitives are the seams this refactor extracts against.
> **Out of scope**: tool interface unification (S4), channel binding (S5), console (S6).

---

## 0. The goal (one sentence)

> **Reduce [`loop.ts`](apps/chat/lib/agent/loop.ts) from 2884 lines to under 800 by extracting one shared streaming iteration body, deleting the dead `runReActLoop` instance method, and replacing the non-streaming sub-agent path with the same streaming iteration the main loop uses.**

Result: one place where "an LLM iteration happens", parameterized by policy + memory + tool-set. Sub-agents stop being a different code path. The main loop becomes a thin state machine over that iteration body.

---

## 1. Why this is needed

### 1.1 Three near-duplicate loops, one of them dead

| # | Method | Lines | Streaming? | Caller |
|---|---|---|---|---|
| 1 | `AgentLoop.prototype.run()` ([loop.ts:252](apps/chat/lib/agent/loop.ts#L252)) | ~1200 | yes | Main user-facing flow |
| 2 | `AgentLoop.prototype.runReActLoop()` ([loop.ts:1696](apps/chat/lib/agent/loop.ts#L1696)) | ~350 | yes | **none — dead code** (grep confirms zero callers in source) |
| 3 | `AgentLoop.runReActLoop()` static ([loop.ts:2739](apps/chat/lib/agent/loop.ts#L2739)) | ~140 | **no**, hardcoded `claude-sonnet-4-20250514` | `sub-agent.ts:100` |

Sub-agents using the non-streaming static path means:
- They block per-iteration on full response generation (higher latency).
- They ignore `config.model`, `config.maxOutputTokens`, `config.temperature`.
- They get no `withRetry` even after S2 lands, unless we explicitly add it to that one site.
- The stream-event parsing logic that handles MiniMax/DeepSeek provider quirks (the `seedContent` fallback at [loop.ts:594-609](apps/chat/lib/agent/loop.ts#L594)) doesn't apply to sub-agents.

### 1.2 The 1200-line `run()` is doing too much

Sections of `run()` that should be elsewhere:

| What | Where it lives today | Where it should live |
|---|---|---|
| Per-message `classify('case' \| 'core')` | [`classifyMessage`](apps/chat/lib/agent/loop.ts#L2455) on AgentLoop | A dedicated `pre-iteration/classify-message.ts` module (or removed — see §3.2) |
| LLM-based leak sanitization | [`sanitizeLeakedContext`](apps/chat/lib/agent/loop.ts#L2522) | `post-iteration/sanitize-leaks.ts` (or removed — see §3.2) |
| ReAct-compliance "nudge" eval | [`evaluateReactCompliance`](apps/chat/lib/agent/loop.ts#L2602) | `post-iteration/react-nudge.ts` |
| SOP todo-tool interception | [`processTodoTools`](apps/chat/lib/agent/loop.ts#L2198) + inline auto-complete logic | Already a method; **move into `CaseAgentLoop`** since it's case-specific |
| Stage transition + nudge logic | Inline `if (!forceCoreMode && !isConsultation && this.caseLoop?.hasStageConfigs())` at [loop.ts:1014](apps/chat/lib/agent/loop.ts#L1014) | Already delegated to `caseLoop`; remove the inline pre-check |
| Compaction trigger | [`checkAndCompact`](apps/chat/lib/agent/loop.ts#L2343) | `pre-iteration/compaction-trigger.ts` |
| Stream-event switch (200+ lines) | Inline at [loop.ts:577-767](apps/chat/lib/agent/loop.ts#L577) (run) and again at [loop.ts:1806-1929](apps/chat/lib/agent/loop.ts#L1806) (instance runReActLoop) | One shared `stream-handler.ts` |
| Anthropic-tool building | [`buildAnthropicTools`](apps/chat/lib/agent/loop.ts#L2931) static | `api/build-tools.ts` |

After extraction, `run()` becomes the orchestration: load config → pre-flight → iterate → post-flight. Each step is a one-line call.

### 1.3 What CC's pattern gives us

CC's [`queryLoop`](claude-code-source-code-ref-only/query.ts#L241) (~1500 lines but for the *whole* loop) shows the pattern:

- One mutable `State` struct destructured at the top of each iteration.
- Inline composable steps: `snip → microcompact → context-collapse → autocompact` — each a function call, not 200 lines of nested logic.
- Explicit `Continue | Terminal` transitions at every break point. The `transition` field on State records *why* the previous iteration continued, so test assertions can verify recovery paths fired.
- API call is one line through `withRetry`. Stream consumption is via `runTools` and `StreamingToolExecutor` — both extracted modules.
- Every `continue` writes the new `state = { ... }` once instead of 9 separate assignments.

We're not porting CC's exact generator pattern (Intera uses SSE callbacks, not generator yield) — but we *are* porting:
1. The `LoopState` struct + explicit transitions.
2. The pre-iteration step composition.
3. The single shared stream-handler.
4. The "one place where 'iteration' happens" principle.

---

## 2. Design

### 2.1 Target file structure after S3

```
apps/chat/lib/agent/
  loop.ts                              # ~700 lines: orchestration + state machine
  iteration/
    iteration-state.ts                 # LoopState struct + Transition union
    run-iteration.ts                   # The shared one-iteration body
    stream-handler.ts                  # Anthropic SSE event parsing (de-duped from run + runReActLoop)
    build-anthropic-tools.ts           # static buildAnthropicTools → here
  pre-iteration/
    classify-message.ts                # (or delete — see §3.2)
    compaction-trigger.ts              # checkAndCompact extracted
    consume-queued-messages.ts         # The session.queue.dequeueNonBlocking() block at run():332
  post-iteration/
    sanitize-leaks.ts                  # (or delete — see §3.2)
    react-nudge.ts                     # evaluateReactCompliance extracted
    post-stream-synthesis.ts           # Calls S1's synthesizeMissingToolResults
  api/
    with-retry.ts                      # S2
    error-classifier.ts                # S2
  tool-result-invariant.ts             # S1
  streaming-tool-executor.ts           # (unchanged)
  case-agent-loop.ts                   # (gains processTodoTools)
  sub-agent.ts                         # Now uses runIteration directly
```

`loop.ts` itself shrinks because:
- ~250 lines of stream-event handling → moved to `stream-handler.ts`, reused by main + sub-agent.
- ~350 lines of dead `runReActLoop` instance method → deleted.
- ~140 lines of static `runReActLoop` → replaced by a thin caller that uses `runIteration`.
- ~6 private helper methods → moved to their own modules.

### 2.2 The shared iteration body

```ts
// apps/chat/lib/agent/iteration/run-iteration.ts

export interface IterationDeps {
  client: Anthropic
  model: string
  fallbackModel?: string
  maxOutputTokens: number
  showThinking: boolean
  thinkingBudget: number
  temperature: number
  /** Built once per case turn; passed in. */
  toolDefinitions: SkillDefinition[]
  /** Engine wraps the API call; S2. */
  withRetryStream: typeof import('../api/with-retry').withRetryStream
  /** Tool execution; same instance reused across iterations. */
  toolExecutor: StreamingToolExecutor
}

export interface IterationInput {
  systemPrompt: string
  messages: Message[]
  tools: AnthropicTool[]      // already filtered by policy
  sendEvent: (e: SSEEvent) => void
  signal: AbortSignal
  /** PolicyEngine for main loop; null for sub-agent (which uses ExecutionPolicy.handleTerminalTool instead). */
  preToolPolicy?: PreToolPolicy
  /** Iteration counter for traces. */
  iteration: number
  caseId: string
  /** Where to record `missingReasons` from S1. */
  missingReasonRecorder: MissingReasonRecorder
}

export interface IterationOutput {
  assistantMessage: Message
  stopReason: string | null
  usage: Usage | null
  toolResults: ToolExecutionResult[]
  /** True iff the model emitted at least one tool_use block. */
  hadToolCalls: boolean
  /** S1 invariant: one entry per tool_use the model emitted. */
  toolResultBlocks: ToolResultBlock[]
}

/**
 * One iteration: open stream (with retry+fallback), parse events, execute tools,
 * synthesize results for the invariant. Pure-ish: depends only on its inputs.
 * Does NOT decide whether the loop continues — that's the caller's job.
 */
export async function runIteration(
  deps: IterationDeps,
  input: IterationInput,
): Promise<IterationOutput> {
  // 1. Call withRetryStream → consume stream via stream-handler
  // 2. After stream end: toolExecutor.waitForAll()
  // 3. Build toolResultBlocks via synthesizeMissingToolResults (S1)
  // 4. Return IterationOutput
}
```

### 2.3 LoopState + Transition (for the main loop)

```ts
// apps/chat/lib/agent/iteration/iteration-state.ts

export interface LoopState {
  messages: Message[]
  iterationCount: number
  nudgeCount: number
  /** Sticky for the rest of the case turn after a fallback. */
  currentModel: string
  /** Set by 'forceCoreMode' classification (if classifier is kept). */
  forceCoreMode: boolean
  /** Why the previous iteration chose to continue. Undefined on first. */
  lastTransition: ContinueReason | undefined
  /** S2 surfaces stickiness here. */
  apiBudget: { tokensConsumed: number; limitHit: boolean }
}

export type Transition =
  | { kind: 'continue'; reason: ContinueReason }
  | { kind: 'terminal'; result: LoopResult }

export type ContinueReason =
  | 'has_tool_calls'
  | 'stage_transition'
  | 'nudge_react_noncompliant'
  | 'nudge_stage_incomplete'
  | 'policy_blocked'
  | 'recovered_after_retry'
```

The main loop body becomes:

```ts
while (state.iterationCount < config.maxIterations) {
  state = { ...state, iterationCount: state.iterationCount + 1 }

  // Pre-iteration steps
  state.messages = consumeQueuedMessages(state.messages, caseMemory, sendEvent)
  await maybeCompact(state, caseMemory)

  // Build the iteration input
  const input = buildIterationInput(state, policy, ...)

  // The work
  const out = await runIteration(deps, input)

  // Append outputs to state
  state.messages.push(out.assistantMessage, makeUserToolResultsMessage(out.toolResultBlocks))

  // Decide what's next
  const transition = await evaluateTransition(state, out, caseLoop, conversationLoop)

  if (transition.kind === 'terminal') return transition.result
  state.lastTransition = transition.reason
  // continue
}
return { messages: state.messages, transition: 'next_turn', ... }
```

`evaluateTransition` is the only place outside `runIteration` that touches business logic. It calls into:
- `caseLoop.evaluateStageTransitionAfterNoTools` (already exists)
- `evaluateReactCompliance` (from `post-iteration/react-nudge.ts`)
- `policy.evaluateContinuation` (sub-agent path)

### 2.4 Sub-agent path unification

`sub-agent.ts` today calls `AgentLoop.runReActLoop` (static, non-streaming). After S3, it builds its own thin loop:

```ts
// apps/chat/lib/agent/sub-agent.ts (after S3)
async run(ctx: AgentContext, task: SubAgentTask): Promise<SubAgentResult> {
  const policy = new ChecklistPolicy({ ... })
  const deps = buildIterationDeps(this.config, this.skillDefinitions)
  const state = initialStateForSubAgent(task)

  while (state.iterationCount < ctx.maxIterations) {
    state.iterationCount++
    const input = buildSubAgentIterationInput(state, policy, this.config)
    const out = await runIteration(deps, input)

    // Apply ExecutionPolicy semantics: did the model call a terminal tool?
    for (const tu of toolUsesFrom(out.assistantMessage)) {
      const terminal = policy.handleTerminalTool(tu.name, tu.input)
      if (terminal?.type === 'handled') return policy.getSubAgentResult()!
    }

    const decision = await policy.evaluateContinuation(out.assistantMessage, out.toolResults, state.iterationCount)
    if (decision.action === 'stop' || decision.action === 'complete_task') {
      return decision.action === 'complete_task' ? decision.result : timeoutResult(task)
    }
    state.messages.push(out.assistantMessage, makeUserToolResultsMessage(out.toolResultBlocks))
  }

  return timeoutResult(task)
}
```

The static `AgentLoop.runReActLoop` and the dead instance `runReActLoop` both **delete**.

### 2.5 Stream handler — single source of truth

```ts
// apps/chat/lib/agent/iteration/stream-handler.ts

export interface StreamConsumeInput {
  stream: ReturnType<Anthropic.Messages['stream']>
  toolExecutor: StreamingToolExecutor
  sendEvent: (e: SSEEvent) => void
  preToolPolicy?: PreToolPolicy
  showThinking: boolean
  /** S1 — recorder for missing-result reasons. */
  missingReasonRecorder: MissingReasonRecorder
  iteration: number
  caseId: string
}

export interface StreamConsumeOutput {
  assistantMessage: Message
  fullText: string
  stopReason: string | null
  usage: Usage | null
  blocks: Map<number, ParsedBlock>
}

export async function consumeStream(input: StreamConsumeInput): Promise<StreamConsumeOutput> {
  // The 200-line switch on event.type lives here. Once.
}
```

Both `run()` and `sub-agent.ts` route through this.

### 2.6 Order of extraction (phased, each phase ships independently)

The whole S3 is too big to land as one PR. Phases below; each phase has its own PR, leaves tests green, and is shippable on its own.

**Phase 3a — Delete dead code** (1 day)
- Delete instance `runReActLoop` at [loop.ts:1685-2080](apps/chat/lib/agent/loop.ts#L1685). ~400 lines gone.
- No other change. CI green. Loop.ts now ~2484 lines.

**Phase 3b — Extract stream handler** (3 days)
- Create `iteration/stream-handler.ts` with `consumeStream()`.
- Replace the inline stream switch in `run()` with a call to `consumeStream()`.
- Behavior preserved. Loop.ts now ~2200 lines.

**Phase 3c — Extract pre/post-iteration helpers** (3 days)
- Move `classifyMessage`, `sanitizeLeakedContext`, `evaluateReactCompliance`, `checkAndCompact`, `processTodoTools` into their own modules.
- Each becomes a pure function (closes over no `this`). Tests written for each in isolation.
- `processTodoTools` specifically moves into `case-agent-loop.ts` because it's case-specific.
- Loop.ts now ~1700 lines.

**Phase 3d — Introduce `runIteration`** (4 days)
- Create `iteration/run-iteration.ts`.
- Refactor `run()` to call `runIteration` per iteration.
- The state machine becomes the explicit pattern in §2.3.
- Loop.ts now ~1100 lines.

**Phase 3e — Unify sub-agent path** (3 days)
- Rewrite `sub-agent.ts` to use `runIteration` directly.
- Delete static `AgentLoop.runReActLoop`. ~140 more lines from loop.ts.
- Sub-agents now stream, honor `config.model`, get S2's retry.
- Loop.ts now ~750 lines (target hit).

**Phase 3f — Cleanup pass** (2 days)
- Consolidate remaining `this.deps.config.X` accesses behind a `getConfig()` accessor.
- Remove ad-hoc try/catches that S2's `withRetry` now handles.
- Final lint + docs pass.
- Loop.ts final size: target ≤800 lines.

**Total**: ~16 working days = ~3 weeks. Each phase is its own PR.

---

## 3. Open questions / cleanup parametrization

### 3.1 Classifier — keep

**Decision (2026-05-26)**: keep. Both `executionMode: 'stage'` and `executionMode: 'cc'` (formerly `'sop'`) will coexist — stage mode remains the predictability-first option for compliance-heavy deployments. The classifier is intrinsic to stage mode (it's how per-message case/core routing happens), so it stays alive.

Action in Phase 3c: extract `classifyMessage` to `pre-iteration/classify-message.ts` as a pure function. Same gate at the call site (`stageActive && executionMode === 'stage'`). S2's `classifier` QuerySource row in the retry policy stays.

If `executionMode: 'cc'` is added later as part of the SOP → CC rename, the gate becomes `executionMode === 'stage'` (single mode, not the negation).

### 3.2 LLM leak sanitizer — keep or kill?

Same shape: gated by `enableLlmSanitization` flag. v4 console-config-scope.md marks this as HARDCODE-always-on, but the code still respects the flag. Two paths:

- **Keep & hardcode-on**: extract, remove the flag check, always run.
- **Kill**: text-sanitizer at [loop.ts:642](apps/chat/lib/agent/loop.ts#L642) (the streaming regex-based one, `textSanitizer.feed`) is enough for known patterns. The LLM-based one is a backup for novel leakage formats. If MiniMax/DeepSeek leakage is no longer a real problem, drop it.

→ Decision needed before Phase 3c.  Default to **kill**: it adds an extra LLM call per iteration, only catches patterns the regex doesn't, and adds a `sanitizer` QuerySource we'd otherwise drop from S2's policy table.

### 3.3 What happens to `ConversationLoop`?

`ConversationLoop` ([apps/chat/lib/agent/conversation-loop.ts](apps/chat/lib/agent/conversation-loop.ts)) is a thin 51-line wrapper used in core (discovery) mode. After S3 it could either:
- Stay as a separate file that `loop.ts` delegates to (current shape).
- Get inlined into `loop.ts` since it's small.

→ Default to **stay**. It's already a clean boundary; no reason to perturb.

### 3.4 Should `runIteration` use a generator?

CC's `queryLoop` is an async generator (`async function*`). Generators give clean composition via `yield*`. But Intera's SSE callback pattern (`sendEvent(event)`) is *callback-based*. To switch to generators we'd have to rewrite every SSE consumer.

→ **No generators for S3.** Keep callback-based event emission. Generators are a follow-up if we ever want SDK-style consumption (which would be S5 / S6 territory).

### 3.5 Dual-mode design — what S3 must NOT close off

**Decision (2026-05-26)**: Intera will support two `executionMode` values:

- `'stage'` — current Design A. Sub-agents pinned to (case-type, stage); declarative dispatch on stage entry. Predictability-first. Used where compliance demands "this case type always runs these sub-agents".
- `'cc'` — evolves from current `'sop'`. Single main agent + todo-driven checklist + a new `dispatch_subagent` tool that the main agent calls when it judges one useful. Sub-agent registry lives at a new `/admin/sub-agents` page (separate from Case Types). Flexibility-first.

**Both modes share the same iteration body** (`runIteration`). Both modes ultimately spawn sub-agents that run the same iteration loop. The only difference is the trigger:

| | `stage` | `cc` |
|---|---|---|
| Where sub-agent dispatch is decided | `StageConfig.subAgents[]` on stage entry — declarative | LLM calls `dispatch_subagent` tool — runtime decision |
| Sub-agent definitions live | Inside Case Types (per-stage) | In a global registry (`/admin/sub-agents`) |
| Stage transitions | LLM-judged via `evaluateStageTransitionAfterNoTools` | None — case progresses via todo checklist completion |
| Classifier `'case' \| 'core'` | Yes — `loop.ts:313` gate | No |

**Implication for S3 phases**:

- **Phase 3e (sub-agent unification)** stays correct — both modes go through `runIteration`. What it must guarantee: the sub-agent path accepts an `IterationDeps` derived from *either* a `StageConfig.subAgents[]` entry (stage mode) *or* a sub-agent registry entry (cc mode). Both produce the same shape — `model`, `systemPrompt`, `allowedTools`, `taskChecklist`, `maxIterations`. Phase 3e doesn't need to know which source; it just needs to take the dict.

- **Phase 3c (helper extraction)** must NOT delete `classifyMessage` or the stage-mode-specific stage-transition logic. Both are stage-mode-only but they're not dead code.

- **No phase introduces the `dispatch_subagent` tool.** That belongs in S4 (tool interface) once the new `Tool<I,O>` abstraction exists. S3 sets up `sub-agent.ts` so that adding a new caller (the tool's executor) is trivial — but does not add the tool itself.

- **No phase introduces `executionMode: 'cc'`.** The rename from `'sop'` to `'cc'` plus the dispatch_subagent tool are explicit S4 deliverables. S3 just preserves the existing `'sop'` code paths so they're ready to be enhanced.

**Rollback safety**: if the dual-mode decision is reversed (e.g. decision is to collapse to one mode), S3's refactor doesn't lock us in. The `runIteration` body is mode-agnostic; only its callers branch on `executionMode`.

---

## 4. Invariants the refactor must preserve

These are MUST-NOT-REGRESS properties. If a phase's tests would break any of these, the phase is wrong:

- [ ] Every existing `LoopResult.transition` value (`next_turn`, `resolved`, `waiting_human`, `waiting_form`, `error`, `consultation_complete`, `stage_continue`, `awaiting_clarification`, `awaiting_interaction`, `connection_lost`) is still produced under the same conditions.
- [ ] Every existing SSE event type continues to fire with the same payload shape.
- [ ] Stage transitions, nudges, max-iterations escalation, human-task creation — all preserved.
- [ ] CaseMemory updates fire at the same points (ingestUserMessageFacts, bumpDashboardVersion, recordCompaction).
- [ ] Trace events written by `TraceWriter` retain the same names (`loop_decision`, `stage_eval`, `policy_hit`, etc.). Operators rely on these for dashboards.
- [ ] S1's invariant assertion still passes throughout.
- [ ] S2's `withRetry` is exercised by every API call site (main, sub-agent, classifier, sanitizer, policy-eval, compact).
- [ ] Debug-mode payload writing (the `writeDebugRequest` / `writeDebugResponse` calls) continues to dump to `debug-logs/<caseId>/`.

A phase's PR description must include a checkbox list of which invariants it touched and how it verified them.

---

## 5. Acceptance criteria

### 5.1 Quantitative
- [ ] `loop.ts` ≤ 800 lines (excluding imports and `StreamingTextSanitizer` if it stays).
- [ ] Zero `static async runReActLoop` references in source.
- [ ] Zero instance `runReActLoop` references in source (other than potential historical aliases).
- [ ] `sub-agent.ts` does not import `AgentLoop` (only `runIteration` and types).
- [ ] `runIteration` has ≥1 unit test covering: success path, retry-recovered path, abort, tool-result invariant satisfied.

### 5.2 Behavioral
- [ ] A representative case (deposit_issue) runs end-to-end with the same trace sequence pre/post-refactor (capture a baseline before Phase 3a; diff at end of Phase 3f).
- [ ] Sub-agent dispatch (existing integration test) passes. Sub-agents now show streaming `text_delta` SSE events where before they sent one batch `text_delta`.
- [ ] `config.model` change on the customer record is honored by sub-agents (previously hardcoded sonnet-4).
- [ ] Manual smoke: 10 chat sessions, no regressions in stage transitions or nudge counts.

### 5.3 Process
- [ ] Each phase's PR has a baseline + post-refactor trace diff attached.
- [ ] No PR adds new behavior — pure refactor. If a phase's diff shows new behavior, split it out.
- [ ] After Phase 3e, run the existing integration tests against a real Anthropic key. Capture iteration counts, latencies, tokens — compare to pre-S3 baseline. No more than 5% regression in P50 case-turn latency.

---

## 6. Risk + rollback

**Risk 1**: Phase 3e (sub-agent streaming) changes user-visible behavior — sub-agents now emit `text_delta` events as they think. *Mitigation*: keep `noopSendEvent` (already used by sub-agent.ts:98) so chat-app consumers don't see sub-agent thoughts mixed with main-agent output. Verify in a chat session.

**Risk 2**: Phase 3d's state machine introduces subtle ordering bugs (e.g., compaction running too late). *Mitigation*: the trace-diff comparison in §5.3 catches reordering. Each phase touches one concern.

**Risk 3**: Test coverage for `run()` is implicit — many code paths are only exercised by full case-flow integration tests. *Mitigation*: before Phase 3a, add a single golden-trace integration test (one case, captured trace) that all phases must keep passing.

**Risk 4**: Concurrent merges from other features cause merge conflicts across the 6 PRs. *Mitigation*: complete S1 + S2 first; aim to ship S3 phases in 3 weeks without parallel feature work in loop.ts.

**Rollback**: each phase is its own PR and squash-revertable. The trace-diff baseline tells us when a regression was introduced.

---

## 7. Estimated effort

| Phase | Effort |
|---|---|
| 3a — Delete dead code | 1 day |
| 3b — Extract stream handler | 3 days |
| 3c — Extract pre/post-iteration helpers | 3 days |
| 3d — Introduce runIteration | 4 days |
| 3e — Unify sub-agent path | 3 days |
| 3f — Cleanup pass | 2 days |
| **Total** | **~3 weeks** |

---

## 8. Hand-off to implementer

Before starting:
- S1 and S2 must be merged. The refactor extracts against those primitives.
- Capture a golden-trace baseline. Pick a real conversation; save its `trace.jsonl` and the final `LoopResult`. Every phase must reproduce that trace (with allowed diff: timestamps, UUIDs, model echos if 3e is in scope for that PR).

Per-phase rules:
1. **One concern per PR.** No mixing extraction with new behavior.
2. **Each PR ends with `loop.ts` line-count drop.** Track it. The goal is real reduction, not "shuffling lines into adjacent files".
3. **Phase 3a is the safety harness.** Land it first, see CI green, then go. If 3a breaks anything, the dead-code grep was wrong and we need to find the actual caller before proceeding.
4. **Phase 3e is the riskiest.** Test sub-agent flow on a real Anthropic key against a real case before merging.

Open these issues / questions to your tech lead before starting:
- Q1: ~~classifier — keep or kill?~~ **Resolved 2026-05-26: keep (dual-mode design — see §3.5).**
- Q2: LLM leak sanitizer — keep or kill? (§3.2)

If sanitizer is killed, S2's policy table loses 1 row and `loop.ts` drops another ~80 lines. Classifier is now confirmed kept.

Do NOT do these in the same PRs:
- S4 (tool interface) — different concern.
- Adding generator-based APIs — keep callbacks.
- Refactoring `CaseMemoryManager` — leave it as the immutable boundary.

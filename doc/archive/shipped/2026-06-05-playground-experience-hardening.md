> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Playground Experience Hardening — Wave 2 (Implementation Plan)

> **For the coding team:** One-shot. Execute end-to-end (spawn parallel sub-agents per the wave map), then hand back for a single architect review. Target 95%; the **Architect-Reserved** items come back. Steps use `- [ ]`.
>
> **铁律 (GENERIC_HANDOFF §0):** declare your lane(s) in MASTER_BUILD_HANDOFF before touching files; every task ends with the two-phase receipt (local gate + production browser verify); safety changes ship red→green e2e guards.

**Goal:** Make the Playground faithfully show what the agent actually does — fix the silent image-drop, surface the agent's lifecycle events (escalation / case-created / sub-agent / retry), de-noise the trace and give it real timing, and unify the error + vision contracts.

**Architecture:** All work is within the playground subsystem — `page.tsx` (UI), `playground-runner.ts` + `run/route.ts` (SSE producers), `trace-aggregator.ts` (trace view). No core-loop changes (the loop already emits everything we need; the playground just under-consumes it). Builds directly on the 2026-06-05 trace single-contract refactor.

**Tech Stack:** Next.js 15, React, TypeScript, Vitest. No new dependencies.

---

## Context (verified in code 2026-06-05, post-trace-refactor)

- `runTurn` is `useCallback(…, [selectedAgentId, debugMode])` ([page.tsx:366](apps/console/app/admin/playground/page.tsx)) but reads `attachedImages` (line ~258) and `showThinking` (line ~265) → stale closure.
- UI SSE switch handles only `text_delta, thinking_delta, error, tool_executing, skill_result, form_request, trace`. The loop also emits `escalated, case_created, sub_agent_start, sub_agent_complete, human_task_created, retry_pending, withheld, policy_blocked, message_stop` — all dropped.
- `loop.ts:816` writes a `loop_decision` "Iteration Snapshot" with real `llmWallMs`/`toolsWallMs`/`iterationWallMs` in the payload. The aggregator ignores it and uses `createdAt`-span (→ 0ms).
- The aggregator's catch-all maps every unmapped `actionType` to "Skills & tools" → bookkeeping records (`user_message`, `stream_event`, `loop_decision`, `agent_tree_node`) pollute that stage.
- `run/route.ts:39` emits `error` as a string; `playground-runner.ts:176` emits `{code,message}`; `loop.ts` (445/459/741) emits strings. The UI defensively `JSON.parse`s.
- Vision: UI reads `ModelInfo.supportsVision` ([page.tsx:179](apps/console/app/admin/playground/page.tsx)); runner uses `nonVisionPrefixes=['deepseek-','MiniMax-']` ([playground-runner.ts:173](apps/console/lib/agent/playground-runner.ts)).

---

## Acceptance criteria (write these as tests)

- **AC-A** Attaching an image on a vision-capable agent includes it in the `/run` request body `contentBlocks`; the image is never dropped. Toggling "Thinking" sends the matching `showThinking`.
- **AC-B** When the agent emits `escalated` / `case_created` / `sub_agent_start` / `human_task_created` / `retry_pending`, the playground renders a visible notice (system bubble in the transcript). No silent swallow.
- **AC-C1** The "Skills & tools" trace stage contains only real skill/tool records — no `run start`, `Iteration Snapshot`, `Exit`, `stop_reason` entries.
- **AC-C2** The "Model generation" stage `ms` reflects real LLM wall-time (>0 for a real turn) sourced from the `Iteration Snapshot` payload — not 0.
- **AC-D** Every SSE `error` event carries `{ code: string, message: string }`; the UI renders `message` with no `JSON.parse` fallback chain.
- **AC-E** A model the UI treats as vision-capable is treated identically by the runner (single source = `ModelInfo.supportsVision`); the `nonVisionPrefixes` blocklist is deleted.
- **AC-F** A loop-level e2e test proves a real guardrail block produces a `policy_hit` (blocked) record in the port `traces[]` → Guardrails stage `fired:true`, `status:'block'`.

---

## File change map

| File | Change | Lane |
|---|---|---|
| `packages/shared/types/index.ts` | Add `SSEErrorData = { code: string; message: string }`; add a `LIFECYCLE_NOTICE` helper type. | W0 |
| `apps/console/app/admin/playground/page.tsx` | F1 stale-closure (refs); F2 lifecycle-event notices in transcript; F5 render `error.message`. | L1 |
| `apps/console/lib/agent/trace-aggregator.ts` | F3 exclude bookkeeping actionTypes from stages; F4 read `iterationWallMs`/`llmWallMs` for Model-generation ms. | L2 |
| `apps/console/lib/agent/playground-runner.ts` | F5 emit `error` as `{code,message}`; F6 resolve vision from `ModelInfo.supportsVision` (drop prefix blocklist). | L3 |
| `apps/console/app/api/admin/playground/run/route.ts` | F5 emit `error` as `{code,message}`. | L3 |
| `apps/console/lib/agent/__tests__/integration/playground-guardrail-trace.test.ts` | **NEW** — AC-F. | L4 |
| `apps/console/lib/agent/__tests__/unit/trace-aggregator.test.ts` | Extend for AC-C1/AC-C2. | L2 |

---

## Wave map

- **Wave 0 (serial, tiny):** Task 1 — error/lifecycle contract types. Blocks L1 + L3.
- **Wave 1 (parallel):** L1 = Task 2 (page.tsx: F1+F2+F5-UI), L2 = Task 3 (aggregator: F3+F4), L3 = Task 4 (producers: F5+F6), L4 = Task 5 (AC-F guard).
- **Wave 2:** Task 6 — full local gate + production browser verify.

---

## Task 1 — Contract types (Wave 0)

**Files:** Modify `packages/shared/types/index.ts`

- [ ] **Step 1.** Add near `SSEEventType`:

```ts
/** Canonical error payload for SSE `error` events. */
export interface SSEErrorData { code: string; message: string }

/** Lifecycle notices the playground renders as system bubbles. */
export type LifecycleKind = 'escalated' | 'case_created' | 'sub_agent' | 'human_task' | 'retry'
export interface LifecycleNotice { kind: LifecycleKind; label: string; detail?: string }
```

- [ ] **Step 2.** `npx tsc --noEmit -p apps/console/tsconfig.json` → 0 errors. Commit: `feat(types): SSE error + lifecycle notice contracts`.

---

## Task 2 — page.tsx: stale-closure + lifecycle notices + error render (Wave 1, Lane L1)

**Files:** Modify `apps/console/app/admin/playground/page.tsx`

- [ ] **Step 1 — F1 stale-closure (refs keep `runTurn` stable AND fresh).** Add refs that mirror the mutable values read at send-time, and read them inside `runTurn`:

```tsx
const attachedImagesRef = useRef<AttachedImage[]>([])
useEffect(() => { attachedImagesRef.current = attachedImages }, [attachedImages])
const showThinkingRef = useRef(showThinking)
useEffect(() => { showThinkingRef.current = showThinking }, [showThinking])
```
Inside `runTurn`, replace `const currentImages = attachedImages` → `const currentImages = attachedImagesRef.current`, and `showThinking` (in the body) → `showThinkingRef.current`. Leave the deps array as-is (now correct because reads go through refs).

- [ ] **Step 2 — Failing test (AC-A).** Add `apps/console/app/admin/playground/__tests__/run-body.test.tsx` that renders the page, attaches a stub image to state, triggers send, and asserts the `fetch('/api/admin/playground/run')` body includes `contentBlocks` with the image. (Use `@testing-library/react` + `vi.spyOn(global, 'fetch')`.) Run → FAIL if reading stale `[]`.

- [ ] **Step 3 — F2 lifecycle notices.** Add a transcript entry type `{ role: 'system'; notice: LifecycleNotice }` to `chatMessages` union, and in `runTurn`'s SSE switch add branches:

```ts
else if (event.type === 'escalated') pushNotice({ kind: 'escalated', label: 'Agent escalated to a human', detail: (event.data as any)?.reason })
else if (event.type === 'case_created') pushNotice({ kind: 'case_created', label: `Case created: ${(event.data as any)?.displayName ?? (event.data as any)?.caseType ?? ''}` })
else if (event.type === 'sub_agent_start') pushNotice({ kind: 'sub_agent', label: `Sub-agent dispatched: ${(event.data as any)?.agentName ?? ''}` })
else if (event.type === 'human_task_created') pushNotice({ kind: 'human_task', label: 'Human task created' })
else if (event.type === 'retry_pending') pushNotice({ kind: 'retry', label: `Retrying (${(event.data as any)?.errorClass ?? 'transient'})…` })
```
where `pushNotice` appends a `{ role:'system', notice }` message. Render system messages as a centered muted pill (icon by `kind`).

- [ ] **Step 4 — F5 error render.** Replace the `JSON.parse` fallback chain in the `error` branch with: `setError(typeof event.data === 'string' ? event.data : (event.data as SSEErrorData)?.message ?? 'Unknown error')`. (Keep the string branch for backward-compat during rollout.)

- [ ] **Step 5.** tsc 0 errors; run the AC-A test → PASS. Commit: `fix(playground): stale-closure refs + lifecycle notices + clean error render`.

---

## Task 3 — trace-aggregator: de-noise + real timing (Wave 1, Lane L2)

**Files:** Modify `apps/console/lib/agent/trace-aggregator.ts` + `__tests__/unit/trace-aggregator.test.ts`

- [ ] **Step 1 — Failing tests.** Add: (a) records `[user_message, stream_event, loop_decision('Iteration Snapshot' w/ payload llmWallMs:1200), skill_result('kb_search')]` → "Skills & tools" stage summary contains `kb_search` but NOT `Iteration Snapshot`/`stop_reason`/`run start`; (b) Model-generation `ms` === 1200 (from the snapshot), not 0.

- [ ] **Step 2 — Implement F3 (exclude bookkeeping).** Add a set and skip these from stage bucketing entirely:

```ts
const BOOKKEEPING: ReadonlySet<string> = new Set([
  'user_message', 'stream_event', 'loop_decision', 'agent_tree_node',
  'stream_request_start', 'microcompact', 'queue_message_enqueued', 'queue_message_consumed',
])
// in the for-loop: if (BOOKKEEPING.has(actionType)) { bookkeeping.push(t); continue }
```
Keep the bookkeeping records aside (don't drop — they feed F4 timing + debug JSON).

- [ ] **Step 3 — Implement F4 (real timing).** When building the "Model generation" step, find the bookkeeping `loop_decision` records whose payload has `llmWallMs`/`iterationWallMs`, and set `step.ms = sum(llmWallMs)` (fallback to the existing span if none). Keep `totalMs` (runner) as the headline.

- [ ] **Step 4.** Run tests → PASS; tsc 0. Commit: `fix(trace): de-noise Skills & tools + real Model-generation timing`.

---

## Task 4 — producers: error contract + single vision source (Wave 1, Lane L3)

**Files:** Modify `playground-runner.ts`, `run/route.ts`

- [ ] **Step 1 — F5 error shape.** In `run/route.ts:39` (the catch in the stream) and any `loop`-relayed error path the runner controls, emit `data: { code: 'internal', message: <string> }` instead of a bare string. In `playground-runner.ts` keep the existing `{code,message}`. Ensure the final `error` event is always `{code,message}`.

- [ ] **Step 2 — F6 single vision source.** Replace the runner's `nonVisionPrefixes` guard with a check against the model's `supportsVision`. Resolve it from the same place the `/api/admin/models` endpoint derives it (import the shared model registry / `MODELS` list) keyed by `resolvedModel`; if unknown, default to **block** (fail-safe). Delete `nonVisionPrefixes`.

- [ ] **Step 3.** tsc 0; existing playground tests green. Commit: `fix(playground): structured SSE errors + single vision-capability source`.

---

## Task 5 — AC-F guardrail trace e2e (Wave 1, Lane L4)

**Files:** NEW `apps/console/lib/agent/__tests__/integration/playground-guardrail-trace.test.ts`

- [ ] **Step 1.** Using the global provider mock, configure an agent whose `policyHooks`/`capabilityBindings.guardrails.preTool` blocks a tool the model tries to call; run `runPlaygroundTurn`; collect the final `trace`. Assert the Guardrails stage is `fired:true` and `status:'block'`, and that a `policy_hit` record exists in the turn. This closes the gap left by the trace refactor (AC2 was aggregator-only).
- [ ] **Step 2.** Run → PASS. Commit: `test(playground): guardrail-block produces fired Guardrails stage (e2e)`.

---

## Task 6 — Verify (Wave 2)

- [ ] **Phase 1:** `tsc` 0 · `env -u … npm test` all green · `build:console` ok · changed-files list.
- [ ] **Phase 2 (prod):** deploy; login; `/admin/playground`: (a) on a vision agent, attach an image → confirm it's sent + rendered (AC-A); (b) run the "I'm furious" escalation path on an agent with an escalation guardrail → confirm a "escalated"/"human task" notice appears (AC-B) and Guardrails trace shows block; (c) confirm Behavior trace "Skills & tools" is clean and Model-generation shows real ms (AC-C); screenshot.

---

## Architect-Reserved (the ~5%)

1. **Phase-2 prod verify** of AC-A/AC-B — needs a **vision-capable agent** and a **guardrail-configured agent** seeded (may not exist). Architect seeds/loads them or co-signs.
2. **F2 notice taxonomy** — which lifecycle events deserve a transcript bubble vs. Live-activity entry vs. silence is a UX judgment; the list above is a starting point, architect refines.
3. **Not in scope (separate):** F8 hardcoded Chinese escalation message (`loop.ts:894`) — **production** i18n bug; fix as its own task. The Live-activity-vs-Behavior-trace divergence for `dispatch_case_agent` is reduced by F2 but full unification is future.

## Risks / rollback
- All changes are playground-scoped (UI + runner + aggregator) — no core-loop edits, so production chat behavior is unaffected. Each task is an isolated commit; revert individually.

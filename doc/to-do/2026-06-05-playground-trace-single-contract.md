# Playground Trace — Single-Contract Refactor (Implementation Plan)

> **For the coding team:** This is a one-shot spec. Execute it end-to-end (spawn parallel sub-agents per the wave map below), then hand back for a single architect review. Target 95%; the **Architect-Reserved** items at the bottom are expected to come back to the architect. Steps use `- [ ]` for tracking.
>
> **铁律 reminder (GENERIC_HANDOFF §0):** every task ends with the two-phase receipt (local gate + production browser verify). Safety/isolation changes ship a red→green e2e guard. Declare your lane in MASTER_BUILD_HANDOFF before touching files.

**Goal:** Make the Playground "Behavior trace" derive from the **same** trace producer as production (`TraceWriter`), through the **same** seam (`PersistencePort`), so the playground stops silently dropping tool calls / guardrail hits and stops fabricating timing.

**Architecture:** Today the playground *re-implements* a trace pipeline by hand-reconstructing records from the SSE stream inside `playground-runner.ts`, using a vocabulary (`policy_hit`/`skill_called`/`stage_eval`) that **no SSE event emits** — while the real producer (`TraceWriter`) is **no-op'd in dry-run**. We invert this: `TraceWriter` writes through `PersistencePort.saveTrace` in **both** modes (Prisma in prod, in-memory in playground). The playground then reads the port's `traces[]` and feeds the existing `aggregateTraces`. One producer, one vocabulary (`ActionType`), one aggregator, two views.

**Tech Stack:** Next.js 15, TypeScript, Prisma 6, Vitest. No new dependencies.

---

## Why this design (locked decision)

Two candidate sources of truth were considered:

- **SSE-as-truth** — derive trace from the browser-facing SSE stream. Rejected: would force production (`messages/route.ts`) to persist an SSE-derived trace, touching the hot path more invasively, and SSE `data` is untyped (`data: unknown`).
- **TraceWriter-as-truth (CHOSEN)** — `TraceWriter` is *already* the single semantic producer in production, with the canonical `ActionType` vocabulary that `trace-aggregator`'s `STAGE_MAP` already keys on. The fork exists **only** because `trace.ts:86` drops the entry in dry-run. Routing it through the already-universal `PersistencePort` collapses the two pipelines with a minimal, contained change and *also* fixes the leaky seam (TraceWriter currently bypasses the port to call `prisma` directly).

**Deletion test:** deleting the SSE-reconstruction block in `playground-runner.ts` concentrates all trace logic into `TraceWriter` + `aggregateTraces` — complexity vanishes from the runner, does not move. That is the signal this is a real deepening, not a shuffle.

**Confirmed facts the plan relies on (verified in code 2026-06-05):**
- `loop.ts:123` — `this.persistence = deps.persistence || createPrismaPersistence()` (port is universal).
- `loop.ts:994` — tool results already written via `traceWriter.write('skill_result', …)`.
- `loop.ts:477/640` — `writeLlmRequestStart`/`writeLlmResponse` already fire (payload carries systemPrompt+messages+usage+toolCalls).
- `loop.ts:521/549/1021`, `case-agent-loop.ts:505/681/710` — `policy_hit` / `stage_eval` already written.
- Only **one** `new TraceWriter(` site: `loop.ts:118`. `PersistencePort.saveTrace` has **no other callers** (no double-write risk).

---

## Acceptance criteria (these define "done" — write them as tests)

- **AC1 — No split-brain.** A dry-run turn that calls N tools shows a "Skills & tools" stage in the Behavior trace whose tool count equals the "Live activity" tool count (N), for the same turn.
- **AC2 — Guardrails visible.** When a guardrail fires (warn or block), the Behavior trace shows a "Guardrails" stage carrying the hit — not "(no events)".
- **AC3 — Honest timing.** `result.totalMs` ≈ real wall-clock for the turn (seconds-scale, not ~13ms). Every per-stage `ms ≥ 0` and `≤ totalMs`.
- **AC4 — Model-generation fidelity preserved.** "Model generation" still exposes the system prompt + messages (PromptViewer) and token usage, now sourced from real `llm_request_start`/`llm_response` records.
- **AC5 — Dry-run still writes zero DB rows.** `playground-isolation.test.ts` stays green; the new in-memory TraceWriter path performs **no** `prisma` write.
- **AC6 — Production trace intact.** Real (non-dry-run) turns still write `actionTrace` rows; `ops/chats` + `/api/cases/[id]/traces` render unchanged.
- **AC7 — Single producer.** `playground-runner.ts` no longer hand-builds trace records from SSE events (the `memoryTraces.push(...)` reconstruction is deleted). Trace data comes solely from the port's `traces[]`.

---

## File change map

| File | Change |
|---|---|
| `apps/console/lib/agent/persistence-port.ts` | `TraceRecord.payload` stays `string`; no shape change. (Reference only.) |
| `apps/console/lib/agent/trace.ts` | **Constructor takes `PersistencePort` instead of `dryRun: boolean`.** `write()` routes to `persistence.saveTrace(...)` (fire-and-forget) instead of `prisma.actionTrace.create`. Drop `dryRun` field + `prisma` import. |
| `apps/console/lib/agent/loop.ts` | Construct `persistence` **before** `traceWriter`; pass it: `new TraceWriter(deps.caseId, this.persistence)`. (Lines ~118/123.) |
| `apps/console/lib/agent/trace-aggregator.ts` | (1) Always emit stages that have ≥1 record (fired), regardless of `applicableStages`; use `applicableStages` only to add unfired stages as `skipped` placeholders. (2) Per-stage `ms` = record-span, not offset. (3) Type `STAGE_MAP` keys as `ActionType`. |
| `apps/console/lib/agent/playground-runner.ts` | Delete the SSE→`memoryTraces` reconstruction (sendEvent body) + the fallback synth block. Read the port's `traces[]` after `run()`. Add `totalMs = Date.now() - startTime` to `PlaygroundResult`. Keep streaming SSE to client unchanged. |
| `apps/console/app/admin/playground/page.tsx` | Headline total now reads `result.totalMs` (the two aggregate blocks) instead of summing per-stage `ms`. No other UI change. |
| `apps/console/lib/agent/__tests__/integration/playground-trace-contract.test.ts` | **NEW** — AC1–AC4 + AC7 regression guard (real dry-run turn, mocked LLM). |
| `apps/console/lib/agent/__tests__/unit/trace-aggregator.test.ts` | Extend/҂add for the stage-emission + timing changes (AC1/AC3 at unit level). |

---

## Wave map (for parallel sub-agents)

- **Wave 0 (serial, blocks everything):** Task 1 — TraceWriter→port seam. Every other task imports its result.
- **Wave 1 (parallel after W0):** Task 2 (aggregator), Task 3 (runner), Task 4 (type-lock + page total).
- **Wave 2 (after W1):** Task 5 (regression guard test) + local-gate receipt.

---

## Task 1 — Route `TraceWriter` through `PersistencePort` (Wave 0)

**Files:**
- Modify: `apps/console/lib/agent/trace.ts`
- Modify: `apps/console/lib/agent/loop.ts:118,123`
- Test: `apps/console/lib/agent/__tests__/unit/trace-writer-port.test.ts` (new)

- [ ] **Step 1 — Failing test.** New `trace-writer-port.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TraceWriter } from '../../trace'
import { createMemoryPersistence } from '../../persistence-port'

describe('TraceWriter → PersistencePort', () => {
  it('writes through the port, never touching prisma, and serialises payload', async () => {
    const { port, traces } = createMemoryPersistence()
    const tw = new TraceWriter('case_1', port)
    tw.setChatId('chat_1')
    await tw.write('policy_hit', 'Policy hit: tone', { policyName: 'tone', result: 'warn' })
    await tw.write('skill_result', 'Skill: kb_search', { skillName: 'kb_search', output: { hits: 2 } })

    expect(traces).toHaveLength(2)
    expect(traces[0]).toMatchObject({ caseId: 'case_1', chatId: 'chat_1', actionType: 'policy_hit' })
    // payload must be a JSON string (matches Prisma column shape — single contract)
    expect(typeof traces[0].payload).toBe('string')
    expect(JSON.parse(traces[1].payload as string)).toMatchObject({ skillName: 'kb_search' })
  })
})
```

- [ ] **Step 2 — Run, verify FAIL** (`TraceWriter` ctor still expects `boolean`): `npx vitest run apps/console/lib/agent/__tests__/unit/trace-writer-port.test.ts`

- [ ] **Step 3 — Implement.** In `trace.ts`: remove `import { prisma }`; change ctor + `write()`:

```ts
import type { PersistencePort } from './persistence-port'

export class TraceWriter {
  private chatId: string | null = null
  constructor(private caseId: string, private persistence: PersistencePort) {}

  setChatId(chatId: string | null): void { this.chatId = chatId }

  async write(actionType: ActionType, title: string,
              detailOrPayload?: string | Record<string, unknown>): Promise<TraceEntry> {
    const entry: TraceEntry = { id: crypto.randomUUID(), caseId: this.caseId, actionType, title, createdAt: new Date() }
    if (typeof detailOrPayload === 'string') entry.detail = detailOrPayload
    else if (detailOrPayload) entry.payload = detailOrPayload as Record<string, unknown>

    // Single seam: prod → Prisma, playground → in-memory. Fire-and-forget (never block the loop).
    this.persistence.saveTrace({
      id: entry.id, caseId: entry.caseId, chatId: this.chatId,
      actionType: entry.actionType, title: entry.title,
      detail: entry.detail ?? null,
      payload: entry.payload ? JSON.stringify(entry.payload) : null,
    }).catch((err) => console.error(`[TraceWriter] saveTrace failed (${actionType}):`, err))

    return entry
  }
  // ...all write* helpers unchanged (they call this.write)...
}
```

In `loop.ts`, ensure `this.persistence` is assigned **before** the TraceWriter line, then:

```ts
// was: this.traceWriter = new TraceWriter(deps.caseId, deps.dryRun ?? false)
this.traceWriter = new TraceWriter(deps.caseId, this.persistence)
```

- [ ] **Step 4 — Run, verify PASS.** Also run the existing isolation guard to confirm AC5 holds:
`npx vitest run apps/console/lib/agent/__tests__/integration/playground-isolation.test.ts apps/console/lib/agent/__tests__/unit/trace-writer-port.test.ts`

- [ ] **Step 5 — Commit.** `feat(trace): route TraceWriter through PersistencePort (single trace seam)`

---

## Task 2 — Aggregator: emit fired stages always + honest timing (Wave 1)

**Files:**
- Modify: `apps/console/lib/agent/trace-aggregator.ts`
- Test: `apps/console/lib/agent/__tests__/unit/trace-aggregator.test.ts`

- [ ] **Step 1 — Failing tests.** Add cases asserting:
  (a) given records for "Skills & tools" but `applicableStages=['Guardrails','Model generation']`, the output **still contains** a fired "Skills & tools" stage;
  (b) an applicable-but-unfired stage appears as `fired:false` / status `skipped`;
  (c) for a stage with two records 500ms apart, `ms` ≈ 500 (span), and `ms ≥ 0` always.

```ts
it('never hides a stage that fired, even if not in applicableStages', () => {
  const t0 = Date.now()
  const recs = [
    { caseId: 'c', actionType: 'skill_result', title: 'Skill: kb_search', detail: 'ok', createdAt: new Date(t0 + 10).toISOString() },
  ]
  const out = aggregateTraces(recs as any, t0, false, ['Guardrails', 'Model generation'])
  const tools = out.find(s => s.stage === 'Skills & tools')
  expect(tools?.fired).toBe(true)
})
```

- [ ] **Step 2 — Run, verify FAIL.**
- [ ] **Step 3 — Implement.** Change `stagesToEmit` to the **union** of (stages with records) ∪ (applicable stages), preserving canonical order; keep `fired` semantics. Replace the per-stage `ms` computation:

```ts
// stages that actually produced records — always shown
const firedStages = new Set(stageMap.keys())
const ordered = allStages.filter(s => firedStages.has(s.stage) || (applicableStages ?? allStages.map(a=>a.stage)).includes(s.stage))

// per-stage ms = span of its records (0 for single-record stages), never the start-offset
const records = entry!.records
const times = records.map(r => new Date(r.createdAt || Date.now()).getTime()).sort((a,b)=>a-b)
const ms = times.length > 1 ? Math.max(0, times[times.length-1] - times[0]) : 0
```

Type the map: `const STAGE_MAP: Record<string, { stage: TraceStage; source: TraceSource }>` → key the known entries with `ActionType` (import the type) so a renamed action breaks the build.

- [ ] **Step 4 — Run, verify PASS.** `npx vitest run apps/console/lib/agent/__tests__/unit/trace-aggregator.test.ts`
- [ ] **Step 5 — Commit.** `fix(trace): emit fired stages unconditionally + span-based timing`

---

## Task 3 — Playground runner: delete SSE-reconstruction, read port `traces[]` (Wave 1)

**Files:**
- Modify: `apps/console/lib/agent/playground-runner.ts`

- [ ] **Step 1 — Implement.** In `runPlaygroundTurn`:
  - Keep `const { port: persistence, traces } = createMemoryPersistence()`.
  - In `sendEvent`, **delete** every `memoryTraces.push(...)` block (the `llm_request_start`/`llm_response`/`policy_hit`/`skill_called`/`skill_result`/`tool_executing` reconstruction). Keep: reply-text accumulation, `blocked` flag on `policy_blocked`, and `pending.push(event); wake()` (streaming stays).
  - **Delete** the fallback-synthesis block (`if (!memoryTraces.some(...llm_request_start...))` etc.).
  - After the drain loop, compute `const totalMs = Date.now() - startTime` and aggregate the **real** records:
    `const trace = aggregateTraces(traces, startTime, pc.debug ?? agentConfig.debugMode ?? false, applicableStages)`
  - Add `totalMs` to `PlaygroundResult` (interface + the yielded object).

- [ ] **Step 2 — Run targeted checks.** `npx tsc --noEmit -p apps/console/tsconfig.json` (0 errors) and the isolation guard green.
- [ ] **Step 3 — Commit.** `refactor(playground): single trace source — read port traces, drop SSE rebuild`

---

## Task 4 — Type-lock + page headline total (Wave 1)

**Files:**
- Modify: `apps/console/app/admin/playground/page.tsx` (the two "Aggregate" blocks ~916–932 and ~1030–1055)

- [ ] **Step 1 — Implement.** Where the headline total is shown, prefer the authoritative `totalMs` from the final `trace` event payload over summing per-stage `ms`. Keep token sums as-is (those are real). Leave per-stage `ms` displayed per row (now span-based).
- [ ] **Step 2 — Run.** `npx tsc --noEmit -p apps/console/tsconfig.json`.
- [ ] **Step 3 — Commit.** `fix(playground): headline duration uses real wall-clock totalMs`

---

## Task 5 — Regression guard: trace-contract e2e (Wave 2)

**Files:**
- Test: `apps/console/lib/agent/__tests__/integration/playground-trace-contract.test.ts` (new)

- [ ] **Step 1 — Write the guard.** Drive `runPlaygroundTurn` with the **global provider mock** (already wired via `vitest-setup.ts`) configured to return: one tool_use (a `system_info` tool e.g. `read_chat_memory`), then a final text. Collect yielded events. Assert:
  - the final `trace` event's `data.trace` contains a `Skills & tools` stage with `fired:true` **(AC1)**;
  - the tool count in that stage equals the number of `skill_result`/`tool_executing` SSE events seen **(AC1)**;
  - a `Model generation` stage carries `promptData.systemPrompt` (non-empty) and `usage` **(AC4)**;
  - `data.totalMs` is a number `> 0` and every stage `ms ≤ data.totalMs` **(AC3)**;
  - **(AC7)** no event of type `trace` is produced until after `run()` resolves (i.e. trace is derived once, from records).
  - Add a second case where the mock trips a guardrail (emit `policy_hit` via the loop's guardrail path) and assert a `Guardrails` stage is `fired:true` **(AC2)**.

- [ ] **Step 2 — Run, verify PASS.** `npx vitest run apps/console/lib/agent/__tests__/integration/playground-trace-contract.test.ts`
- [ ] **Step 3 — Full local gate (keyless):**
```
npx tsc --noEmit -p apps/console/tsconfig.json
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
npm run build:console
```
- [ ] **Step 4 — Commit.** `test(trace): playground trace-contract guard (AC1–AC4, AC7)`

---

## Architect-Reserved (the ~5% — hand back, do not force)

1. **Production Phase-2 verification (AC6).** Deploy, run a *real* (non-dry-run) chat via `/api/messages`, confirm `actionTrace` rows still land and `ops/chats/[chatId]` + `/api/cases/[id]/traces` render. DB spot-check that payloads are intact. (Architect drives or co-signs — touches the production hot path.)
2. **Sub-agent / case-agent-loop trace sharing.** Confirm `case-agent-loop`'s `services.traceWriter` is the **same** port-backed instance (single `new TraceWriter`). If a dispatched case-agent constructs its own, thread the port. Flag if found; architect decides.
3. **Timing semantics polish.** Span-based per-stage `ms` is "honest but coarse." If the team finds it misleading for single-call Model-generation, leave it for the architect to refine (likely sum of `llm_response` latencies).
4. **Out of scope (future ADR):** typing SSE `data` as a discriminated union keyed on `type`. Do **not** attempt here — too broad, high blast radius. Note it in the handoff as a follow-up.

---

## Two-phase verification (paste into the receipt)

**Phase 1 — local gate:** tsc 0 errors · keyless `npm test` all green (db-integration known-fail excluded) · `build:console` success · list changed files.

**Phase 2 — production:** `git push deploy main` → `curl https://demo.anytrans.ai/api/health` ok → Playwright login (`test@intera.dev`/`intera123`) → `/admin/playground`: send "Where is my order?" → confirm **Live activity tool count == Behavior-trace "Skills & tools" tool count** (AC1 live), headline duration is seconds-scale (AC3), Model generation shows prompt+tokens (AC4) → screenshot. Then `/ops/chats` on a real chat: trace still renders (AC6).

## Risks / rollback
- **Blast radius:** core-loop trace writing changes (prod + playground). Mitigated: fire-and-forget preserved (non-blocking); Prisma path does the identical `actionTrace.create`; `saveTrace` had no other callers.
- **Rollback:** the seam change is one commit (Task 1); revert restores the old dry-run no-op. Tasks 2–5 are additive/iso­lated to playground + tests.

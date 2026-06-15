> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Kickoff: Playground Multi-Turn Conversation + Session Persistence

> **To:** Coding agent leader
> **From:** Architect
> **Date:** 2026-06-05
> **Plan:** `docs/superpowers/plans/2026-06-05-playground-multi-turn-persistence.md`
> **Spec:** `doc/to-do/2026-06-05-playground-multi-turn-persistence.md`

---

## What this is

Playground sessions are one-shot — each turn creates a fresh AgentLoop, the model sees zero conversation history. You can't have a follow-up conversation.

**Fix:** Server-side history loading from DB. Client sends `chatId` only. First turn creates a `Case` (type='playground') via PrismaPersistence; subsequent turns reuse the same caseId. Messages persist to DB. Session restored on page load. Reset button deletes the Case (CASCADE clears messages). Per-account cap = 5 sessions.

## Design decisions (locked — do not redesign)

1. **Server-side history loading** — client sends chatId, server loads from DB. NOT client-carried messages[].
2. **Zero schema changes** — Case.type='playground', Message.caseId FK, ON DELETE CASCADE. No migrations.
3. **Per-account cap = 5** — `MAX_PLAYGROUND_SESSIONS` constant, oldest evicted on new session creation.
4. **dryRun: true preserved** — tools still mocked, only message persistence changes. `saveMessages()` is NOT gated by dryRun (it writes through PersistencePort directly).
5. **Reset = DELETE Case** — cascade clears messages, no orphaned rows.
6. **Session restore on page mount** — GET latest session, auto-render history.

## Files at play

| File | Change |
|------|--------|
| `packages/shared/types/index.ts` | Add `'session_init'` to SSEEventType union |
| `apps/console/app/admin/playground/page.tsx` | Remove messages[] serialization; add chatId state + session_init handler + reset button + session restore on mount |
| `apps/console/app/api/admin/playground/run/route.ts` | Accept chatId, drop messages[], pass userId from session |
| `apps/console/lib/agent/playground-runner.ts` | MemoryPersistence→PrismaPersistence; chatId→Case resolution; cap check; DB loadMessages; yield session_init |
| `apps/console/app/api/admin/playground/sessions/route.ts` | **NEW** — GET list sessions |
| `apps/console/app/api/admin/playground/sessions/[chatId]/route.ts` | **NEW** — GET restore + DELETE reset |
| `apps/console/lib/i18n/dictionaries.ts` | Add playground.resetSession etc. keys (en + zh) |
| `apps/console/lib/agent/__tests__/integration/playground-persistence.test.ts` | **NEW** — 5 guard tests |

## Task dependency graph

```
Task 1 (SSEEventType)     ← no deps, can run immediately
    │
Task 2 (cleanup WIP)      ← no deps, can run immediately
    │
Task 3 (runner rewrite)   ← depends on Task 2 (same file)
    │
Task 4 (route.ts userId)  ← depends on Task 2+3
    │
Task 5 (GET /sessions)    ← no deps, can run in parallel with Task 2-4
Task 6 (GET+DELETE [chatId]) ← no deps, can run in parallel with Task 2-5
    │
Task 7 (UI)               ← depends on Task 5+6 (API must exist) + Task 1 (SSEEventType)
    │
Task 8 (guard tests)      ← depends on Task 3+4 (runner must work)
    │
Task 9 (final gate)       ← depends on everything
```

## Parallelization strategy

### Wave 1 (3 parallel lanes)

**Lane A — Foundation** (sequential within lane):
- Task 1: Add `session_init` to SSEEventType
- Task 2: Cleanup WIP — remove messages[] from page.tsx, route.ts, playground-runner.ts
- Task 3: Rewrite playground-runner.ts — PrismaPersistence + chatId flow + cap + DB loadMessages + session_init yield
- Task 4: Pass real userId from route.ts → runner

**Lane B — API endpoints** (can run parallel with Lane A):
- Task 5: Create GET /api/admin/playground/sessions
- Task 6: Create GET + DELETE /api/admin/playground/sessions/[chatId]

**Lane C — Observer.** Lane A owns `playground-runner.ts` and `run/route.ts`. Lane B owns the two new route files. No file conflicts. Lane C waits.

### Wave 2 (after Wave 1 commits land)

**Lane A continuation:**
- `git pull --rebase origin main` to pick up Lane B's routes
- Task 7: UI — session restore on mount + reset button + chatId state + i18n keys

**Lane C — Tests:**
- Task 8: Integration guard tests (depends on Task 3+4 runner working)

### Wave 3 (after all commits land)

- Task 9: Final verification gate — tsc + test + build + deploy + production browser test

## Task details

### Task 1: SSEEventType (Lane A)

**File:** `packages/shared/types/index.ts:469`

Add `| 'session_init'` after `| 'retry_pending'` in the SSEEventType union. This is the event the runner yields to tell the UI what chatId was assigned.

Commit: `feat(types): add session_init SSE event type for playground chatId handshake`

### Task 2: Cleanup WIP (Lane A)

**Files:** `page.tsx:297-306`, `route.ts:19,37-45`, `playground-runner.ts:39,41,87-90`

Remove the client-side messages[] carriage that was added as a temporary fix:
- `page.tsx`: delete the `body.messages = chatMessages.filter(...)` block
- `route.ts`: remove `messages?` from body type, remove `previousMessages` deserialization, remove from `runPlaygroundTurn()` call
- `playground-runner.ts`: remove `previousMessages?` from input type, remove destructure, remove `loadMessages()` call block, remove unused `Message` import

Gate: `npx tsc --noEmit -p apps/console/tsconfig.json` → 0 errors.

Commit: `refactor(playground): remove client-side messages[] carriage, prep for server-side history`

### Task 3: Runner rewrite (Lane A)

**File:** `apps/console/lib/agent/playground-runner.ts`

This is the core change. Full code in the plan file. Key steps:

1. Add `MAX_PLAYGROUND_SESSIONS = 5` constant
2. Replace `createMemoryPersistence()` with `createPrismaPersistence()`
3. Resolve or create Case: if `chatId` provided → find existing Case; if not → check cap, evict oldest if needed, generate new chatId
4. `bootstrapNewCase` = `!chatId` (only bootstrap on first turn)
5. After AgentLoop.create: query `prisma.message.findMany({ where: { caseId }, take: 40 })` → `agentLoop.loadMessages()`
6. Yield `{ type: 'session_init', data: { chatId, caseId } }` before the run loop
7. Keep `dryRun: true` — tools mocked, only message persistence changes

**Important:** The `traces` array from MemoryPersistence is gone. Replace with `const traces: TraceRecord[] = []`. The trace timeline is already fed by SSE events — the memory accumulation was redundant.

Gate: `npx tsc --noEmit -p apps/console/tsconfig.json` → 0 errors.

Commit: `feat(playground): server-side history loading — PrismaPersistence + chatId flow + DB loadMessages`

### Task 4: Real userId (Lane A)

**Files:** `route.ts`, `playground-runner.ts`

The route already calls `getActiveVendor()` which returns `vendor.userId`. Pass it through:
- `route.ts`: add `userId: vendor.userId ?? 'playground'` to the `runPlaygroundTurn()` call
- `playground-runner.ts`: add `userId?: string` to input type, use `inputUserId || 'playground'` in the Case resolution block

Gate: `npx tsc --noEmit -p apps/console/tsconfig.json` → 0 errors.

Commit: `feat(playground): pass real userId from session to scope playground Cases`

### Task 5: GET /sessions (Lane B)

**File:** NEW `apps/console/app/api/admin/playground/sessions/route.ts`

Uses `defineRoute` with `requireRole: ['admin', 'owner', 'operator']`. Queries `repo.raw.case.findMany()` where `userId` + `type='playground'`, returns `{ sessions: [{ chatId, firstMessage, createdAt }] }`. Full code in plan.

Commit: `feat(playground): GET /sessions — list playground sessions for account`

### Task 6: GET+DELETE /sessions/[chatId] (Lane B)

**File:** NEW `apps/console/app/api/admin/playground/sessions/[chatId]/route.ts`

Uses `defineRoute<void, { chatId: string }>` with `requireRole`. GET queries messages for the Case, returns `{ chatId, messages }`. DELETE finds Case by chatId+userId, deletes (CASCADE clears messages), returns `{ ok: true }`. Full code in plan.

Commit: `feat(playground): GET + DELETE /sessions/[chatId] — restore and reset sessions`

### Task 7: UI (Lane A, Wave 2)

**File:** `apps/console/app/admin/playground/page.tsx`, `apps/console/lib/i18n/dictionaries.ts`

Four changes to page.tsx:

1. **chatId state:** `const [chatId, setChatId] = useState<string | null>(null)`
2. **Session restore on mount:** useEffect → GET /sessions → GET /sessions/{latest.chatId} → render chatMessages
3. **session_init handler:** in SSE event loop, capture `event.data.chatId` into state
4. **Reset button:** in the toolbar header (after "Thinking" toggle, before "Save to Chat"), inline-style button matching existing pattern. On click: DELETE /sessions/{chatId}, clear all state.
5. **send body:** add `if (chatId) body.chatId = chatId` (no more messages[])

Add i18n keys: `playground.resetSession`, `playground.resetSessionHint`, `playground.noSessions`, `playground.sessionRestored` (en + zh).

Gate: `npx tsc --noEmit` → 0 errors + `npm run build:console` → success.

Commit: `feat(playground): session restore on mount + reset button + chatId state`

### Task 8: Guard tests (Lane C, Wave 2)

**File:** NEW `apps/console/lib/agent/__tests__/integration/playground-persistence.test.ts`

5 tests driving `runPlaygroundTurn()` with real PrismaPersistence:
1. First turn creates Case with type='playground'
2. Second turn loads history (same chatId → messages ≥ 2)
3. DELETE session removes Case (CASCADE verified)
4. Session cap evicts oldest (create 6, verify ≤ 5, oldest gone)
5. Cross-account isolation (user A's session invisible to user B)

**Note:** These tests call `runPlaygroundTurn()` which calls `AgentLoop.run()` which calls the LLM. The global provider mock (`vitest-setup.ts`) should prevent real LLM calls. If it doesn't cover this path, mark tests as `it.skip` and verify in Phase 2 production test instead.

Gate: `npx vitest run apps/console/lib/agent/__tests__/integration/playground-persistence.test.ts`

Commit: `test(playground): integration guard tests for session persistence`

### Task 9: Final gate

```bash
npx tsc --noEmit -p apps/console/tsconfig.json          # 0 errors
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test  # all passing
npm run build:console                                    # success
git push deploy main
curl -s https://demo.anytrans.ai/api/health              # {"status":"ok"}
```

Then Playwright MCP production verification:
1. Login `test@intera.dev` / `intera123`
2. `/admin/playground` → send "hello" → verify reply
3. Send "what did I just say?" → verify model remembers (multi-turn works)
4. Navigate to `/admin/model` → back to `/admin/playground` → verify session restored
5. Click Reset → verify chat cleared
6. New message → new chatId, works

## Process rules (from GENERIC_HANDOFF.md)

1. **Declare your lane** in `MASTER_BUILD_HANDOFF.md` Active Lanes table before touching files.
2. **Run the local gate** (tsc + test + build) before every commit.
3. **Phase 2 production verify** after deploy — not optional. Screenshots as evidence.
4. **Update MASTER_BUILD_HANDOFF.md** when done — flip task status, note commits, remove your lane.
5. **After all tasks complete:** move `doc/to-do/2026-06-05-playground-multi-turn-persistence.md` to `doc/what's done/` and update MASTER_BUILD_HANDOFF.md.
6. **git pull --rebase origin main** before starting each Wave to pick up other lanes' commits.

## Reference

- Full implementation plan with exact code: `docs/superpowers/plans/2026-06-05-playground-multi-turn-persistence.md`
- Project context: `doc/handoffs/GENERIC_HANDOFF.md`
- Live backlog: `doc/handoffs/MASTER_BUILD_HANDOFF.md`
- Production URL: `https://demo.anytrans.ai`
- Test account: `test@intera.dev` / `intera123`

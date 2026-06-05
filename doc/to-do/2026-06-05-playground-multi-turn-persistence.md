# Playground Multi-Turn Conversation + Session Persistence

**Created:** 2026-06-05 | **Status:** design approved — ready for dispatch | **Branch:** `main`

> Fixes: playground was one-shot — each turn created a fresh `AgentLoop`, model saw zero conversation history.
> Design: server-side history loading from DB (no client-carried messages[]). Reuses Case + Message tables, zero schema changes.

## Summary

| Current | Target |
|---------|--------|
| Client sends `messages[]` each turn | Client sends `chatId` only |
| `MemoryPersistence` (ephemeral) | `PrismaPersistence` (DB) |
| `bootstrapNewCase: true` every turn | `bootstrapNewCase` only on first turn |
| New chatId every turn | Stable chatId across turns |
| UI state lost on page nav | Session restored from DB |
| — | Reset button → DELETE Case CASCADE |
| — | Per-account cap (5 sessions, oldest evicted) |

## API Surface

| Method | Path | Status |
|--------|------|--------|
| `GET` | `/api/admin/playground/sessions` | **NEW** — list sessions for account |
| `GET` | `/api/admin/playground/sessions/[chatId]` | **NEW** — get full messages for session |
| `POST` | `/api/admin/playground/run` | **MODIFY** — accept `chatId`, drop `messages[]` |
| `DELETE` | `/api/admin/playground/sessions/[chatId]` | **NEW** — reset (delete Case + messages CASCADE) |

## Task Breakdown

### Task 0 — Cleanup current WIP (2 files)

The current `page.tsx` line 299-306 serializes chatMessages into `body.messages`. The current `route.ts` line 38-43 deserializes them. Both get removed.

- [ ] **`apps/console/app/admin/playground/page.tsx`** — remove `body.messages` serialization block (lines 298-306). The entire `messages` field is gone from the POST body.
- [ ] **`apps/console/app/api/admin/playground/run/route.ts`** — remove `messages` from body type (line 19), remove `previousMessages` deserialization block (lines 37-43), remove `previousMessages` from `runPlaygroundTurn` call (line 45).
- [ ] **`apps/console/lib/agent/playground-runner.ts`** — remove `previousMessages?` from `runPlaygroundTurn` input type (line 39), remove destructure (line 41), remove `loadMessages` call (lines 87-90).

**Gate:** `npx tsc --noEmit -p apps/console/tsconfig.json` — 0 errors.

### Task 1 — POST /run: accept chatId, use real persistence

- [ ] **`apps/console/app/api/admin/playground/run/route.ts`**:
  - Add `chatId?: string` to body type (line 19)
  - Pass `chatId` through to `runPlaygroundTurn()`
- [ ] **`apps/console/lib/agent/playground-runner.ts`**:
  - Add `chatId?: string` to `runPlaygroundTurn` input type
  - Replace `createMemoryPersistence()` with `createPrismaPersistence(prisma)` (line 46)
  - Before AgentLoop.create: if `!chatId` → create Case with `type='playground'`, `userId` from session, generate chatId. If `chatId` → find existing Case by chatId (`prisma.case.findFirst({ where: { chatId, type: 'playground' } })`)
  - Per-account cap check: `prisma.case.count({ where: { userId, type: 'playground' } })` — if ≥ `MAX_PLAYGROUND_SESSIONS` (5), delete oldest first
  - Set `bootstrapNewCase: !chatId` (line 82)
  - After AgentLoop.create, query `prisma.message.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' }, take: 40 })` and call `agentLoop.loadMessages()`
  - Yield `chatId` as SSE event so client can store it (new event type: `session_init` with `{ chatId }`)
  - Use **real** persistence port (not memory) — this means messages get written to DB. BUT keep `dryRun: true` (tools still mocked, no `actionTrace` writes).
- [ ] **`apps/console/lib/agent/loop.ts`** — verify PersistencePort writes to DB when using PrismaPersistence. The existing `addMessage` callback at line 156 does `this.messages.push(msg)`. The persistence port's `addMessage` writes to DB. Confirm PrismaPersistence.addMessage writes to the Message table.

**Gate:** `npx tsc --noEmit -p apps/console/tsconfig.json` — 0 errors.
**Gate:** `env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test` — all passing.

### Task 2 — GET /api/admin/playground/sessions (list)

- [ ] **NEW: `apps/console/app/api/admin/playground/sessions/route.ts`**:
  - `GET` handler: `prisma.case.findMany({ where: { userId, type: 'playground' }, orderBy: { createdAt: 'desc' }, select: { id: true, chatId: true, createdAt: true, messages: { take: 1, orderBy: { createdAt: 'asc' }, select: { content: true } } } })`
  - Return `{ sessions: [{ chatId, firstMessage, createdAt }] }`
  - 401 if not admin session (use existing auth pattern from `run/route.ts`)

### Task 3 — GET /api/admin/playground/sessions/[chatId] (restore)

- [ ] **NEW: `apps/console/app/api/admin/playground/sessions/[chatId]/route.ts`**:
  - `GET` handler: find Case by `chatId` + `type='playground'` + `userId`, 404 if not found
  - `prisma.message.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } })`
  - Return `{ chatId, messages: [{ id, role, content, contentBlocks, createdAt }] }`
  - 401 if not admin session

### Task 4 — DELETE /api/admin/playground/sessions/[chatId] (reset)

- [ ] **In `apps/console/app/api/admin/playground/sessions/[chatId]/route.ts`** (same file as Task 3):
  - `DELETE` handler: find Case by `chatId` + `type='playground'` + `userId`, 404 if not found
  - `prisma.case.delete({ where: { id: caseId } })` — messages cascade-delete via FK
  - Return `{ ok: true }`
  - 401 if not admin session

### Task 5 — UI: session restore + reset button

- [ ] **`apps/console/app/admin/playground/page.tsx`**:
  - On mount: `GET /api/admin/playground/sessions` → find latest session → `GET /sessions/{chatId}` → render `chatMessages`
  - Store `chatId` in state. Initially null. Set from SSE `session_init` event on first turn, or from restored session.
  - On send: POST to `/run` with `chatId` (if exists), no more `messages[]` field. Watch for SSE `session_init` event to capture chatId.
  - Add **Reset button** (top-right of chat area, icon button). On click: `DELETE /sessions/{chatId}` → clear `chatMessages`, clear `chatId`, clear traces.
  - Remove the `messages` serialization block that was added at lines 298-306.
  - Session list dropdown (optional, can be follow-up): a small `<select>` showing other sessions, clicking one calls GET and renders.
- [ ] **i18n**: add keys for reset button, session list, empty state

**Gate:** `npx tsc --noEmit -p apps/console/tsconfig.json` — 0 errors.
**Gate:** `npm run build:console` — success.

### Task 6 — Integration guard tests

- [ ] **NEW: `apps/console/lib/agent/__tests__/integration/playground-persistence.test.ts`**:
  - Test: first turn creates Case + messages in DB
  - Test: second turn with same chatId loads history → model sees prior messages
  - Test: reset deletes Case + messages (verify `prisma.case.count` = 0 after)
  - Test: per-account cap evicts oldest session
  - Test: cross-account isolation (account A can't see account B's sessions)
  - Use real Prisma (test DB), not mocks. See existing `db-integration.test.ts` pattern.

## Verification

### Phase 1 — Local gate
```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # must be 0 errors
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # all passing
npm run build:console                             # success
```

### Phase 2 — Production browser test
1. Deploy: `git push deploy main` → health check
2. Playwright: login as `test@intera.dev`
3. Navigate to `/admin/playground`
4. **First message**: send "hello" → verify reply, verify chatId stored in state
5. **Second message**: send "what did I just say?" → verify model remembers (multi-turn works)
6. **Navigate away** to `/admin/model`, then back to `/admin/playground` → verify session restored
7. **Reset**: click reset → verify chat cleared, verify DB record deleted
8. **New session after reset**: send message → new chatId, works

## Files changed

| File | Change |
|------|--------|
| `apps/console/app/admin/playground/page.tsx` | Remove messages[] serialization; add session restore + reset button + chatId state |
| `apps/console/app/api/admin/playground/run/route.ts` | Accept chatId, drop messages[], pass chatId to runner |
| `apps/console/lib/agent/playground-runner.ts` | PrismaPersistence, chatId flow, cap cleanup, DB loadMessages |
| `apps/console/app/api/admin/playground/sessions/route.ts` | **NEW** — list sessions |
| `apps/console/app/api/admin/playground/sessions/[chatId]/route.ts` | **NEW** — get/delete session |
| `apps/console/lib/agent/__tests__/integration/playground-persistence.test.ts` | **NEW** — guard tests |
| `apps/console/lib/i18n/dictionaries.ts` | Reset button + session labels (en + zh) |

## Design decisions (locked)

1. **Server-side history loading** — client sends chatId, server loads from DB. Single source of truth, constant request size.
2. **Zero schema changes** — Case.type='playground', Message.caseId FK, ON DELETE CASCADE.
3. **Per-account cap = 5** — `MAX_PLAYGROUND_SESSIONS` constant, oldest evicted on creation.
4. **dryRun: true preserved** — tools still mocked, only message persistence changes.
5. **Reset = DELETE Case** — cascade clears messages, no orphaned rows.
6. **Session restore on page mount** — GET latest session, auto-render history.

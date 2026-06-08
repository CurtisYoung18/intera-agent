# Hard Bugs Archive

> Last updated: 2026-06-08

---

## Bug 1: Playground chat history leaks across org switch

**Symptom:** Switching organization in console still shows previous org's playground chat history.

**Root cause:** 3-layer isolation failure:
1. `localStorage` key `pg_chatId` was global — not scoped to user or org
2. Session restore `useEffect` only detected agent switch (`prevAgentIdRef`), not org switch
3. Session API scoped by `userId` but `userId` stays same across org switches (same console account)

**Fix (commit `88ac4682`):**
- Scoped localStorage keys to `userId + agentId`: `pg_chatId_${userId}_${agentId}`, `pg_formRequest_${userId}_${agentId}`, `pg_trace_collapsed_${userId}`
- Added `prevOrgIdRef` to detect org switch, clearing state same as agent switch
- Same scoping applied to all `pg_*` localStorage operations

**Files:** `apps/console/app/admin/playground/page.tsx`

---

## Bug 2: Tool use renderHint cards disappear after playground page refresh

**Symptom:** Agent-generated tool output cards (RenderHintCard: lists, images, cards) vanish on page refresh.

**Root cause:** `renderHints` dropped at 3 points in the persistence chain:

```
SSE skill_result event  →  has renderHints ✅
    ↓
ToolExecutionResult     →  MISSING renderHints field in interface
    ↓
loop.ts trace payload   →  renderHints not written to DB
    ↓
session restore          →  payload.renderHints = undefined → cards lost
```

**Fix (commits `570e823e`, `43f13f9a`):**

| Layer | Change |
|---|---|
| `ToolExecutionResult` interface | Added `renderHints?: ToolDefinition['renderHints']` |
| `streaming-tool-executor.ts` | All 3 `results.push()` sites now include `renderHints: tool.definition.renderHints` |
| `loop.ts` trace write | Added `renderHints: result.renderHints` to skill_result trace payload |
| `playground/page.tsx` session restore | Reads `payload.renderHints` (primary) with `renderHintsMap` (DB fallback); uses `payload.skillName` for tool name |

**Files:** `streaming-tool-executor.ts`, `loop.ts`, `playground/page.tsx`, `playground/sessions/[chatId]/route.ts`

---

## Lessons

1. **Trace full data flow before fixing.** Bug 2 first 2 attempts only patched the restore side (DB `renderHintsMap`), missing that the write side never stored `renderHints` in the trace payload.
2. **SSE → DB → restore is one pipeline.** When data visible during live SSE is lost on refresh, check every hop: SSE event payload → in-memory state → DB trace payload → API response → restore logic.
3. **localStorage keys must be scoped.** Any key used across org/agent boundaries needs user+agent scope, and the UI must detect scope changes.

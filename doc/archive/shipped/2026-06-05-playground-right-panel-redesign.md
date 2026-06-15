> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Playground Right Panel — Unified Timeline Redesign

> **铁律 (GENERIC_HANDOFF §0):** declare lane in MASTER_BUILD_HANDOFF before touching files; two-phase receipt required (local gate + production browser verify).

**Goal:** Merge "Live Activity" + "Behavior Trace" into a single unified timeline. Eliminates duplicated stats, fills empty space with meaningful content.

**Scope:** Rendering changes in `page.tsx` only. No data pipeline changes.

---

## Context (verified in code 2026-06-05)

- Right panel `<aside>` at [page.tsx:988](apps/console/app/admin/playground/page.tsx#L988), width 340px
- **Live Activity** `SidebarSection` at line 997–1105: stats (lines 1003–1020) + tool list (1022–1104) + RenderHintCard (1089–1102)
- **Behavior Trace** `SidebarSection` at line 1107–1273: stats (1117–1143) + skipped toggle (1145–1168) + turn groups (1170–1270)
- Both stats blocks compute identical data from `turnTraces` → duplicated
- Behavior Trace uses `flex={1}` → empty space when few steps
- `SidebarSection` component defined at lines 1265–1310

---

## Acceptance criteria

- **AC-A** Single `<SidebarSection title="Trace">` replaces the two sections. Summary bar at top shows aggregate tokens/timing/turns. No duplicate stats.
- **AC-B** Timeline entries are chronological: during streaming, live tools appear with spinner; after turn completes, live tools clear and trace steps render.
- **AC-C** Skipped stages hidden by default; toggle shows/hides them with opacity 0.4.
- **AC-D** Clicking a completed step inline-expands detail below the row (PromptViewer for Model gen, JSON for tools, etc.)
- **AC-E** Empty state ("Send a message to see the trace") shown when no messages sent yet.
- **AC-F** Multi-turn: "TURN N" separators, entries accumulate chronologically, summary bar aggregates across turns.

---

## File change map

| File | Change |
|------|--------|
| `apps/console/app/admin/playground/page.tsx` | Replace two `SidebarSection` blocks (lines 997–1273) with single unified timeline |

---

## Task 1 — Merge two SidebarSections into unified timeline

**File:** `apps/console/app/admin/playground/page.tsx`

### Step 1: Remove the Live Activity `SidebarSection` (lines 997–1105)

Delete the entire first `<SidebarSection title="Live activity">` block. This removes:
- The duplicate stats IIFE (lines 1003–1020)
- The tool list rendering (lines 1022–1104)
- The RenderHintCard display (lines 1089–1102)

### Step 2: Rewrite the Behavior Trace `SidebarSection` as unified timeline

Replace `<SidebarSection title="Behavior trace">` (line 1107) with `<SidebarSection title="Trace">`:

```tsx
<SidebarSection
  title="Trace"
  icon={<Activity size={11} />}
  count={liveTools.length + turnTraces.reduce((sum, t) => sum + t.length, 0)}
>
```

Remove `flex={1}` — the section should size to content.

### Step 3: Add summary bar at top

Move the Behavior Trace stats block (lines 1117–1143) to be the first child. This is the single source of aggregate stats. No changes needed to the computation — it already sums correctly.

### Step 4: Add timeline entries section

After the summary bar, render a single `<div>` containing:

1. **Turn groups** (existing logic from lines 1170–1270) — iterate `turnTraces`, filter skipped, render steps
2. **Live tools** (during streaming) — when `turnTraces` is empty or last turn hasn't completed, show `liveTools` entries with spinner/completed state

The live tools rendering adapts the existing tool row code (lines 1026–1088) but in a flat timeline style:
- Running: spinner + tool name + "running..."
- Done: status dot + tool name + duration
- Error: red dot + tool name + error summary

### Step 5: Skipped toggle

Keep existing skipped toggle logic (lines 1145–1168). Move it inside the unified timeline div, after turn groups.

### Step 6: Empty state

When `turnTraces.length === 0 && liveTools.length === 0`, show:
```tsx
<SidebarEmpty>Send a message to see the trace.</SidebarEmpty>
```

### Step 7: RenderHintCard

Keep the RenderHintCard rendering (lines 1089–1102) — append it after the timeline entries, before the closing `</SidebarSection>`.

### Step 8: Verify

```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # all passing
npm run build:console                             # success
```

Commit: `feat(playground): unified timeline — merge live activity + behavior trace`

---

## Phase 2 — Production verification

1. `git push deploy main`
2. `curl -s https://demo.anytrans.ai/api/health` → `{"status":"ok","db":"connected"}`
3. Login: test@intera.dev / intera123
4. Navigate to Playground
5. **Before sending:** empty state visible ("Send a message to see the trace")
6. **Send "Where is my order?":**
   - Summary bar appears with token counts
   - Timeline shows entries: Guardrails → Knowledge → Tools (spinner → done) → Model gen
   - Click Model gen → PromptViewer expands inline
   - Skipped stages hidden, toggle works
7. **Send second message:** "What about my return?"
   - "TURN 2" separator appears
   - Entries accumulate below turn 1
   - Summary bar updates with cross-turn totals
8. Take screenshots at key moments

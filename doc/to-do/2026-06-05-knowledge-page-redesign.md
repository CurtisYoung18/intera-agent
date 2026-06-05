# Knowledge Page Redesign — (Implementation Plan)

> **For the coding team:** One-shot. Execute end-to-end (spawn parallel sub-agents per the wave map), then hand back for a single architect review. Target 95%; the **Architect-Reserved** items come back for the architect. Steps use `- [ ]`.
>
> **铁律 (GENERIC_HANDOFF §0):** declare your lane(s) in MASTER_BUILD_HANDOFF before touching files; every task ends with the two-phase receipt (local gate + production browser verify); safety changes ship red→green e2e guards.

**Goal:** Redesign the Knowledge admin page (`/admin/knowledge`) from a single 710-line god-component into a clean, modular layout with tab-based navigation, liquid glass styling, and correct UX semantics — fixing the misleading "7 tools active" badge when GPTBots API is disconnected.

**Architecture:** All changes within the playground subsystem — `page.tsx` (UI), no API route changes, no data model changes. The 4 API routes (`sources/route.ts`, `sources/[id]/route.ts`, `gptbots/route.ts`, `test/route.ts`) remain untouched. Existing `useCapabilityBindings`, `useSelectedAgentId`, `apiClient` hooks are preserved.

**Tech Stack:** Next.js 15, React, TypeScript, Tailwind CSS. No new dependencies. Uses existing `glass-card`, `glass-input-console`, `glass-pill` utility classes from `globals.css`.

---

## Context (verified in code 2026-06-05)

- `page.tsx` is 710 lines, single `KnowledgePage` component with 14 `useState` hooks + 3 from hooks. Only extraction is inline `ApiKeyInput` (lines 668-710).
- Line 256: `sources.filter(s => s.enabled).length` counts enabled sources from local DB — **does not check `gptConnected`**, so "7 tools active" shows even when GPTBots API is unreachable.
- Lines 264-292: GPTBots connection status + API key config take 2 full rows, always visible, pushing source cards below the fold.
- Sources are fetched from local DB (`GET /api/admin/knowledge/sources`), GPTBots connection via separate `GET /api/admin/knowledge/gptbots`. These are independent.
- Source card rendering at line 424: `sources.filter((s) => s.enabled).map(...)` — flat list, no grid.
- Edit modal at line 468: full-screen overlay with form fields. Keep this interaction pattern.
- `VersionContextBar` rendered with redundant wrapper `<div>` on line 232.
- No `useApi` hook used — raw `useState` + `useCallback` + `useEffect` for all data fetching.
- Liquid glass tokens available: `--surface`, `--border-subtle`, `--border-hover`, `--shadow-card`, `--ease-glass`, `--radius-lg`, `.glass-card`, `.glass-input-console`, `.glass-pill`.

---

## Acceptance criteria (write these as tests)

- **AC-A** The page renders two tabs: "Sources" (default active) and "Test Retrieval". Switching tabs shows the correct view without remounting unrelated state.
- **AC-B** The "N tools active" badge counts only enabled sources **AND** `gptConnected === true`. When GPTBots is disconnected, the badge reads "N sources configured" instead.
- **AC-C** The GPTBots API key section is collapsed by default, showing only a one-line connection status bar. Clicking expands it to reveal the key input + save button.
- **AC-D** Source cards render in a 2-column responsive grid (`grid-cols-1 sm:grid-cols-2`). Each card shows: name, tool name (monospace), description (2-line clamp), group_id (truncated + tooltip), parameter badges, toggle, and action buttons (Edit / Bind / Delete with text labels).
- **AC-E** Disabled sources render with reduced opacity (`opacity-55`) and muted colors.
- **AC-F** All cards and surfaces use liquid glass styling: `glass-card` or equivalent (`bg-white/50 backdrop-blur-xl rounded-[var(--radius-lg)] border border-white/60 shadow-card`), `--ease-glass` transitions, `--border-subtle` / `--border-hover` for borders.
- **AC-G** The edit modal, confirm dialog, and test retrieval panel retain existing functionality — no regression in CRUD, binding, or search.

---

## File change map

| File | Change | Lane |
|---|---|---|
| `apps/console/app/admin/knowledge/page.tsx` | Full rewrite: extract sub-components, add tabs, fix badge logic, liquid glass styling | L1 |
| `apps/console/app/admin/knowledge/page.test.tsx` | **NEW** — AC-A/AC-B/AC-C component tests | L2 |

---

## Wave map

- **Wave 0 (serial, tiny):** None — no contract changes needed.
- **Wave 1 (parallel):** L1 = Task 1 (page.tsx rewrite), L2 = Task 2 (tests).
- **Wave 2:** Task 3 — full local gate + production browser verify.

---

## Task 1 — page.tsx rewrite (Wave 1, Lane L1)

**Files:** Modify `apps/console/app/admin/knowledge/page.tsx`

- [ ] **Step 1 — Extract sub-components.** Split the monolith into focused components, all within the same file (no new files):

```tsx
// Tab bar component
function KnowledgeTabs({ activeTab, onTabChange, sourceCount }: {
  activeTab: 'sources' | 'test'
  onTabChange: (tab: 'sources' | 'test') => void
  sourceCount: number
}) { /* ... */ }

// Collapsible API key section
function GptBotsConnection({ gptConnected, gptKbs, gptKbsLoading, onRefresh, onKeySaved }: {
  gptConnected: boolean | null
  gptKbs: GptBotKb[]
  gptKbsLoading: boolean
  onRefresh: () => void
  onKeySaved: () => void
}) { /* ... */ }

// Single source card
function SourceCard({ source, toolName, onToggle, onEdit, onDelete, onBind }: {
  source: KnowledgeSource
  toolName: string
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onBind: () => void
}) { /* ... */ }

// Test retrieval tab content
function TestRetrieval({ sources, testQuery, testSourceId, testResults, testTotal, testing, testError, onQueryChange, onSourceChange, onSearch }: {
  // ... props
}) { /* ... */ }
```

- [ ] **Step 2 — Rewrite KnowledgePage.** The main component becomes ~150 lines: tab state, data fetching (keep existing `useCallback` + `useEffect` pattern), and rendering the extracted components. Replace the flat source list with a CSS grid:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
  {sources.map(s => (
    <SourceCard
      key={s.id}
      source={s}
      toolName={getToolName(s.name)}
      onToggle={() => toggleSource(s)}
      onEdit={() => setEditingSource(s)}
      onDelete={() => handleDelete(s.id)}
      onBind={() => toggleItemBinding(s.id)}
    />
  ))}
</div>
```

- [ ] **Step 3 — Fix "tools active" badge (AC-B).** Replace line 256:

```tsx
// BEFORE (broken):
{sources.filter(s => s.enabled).length} tools active

// AFTER (correct):
{gptConnected
  ? <>{sources.filter(s => s.enabled).length} tools active</>
  : <>{sources.filter(s => s.enabled).length} sources configured</>
}
```

- [ ] **Step 4 — Collapsible API key (AC-C).** Use local `useState<boolean>` for expanded/collapsed:

```tsx
const [apiKeyExpanded, setApiKeyExpanded] = useState(false)

// Collapsed: one-line status bar
// Expanded: full key input + save + refresh
```

- [ ] **Step 5 — Liquid glass styling (AC-F).** Apply consistent glass tokens:

```tsx
// Source card wrapper
className="glass-card p-4 hover:border-[var(--border-hover)] hover:shadow-card-hover transition-all duration-[var(--dur-slow)] ease-[var(--ease-glass)]"

// Toggle ON
className="rounded-full bg-[var(--malachite)] ..."

// Toggle OFF
className="rounded-full bg-black/[0.08] ..."

// Parameter badges
className="glass-pill text-[10px] px-2 py-0.5"

// Tab active
className="text-[var(--indigo)] border-b-2 border-[var(--indigo)]"

// Tab inactive
className="text-[var(--fog)] hover:text-[var(--mist)]"
```

- [ ] **Step 6 — Remove redundant wrapper.** Delete the extra `<div>` around `VersionContextBar` (line 232).

- [ ] **Step 7.** `npx tsc --noEmit -p apps/console/tsconfig.json` → 0 errors. Commit: `feat(knowledge): redesign page — tabs, grid cards, liquid glass, fixed badge`.

---

## Task 2 — Component tests (Wave 1, Lane L2)

**Files:** NEW `apps/console/app/admin/knowledge/page.test.tsx`

- [ ] **Step 1 — AC-B test.** Mock `apiClient` to return sources + `gptConnected: false`. Render page. Assert badge text contains "sources configured" not "tools active". Then mock `gptConnected: true` → assert "tools active".

- [ ] **Step 2 — AC-A test.** Render page. Assert two tab buttons exist ("Sources", "Test Retrieval"). Click "Test Retrieval" → assert test search input is visible, source cards are hidden.

- [ ] **Step 3 — AC-C test.** Render page. Assert API key input is NOT visible (collapsed). Click the connection status bar → assert API key input IS visible (expanded).

- [ ] **Step 4.** Run tests → PASS. Commit: `test(knowledge): AC-A/AC-B/AC-C component tests`.

---

## Task 3 — Verify (Wave 2)

- [ ] **Phase 1:** `tsc` 0 · `env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test` all green · `build:console` ok · changed-files list.
- [ ] **Phase 2 (prod):** deploy; login; `/admin/knowledge`: (a) verify Sources tab shows 2-column grid of 7 cards, (b) verify badge reads "5 tools active" (5 enabled), (c) verify API key section is collapsed, click to expand, (d) click "Test Retrieval" tab → verify search input + results, (e) click Edit on a card → verify modal opens with correct data, (f) screenshot.

---

## Architect-Reserved (the ~5%)

1. **Phase-2 prod verify** of AC-B — needs to confirm the badge correctly reflects `gptConnected` state on the live server (currently disconnected → should show "N sources configured").
2. **Card hover micro-interactions** — the exact `--ease-glass` timing and lavender border tint may need visual polish after seeing it in prod. Architect co-signs.
3. **Responsive breakpoints** — the 2-column grid may need adjustment for very narrow screens (sidebar collapsed vs expanded).

## Risks / rollback
- All changes are within `page.tsx` (single file) — no API route or data model changes. Revert is a single `git revert`.
- Existing CRUD, binding, and test retrieval logic is preserved verbatim — only the rendering layer changes.

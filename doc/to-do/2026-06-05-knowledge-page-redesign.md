# Knowledge Page Redesign — (Implementation Plan)

> **For the coding team:** One-shot. Execute end-to-end (spawn parallel sub-agents per the wave map), then hand back for a single architect review. Target 95%; the **Architect-Reserved** items come back for the architect. Steps use `- [ ]`.
>
> **铁律 (GENERIC_HANDOFF §0):** declare your lane(s) in MASTER_BUILD_HANDOFF before touching files; every task ends with the two-phase receipt (local gate + production browser verify); safety changes ship red→green e2e guards.

**Goal:** Redesign the Knowledge admin page (`/admin/knowledge`) from a single 710-line god-component into a clean, modular layout with tab-based navigation, liquid glass styling, and correct UX semantics — fixing the source list to only show sources bound to the current agent via `CapabilityBindings.knowledge`, and the badge to reflect actual bound+enabled count.

**Architecture:** All changes within the playground subsystem — `page.tsx` (UI), no API route changes, no data model changes. The 4 API routes (`sources/route.ts`, `sources/[id]/route.ts`, `gptbots/route.ts`, `test/route.ts`) remain untouched. Existing `useCapabilityBindings`, `useSelectedAgentId`, `apiClient` hooks are preserved. Source list is filtered **client-side** by `bindings.knowledge` (per-agent `KnowledgeSource.name[]` array). Adding a source to an agent = pushing its name into `bindings.knowledge` via `saveBindings`.

**Tech Stack:** Next.js 15, React, TypeScript, Tailwind CSS. No new dependencies. Uses existing `glass-card`, `glass-input-console`, `glass-pill` utility classes from `globals.css`.

---

## Context (verified in code 2026-06-05)

- `page.tsx` is 710 lines, single `KnowledgePage` component with 14 `useState` hooks + 3 from hooks. Only extraction is inline `ApiKeyInput` (lines 668-710).
- Line 256: `sources.filter(s => s.enabled).length` counts enabled sources from local DB — **does not check `gptConnected`**, so "7 tools active" shows even when GPTBots API is unreachable.
- Lines 264-292: GPTBots connection status + API key config take 2 full rows, always visible, pushing source cards below the fold.
- Sources are fetched from local DB (`GET /api/admin/knowledge/sources`), GPTBots connection via separate `GET /api/admin/knowledge/gptbots`. These are independent.
- Source card rendering at line 424: `sources.filter((s) => s.enabled).map(...)` — flat list, renders ALL org sources, **does not filter by agent bindings**. THIS IS THE BUG: a new agent with `bindings.knowledge = []` still shows all 7 sources.
- Edit modal at line 468: full-screen overlay with form fields. Keep this interaction pattern.
- `VersionContextBar` rendered with redundant wrapper `<div>` on line 232.
- No `useApi` hook used — raw `useState` + `useCallback` + `useEffect` for all data fetching.
- `useCapabilityBindings` (line 70) provides `bindings.knowledge: string[]` (KnowledgeSource names bound to current agent) and `saveBindings` (updates `bindings.knowledge` array). This hook is the correct way to filter sources per-agent.
- Liquid glass tokens available: `--surface`, `--border-subtle`, `--border-hover`, `--shadow-card`, `--ease-glass`, `--radius-lg`, `.glass-card`, `.glass-input-console`, `.glass-pill`.

---

## Acceptance criteria (write these as tests)

- **AC-A** The page renders two tabs: "Sources" (default active) and "Test Retrieval". Switching tabs shows the correct view without remounting unrelated state.
- **AC-B** The source list only shows sources whose `name` is in `bindings.knowledge` (the current agent's bound sources). A new agent with `bindings.knowledge = []` shows an empty state. The "N tools active" badge counts bound+enabled sources. When GPTBots is disconnected, the badge reads "N sources configured" instead.
- **AC-C** The GPTBots API key section is collapsed by default, showing only a one-line connection status bar. Clicking expands it to reveal the key input + save button.
- **AC-D** Source cards render in a 2-column responsive grid (`grid-cols-1 sm:grid-cols-2`). Each card shows: name, tool name (monospace), description (2-line clamp), group_id (truncated + tooltip), parameter badges, toggle, and action buttons (Edit / Bind / Delete with text labels).
- **AC-E** Disabled sources render with reduced opacity (`opacity-55`) and muted colors.
- **AC-F** All cards and surfaces use liquid glass styling: `glass-card` or equivalent (`bg-white/50 backdrop-blur-xl rounded-[var(--radius-lg)] border border-white/60 shadow-card`), `--ease-glass` transitions, `--border-subtle` / `--border-hover` for borders.
- **AC-G** The edit modal, confirm dialog, and test retrieval panel retain existing functionality — no regression in CRUD, binding, or search.
- **AC-H** An "Add Source" button opens a picker showing unbound org sources (those NOT in `bindings.knowledge`). Selecting a source appends its name to `bindings.knowledge` via `saveBindings`.

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
function KnowledgeTabs({ activeTab, onTabChange, boundCount }: {
  activeTab: 'sources' | 'test'
  onTabChange: (tab: 'sources' | 'test') => void
  boundCount: number
}) { /* ... */ }

// Collapsible API key section
function GptBotsConnection({ gptConnected, gptKbs, gptKbsLoading, onRefresh, onKeySaved }: {
  gptConnected: boolean | null
  gptKbs: GptBotKb[]
  gptKbsLoading: boolean
  onRefresh: () => void
  onKeySaved: () => void
}) { /* ... */ }

// Single source card (only for bound sources)
function SourceCard({ source, toolName, onToggle, onEdit, onDelete, onBind }: {
  source: KnowledgeSource
  toolName: string
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onBind: () => void
}) { /* ... */ }

// Add source picker (unbound org sources)
function AddSourcePicker({ candidates, onAdd }: {
  candidates: KnowledgeSource[]
  onAdd: (source: KnowledgeSource) => void
}) { /* ... */ }

// Empty state for unbound agent
function EmptySources({ onAddSource }: {
  onAddSource: () => void
}) { /* ... */ }

// Test retrieval tab content
function TestRetrieval({ sources, testQuery, testSourceId, testResults, testTotal, testing, testError, onQueryChange, onSourceChange, onSearch }: {
  // ... props
}) { /* ... */ }
```

- [ ] **Step 2 — Rewrite KnowledgePage.** The main component becomes ~150 lines: tab state, data fetching (keep existing `useCallback` + `useEffect` pattern), and rendering the extracted components. **Critical: filter sources by agent bindings.**

```tsx
// Filter: only sources bound to this agent
const boundSources = sources.filter(s => bindings.knowledge.includes(s.name))

// Badge: count bound + enabled
const boundEnabledCount = boundSources.filter(s => s.enabled).length

// Grid layout (or empty state if no bindings)
{boundSources.length === 0 ? (
  <EmptySources onAddSource={() => setShowAddPicker(true)} />
) : (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    {boundSources.map(s => (
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
)}
```

- [ ] **Step 3 — Fix "tools active" badge (AC-B).** Replace line 256. Badge now counts bound+enabled sources, not all org sources:

```tsx
// BEFORE (broken): counts ALL org sources, ignores bindings
{sources.filter(s => s.enabled).length} tools active

// AFTER (correct): counts only bound+enabled sources
const boundEnabledCount = boundSources.filter(s => s.enabled).length

{gptConnected
  ? <>{boundEnabledCount} tools active</>
  : <>{boundEnabledCount} sources configured</>
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

- [ ] **Step 5b — Add Source picker (AC-H).** When "Add Source" is clicked, show a picker panel listing unbound org sources. Each candidate shows name + description + "Add" button. On click, push the source name into `bindings.knowledge` via `saveBindings`. Close picker after add.

```tsx
// Unbound candidates: org sources not yet bound to this agent
const unboundCandidates = sources.filter(s => !bindings.knowledge.includes(s.name))

// Add source handler
const addSource = async (source: KnowledgeSource) => {
  await saveBindings({ knowledge: [...bindings.knowledge, source.name] })
}
```

- [ ] **Step 6 — Remove redundant wrapper.** Delete the extra `<div>` around `VersionContextBar` (line 232).

- [ ] **Step 7.** `npx tsc --noEmit -p apps/console/tsconfig.json` → 0 errors. Commit: `feat(knowledge): redesign page — tabs, grid cards, liquid glass, fixed badge`.

---

## Task 2 — Component tests (Wave 1, Lane L2)

**Files:** NEW `apps/console/app/admin/knowledge/page.test.tsx`

- [ ] **Step 1 — AC-B test.** Mock `apiClient` to return 5 org sources, `gptConnected: false`, and `bindings.knowledge: ['source-a', 'source-b']`. Render page. Assert only 2 source cards are visible (a, b), not all 5. Badge reads "0 sources configured" (2 bound but both disabled). Then mock `gptConnected: true` and one source enabled → badge reads "1 tools active".

- [ ] **Step 2 — AC-B empty state test.** Mock `bindings.knowledge: []` (new agent). Render page. Assert source list is empty, "Add Source" empty state is visible, badge reads "0 sources configured".

- [ ] **Step 3 — AC-A test.** Render page. Assert two tab buttons exist ("Sources", "Test Retrieval"). Click "Test Retrieval" → assert test search input is visible, source cards are hidden.

- [ ] **Step 4 — AC-C test.** Render page. Assert API key input is NOT visible (collapsed). Click the connection status bar → assert API key input IS visible (expanded).

- [ ] **Step 5 — AC-H test.** Mock 5 org sources, `bindings.knowledge: ['source-a']`. Render page. Click "Add Source" → assert picker shows 4 unbound sources (not source-a). Click "Add" on source-b → assert `saveBindings` called with `knowledge: ['source-a', 'source-b']`.

- [ ] **Step 6.** Run tests → PASS. Commit: `test(knowledge): AC-A/AC-B/AC-C/AC-H component tests`.

---

## Task 3 — Verify (Wave 2)

- [ ] **Phase 1:** `tsc` 0 · `env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test` all green · `build:console` ok · changed-files list.
- [ ] **Phase 2 (prod):** deploy; login; `/admin/knowledge`: (a) verify Sources tab shows only bound sources (switch agents to verify different lists), (b) verify new agent shows empty state + "Add Source" button, (c) verify badge reads correct bound+enabled count, (d) verify API key section is collapsed, click to expand, (e) click "Test Retrieval" tab → verify search input + results, (f) click Edit on a card → verify modal opens with correct data, (g) click "Add Source" → verify picker shows unbound sources, add one → verify it appears in list, (h) screenshot.

---

## Architect-Reserved (the ~5%)

1. **Phase-2 prod verify** of AC-B — needs to confirm the badge correctly reflects bound+enabled count AND `gptConnected` state on the live server. Verify: (a) switch between agents with different bindings → list updates, (b) new agent → empty list, (c) GPTBots disconnected → badge reads "N sources configured".
2. **Card hover micro-interactions** — the exact `--ease-glass` timing and lavender border tint may need visual polish after seeing it in prod. Architect co-signs.
3. **Responsive breakpoints** — the 2-column grid may need adjustment for very narrow screens (sidebar collapsed vs expanded).
4. **Add Source picker UX** — the picker panel layout (modal vs inline vs slide-out) may need visual tuning in prod. Architect co-signs.

## Risks / rollback
- All changes are within `page.tsx` (single file) — no API route or data model changes. Revert is a single `git revert`.
- Existing CRUD, binding, and test retrieval logic is preserved verbatim — only the rendering layer changes.

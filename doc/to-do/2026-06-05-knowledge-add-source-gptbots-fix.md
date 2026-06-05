# Knowledge Add Source — GPTBots API Key Gate + Real KB Picker

> **For the coding team:** One-shot. Fix the Add Source flow to require GPTBots API key first, then pick from real GPTBots KBs (not local DB sources). Execute end-to-end, then hand back for architect review.
>
> **铁律 (GENERIC_HANDOFF §0):** declare your lane(s) in MASTER_BUILD_HANDOFF before touching files; every task ends with the two-phase receipt (local gate + production browser verify).

**Goal:** Fix the Add Source flow so it (1) gates on GPTBots API key configuration, (2) shows real KBs from GPTBots API as candidates, (3) creates a local KnowledgeSource + binds to agent on selection. Different API keys yield different KBs — the picker must reflect the live GPTBots state.

**Architecture:** Changes within `page.tsx` only. No API route changes — existing routes (`gptbots/route.ts` for KB list, `sources/route.ts` for create) are sufficient.

**Tech Stack:** Next.js 15, React, TypeScript, Tailwind CSS. No new dependencies.

---

## Context (verified in code 2026-06-05)

- `page.tsx:32` — `GptBotKb` interface: `{ id, name, desc, chunk, doc }` (from GPTBots API)
- `page.tsx:345` — `gptKbs` state: fetched from `GET /api/admin/knowledge/gptbots`
- `page.tsx:376` — `fetchGptKbs()`: calls GPTBots API via proxy, sets `gptConnected` + `gptKbs`
- `page.tsx:350` — `gptConnected`: `true` (key valid), `false` (no key), `null` (checking)
- `page.tsx:537` — Current "Add Source" button: opens picker showing local DB `sources` (WRONG)
- `page.tsx:555` — `bindSource()`: calls `toggleItemBinding` + `saveBindings` (correct for binding)
- `gptbots/route.ts:9` — GPTBots KB API: `https://api-sg.gptbots.ai/v1/bot/knowledge/base/page`
- `gptbots/route.ts:11-16` — API key source: `AgentConfig.gptbotsApiKey` (per-org, active version)
- `sources/route.ts:31-45` — `POST /api/admin/knowledge/sources`: creates KnowledgeSource in local DB
- `KnowledgeSource.groupIds` — JSON array of GPTBots KB IDs (links local source to GPTBots KB)

---

## Acceptance criteria

- **AC-A** When `gptConnected === false` (no API key), the "Add Source" button is disabled/hidden with a tooltip/hint: "Configure GPTBots API key first". Clicking does nothing.
- **AC-B** When `gptConnected === true`, clicking "Add Source" opens a picker showing GPTBots KBs from `gptKbs` (NOT local DB sources). Each candidate shows: KB name, description, chunk count, doc count.
- **AC-C** The picker excludes KBs that are already bound to this agent (i.e., KBs whose `id` appears in any local KnowledgeSource's `groupIds` AND that source is bound via `bindings.knowledge`).
- **AC-D** Clicking "Bind" on a GPTBots KB: (1) creates a local KnowledgeSource via `POST /api/admin/knowledge/sources` with `name` = KB name, `description` = KB desc, `groupIds` = `[KB.id]`, (2) adds the source name to `bindings.knowledge` via `saveBindings`, (3) closes picker, (4) source card appears in the list.
- **AC-E** If the KB name already exists in local DB (duplicate), the picker shows it as already added (disabled "Bind" button) instead of failing with a 409 conflict.
- **AC-F** The GPTBots connection section remains collapsible. After configuring the API key and clicking Refresh, `gptKbs` updates and the picker reflects the new KBs.

---

## File change map

| File | Change | Lane |
|---|---|---|
| `apps/console/app/admin/knowledge/page.tsx` | Fix Add Source picker: gate on gptConnected, use gptKbs as candidates, create KnowledgeSource on bind | L1 |

---

## Wave map

- **Wave 1:** L1 = Task 1 (page.tsx fix)
- **Wave 2:** Task 2 (verify)

---

## Task 1 — Fix Add Source picker (Wave 1, Lane L1)

**Files:** Modify `apps/console/app/admin/knowledge/page.tsx`

- [ ] **Step 1 — Gate Add Source on API key (AC-A).** When `gptConnected !== true`, disable the "Add Source" button and show a hint:

```tsx
<button
  onClick={() => gptConnected && setShowAddPicker(true)}
  disabled={!gptConnected}
  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-card text-[12px] font-semibold transition-opacity ${
    gptConnected ? 'text-[var(--malachite)] hover:opacity-80' : 'text-[var(--fog)] opacity-40 cursor-not-allowed'
  }`}
  title={!gptConnected ? 'Configure GPTBots API key first' : undefined}
>
  <Plus className="w-3.5 h-3.5" /> Add Source
</button>
```

- [ ] **Step 2 — Use gptKbs as picker candidates (AC-B).** Replace the Add Source picker's `unboundSources` (local DB) with GPTBots KBs:

```tsx
// BEFORE (wrong): shows local DB sources
const unboundSources = sources.filter(s => !boundNames.includes(s.name))

// AFTER (correct): shows GPTBots KBs from API
// Already-bound KB IDs = IDs found in groupIds of bound sources
const boundKbIds = new Set(
  boundSources.flatMap(s => parseGroupIds(s.groupIds))
)
const availableKbs = gptKbs.filter(kb => !boundKbIds.has(kb.id))
```

- [ ] **Step 3 — Update picker UI (AC-B/C).** Replace source cards in the picker with KB cards:

```tsx
{availableKbs.length === 0 ? (
  <p className="text-[13px] text-[var(--fog)] py-8 text-center">
    {gptKbs.length === 0
      ? 'No knowledge bases found in GPTBots.'
      : 'All knowledge bases are already bound to this agent.'}
  </p>
) : (
  <div className="space-y-2">
    {availableKbs.map((kb) => (
      <div key={kb.id} className="flex items-center justify-between gap-3 glass-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[var(--mist)] truncate">{kb.name}</p>
          {kb.desc && (
            <p className="text-[11px] text-[var(--fog)] mt-0.5 line-clamp-1">{kb.desc}</p>
          )}
          <p className="text-[10px] text-[var(--fog)] mt-0.5">{kb.chunk} chunks · {kb.doc} docs</p>
        </div>
        <button
          onClick={() => bindGptBotKb(kb)}
          className="px-3 py-1.5 rounded-xl bg-[var(--indigo)] text-white text-[11px] font-semibold hover:opacity-90 transition-opacity flex-shrink-0"
        >
          Bind
        </button>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 4 — Implement bindGptBotKb handler (AC-D/E).** Create local source + bind:

```tsx
const bindGptBotKb = async (kb: GptBotKb) => {
  // Check if KB name already exists in local DB (AC-E)
  const existing = sources.find(s => s.name === kb.name)
  if (existing) {
    // Already exists — just bind it
    const newB = toggleItemBinding(bindings, 'knowledge', existing.name)
    saveBindings(newB)
    setShowAddPicker(false)
    return
  }

  // Create local KnowledgeSource from GPTBots KB
  try {
    await apiClient('/api/admin/knowledge/sources', {
      method: 'POST',
      body: {
        name: kb.name,
        description: kb.desc || null,
        groupIds: JSON.stringify([kb.id]),
        embeddingRate: 0.9,
        topK: 15,
        rerankVersion: 'BGE-Rerank',
        docCorrelation: 0.3,
        enabled: true,
      },
    })
    // Bind to agent
    const newB = toggleItemBinding(bindings, 'knowledge', kb.name)
    saveBindings(newB)
    // Refresh sources list
    fetchSources()
    setShowAddPicker(false)
  } catch {
    setError('Failed to add knowledge source')
  }
}
```

- [ ] **Step 5 — Clean up picker close handler.** Ensure clicking backdrop or X button works:

```tsx
// Already handled by setShowAddPicker(false) in the backdrop onClick
// Just make sure the X button also calls setShowAddPicker(false)
```

- [ ] **Step 6.** `npx tsc --noEmit -p apps/console/tsconfig.json` → 0 errors. Commit: `fix(knowledge): Add Source picker uses GPTBots API KBs, gated on API key`.

---

## Task 2 — Verify (Wave 2)

- [ ] **Phase 1:** `tsc` 0 · `env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test` all green · `build:console` ok.
- [ ] **Phase 2 (prod):** deploy; login; `/admin/knowledge`: (a) verify "Add Source" is disabled when GPTBots disconnected, (b) configure API key → Refresh → verify KBs load, (c) click "Add Source" → verify GPTBots KBs shown (not local DB sources), (d) bind a KB → verify source card appears with correct group_id, (e) verify bound KB excluded from picker, (f) screenshot.

---

## Architect-Reserved

1. **GPTBots API key is per-org** (stored on active `AgentConfig`), not per-agent. All agents share the same key. If per-agent keys are needed later, the `getApiKey` function in `gptbots/route.ts` needs scoping.
2. **Source name = KB name** — if a user manually creates a source with the same name as a GPTBots KB, the duplicate detection (AC-E) handles it. But renaming a source could break the binding.
3. **Large KB lists** — GPTBots may return many KBs. Consider pagination or search if the list grows beyond ~20.

## Risks / rollback
- Changes are within `page.tsx` only — no API route changes. Revert is a single `git revert`.
- Existing CRUD, binding, and test retrieval logic preserved.
- The `POST /api/admin/knowledge/sources` route already handles duplicate names (409 Conflict) — AC-E catches this client-side before the API call.

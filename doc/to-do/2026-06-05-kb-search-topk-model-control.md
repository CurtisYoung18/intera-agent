# KB Search topK Model Control

**Date**: 2026-06-05 | **Status**: Ready for dispatch | **Spec**: `docs/superpowers/specs/2026-06-05-kb-search-topk-model-control.md`

## Problem

DeepSeek v4 Flash consistently passes `topK: 5` in kb_search tool calls, overriding the knowledge source's configured topK (default 15). The tool schema declares `default: 15`, but the model ignores it. This causes sub-optimal recall.

## Solution

Per-source toggle: when off (default), server ignores model's topK and uses source config. When on, model may request 1-30, clamped.

## Task list

### T1 — Schema + migration

Add `modelControlTopK` column to `KnowledgeSource` model.

**File**: `packages/shared/prisma/schema.prisma`

- Add `modelControlTopK Boolean @default(false)` to `KnowledgeSource` model
- Generate migration: `npx prisma migrate dev --schema=packages/shared/prisma/schema.prisma --name add_knowledge_source_model_control_topk`
- Verify: `npx prisma db push --schema=packages/shared/prisma/schema.prisma` (local) or confirm column exists on prod

### T2 — Knowledge page UI

Add toggle next to Top-K input.

**File**: `apps/console/app/admin/knowledge/page.tsx`

- Import the field from the source type (already returns DB columns)
- Next to the Top-K `<input>` (around line 743-749), add a toggle:
  ```
  <label class="flex items-center gap-2 text-[11px] text-[var(--mist)] cursor-pointer">
    <input type="checkbox" checked={editingSource.modelControlTopK ?? false}
      onChange={(e) => setEditingSource({ ...editingSource, modelControlTopK: e.target.checked })} />
    Allow model to control
  </label>
  ```
- When toggle is on, show subtle hint: `"Model may request 1–30 results. Configured value is fallback."`

### T3 — Dynamic tool description

Make kb_search tool description vary based on `modelControlTopK`.

**File**: `apps/console/lib/agent/skills.ts` — around line 996

- When `ks.modelControlTopK` is `true`:
  ```
  description: `Search the "${ks.name}" knowledge base. Number of results to return (1–30, higher values return more matches). Default: ${ks.topK}.`
  ```
- When `false`:
  ```
  description: ks.description || `Search the "${ks.name}" knowledge base.`
  ```
  (omit topK mention entirely — model has no reason to pass it)

### T4 — Server-side enforcement

Clamp model's topK when toggle is on.

**File**: `apps/console/lib/agent/streaming-tool-executor.ts` — line 407

Replace:
```ts
top_k: (input.topK as number) ?? maxTopK,
```
With:
```ts
top_k: source.modelControlTopK
  ? Math.min(Math.max((input.topK as number) ?? source.topK, 1), 30)
  : source.topK,
```

Also update the `sources` query (around line 373-376) to include `modelControlTopK` in the select fields.

Same pattern for the fallback path (line 416): use source's topK.

## Verification

### Phase 1 — Local gate
```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # all passing
npm run build:console                             # success
```

### Phase 2 — Production verification
1. Deploy: `git push deploy main` → wait for health check
2. Open `https://demo.anytrans.ai/admin/knowledge` → verify toggle appears next to Top-K
3. Test with toggle OFF: playground → send message that triggers kb_search → trace shows topK = source's configured value (not 5)
4. Test with toggle ON: playground → send message → trace shows model's topK (if model passes one), clamped 1-30
5. Verify tool description in System prompt: expand "Model generation" → "System prompt" → should include/omit topK guidance based on toggle

## Files changed
- `packages/shared/prisma/schema.prisma`
- `packages/shared/prisma/migrations/*_add_knowledge_source_model_control_topk/migration.sql`
- `apps/console/app/admin/knowledge/page.tsx`
- `apps/console/lib/agent/skills.ts`
- `apps/console/lib/agent/streaming-tool-executor.ts`

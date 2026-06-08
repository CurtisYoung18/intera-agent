> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# KB Search topK Model Control — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-source toggle controlling whether the model can request its own `topK` value in `kb_search_*` tool calls.

**Architecture:** Add `modelControlTopK` boolean to `KnowledgeSource` (schema → migration → UI toggle → dynamic tool description → server-side clamp). Default `false` = no behavior change.

**Tech Stack:** Prisma (Postgres), Next.js, React, Zod

**Spec:** `docs/superpowers/specs/2026-06-05-kb-search-topk-model-control.md` (design decisions)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/shared/prisma/schema.prisma` | Add `modelControlTopK` column to `KnowledgeSource` |
| `packages/shared/prisma/migrations/` | Auto-generated migration SQL |
| `apps/console/app/admin/knowledge/page.tsx` | Toggle UI next to Top-K input |
| `apps/console/lib/agent/skills.ts` | Dynamic tool description based on flag |
| `apps/console/lib/agent/streaming-tool-executor.ts` | Clamp logic at execution time |

---

### Task 1: Schema + Migration

**Files:**
- Modify: `packages/shared/prisma/schema.prisma`

- [ ] **Step 1: Add column to KnowledgeSource model**

Find the `KnowledgeSource` model in `packages/shared/prisma/schema.prisma`. Locate the field before `createdAt` and add:

```prisma
model KnowledgeSource {
  // ... existing fields ...
  docCorrelation   Float?
  rerankVersion    String?
  modelControlTopK Boolean  @default(false)  // <-- ADD THIS LINE
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  // ...
}
```

- [ ] **Step 2: Generate migration**

```bash
cd packages/shared && npx prisma migrate dev --name add_knowledge_source_model_control_topk
```

Verify the generated SQL in `packages/shared/prisma/migrations/*_add_knowledge_source_model_control_topk/migration.sql` looks like:

```sql
ALTER TABLE "knowledge_sources" ADD COLUMN "modelControlTopK" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Regenerate Prisma client**

```bash
npm run db:generate
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/prisma/schema.prisma packages/shared/prisma/migrations/
git commit -m "feat(schema): add modelControlTopK to KnowledgeSource"
```

---

### Task 2: Knowledge Page UI Toggle

**Files:**
- Modify: `apps/console/app/admin/knowledge/page.tsx`

- [ ] **Step 1: Add toggle next to existing Top-K input**

Locate the Top-K input (around line 743-749). Replace the existing `<div>` block:

```tsx
<div>
  <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">Top-K</label>
  <input
    type="number" min={1} max={50}
    value={editingSource.topK ?? 15}
    onChange={(e) => setEditingSource({ ...editingSource, topK: parseInt(e.target.value) || 15 })}
    className="glass-input-console"
  />
</div>
```

Replace with:

```tsx
<div>
  <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">Top-K</label>
  <div className="flex items-center gap-3">
    <input
      type="number" min={1} max={50}
      value={editingSource.topK ?? 15}
      onChange={(e) => setEditingSource({ ...editingSource, topK: parseInt(e.target.value) || 15 })}
      className="glass-input-console flex-1"
    />
    <label className="flex items-center gap-1.5 text-[11px] text-[var(--mist)] cursor-pointer select-none whitespace-nowrap">
      <input
        type="checkbox"
        checked={editingSource.modelControlTopK ?? false}
        onChange={(e) => setEditingSource({ ...editingSource, modelControlTopK: e.target.checked })}
        className="accent-[var(--indigo)]"
      />
      Allow model to control
    </label>
  </div>
  {editingSource.modelControlTopK && (
    <p className="text-[10px] text-[var(--fog)] mt-1 opacity-60">
      Model may request 1–30 results. Configured value ({editingSource.topK ?? 15}) is fallback.
    </p>
  )}
</div>
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
```

- [ ] **Step 3: Commit**

```bash
git add apps/console/app/admin/knowledge/page.tsx
git commit -m "feat(knowledge): add modelControlTopK toggle next to Top-K input"
```

---

### Task 3: Dynamic Tool Description

**Files:**
- Modify: `apps/console/lib/agent/skills.ts`

- [ ] **Step 1: Update kb_search tool description**

Locate the `kb_search_*` tool creation block (around line 994-1004). The current code:

```ts
router.skills.set(toolName, {
  name: toolName,
  description: ks.description || `Search the "${ks.name}" knowledge base`,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query in the user\'s language' },
      topK: { type: 'number', description: 'Number of results to return (1-50)', default: 15 },
    },
    required: ['query'],
  },
```

Replace the `description` line with:

```ts
router.skills.set(toolName, {
  name: toolName,
  description: ks.modelControlTopK
    ? (ks.description || `Search the "${ks.name}" knowledge base.`) + ` Number of results to return (1–30, higher values return more matches). Default: ${ks.topK}.`
    : (ks.description || `Search the "${ks.name}" knowledge base`),
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query in the user\'s language' },
      ...(ks.modelControlTopK ? { topK: { type: 'number', description: `Number of results to return (1–30). Default: ${ks.topK}.`, default: ks.topK } } : {}),
    },
    required: ['query'],
  },
```

Key changes:
- When `modelControlTopK` is `true`: description includes sizing guidance, and `topK` parameter is included in the schema with source's configured value as default
- When `false`: description stays as-is, `topK` parameter omitted from schema (model shouldn't care about it)

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
```

- [ ] **Step 3: Commit**

```bash
git add apps/console/lib/agent/skills.ts
git commit -m "feat(skills): dynamic kb_search tool description based on modelControlTopK"
```

---

### Task 4: Server-Side Enforcement

**Files:**
- Modify: `apps/console/lib/agent/streaming-tool-executor.ts`

- [ ] **Step 1: Include modelControlTopK in source query**

Locate the source query (around lines 373-376). The current code:

```ts
let sources: Array<{
  groupIds: string; topK: number; embeddingRate: number;
  docCorrelation: number | null; rerankVersion: string | null;
}> = []
```

Add `modelControlTopK` to the type:

```ts
let sources: Array<{
  groupIds: string; topK: number; embeddingRate: number;
  docCorrelation: number | null; rerankVersion: string | null;
  modelControlTopK: boolean;
}> = []
```

- [ ] **Step 2: Update the topK assignment (GPTBots path)**

Locate line ~407:

```ts
body = {
  prompt: input.query,
  top_k: (input.topK as number) ?? maxTopK,
```

Replace with:

```ts
const source = sources[0]
body = {
  prompt: input.query,
  top_k: source.modelControlTopK
    ? Math.min(Math.max((input.topK as number) ?? source.topK, 1), 30)
    : source.topK,
```

- [ ] **Step 3: Update the topK assignment (fallback path)**

Locate line ~416:

```ts
} else {
  body = {
    prompt: input.query,
    top_k: (input.topK as number) ?? 15,
  }
```

Replace with:

```ts
} else {
  body = {
    prompt: input.query,
    top_k: (input.topK as number) ?? 15,  // unchanged — no source to reference
  }
```

- [ ] **Step 4: Verify TypeScript + tests**

```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
npm run build:console
```

- [ ] **Step 5: Commit**

```bash
git add apps/console/lib/agent/streaming-tool-executor.ts
git commit -m "feat(executor): enforce modelControlTopK clamp in kb_search execution"
```

---

## Verification

### Phase 1 — Local gate

```bash
npx tsc --noEmit -p apps/console/tsconfig.json   # must be 0 errors
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # all passing
npm run build:console                             # must succeed
```

### Phase 2 — Production verification

```bash
git push origin main
git push deploy main
curl -s https://demo.anytrans.ai/api/health   # {"status":"ok","db":"connected"}
```

1. Open `https://demo.anytrans.ai/admin/knowledge` → verify toggle appears next to Top-K on each source card
2. **Toggle OFF (default):** playground → send message that triggers kb_search → trace detail shows `topK` = source's configured value (not 5)
3. **Toggle ON:** playground → send message → trace shows model's topK (clamped 1-30), fallback to configured value if model omits
4. **Model generation → System prompt:** when toggle ON, should include sizing guidance in tool description; when OFF, should not mention topK

## Files Changed Summary

| File | Change |
|------|--------|
| `packages/shared/prisma/schema.prisma` | Add `modelControlTopK Boolean @default(false)` |
| `packages/shared/prisma/migrations/*/migration.sql` | Auto-generated |
| `apps/console/app/admin/knowledge/page.tsx` | Toggle + hint UI |
| `apps/console/lib/agent/skills.ts` | Dynamic description |
| `apps/console/lib/agent/streaming-tool-executor.ts` | Clamp logic |

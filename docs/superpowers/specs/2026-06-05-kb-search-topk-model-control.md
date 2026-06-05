# KB Search topK Model Control

**Date**: 2026-06-05
**Status**: Design approved, implementation plan ready

## Problem

DeepSeek v4 Flash consistently passes `topK: 5` in kb_search tool calls, overriding the configured default (15) and the knowledge source's configured value. The tool schema declares `default: 15`, but the model ignores it. This causes sub-optimal recall.

## Solution: Per-source toggle + server-side enforcement

### Data model

`KnowledgeSource` table: add `modelControlTopK` boolean column, default `false`.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| modelControlTopK | Boolean | false | If false, server uses source's topK; if true, model may request 1-30 |

### Knowledge page UI

Top-K input row gains a toggle:

```
Top-K: [15]  [—] Allow model to control
```

- Toggle off (default): model's topK is ignored, server always uses the source's configured value. No UI hint.
- Toggle on: tooltip "Model may request 1–30 results. Configured value is used as fallback."

### Tool description (skills.ts)

When `modelControlTopK` is `true`, the tool description includes sizing guidance and the `topK` parameter in schema:

```
Search the "{name}" knowledge base. Number of results to return (1–30, higher values return more matches). Default: {topK}.
```

When `false`, description stays unchanged, `topK` parameter omitted from schema.

### Server-side enforcement (streaming-tool-executor.ts)

```ts
const effectiveTopK = source.modelControlTopK
  ? Math.min(Math.max((input.topK as number) ?? source.topK, 1), 30)
  : source.topK
```

### Files touched

| File | Change |
|------|--------|
| `packages/shared/prisma/schema.prisma` | Add `modelControlTopK` to KnowledgeSource model + migration |
| `apps/console/app/admin/knowledge/page.tsx` | Toggle UI next to Top-K input |
| `apps/console/lib/agent/skills.ts` | Dynamic tool description based on flag |
| `apps/console/lib/agent/streaming-tool-executor.ts` | Clamp logic |

### Edge cases

- **Source topK changed while toggle is off**: effective topK changes immediately (always uses source value)
- **Source topK changed while toggle is on**: effective default changes (description updates next skill reload)
- **Model passes topK > 30**: clamped to 30
- **Model passes topK < 1**: clamped to 1
- **Model omits topK**: uses source's configured topK

### Migration note

Existing sources get `modelControlTopK = false` — no behavior change on deploy. Admins opt in per source.

### Implementation plan

See `doc/to-do/2026-06-05-kb-search-topk-model-control.md` for T1–T4 with exact code changes.

# TODO-41 Memory / Compact Three-Layer Redesign — COMPLETED 2026-06-04

**Spec:** `doc/to-do/2026-06-03-memory-three-layer-redesign.md`
**Branch:** `main`
**Verification:** tsc 0 errors | 328 tests pass | build succeeds

## What was built (5 parallel lanes + architect review)

### Task 0 — Shared Contract
- `packages/shared/memory/contract.ts` — `PROFILE_SECTIONS`, `ProfileSection`, `ProfileSections`, `emptyProfileSections()`, `sectionHeader()`, `DEFAULT_MEMORY_MODEL`
- 4 tests

### Lane A — Prompts and Contract (fixes P0-2, producer-side P0-3)
- `apps/console/lib/agent/case-compact-prompt.ts` — working-state summary prompt for L2
- `apps/console/lib/agent/profile-compact-prompt.ts` — portrait prompt emitting contract headers for L3
- `apps/console/lib/agent/compact.ts` — added `purpose?: 'case' | 'profile'` param, routes to correct prompt
- `apps/console/lib/agent/loop.ts` — `performCompaction` passes `'case'`, `compactUserProfile` passes `'profile'`
- `packages/shared/types/index.ts` — added `profileModel?: string` to MemoryStrategy
- 20 tests

### Lane B — Trigger Model (fixes P0-1)
- `apps/console/lib/agent/memory.ts` — `assessCompaction` rewritten to ratio-based: `autocompactRatio: 0.70`, `warningRatio: 0.60`, `blockingRatio: 0.92`
- `apps/console/lib/agent/loop.ts` — cadence-driven compaction: `compactEveryNMessages?: number` (default `undefined`)
- `packages/shared/types/index.ts` — ratio fields + `compactEveryNMessages` on MemoryStrategy
- `packages/shared/defaults/index.ts` — ratio defaults
- 16 tests

### Lane C — Structured L3 Profile (fixes P0-3 consumer side, P1-2)
- `packages/shared/prisma/schema.prisma` — `sections String @default("{}")` on UserProfile
- Migration: `20260603000009_add_user_profile_sections`
- `packages/shared/memory/mergeProfile.ts` — rewritten against contract: structured parsing, dedup merge, truncation (History first, never Identity)
- `apps/console/lib/agent/loop.ts` — dual-write: `profile` (Markdown) + `sections` (JSON)
- `apps/console/app/api/chats/[chatId]/update-profile/route.ts` — dual-write
- 25 tests

### Lane D — Cleanup (fixes P1-1, P2)
- `apps/console/app/api/chats/[chatId]/compact/route.ts` — self-contained compact endpoint (fixed broken proxy)
- `apps/console/app/api/internal/compact-chat/route.ts` — DELETED (dead proxy from deleted apps/chat)
- `apps/console/lib/agent/compact.ts` — `compactModel` fallback → `DEFAULT_MEMORY_MODEL`
- `apps/console/lib/agent/memory.ts` — fact extraction → `strategy.factExtractionModel ?? DEFAULT_MEMORY_MODEL`
- `packages/shared/types/index.ts` — `factExtractionModel?: string`
- `packages/shared/defaults/index.ts` — `factExtractionModel` defaults
- 13 tests

### C4 — System Tools (user chose Option B: agent-decides)
- `apps/console/lib/agent/loop.ts` — `read_user_profile` handler now returns structured `sections`
- `apps/console/lib/agent/conversation-loop.ts` — both tools added to `CORE_ALLOWED_TOOLS`
- `apps/console/lib/agent/stage-executor.ts` — `system_info` tools auto-allowed in all stages
- `packages/shared/defaults/index.ts` — `## Memory Tools` section in core + case prompts

## Root defects addressed

| Defect | Fix |
|---|---|
| P0-1 Autocompaction never fires | Ratio-based trigger (Lane B) |
| P0-2 Compaction prompt is user portrait | Split into CASE + PROFILE prompts (Lane A) |
| P0-3 mergeProfile parses wrong headers | Contract-based parsing (Lane C) |
| P1-1 Compact Chat ops button broken | Inlined endpoint, deleted proxy (Lane D) |
| P1-2 L3 profile written but only read on tool call | Structured sections returned; system_info always available (C4) |
| P2 Model-name drift | Unified to `DEFAULT_MEMORY_MODEL` (Lane D) |

## Files changed: 26 files, +584 / -691 lines

## Not yet built (deferred)
- **C5** Anonymous visitor identity key (deferred per user)
- **P1-3** `chat:<chatId>` fallback for anonymous users (stays as-is)

> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# TODO-42 Trace Cleanup + Observability — COMPLETED 2026-06-04

**Spec:** `doc/to-do/2026-06-03-trace-cleanup.md`
**Branch:** `main`
**Verification:** tsc 0 errors | 328 tests pass | build succeeds

## Items completed

### Item 2 — Remove Profiler Snapshot (user chose complete removal over fix)
- `apps/console/lib/agent/profiler-utils.ts` — DELETED (writeProfilerSnapshot)
- `apps/console/lib/agent/profiler.ts` — removed `snapshot()` method + `ProfilerSnapshot` interface
- `apps/console/lib/agent/loop.ts` — removed all 10 call sites + import
- `apps/console/lib/agent/case-agent-loop.ts` — removed 3 call sites from CaseLoopServices
- `apps/console/app/ops/chats/[chatId]/page.tsx` — removed legacy profiler snapshot parsing

### Item 3 — "View conversation" button (investigated, KEPT)
- Chat page provides unique functionality not in case detail (memory panel, filterable timeline, JSON export, delete chat)
- Button is NOT redundant

### Item 4 — Tool call I/O visibility
- `apps/console/components/ops/case-trace-view.tsx` — `skill_result` cards default open (removed `!isSkill` from collapsed set)
- `apps/console/app/ops/cases/[caseId]/page.tsx` — `ToolCallCard` expanded state: `false` → `true`

### Item 5 — Playground LLM prompt visibility
- `apps/console/lib/agent/loop.ts` — emit SSE `llm_request_start` event with full systemPrompt + messages
- `apps/console/lib/agent/playground-runner.ts` — capture prompt payload from SSE into memoryTraces
- `apps/console/lib/agent/trace-aggregator.ts` — `promptData` field on PlaygroundTraceStep, populate from trace payload
- `apps/console/app/admin/playground/page.tsx` — `PromptViewer` component (collapsible code block + message list)
- `packages/shared/types/index.ts` — `'llm_request_start'` added to SSEEventType

### Item 1 — Profiler Snapshot actionType fix
- NOT DONE — superseded by Item 2 (complete removal)

## Files changed: 10 files

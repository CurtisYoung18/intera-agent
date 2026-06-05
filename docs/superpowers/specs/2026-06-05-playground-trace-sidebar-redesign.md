# Playground Trace Sidebar Redesign

**Date**: 2026-06-05
**Status**: Design approved

## Goal

Redesign the Playground right-side trace panel (340px) with clear tool IN/OUT display, per-turn metrics, and progressive disclosure of information.

## Design Principles

- **Default collapsed** — sidebar starts closed, auto-expands when agent runs
- **One-click per tool** — clicking a tool card expands both INPUT and OUTPUT together
- **Current turn expanded** — the active/latest turn auto-expands; previous turns default collapsed
- **Metrics where they matter** — session totals at top, per-turn breakdown inline, per-tool latency inline

## Data Flow

```
AgentLoop (TraceWriter via PersistencePort)
  -> trace records in-memory
  -> aggregateTraces() -> PlaygroundTraceStep[]
  -> SSE: { type: 'trace', data: { trace, totalMs, resolvedModel, applicableStages } }
  -> page.tsx: turnTraces state
  -> render sidebar
```

Primarily a frontend redesign. One small backend change: extend `trace-aggregator.ts` usage type to expose cache tokens. No changes to `playground-runner.ts` or SSE pipeline.

## UI Structure

```
┌─ Sidebar (340px) ──────────────────────┐
│ ┌ Session ────────────────────────────┐ │
│ │ tokens  wall   llm   tools          │ │
│ └─────────────────────────────────────┘ │
│ ┌ Turn 1 (collapsed) ────────────────┐ │
│ │ ▌ Turn 1  62% cache  3.8s/3tools ▶ │ │
│ └─────────────────────────────────────┘ │
│ ┌ Turn 2 (active, expanded) ─────────┐ │
│ │ ▌ Turn 2 ● 34% cache  1.2s/1tool ▼ │ │
│ │ ┌─ Breakdown ────────────────────┐  │ │
│ │ │ input output cache  llm tools  │  │ │
│ │ │  280   120   34%   0.8  0.4   │  │ │
│ │ │          tok/s: 150           │  │ │
│ │ └───────────────────────────────┘  │ │
│ │ ● kb_search          95ms          │ │
│ │ ● kb_search (expanded)  180ms      │ │
│ │   ┌ INPUT ──────────────────────┐  │ │
│ │   │ query: "deposit..."         │  │ │
│ │   │ topK: 5                     │  │ │
│ │   └─────────────────────────────┘  │ │
│ │   ┌ OUTPUT · 3 results ─────────┐  │ │
│ │   │ 1. "通常需要 1-3 个工作日"   │  │ │
│ │   │ 2. "国际电汇..."            │  │ │
│ │   │ 3. "周末存款..."            │  │ │
│ │   └─────────────────────────────┘  │ │
│ │ ● check_balance (error)  2.1s     │ │
│ │   ┌ INPUT ──────────────────────┐  │ │
│ │   │ userId: "usr_8821"          │  │ │
│ │   └─────────────────────────────┘  │ │
│ │   ┌ OUTPUT · error ─────────────┐  │ │
│ │   │ API timeout after 2000ms    │  │ │
│ │   └─────────────────────────────┘  │ │
│ │ ● Model response   520+240 tok    │ │
│ │   您好，关于存款处理时间...        │ │
│ └───────────────────────────────────┘ │
└───────────────────────────────────────┘
```

## Component Tree

```
TraceSidebar
├── SessionMetrics          // 4 mini-cards: tokens, wall, llm, tools
├── TurnGroup (per turn)
│   ├── TurnHeader          // bar + label + dot + cache% + summary + chevron
│   ├── TurnBreakdown       // 6-cell grid: input/output/cache/llm/tools/tok-per-s
│   ├── ToolCard (per tool)
│   │   ├── ToolRow         // dot + name + latency
│   │   ├── InputBlock      // blue label + key-value content
│   │   └── OutputBlock     // green/red label + content
│   └── ModelResponse       // dot + name + token count + reply text
└── LiveTurn (current in-progress)  // same structure but with running animation
```

## Interaction Model

### Sidebar visibility
- **Default**: `sidebarCollapsed = true` on page load
- **Auto-expand**: set `sidebarCollapsed = false` when `sendMessage()` is called and agent begins processing
- **Manual toggle**: collapse button in sidebar header (existing)

### Turn expansion
- **Active turn** (most recent, or currently streaming): auto-expanded, shows breakdown + tools
- **Previous turns**: default collapsed, shows one-line summary
- **Click collapsed turn header**: expands that turn, does NOT collapse others (independent accordion)
- **Live turn**: during streaming, tools appear as they complete; running tools show animated amber dot

### Tool card expansion
- **Default**: collapsed (dot + name + latency only)
- **Click**: expands to show INPUT + OUTPUT blocks together
- **Click again**: collapses
- **Independent**: each tool card toggles independently within its turn

### Error state
- Error tools: red dot, red tool name, red OUTPUT block with error message
- Failed tools default to expanded (so the error is visible immediately)

## Token & Timing Data

### Session metrics (top)
- Total tokens (all turns summed)
- Wall time (all turns summed)
- LLM call count
- Total tool count

### Per-turn metrics
- Input tokens, Output tokens
- Cache read hit %
- LLM phase wall time
- Tool phase wall time  
- Tokens/sec (output tokens / llm phase seconds)

### Source data
- `PlaygroundTraceStep.usage` for token counts (Model generation stage)
- `PlaygroundTraceStep.ms` for timing (already span-based in aggregator)
- Cache read % from `usage.cache_read_input_tokens / (usage.cache_read_input_tokens + usage.input_tokens)`
- Per-tool latency from `detail` array parsing

## Styling

- **Typography**: system sans for labels (`-apple-system, SF Pro Display`), monospace for data values (`SF Mono, JetBrains Mono`)
- **Colors**: single accent blue (`#3b6cf4`), semantic green (`#1d8c4e`) for success, red (`#d63031`) for error, amber (`#c27a0a`) for running
- **Spacing**: tight but scannable — 7-8px tool row padding, 10-14px section padding
- **Borders**: 1px `#ececf0`, 6-8px border radius, no shadows, no gradients
- **Active indicator**: blue vertical bar + pulsing dot for current turn

## Files Changed

| File | Change |
|---|---|
| `apps/console/lib/agent/trace-aggregator.ts` | Extend `PlaygroundTraceStep.usage` with `cacheReadTokens?`, `cacheWriteTokens?`. Extend `extractUsage()`. |
| `apps/console/app/admin/playground/page.tsx` | Full trace sidebar rewrite. Replace inline trace rendering (current ~340 lines) with new component structure. Add `useRef` for auto-scroll to active turn. Add `sidebarCollapsed` default-true behavior with auto-expand on send. |
| `apps/console/lib/i18n/dictionaries.ts` | Add new i18n keys (en + zh) for: session metrics labels, turn breakdown labels, input/output labels, cache hit label |

## Acceptance Criteria

- **AC1**: Sidebar starts collapsed on page load. Sending a message auto-expands it.
- **AC2**: Previous turns default collapsed with one-line summary showing cache%, tokens, time, tool count.
- **AC3**: Active turn auto-expanded with breakdown grid and tool list visible.
- **AC4**: Clicking a collapsed turn expands it to show breakdown + tools.
- **AC5**: Clicking a tool card toggles INPUT + OUTPUT display together.
- **AC6**: Error tools show red styling, OUTPUT block defaults to expanded.
- **AC7**: Running tools show animated amber dot during execution.
- **AC8**: Session metrics update as turns accumulate.
- **AC9**: Model response shows reply text preview when expanded.

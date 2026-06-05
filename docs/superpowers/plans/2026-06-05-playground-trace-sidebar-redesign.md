# Playground Trace Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the playground trace sidebar with a redesigned panel featuring one-click tool IN/OUT expansion, per-turn token/timing metrics, session summary, and progressive disclosure.

**Architecture:** Pure frontend refactor of `page.tsx` trace sidebar (~340 lines) into structured TSX. One small backend change to `trace-aggregator.ts` for cache token exposure. All existing SSE events and state management remain unchanged.

**Tech Stack:** Next.js 15, React 19, TypeScript, inline styles (existing project convention)

---

### Task 1: Extend trace-aggregator to expose cache tokens

**Files:**
- Modify: `apps/console/lib/agent/trace-aggregator.ts:23,92-106`

- [ ] **Step 1: Extend PlaygroundTraceStep.usage type**

In `trace-aggregator.ts`, update `PlaygroundTraceStep.usage` (line 23):

```typescript
usage?: {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}
```

- [ ] **Step 2: Extend extractUsage to capture cache tokens**

In `trace-aggregator.ts`, replace `extractUsage` (lines 92-106):

```typescript
function extractUsage(record: TraceRecord): PlaygroundTraceStep['usage'] {
  const raw = record.detail || record.payload
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    const u = parsed?.usage
    if (u && (typeof u.input_tokens === 'number' || typeof u.output_tokens === 'number')) {
      const inputTokens = Number(u.input_tokens ?? 0)
      const outputTokens = Number(u.output_tokens ?? 0)
      return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cacheReadTokens: typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : undefined,
        cacheWriteTokens: typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : undefined,
      }
    }
  } catch { /* ignore parse errors */ }
  return undefined
}
```

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit -p apps/console/tsconfig.json`
Expected: 0 errors (no new errors from usage type change)

- [ ] **Step 4: Commit**

```bash
git add apps/console/lib/agent/trace-aggregator.ts
git commit -m "feat(trace): expose cache read/write tokens in PlaygroundTraceStep usage"
```

---

### Task 2: Add i18n keys for trace sidebar

**Files:**
- Modify: `apps/console/lib/i18n/dictionaries.ts`

- [ ] **Step 1: Add en keys**

In the `en` dictionary, add to `playground` namespace:

```typescript
trace: {
  sessionTokens: 'tokens',
  sessionWall: 'wall',
  sessionLlm: 'llm',
  sessionTools: 'tools',
  turnTokens: '{{input}}/{{output}} tok',
  turnCache: '{{pct}}% cache',
  turnSummary: '{{time}} / {{n}} tool{{plural}}',
  breakdownInput: 'input',
  breakdownOutput: 'output',
  breakdownCache: 'cache hit',
  breakdownLlm: 'llm',
  breakdownTools: 'tools',
  breakdownTokPerS: 'tok/s',
  inputLabel: 'Input',
  outputLabel: 'Output',
  outputError: 'error',
  outputResults: '{{n}} result{{plural}}',
  modelResponse: 'Model response',
  empty: 'Send a message to see the trace.',
  turnLabel: 'Turn {{n}}',
  toolsCount: '{{n}} tool{{plural}}',
  running: 'running...',
  failed: 'failed',
}
```

- [ ] **Step 2: Add zh keys**

In the `zh` dictionary, add matching entries:

```typescript
trace: {
  sessionTokens: 'tokens',
  sessionWall: 'wall',
  sessionLlm: 'llm',
  sessionTools: 'tools',
  turnTokens: '{{input}}/{{output}} tok',
  turnCache: '{{pct}}% cache',
  turnSummary: '{{time}} / {{n}} tool{{plural}}',
  breakdownInput: 'input',
  breakdownOutput: 'output',
  breakdownCache: 'cache hit',
  breakdownLlm: 'llm',
  breakdownTools: 'tools',
  breakdownTokPerS: 'tok/s',
  inputLabel: 'Input',
  outputLabel: 'Output',
  outputError: 'error',
  outputResults: '{{n}} result{{plural}}',
  modelResponse: 'Model response',
  empty: '发送消息以查看追踪。',
  turnLabel: 'Turn {{n}}',
  toolsCount: '{{n}} tool{{plural}}',
  running: 'running...',
  failed: 'failed',
}
```

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit -p apps/console/tsconfig.json`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/console/lib/i18n/dictionaries.ts
git commit -m "feat(i18n): add trace sidebar labels (en + zh)"
```

---

### Task 3: Rewrite trace sidebar in page.tsx

**Files:**
- Modify: `apps/console/app/admin/playground/page.tsx`

This is the main task. The trace sidebar rendering spans ~340 lines (lines 1100-1442). We replace it with the new component structure while keeping the existing SSE event handling and state management.

- [ ] **Step 1: Change sidebar default to collapsed + auto-expand on send**

Change line 111 from:

```typescript
const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
```

To:

```typescript
const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
```

Add in `runTurn` (after line 322 `setResponding(true)`):

```typescript
setSidebarCollapsed(false)
```

- [ ] **Step 2: Replace sidebarCollapsed gating on chat area maxWidth**

At line 621, remove `sidebarCollapsed` gating since chat area should always use the same width:

```tsx
// Before:
...(sidebarCollapsed ? {} : { maxWidth: 680 }),
// After:
maxWidth: 680,
```

At line 929, same change:

```tsx
// Before:
width: '100%', ...(sidebarCollapsed ? {} : { maxWidth: 680 }), padding: '12px 24px 12px',
// After:
width: '100%', maxWidth: 680, padding: '12px 24px 12px',
```

- [ ] **Step 3: Replace `collapsedTraces` and `expandedDetails` state with new state**

Remove lines 108-109:

```typescript
const [collapsedTraces, setCollapsedTraces] = useState<Set<string>>(new Set())
const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set())
```

Add new state:

```typescript
const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set())
const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
```

`expandedTurns`: Set of turn indices that are expanded. The latest turn (turnTraces.length - 1) is always in this set.
`expandedTools`: Set of tool keys `"turnIdx-toolIdx"` that are expanded. Error tools default to expanded.

- [ ] **Step 4: Sync expandedTurns when turnTraces updates**

Add a `useEffect`:

```typescript
// Auto-expand the latest turn; error tools default expanded
useEffect(() => {
  if (turnTraces.length === 0) return
  setExpandedTurns(prev => {
    const next = new Set(prev)
    next.add(turnTraces.length - 1)
    return next
  })
  // Auto-expand error tools in latest turn
  const latestSteps = turnTraces[turnTraces.length - 1] || []
  latestSteps.forEach((step: any, toolIdx: number) => {
    if (step.status === 'warn' || step.status === 'block') {
      setExpandedTools(prev => {
        const next = new Set(prev)
        next.add(`${turnTraces.length - 1}-${toolIdx}`)
        return next
      })
    }
  })
}, [turnTraces])
```

- [ ] **Step 5: Replace trace sidebar JSX (lines 1100-1442)**

Remove the entire sidebar section (from line 1100 `{/* ── Sidebar (right) ── */}` through the closing of the collapsed sidebar toggle around line 1442).

Replace with the new sidebar implementation. See **Task 3 Sidebar JSX** below.

- [ ] **Step 6: Add session metrics computation**

Before the sidebar JSX, compute session-level metrics:

```typescript
// ── Session metrics ──
const sessionMetrics = useMemo(() => {
  let totalInput = 0, totalOutput = 0, totalTools = 0, llmCalls = 0
  for (const steps of turnTraces) {
    for (const step of steps) {
      if (step.usage) { totalInput += step.usage.inputTokens || 0; totalOutput += step.usage.outputTokens || 0; llmCalls++ }
      if (step.stage === 'Skills & tools' || step.stage === 'Knowledge retrieval') totalTools += step.detail?.length || 0
    }
  }
  const totalMs = turnTotalMs.reduce((a, b) => a + b, 0)
  return { totalInput, totalOutput, totalTools, llmCalls, totalMs }
}, [turnTraces, turnTotalMs])
```

- [ ] **Step 7: TypeScript check**

Run: `npx tsc --noEmit -p apps/console/tsconfig.json`
Expected: 0 errors

- [ ] **Step 8: Build check**

Run: `npm run build:console`
Expected: success, no new errors

- [ ] **Step 9: Commit**

```bash
git add apps/console/app/admin/playground/page.tsx
git commit -m "feat(playground): redesign trace sidebar with tool IN/OUT expansion and per-turn metrics"
```

---

### Task 3 Sidebar JSX — Complete replacement (for Step 5)

Replace lines 1100-1442 with the following. This is the full sidebar JSX including the collapsed toggle and the expanded panel:

```tsx
        {/* ── Sidebar (right) ── */}
        {!sidebarCollapsed && (
        <aside style={{
          width: 340, flexShrink: 0,
          borderLeft: '1px solid var(--border-subtle)',
          background: '#fff',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={11} style={{ color: 'var(--fog)' }} />
              <span style={{ fontSize: 11, fontWeight: 650, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Trace</span>
              {(liveTools.length + turnTraces.reduce((sum, t) => sum + t.length, 0)) > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 600, color: 'var(--fog)',
                  background: 'rgba(139,111,245,0.06)', padding: '0 5px', borderRadius: 3,
                  lineHeight: '18px', minWidth: 18, textAlign: 'center',
                }}>
                  {liveTools.length + turnTraces.reduce((sum, t) => sum + t.length, 0)}
                </span>
              )}
            </div>
            <button onClick={() => setSidebarCollapsed(true)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 2, color: 'var(--fog)', opacity: 0.5,
            }}>
              <ChevronRight size={14} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {/* Empty state */}
            {turnTraces.length === 0 && liveTools.length === 0 ? (
              <div style={{
                padding: '24px 20px', textAlign: 'center',
                fontSize: 12, color: 'var(--smoke)', lineHeight: 1.6,
              }}>
                {d ? t('playground.trace.empty') : 'Send a message to see the trace.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {/* ── Session metrics ── */}
                {sessionMetrics.totalInput > 0 && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6,
                    padding: '0 12px 12px', borderBottom: '1px solid var(--border-subtle)',
                    marginBottom: 8,
                  }}>
                    <div style={metricStyle}>
                      <div style={metricValStyle}>{sessionMetrics.totalInput + sessionMetrics.totalOutput >= 1000 ? ((sessionMetrics.totalInput + sessionMetrics.totalOutput) / 1000).toFixed(1) + 'K' : String(sessionMetrics.totalInput + sessionMetrics.totalOutput)}</div>
                      <div style={metricLblStyle}>{tb('trace.sessionTokens')}</div>
                    </div>
                    <div style={metricStyle}>
                      <div style={metricValStyle}>{sessionMetrics.totalMs >= 1000 ? (sessionMetrics.totalMs / 1000).toFixed(1) + 's' : sessionMetrics.totalMs + 'ms'}</div>
                      <div style={metricLblStyle}>{tb('trace.sessionWall')}</div>
                    </div>
                    <div style={metricStyle}>
                      <div style={metricValStyle}>{sessionMetrics.llmCalls}</div>
                      <div style={metricLblStyle}>{tb('trace.sessionLlm')}</div>
                    </div>
                    <div style={metricStyle}>
                      <div style={metricValStyle}>{sessionMetrics.totalTools}</div>
                      <div style={metricLblStyle}>{tb('trace.sessionTools')}</div>
                    </div>
                  </div>
                )}

                {/* ── Completed turns ── */}
                {turnTraces.map((steps, turnIdx) => {
                  const isExpanded = expandedTurns.has(turnIdx)
                  const isLatest = turnIdx === turnTraces.length - 1
                  const turnMs = turnTotalMs[turnIdx] || 0
                  // Compute turn metrics
                  let turnInput = 0, turnOutput = 0, cacheRead = 0
                  const modelStep = steps.find((s: any) => s.stage === 'Model generation')
                  if (modelStep?.usage) {
                    turnInput = modelStep.usage.inputTokens || 0
                    turnOutput = modelStep.usage.outputTokens || 0
                    cacheRead = modelStep.usage.cacheReadTokens || 0
                  }
                  const cachePct = (turnInput + cacheRead) > 0 ? Math.round(cacheRead / (turnInput + cacheRead) * 100) : 0
                  const toolSteps = steps.filter((s: any) => s.stage === 'Skills & tools' || s.stage === 'Knowledge retrieval')
                  const toolCount = toolSteps.reduce((sum: number, s: any) => sum + (s.detail?.length || 0), 0)

                  return (
                    <div key={turnIdx}>
                      {/* Turn header */}
                      <div
                        onClick={() => setExpandedTurns(prev => {
                          const next = new Set(prev)
                          if (next.has(turnIdx)) next.delete(turnIdx); else next.add(turnIdx)
                          return next
                        })}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '8px 12px', cursor: 'pointer',
                          borderBottom: isExpanded ? 'none' : '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{
                          width: 3, height: 22, borderRadius: 2, flexShrink: 0,
                          background: isLatest ? '#3b6cf4' : '#d0d0d8',
                        }} />
                        <span style={{
                          fontSize: 12, fontWeight: 650,
                          color: isExpanded ? 'var(--mist)' : 'var(--fog)',
                        }}>
                          {d ? t('playground.trace.turnLabel', { n: turnIdx + 1 }) : `Turn ${turnIdx + 1}`}
                        </span>
                        {isLatest && (
                          <div style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: '#3b6cf4',
                            animation: 'pulse 2s ease infinite',
                          }} />
                        )}
                        {cacheRead > 0 && (
                          <span style={{
                            fontSize: 10, padding: '1px 5px', borderRadius: 3,
                            background: '#eef3f0', color: '#1d8c4e',
                            fontFamily: 'monospace',
                          }}>
                            {cachePct}% cache
                          </span>
                        )}
                        <span style={{
                          fontSize: 10, color: 'var(--smoke)',
                          whiteSpace: 'nowrap', marginLeft: 'auto',
                        }}>
                          {turnMs >= 1000 ? (turnMs / 1000).toFixed(1) + 's' : turnMs + 'ms'}{toolCount > 0 ? ` / ${toolCount} tool${toolCount !== 1 ? 's' : ''}` : ''}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--smoke)', opacity: 0.4 }}>
                          {isExpanded ? '▲' : '▶'}
                        </span>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          paddingBottom: 8,
                        }}>
                          {/* Turn breakdown grid */}
                          {modelStep && (
                            <div style={{
                              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                              gap: 4, padding: '4px 12px 8px 24px',
                            }}>
                              <BreakdownCell label={tb('trace.breakdownInput')} value={String(turnInput)} />
                              <BreakdownCell label={tb('trace.breakdownOutput')} value={String(turnOutput)} />
                              <BreakdownCell label={tb('trace.breakdownCache')} value={`${cachePct}%`} />
                              <BreakdownCell label={tb('trace.breakdownLlm')} value={modelStep.ms >= 1000 ? (modelStep.ms / 1000).toFixed(1) + 's' : modelStep.ms + 'ms'} />
                              <BreakdownCell label={tb('trace.breakdownTools')} value={turnMs >= modelStep.ms ? `${((turnMs - modelStep.ms) >= 1000 ? ((turnMs - modelStep.ms) / 1000).toFixed(1) + 's' : (turnMs - modelStep.ms) + 'ms')}` : '-'} />
                              <BreakdownCell label={tb('trace.breakdownTokPerS')} value={modelStep.ms > 0 ? String(Math.round(turnOutput / (modelStep.ms / 1000))) : '-'} />
                            </div>
                          )}

                          {/* Tool cards + Model response */}
                          {steps.filter((s: any) => s.fired !== false).map((step: any, i: number) => {
                            const isModelGen = step.stage === 'Model generation'
                            const isSkill = step.stage === 'Skills & tools' || step.stage === 'Knowledge retrieval'

                            if (isSkill && step.detail?.length > 0) {
                              // Render tool cards
                              return step.detail.map(([actionType, detailText]: [string, string], di: number) => {
                                const toolKey = `${turnIdx}-${i}-${di}`
                                const isToolExpanded = expandedTools.has(toolKey)
                                const isError = actionType === 'skill_result' && detailText.includes('ok:false')
                                const toolName = actionType === 'skill_called' ? detailText.split('\n')[0]?.replace('input: ', '')?.slice(0, 30) : (step.summary?.split(' → ')?.[di] || 'tool')
                                // Parse IN/OUT from detailText
                                const lines = detailText.split('\n')
                                const inputLines: string[] = []
                                const outputLines: string[] = []
                                let inOutput = false
                                for (const line of lines) {
                                  if (line.startsWith('input: ')) { inputLines.push(line.slice(7)); inOutput = false }
                                  else if (line.startsWith('output: ')) { outputLines.push(line.slice(8)); inOutput = true }
                                  else if (inOutput) { outputLines.push(line) }
                                  else { inputLines.push(line) }
                                }

                                return (
                                  <div key={toolKey}>
                                    <div
                                      onClick={() => setExpandedTools(prev => {
                                        const next = new Set(prev)
                                        if (next.has(toolKey)) next.delete(toolKey); else next.add(toolKey)
                                        return next
                                      })}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: 7,
                                        padding: '6px 12px 6px 24px', cursor: 'pointer',
                                        background: isToolExpanded ? 'var(--surface-raised, #f9f9fb)' : undefined,
                                      }}
                                    >
                                      <div style={{
                                        width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                                        background: isError ? '#d63031' : '#1d8c4e',
                                      }} />
                                      <span style={{
                                        fontSize: 11, fontWeight: 550,
                                        color: isError ? '#d63031' : 'var(--mist)',
                                        fontFamily: 'monospace',
                                      }}>
                                        {toolName}
                                      </span>
                                      <span style={{
                                        fontSize: 10, color: isError ? '#d63031' : 'var(--smoke)',
                                        marginLeft: 'auto', fontFamily: 'monospace',
                                      }}>
                                        {isError ? 'failed' : ''}
                                      </span>
                                    </div>

                                    {/* IN/OUT blocks */}
                                    {isToolExpanded && (
                                      <div style={{ padding: '0 12px 0 24px' }}>
                                        {inputLines.length > 0 && inputLines[0] && (
                                          <>
                                            <div style={{
                                              fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                                              textTransform: 'uppercase', color: '#3b6cf4',
                                              marginBottom: 2, marginTop: 2,
                                            }}>
                                              {tb('trace.inputLabel')}
                                            </div>
                                            <div style={{
                                              padding: '6px 8px', borderRadius: 6,
                                              background: '#f4f6fe', border: '1px solid #e2e8f8',
                                              fontSize: 10.5, fontFamily: 'monospace',
                                              color: 'var(--mist)', lineHeight: 1.55,
                                              maxHeight: 90, overflowY: 'auto',
                                              marginBottom: 5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                            }}>
                                              {inputLines.join('\n')}
                                            </div>
                                          </>
                                        )}
                                        {outputLines.length > 0 && outputLines[0] && (
                                          <>
                                            <div style={{
                                              fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                                              textTransform: 'uppercase',
                                              color: isError ? '#d63031' : '#1d8c4e',
                                              marginBottom: 2,
                                            }}>
                                              {tb('trace.outputLabel')}{isError ? ` · ${tb('trace.outputError')}` : ''}
                                            </div>
                                            <div style={{
                                              padding: '6px 8px', borderRadius: 6,
                                              background: isError ? '#fef5f5' : '#f3f9f5',
                                              border: isError ? '1px solid #f8d7d7' : '1px solid #dcece2',
                                              fontSize: 10.5, fontFamily: 'monospace',
                                              color: isError ? '#d63031' : 'var(--mist)', lineHeight: 1.55,
                                              maxHeight: 90, overflowY: 'auto',
                                              marginBottom: 5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                            }}>
                                              {outputLines.join('\n')}
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })
                            }

                            if (isModelGen) {
                              const isModelExpanded = expandedTurns.has(turnIdx)
                              return (
                                <div key={`${turnIdx}-${i}`}>
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: 7,
                                    padding: '6px 12px 6px 24px',
                                    borderTop: '1px solid var(--border-subtle)',
                                  }}>
                                    <div style={{
                                      width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                                      background: '#3b6cf4',
                                    }} />
                                    <span style={{ fontSize: 11, fontWeight: 550, color: 'var(--mist)', fontFamily: 'monospace' }}>
                                      {tb('trace.modelResponse')}
                                    </span>
                                    {step.usage && (
                                      <span style={{
                                        fontSize: 10, color: 'var(--smoke)',
                                        marginLeft: 'auto', fontFamily: 'monospace',
                                      }}>
                                        &uarr;{step.usage.inputTokens || 0} &darr;{step.usage.outputTokens || 0} tok
                                      </span>
                                    )}
                                  </div>
                                  {isModelExpanded && step.summary && step.summary !== '(no summary)' && (
                                    <div style={{
                                      margin: '0 12px 8px 24px', padding: '7px 9px',
                                      background: 'var(--surface-raised, #f9f9fb)',
                                      borderRadius: 6, border: '1px solid var(--border-subtle)',
                                      fontSize: 11, color: 'var(--mist)', lineHeight: 1.5,
                                      maxHeight: 80, overflowY: 'auto',
                                    }}>
                                      {step.summary}
                                    </div>
                                  )}
                                </div>
                              )
                            }

                            return null
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Current turn in progress (during streaming) */}
                {responding && liveTools.length > 0 && (
                  <div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      <div style={{
                        width: 3, height: 22, borderRadius: 2, flexShrink: 0,
                        background: '#3b6cf4',
                      }} />
                      <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--mist)' }}>
                        {d ? t('playground.trace.turnLabel', { n: turnTraces.length + 1 }) : `Turn ${turnTraces.length + 1}`}
                      </span>
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#3b6cf4',
                        animation: 'pulse 2s ease infinite',
                      }} />
                      <span style={{ fontSize: 10, color: '#3b6cf4', marginLeft: 'auto' }}>
                        {tb('trace.running')}
                      </span>
                    </div>
                    {liveTools.map((t, i) => (
                      <div key={`live-${i}`} style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '6px 12px 6px 24px',
                      }}>
                        <div style={{
                          width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                          background: t.status === 'running' ? '#c27a0a' : t.status === 'error' ? '#d63031' : '#1d8c4e',
                          ...(t.status === 'running' ? { animation: 'pulse 1.2s ease infinite' } : {}),
                        }} />
                        <span style={{
                          fontSize: 11, fontWeight: 550,
                          color: t.status === 'error' ? '#d63031' : 'var(--mist)',
                          fontFamily: 'monospace',
                        }}>
                          {t.name}
                        </span>
                        <span style={{
                          fontSize: 10, color: t.status === 'running' ? '#c27a0a' : t.status === 'error' ? '#d63031' : 'var(--smoke)',
                          marginLeft: 'auto', fontFamily: 'monospace',
                        }}>
                          {t.status === 'running' ? 'running' : t.status === 'error' ? 'failed' : t.finishedAt && t.startedAt ? `${t.finishedAt - t.startedAt}ms` : 'done'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
        )}

        {/* Collapsed sidebar toggle */}
        {sidebarCollapsed && (
          <div style={{
            width: 32, flexShrink: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'flex-start', paddingTop: 12,
            borderLeft: '1px solid var(--border-subtle)',
            background: 'rgba(255,255,255,0.4)', cursor: 'pointer',
          }}
            onClick={() => setSidebarCollapsed(false)}
          >
            <ChevronLeft size={14} style={{ color: 'var(--fog)', opacity: 0.5 }} />
            {(liveTools.length + turnTraces.reduce((sum, t) => sum + t.length, 0)) > 0 && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: '#3b6cf4',
                marginTop: 6, writingMode: 'vertical-rl',
              }}>
                {liveTools.length + turnTraces.reduce((sum, t) => sum + t.length, 0)}
              </span>
            )}
          </div>
        )}
```

- [ ] **Step 10: Add helper components and styles**

Place these at the bottom of the file (before the final `}` of `PlaygroundPage`), or in the same file before the main component:

```tsx
// ── Trace sidebar styles ──

const metricStyle: React.CSSProperties = {
  textAlign: 'center', padding: '6px 4px',
  background: 'var(--surface-raised, #f9f9fb)',
  borderRadius: 6, border: '1px solid var(--border-subtle)',
}

const metricValStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 650, color: 'var(--mist)',
  fontFamily: 'monospace', letterSpacing: '-0.02em',
}

const metricLblStyle: React.CSSProperties = {
  fontSize: 8.5, color: 'var(--smoke)', marginTop: 2,
  textTransform: 'uppercase', letterSpacing: '0.04em',
}

function BreakdownCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '5px 3px',
      background: 'var(--surface-raised, #f9f9fb)',
      borderRadius: 5, border: '1px solid var(--border-subtle)',
    }}>
      <div style={{
        fontSize: 11.5, fontWeight: 650, color: 'var(--mist)',
        fontFamily: 'monospace',
      }}>{value}</div>
      <div style={{
        fontSize: 8, color: 'var(--smoke)',
        textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 1,
      }}>{label}</div>
    </div>
  )
}
```

Add `ChevronRight` and `ChevronLeft` to the lucide-react imports at the top of the file (if not already imported). Add `useMemo` to the React import.

- [ ] **Step 11: Add CSS keyframes for pulse animation**

Add to `globals.css`:

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

Or inline via a `<style jsx>` block or a `<style>` tag in the component.

- [ ] **Step 12: Remove unused imports and state**

Remove `showSkipped` state (line 110) and related UI (lines 1381-1404 "Show skipped" toggle) since the new design doesn't have skipped-stage display.

Remove `collapsedTraces` and `expandedDetails` references from `useEffect` at line 205.

- [ ] **Step 13: TypeScript + build check**

Run: `npx tsc --noEmit -p apps/console/tsconfig.json`
Expected: 0 errors

Run: `npm run build:console`
Expected: success

- [ ] **Step 14: Commit**

```bash
git add apps/console/app/admin/playground/page.tsx apps/console/app/globals.css
git commit -m "feat(playground): redesign trace sidebar with tool IN/OUT expansion and per-turn metrics"
```

---

## Verification

Run the full Phase 1 gate:

```bash
npx tsc --noEmit -p apps/console/tsconfig.json
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
npm run build:console
```

Expected: 0 TS errors, keyless tests passing, build successful.

Then deploy and verify AC1-AC9 manually in the Playground.

'use client'

import { useState } from 'react'
import {
  Activity, ChevronDown, ChevronLeft,
  CheckCircle2, XCircle, Loader2, Brain,
} from 'lucide-react'
import RenderHintCard from '@/components/chat/render-hint-card'
import CopyButton from '@/components/ui/copy-button'
import { OrganicLoader } from '@/components/config-pilot/ai-motion'
import type {
  PlaygroundTraceEvent,
  PlaygroundTraceStep,
} from '@/lib/agent/trace-aggregator'

/* ── Types ── */

export interface LiveTool {
  name: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  finishedAt?: number
  result?: unknown
  renderHints?: { kind: string; [key: string]: unknown }
}

interface TraceSidebarProps {
  collapsed: boolean
  onCollapse: () => void
  onExpand: () => void
  liveTools: LiveTool[]
  turnTraces: PlaygroundTraceStep[][]
  turnTotalMs: number[]
  sessionMetrics: {
    totalInput: number
    totalOutput: number
    totalTools: number
    llmCalls: number
    totalMs: number
  }
  expandedTurns: Set<number>
  expandedTools: Set<string>
  onToggleTurn: (idx: number) => void
  onToggleTool: (key: string) => void
  responding: boolean
  onRerunWithMessage?: (msg: string) => void
  tb: (key: string) => string
}

/* ── Sub-components ── */

function TraceHeader({ onCollapse }: { onCollapse: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
      padding: '14px 16px',
      borderBottom: '1px solid rgba(0,0,0,0.04)',
      background: 'rgba(255,252,249,0.4)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 8,
          background: 'linear-gradient(135deg, rgba(91,138,247,0.12), rgba(139,111,245,0.10))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Activity size={13} style={{ color: 'var(--indigo)' }} />
        </div>
        <div>
          <div style={{
            fontSize: 12, fontWeight: 700, color: '#5a524b',
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>Trace timeline</div>
        </div>
      </div>
      <button onClick={onCollapse} style={{
        width: 24, height: 24, borderRadius: 6,
        background: 'rgba(0,0,0,0.04)', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#b8a99a', transition: 'all 150ms ease',
      }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; e.currentTarget.style.color = '#8a7e74' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; e.currentTarget.style.color = '#b8a99a' }}
      >
        <ChevronLeft size={13} />
      </button>
    </div>
  )
}

function SessionMetricsGrid({ metrics, tb }: { metrics: TraceSidebarProps['sessionMetrics']; tb: (k: string) => string }) {
  const { totalInput, totalOutput, totalTools, llmCalls, totalMs } = metrics
  const totalTokens = totalInput + totalOutput

  const fmtTokens = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
  const fmtMs = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 's' : n + 'ms'

  const items = [
    { value: fmtTokens(totalTokens), label: tb('trace.sessionTokens') },
    { value: fmtMs(totalMs), label: tb('trace.sessionWall') },
    { value: String(llmCalls), label: tb('trace.sessionLlm') },
    { value: String(totalTools), label: tb('trace.sessionTools') },
  ]

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6,
      padding: '8px 14px 12px',
      borderBottom: '1px solid rgba(0,0,0,0.04)',
    }}>
      {items.map((item) => (
        <div key={item.label} style={{
          textAlign: 'center', padding: '8px 4px',
          background: 'rgba(255,252,249,0.6)',
          borderRadius: 10,
          border: '1px solid rgba(0,0,0,0.04)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}>
          <div style={{
            fontSize: 15, fontWeight: 700, color: '#3d3833',
            fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em',
          }}>{item.value}</div>
          <div style={{
            fontSize: 9, fontWeight: 600, color: '#b8a99a', marginTop: 3,
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>{item.label}</div>
        </div>
      ))}
    </div>
  )
}

function BreakdownCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '7px 4px',
      background: 'rgba(255,252,249,0.5)',
      borderRadius: 8,
      border: '1px solid rgba(0,0,0,0.03)',
    }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: '#3d3833',
        fontFamily: 'var(--font-mono)',
      }}>{value}</div>
      <div style={{
        fontSize: 9, fontWeight: 600, color: '#b8a99a',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2,
      }}>{label}</div>
    </div>
  )
}

function toneForStatus(status: PlaygroundTraceEvent['status']) {
  if (status === 'block') {
    return {
      fg: 'var(--vermillion)',
      bg: 'rgba(230,69,57,0.04)',
      border: '1px solid rgba(230,69,57,0.10)',
    }
  }
  if (status === 'warn') {
    return {
      fg: 'var(--amber)',
      bg: 'rgba(212,145,46,0.06)',
      border: '1px solid rgba(212,145,46,0.14)',
    }
  }
  if (status === 'info') {
    return {
      fg: 'var(--indigo)',
      bg: 'rgba(91,138,247,0.05)',
      border: '1px solid rgba(91,138,247,0.12)',
    }
  }
  return {
    fg: '#5a524b',
    bg: 'rgba(255,252,249,0.5)',
    border: '1px solid rgba(0,0,0,0.04)',
  }
}

function ToolCallCard({
  toolKey, actionType, detailText, toolName, event, isExpanded, onToggle,
}: {
  toolKey: string; actionType: string; detailText: string; toolName: string
  event?: PlaygroundTraceEvent
  isExpanded: boolean; onToggle: () => void
}) {
  const isResult = actionType === 'tool_result'
  const isError = event?.status === 'block' || event?.status === 'warn'
    ? true
    : /"ok"\s*:\s*false|"ok":\s*false|ok:\s*false/i.test(detailText)
  const executionLabel = event?.executionTruth?.label
  const executionNote = event?.executionTruth?.note

  const lines = detailText.split('\n')
  const inputLines: string[] = []
  const outputLines: string[] = []
  let inOutput = false
  for (const line of lines) {
    if (line.startsWith('input: ')) { inputLines.push(line.slice(7)); inOutput = false }
    else if (line.startsWith('output: ')) { outputLines.push(line.slice(8)); inOutput = true }
    else if (inOutput) { outputLines.push(line) }
    else if (line.length > 0) { inputLines.push(line) }
  }

  const hasStructuredData = inputLines.length > 0 || outputLines.length > 0

  return (
    <div>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px 8px 26px', cursor: 'pointer',
          background: isExpanded ? 'rgba(212,118,78,0.04)' : 'transparent',
          transition: 'background 200ms ease',
          borderLeft: isExpanded ? '2px solid rgba(212,118,78,0.3)' : '2px solid transparent',
        }}
        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(0,0,0,0.02)' }}
        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
      >
        {isResult && isError ? (
          <XCircle size={12} style={{ color: 'var(--vermillion)', flexShrink: 0 }} />
        ) : isResult ? (
          <CheckCircle2 size={12} style={{ color: 'var(--malachite)', flexShrink: 0 }} />
        ) : (
          <Activity size={12} style={{ color: 'var(--indigo)', flexShrink: 0 }} />
        )}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontSize: 12, fontWeight: 500,
            color: isError ? 'var(--vermillion)' : '#5a524b',
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {toolName}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{
            fontSize: 9,
            color: isResult ? '#2f7a4b' : 'var(--indigo)',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
            padding: '2px 6px',
            borderRadius: 999,
            background: isResult ? 'rgba(46,160,74,0.08)' : 'rgba(91,138,247,0.08)',
          }}>
              {isResult ? 'Result' : 'Call'}
            </span>
            {executionLabel && (
              <span style={{
                fontSize: 9, color: isError ? 'var(--vermillion)' : '#8a7e74',
                fontFamily: 'var(--font-mono)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {executionLabel}
              </span>
            )}
          </div>
        </div>
        <span style={{
          fontSize: 10, color: isError ? 'var(--vermillion)' : isResult ? '#b8a99a' : 'var(--indigo)',
          marginLeft: 'auto', fontFamily: 'var(--font-mono)', flexShrink: 0,
        }}>
          {isResult ? (isError ? 'warn' : 'ok') : ''}
        </span>
      </div>

      {isExpanded && (
        <div style={{ padding: '0 14px 0 26px' }}>
          {hasStructuredData ? (
            <>
              {inputLines.length > 0 && inputLines[0] && (
                <>
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: 'var(--indigo)',
                    marginBottom: 4, marginTop: 4,
                  }}>Input</div>
                  <div style={{
                    padding: '8px 10px', borderRadius: 8,
                    background: 'rgba(91,138,247,0.04)',
                    border: '1px solid rgba(91,138,247,0.10)',
                    fontSize: 11, fontFamily: 'var(--font-mono)',
                    color: '#5a524b', lineHeight: 1.6,
                    maxHeight: 120, overflowY: 'auto',
                    marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    {inputLines.join('\n')}
                  </div>
                </>
              )}
              {outputLines.length > 0 && outputLines[0] && (
                <>
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: isError ? 'var(--vermillion)' : 'var(--malachite)',
                    marginBottom: 4,
                  }}>Output{isError ? ' - error' : ''}</div>
                  <div style={{
                    padding: '8px 10px', borderRadius: 8,
                    background: isError ? 'rgba(230,69,57,0.04)' : 'rgba(46,160,74,0.04)',
                    border: isError ? '1px solid rgba(230,69,57,0.10)' : '1px solid rgba(46,160,74,0.10)',
                    fontSize: 11, fontFamily: 'var(--font-mono)',
                    color: isError ? 'var(--vermillion)' : '#5a524b', lineHeight: 1.6,
                    maxHeight: 120, overflowY: 'auto',
                    marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    {outputLines.join('\n')}
                  </div>
                </>
              )}
            </>
          ) : (
            <div style={{
              padding: '8px 10px', borderRadius: 8,
              background: 'rgba(255,252,249,0.5)',
              border: '1px solid rgba(0,0,0,0.04)',
              fontSize: 11, fontFamily: 'var(--font-mono)',
              color: '#5a524b', lineHeight: 1.6,
              maxHeight: 120, overflowY: 'auto',
              marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {detailText}
            </div>
          )}
          {executionNote ? (
            <div style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(255,252,249,0.55)',
              border: '1px solid rgba(0,0,0,0.04)',
              fontSize: 10.5,
              color: '#8a7e74',
              lineHeight: 1.55,
              marginBottom: 6,
            }}>
              {executionNote}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function PromptSection({ label, data, color }: { label: string; data: string; color: string }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = data.length > 200 && !expanded
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color,
        }}>{label}</span>
        <CopyButton text={data} label={`Copy ${label}`} />
      </div>
      <div
        onClick={() => truncated && setExpanded(true)}
        style={{
          padding: '8px 10px', borderRadius: 8,
          background: 'rgba(91,138,247,0.04)',
          border: '1px solid rgba(91,138,247,0.10)',
          fontSize: 11, fontFamily: 'var(--font-mono)',
          color: '#5a524b', lineHeight: 1.6,
          maxHeight: expanded ? 400 : 120, overflowY: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          cursor: truncated ? 'pointer' : undefined,
        }}
      >
        {truncated ? data.slice(0, 200) + '…' : data}
      </div>
      {truncated && (
        <button onClick={() => setExpanded(true)} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 10, color: 'var(--indigo)', padding: '2px 0',
          fontWeight: 600,
        }}>
          Show all ({data.length.toLocaleString()} chars)
        </button>
      )}
    </div>
  )
}

function ModelGenerationRow({ step, isExpanded, tb }: { step: PlaygroundTraceStep; isExpanded: boolean; tb: (k: string) => string }) {
  const hasPromptData = !!step.promptData && (
    !!step.promptData.systemPrompt ||
    (step.promptData.messages?.length ?? 0) > 0 ||
    (step.promptData.tools?.length ?? 0) > 0 ||
    step.promptData.toolChoice != null
  )
  const [showPromptData, setShowPromptData] = useState(false)

  const formatPromptValue = (value: unknown): string => {
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px 8px 26px',
        borderTop: '1px solid rgba(0,0,0,0.03)',
      }}>
        <Brain size={12} style={{ color: 'var(--indigo)', flexShrink: 0 }} />
        <span style={{
          fontSize: 12, fontWeight: 500, color: '#5a524b',
          fontFamily: 'var(--font-mono)',
        }}>
          {tb('trace.modelResponse')}
        </span>
        {step.usage && (
          <span style={{
            fontSize: 10, color: '#b8a99a',
            marginLeft: 'auto', fontFamily: 'var(--font-mono)',
          }}>
            &uarr;{step.usage.inputTokens || 0} &darr;{step.usage.outputTokens || 0} tok
          </span>
        )}
      </div>
      {isExpanded && (
        <div style={{ margin: '0 14px 8px 26px' }}>
          {step.summary && step.summary !== '(no summary)' && (
            <div style={{
              padding: '8px 10px', marginBottom: hasPromptData ? 6 : 0,
              background: 'rgba(255,252,249,0.5)',
              borderRadius: 8, border: '1px solid rgba(0,0,0,0.04)',
              fontSize: 11, color: '#5a524b', lineHeight: 1.6,
              maxHeight: 80, overflowY: 'auto',
            }}>
              {step.summary}
            </div>
          )}
          {hasPromptData && (
            <>
              <button onClick={() => setShowPromptData(!showPromptData)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 10, fontWeight: 600, color: 'var(--indigo)',
                padding: '2px 0', display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <ChevronDown size={10} style={{
                  transition: 'transform 200ms cubic-bezier(0.4,0,0.2,1)',
                  transform: showPromptData ? 'rotate(0deg)' : 'rotate(-90deg)',
                }} />
                {showPromptData ? 'Hide' : 'Show'} prompt data
              </button>
              {showPromptData && (
                <div style={{ marginTop: 6 }}>
                  {Boolean(step.promptData!.systemPrompt) && (
                    <PromptSection label="System Prompt" data={formatPromptValue(step.promptData!.systemPrompt)} color="var(--indigo)" />
                  )}
                  {(step.promptData!.messages?.length ?? 0) > 0 && (
                    <PromptSection label="Messages (IN)" data={formatPromptValue(step.promptData!.messages)} color="var(--indigo)" />
                  )}
                  {(step.promptData!.tools?.length ?? 0) > 0 && (
                    <PromptSection label="Tools (IN)" data={formatPromptValue(step.promptData!.tools)} color="var(--indigo)" />
                  )}
                  {step.promptData!.toolChoice != null && (
                    <PromptSection label="Tool Choice" data={formatPromptValue(step.promptData!.toolChoice)} color="var(--indigo)" />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function evidenceKindLabel(event: PlaygroundTraceEvent): string {
  if (event.kind === 'hook_decision') return 'Hook'
  if (event.kind === 'stale_evidence') return 'Stale evidence'
  if (event.label.toLowerCase().includes('reconcile')) return 'Reconcile gate'
  return 'Procedure runtime'
}

function EvidenceCard({ event }: { event: PlaygroundTraceEvent }) {
  const tone = toneForStatus(event.status)
  return (
    <div style={{ padding: '8px 14px 8px 26px', borderTop: '1px solid rgba(0,0,0,0.03)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {event.status === 'block' ? (
          <XCircle size={12} style={{ color: tone.fg, flexShrink: 0 }} />
        ) : event.status === 'warn' ? (
          <Loader2 size={12} style={{ color: tone.fg, flexShrink: 0 }} />
        ) : (
          <CheckCircle2 size={12} style={{ color: tone.fg, flexShrink: 0 }} />
        )}
        <span style={{
          fontSize: 12, fontWeight: 500, color: tone.fg,
          fontFamily: 'var(--font-mono)',
        }}>
          {event.label}
        </span>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          color: tone.fg,
          background: 'rgba(255,255,255,0.6)',
          border: tone.border,
          padding: '2px 6px',
          borderRadius: 999,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {evidenceKindLabel(event)}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 10, color: tone.fg,
          fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
        }}>
          {event.status}
        </span>
      </div>
      <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
        <div style={{
          padding: '8px 10px',
          borderRadius: 8,
          background: tone.bg,
          border: tone.border,
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: tone.fg,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {event.detail}
        </div>
      </div>
    </div>
  )
}

function TurnSection({
  turnIdx, steps, turnMs, isExpanded, isLatest, isResponding, liveTools, expandedTools, onToggleTool, onToggleTurn, tb,
}: {
  turnIdx: number; steps: PlaygroundTraceStep[]; turnMs: number
  isExpanded: boolean; isLatest: boolean; isResponding: boolean
  liveTools: LiveTool[]; expandedTools: Set<string>; onToggleTool: (key: string) => void; onToggleTurn: (idx: number) => void
  tb: (k: string) => string
}) {
  let turnInput = 0, turnOutput = 0, cacheRead = 0
  const modelStep = steps.find((s) => s.stage === 'Model generation')
  if (modelStep?.usage) {
    turnInput = modelStep.usage.inputTokens || 0
    turnOutput = modelStep.usage.outputTokens || 0
    cacheRead = modelStep.usage.cacheReadTokens || 0
  }
  const cachePct = (turnInput + cacheRead) > 0 ? Math.round(cacheRead / (turnInput + cacheRead) * 100) : 0
  const toolSteps = steps.filter((s) => s.stage === 'Tools' || s.stage === 'Knowledge retrieval')
  const toolCount = toolSteps.reduce((sum, s) => sum + (s.detail?.length || 0), 0)
  const hasLiveTools = isLatest && isResponding && liveTools.length > 0
  const hasTraceData = steps.length > 0
  const chevronStyle: React.CSSProperties = {
    transition: 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)',
    transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
    color: '#b8a99a', flexShrink: 0,
  }

  return (
    <div style={{
      borderBottom: '1px solid rgba(0,0,0,0.03)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px', cursor: 'pointer',
        background: isExpanded ? 'rgba(212,118,78,0.03)' : 'transparent',
        transition: 'background 200ms ease',
      }}
        onClick={() => onToggleTurn(turnIdx)}
        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(0,0,0,0.015)' }}
        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
      >
        <div style={{
          width: 3, height: 22, borderRadius: 2, flexShrink: 0,
          background: isLatest
            ? 'linear-gradient(180deg, var(--indigo), rgba(139,111,245,0.6))'
            : 'linear-gradient(180deg, #d4c9be, #c4b8ad)',
          boxShadow: isLatest ? '0 0 6px rgba(91,138,247,0.2)' : 'none',
        }} />
        <span style={{
          fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
          color: isExpanded ? '#3d3833' : '#8a7e74',
        }}>
          Turn {turnIdx + 1}
        </span>
        {isLatest && isResponding && (
          <span style={{ color: 'var(--indigo)', display: 'inline-flex', flexShrink: 0 }}>
            <OrganicLoader variant="20" size={14} title="Trace turn is running" />
          </span>
        )}
        {cacheRead > 0 && (
          <span style={{
            fontSize: 10, padding: '2px 7px', borderRadius: 6,
            background: 'rgba(46,160,74,0.08)', color: 'var(--malachite)',
            fontFamily: 'var(--font-mono)', fontWeight: 500,
          }}>
            {cachePct}% cache
          </span>
        )}
        <span style={{
          fontSize: 11, color: hasLiveTools && !hasTraceData ? 'var(--indigo)' : '#b8a99a',
          whiteSpace: 'nowrap', marginLeft: 'auto',
          fontFamily: 'var(--font-mono)',
        }}>
          {hasLiveTools && !hasTraceData
            ? tb('trace.running')
            : <>{turnMs >= 1000 ? (turnMs / 1000).toFixed(1) + 's' : turnMs + 'ms'}{toolCount > 0 ? ` / ${toolCount} tool${toolCount !== 1 ? 's' : ''}` : ''}</>
          }
        </span>
        <ChevronDown size={14} style={chevronStyle} />
      </div>

      {isExpanded && (
        <div style={{ paddingBottom: 10 }}>
          {modelStep && (
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
              gap: 5, padding: '6px 14px 10px 26px',
            }}>
              <BreakdownCell label={tb('trace.breakdownInput')} value={String(turnInput)} />
              <BreakdownCell label={tb('trace.breakdownOutput')} value={String(turnOutput)} />
              <BreakdownCell label={tb('trace.breakdownCache')} value={`${cachePct}%`} />
              <BreakdownCell label={tb('trace.breakdownLlm')} value={modelStep.ms >= 1000 ? (modelStep.ms / 1000).toFixed(1) + 's' : modelStep.ms + 'ms'} />
              <BreakdownCell label={tb('trace.breakdownTools')} value={turnMs >= modelStep.ms && turnMs - modelStep.ms >= 0 ? ((turnMs - modelStep.ms) >= 1000 ? ((turnMs - modelStep.ms) / 1000).toFixed(1) + 's' : (turnMs - modelStep.ms) + 'ms') : '-'} />
              <BreakdownCell label={tb('trace.breakdownTokPerS')} value={modelStep.ms > 0 ? String(Math.round(turnOutput / (modelStep.ms / 1000))) : '-'} />
            </div>
          )}

          {steps.filter((s) => s.fired !== false).map((step, i) => {
            const isModelGen = step.stage === 'Model generation'
            const isTool = step.stage === 'Tools' || step.stage === 'Knowledge retrieval'
            const toolEvents = step.events?.filter((event) => event.kind === 'tool_call' || event.kind === 'tool_result') ?? []
            const evidenceEvents = step.events?.filter((event) => event.kind === 'hook_decision' || event.kind === 'runtime_guard' || event.kind === 'stale_evidence') ?? []

            if (isTool && hasLiveTools) return null

            if (isTool && toolEvents.length > 0) {
              return toolEvents.map((event, di) => {
                const toolKey = `${turnIdx}-${i}-${di}`
                const toolName = event.toolName || event.label || event.actionType.replace('tool_', '')
                return (
                  <ToolCallCard
                    key={toolKey}
                    toolKey={toolKey}
                    actionType={event.actionType}
                    detailText={event.detail}
                    toolName={toolName}
                    event={event}
                    isExpanded={expandedTools.has(toolKey)}
                    onToggle={() => onToggleTool(toolKey)}
                  />
                )
              })
            }

            if (isTool && step.detail?.length > 0) {
              return step.detail.map(([actionType, detailText], di) => {
                const toolKey = `${turnIdx}-${i}-${di}`
                const toolName = step.summary?.split(' → ')?.[di] || actionType.replace('tool_', '')
                return (
                  <ToolCallCard
                    key={toolKey}
                    toolKey={toolKey}
                    actionType={actionType}
                    detailText={detailText}
                    toolName={toolName}
                    isExpanded={expandedTools.has(toolKey)}
                    onToggle={() => onToggleTool(toolKey)}
                  />
                )
              })
            }

            if (isModelGen) {
              return (
                <ModelGenerationRow
                  key={`${turnIdx}-${i}`}
                  step={step}
                  isExpanded={isExpanded}
                  tb={tb}
                />
              )
            }

            if ((step.stage === 'Hooks' || step.stage === 'Procedure') && evidenceEvents.length > 0) {
              return evidenceEvents.map((event, eventIdx) => (
                <EvidenceCard
                  key={`${turnIdx}-${i}-${event.kind}-${eventIdx}`}
                  event={event}
                />
              ))
            }

            return null
          })}

          {hasLiveTools && liveTools.map((t, i) => (
            <div key={`live-${i}`} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px 8px 26px',
              background: t.status === 'running' ? 'rgba(217,161,36,0.03)' : 'transparent',
            }}>
              {t.status === 'running' ? (
                <span style={{ color: 'var(--amber)', display: 'inline-flex', flexShrink: 0 }}>
                  <OrganicLoader variant="05" size={14} title="Tool is running" />
                </span>
              ) : t.status === 'error' ? (
                <XCircle size={12} style={{ color: 'var(--vermillion)', flexShrink: 0 }} />
              ) : (
                <CheckCircle2 size={12} style={{ color: 'var(--malachite)', flexShrink: 0 }} />
              )}
              <span style={{
                fontSize: 12, fontWeight: 500,
                color: t.status === 'error' ? 'var(--vermillion)' : '#5a524b',
                fontFamily: 'var(--font-mono)',
              }}>
                Tool: {t.name}
              </span>
              <span style={{
                fontSize: 11, color: t.status === 'running' ? 'var(--amber)' : t.status === 'error' ? 'var(--vermillion)' : '#b8a99a',
                marginLeft: 'auto', fontFamily: 'var(--font-mono)',
              }}>
                {t.status === 'running' ? 'running...' : t.status === 'error' ? 'failed' : t.finishedAt && t.startedAt ? `${t.finishedAt - t.startedAt}ms` : 'done'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Main component ── */

export default function TraceSidebar({
  collapsed, onCollapse, onExpand,
  liveTools, turnTraces, turnTotalMs, sessionMetrics,
  expandedTurns, expandedTools, onToggleTurn, onToggleTool,
  responding, onRerunWithMessage, tb,
}: TraceSidebarProps) {
  const hasData = turnTraces.length > 0 || liveTools.length > 0

  /* ── Collapsed strip ── */
  if (collapsed) {
    return (
      <div
        onClick={onExpand}
        style={{
          width: 32, flexShrink: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'flex-start', paddingTop: 14,
          borderLeft: '1px solid rgba(0,0,0,0.05)',
          background: 'rgba(255,252,249,0.35)',
          backdropFilter: 'blur(16px) saturate(140%)',
          WebkitBackdropFilter: 'blur(16px) saturate(140%)',
          cursor: 'pointer',
          transition: 'all 200ms ease',
          position: 'relative',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(255,252,249,0.55)'
          e.currentTarget.style.backdropFilter = 'blur(20px) saturate(160%)'
          const icon = e.currentTarget.querySelector('svg') as SVGElement | null
          if (icon) { icon.style.color = '#8a7e74'; icon.style.opacity = '1' }
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(255,252,249,0.35)'
          e.currentTarget.style.backdropFilter = 'blur(16px) saturate(140%)'
          const icon = e.currentTarget.querySelector('svg') as SVGElement | null
          if (icon) { icon.style.color = '#b8a99a'; icon.style.opacity = '0.5' }
        }}
      >
        <ChevronLeft size={13} style={{ color: '#b8a99a', opacity: 0.5, transition: 'all 200ms ease' }} />
      </div>
    )
  }

  /* ── Expanded sidebar ── */
  return (
    <aside style={{
      width: 340, flexShrink: 0,
      borderLeft: '1px solid rgba(0,0,0,0.04)',
      background: 'rgba(255, 252, 249, 0.82)',
      backdropFilter: 'blur(24px) saturate(160%)',
      WebkitBackdropFilter: 'blur(24px) saturate(160%)',
      boxShadow: '-2px 0 16px rgba(0,0,0,0.03), -1px 0 4px rgba(0,0,0,0.02)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <TraceHeader onCollapse={onCollapse} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {!hasData ? (
          <div style={{
            padding: '20px 16px', textAlign: 'center',
            fontSize: 12, color: '#8a7e74', lineHeight: 1.6,
          }}>
            Run a manual turn to populate the timeline.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {(turnTraces.length > 0 || liveTools.length > 0) && (
              <SessionMetricsGrid metrics={sessionMetrics} tb={tb} />
            )}

            {turnTraces.map((steps, turnIdx) => {
              const isLatest = turnIdx === turnTraces.length - 1
              const live = (isLatest && responding) ? liveTools : []
              return (
                <TurnSection
                  key={turnIdx}
                  turnIdx={turnIdx}
                  steps={steps}
                  turnMs={turnTotalMs[turnIdx] || 0}
                  isExpanded={expandedTurns.has(turnIdx)}
                  isLatest={isLatest}
                  isResponding={responding}
                  liveTools={live}
                  expandedTools={expandedTools}
                  onToggleTool={onToggleTool}
                  onToggleTurn={onToggleTurn}
                  tb={tb}
                />
              )
            })}

            {liveTools.filter(t => t.status === 'done' && t.renderHints).map((t, i) => {
              const hint = (t.renderHints as any)?.playground || (t.renderHints as any)?.['web-chat'] || null
              if (!hint) return null
              return (
                <RenderHintCard
                  key={`hint-${i}`}
                  hint={hint}
                  result={t.result}
                  onSubmit={(values) => {
                    if (onRerunWithMessage) {
                      onRerunWithMessage(JSON.stringify(values, null, 2))
                    }
                  }}
                />
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}

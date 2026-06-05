'use client'

import { useState } from 'react'
import {
  Activity, ChevronDown, ChevronLeft,
  CheckCircle2, XCircle, Loader2, Brain,
} from 'lucide-react'
import RenderHintCard from '@/components/chat/render-hint-card'
import CopyButton from '@/components/ui/copy-button'
import type { PlaygroundTraceStep } from '@/lib/agent/trace-aggregator'

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

function TraceHeader({ count, onCollapse }: { count: number; onCollapse: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Activity size={14} style={{ color: 'var(--fog)' }} />
        <span style={{
          fontSize: 12, fontWeight: 700, color: 'var(--fog)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>Trace</span>
        {count > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: 'var(--indigo)',
            background: 'rgba(91,138,247,0.08)', padding: '1px 6px',
            borderRadius: 'var(--radius-sm)', lineHeight: '18px',
            minWidth: 18, textAlign: 'center', fontFamily: 'var(--font-mono)',
          }}>
            {count}
          </span>
        )}
      </div>
      <button onClick={onCollapse} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        padding: 2, color: 'var(--fog)', opacity: 0.5,
      }}>
        <ChevronLeft size={14} />
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
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8,
      padding: '0 14px 12px', borderBottom: '1px solid var(--border-subtle)',
      marginBottom: 6,
    }}>
      {items.map((item) => (
        <div key={item.label} style={{
          textAlign: 'center', padding: '7px 4px',
          background: 'var(--surface)', borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
        }}>
          <div style={{
            fontSize: 15, fontWeight: 700, color: 'var(--mist)',
            fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em',
          }}>{item.value}</div>
          <div style={{
            fontSize: 9, fontWeight: 600, color: 'var(--smoke)', marginTop: 2,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>{item.label}</div>
        </div>
      ))}
    </div>
  )
}

function BreakdownCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '6px 4px',
      background: 'var(--surface)', borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border-subtle)',
    }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: 'var(--mist)',
        fontFamily: 'var(--font-mono)',
      }}>{value}</div>
      <div style={{
        fontSize: 9, fontWeight: 600, color: 'var(--smoke)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 1,
      }}>{label}</div>
    </div>
  )
}

function ToolCallCard({
  toolKey, actionType, detailText, toolName, isExpanded, onToggle,
}: {
  toolKey: string; actionType: string; detailText: string; toolName: string
  isExpanded: boolean; onToggle: () => void
}) {
  const isError = /"ok"\s*:\s*false|"ok":\s*false|ok:\s*false/i.test(detailText)

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
          padding: '7px 14px 7px 26px', cursor: 'pointer',
          background: isExpanded ? 'rgba(248,247,244,0.5)' : undefined,
          transition: 'background 150ms ease',
        }}
      >
        {isError ? (
          <XCircle size={12} style={{ color: 'var(--vermillion)', flexShrink: 0 }} />
        ) : (
          <CheckCircle2 size={12} style={{ color: 'var(--malachite)', flexShrink: 0 }} />
        )}
        <span style={{
          fontSize: 12, fontWeight: 500,
          color: isError ? 'var(--vermillion)' : 'var(--mist)',
          fontFamily: 'var(--font-mono)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {toolName}
        </span>
        <span style={{
          fontSize: 10, color: isError ? 'var(--vermillion)' : 'var(--smoke)',
          marginLeft: 'auto', fontFamily: 'var(--font-mono)', flexShrink: 0,
        }}>
          {isError ? 'failed' : ''}
        </span>
      </div>

      {isExpanded && (
        <div style={{ padding: '0 14px 0 26px' }}>
          {hasStructuredData ? (
            <>
              {inputLines.length > 0 && inputLines[0] && (
                <>
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: 'var(--indigo)',
                    marginBottom: 3, marginTop: 3,
                  }}>Input</div>
                  <div style={{
                    padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                    background: 'rgba(91,138,247,0.05)',
                    border: '1px solid rgba(91,138,247,0.12)',
                    fontSize: 11, fontFamily: 'var(--font-mono)',
                    color: 'var(--mist)', lineHeight: 1.6,
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
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: isError ? 'var(--vermillion)' : 'var(--malachite)',
                    marginBottom: 3,
                  }}>Output{isError ? ' - error' : ''}</div>
                  <div style={{
                    padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                    background: isError ? 'rgba(230,69,57,0.05)' : 'rgba(46,160,74,0.05)',
                    border: isError ? '1px solid rgba(230,69,57,0.12)' : '1px solid rgba(46,160,74,0.12)',
                    fontSize: 11, fontFamily: 'var(--font-mono)',
                    color: isError ? 'var(--vermillion)' : 'var(--mist)', lineHeight: 1.6,
                    maxHeight: 120, overflowY: 'auto',
                    marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    {outputLines.join('\n')}
                  </div>
                </>
              )}
            </>
          ) : (
            /* Fallback: unstructured detail text */
            <div style={{
              padding: '8px 10px', borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              border: '1px solid var(--border-subtle)',
              fontSize: 11, fontFamily: 'var(--font-mono)',
              color: 'var(--mist)', lineHeight: 1.6,
              maxHeight: 120, overflowY: 'auto',
              marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {detailText}
            </div>
          )}
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
          fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', color,
        }}>{label}</span>
        <CopyButton text={data} label={`Copy ${label}`} />
      </div>
      <div
        onClick={() => truncated && setExpanded(true)}
        style={{
          padding: '8px 10px', borderRadius: 'var(--radius-sm)',
          background: 'rgba(91,138,247,0.05)',
          border: '1px solid rgba(91,138,247,0.12)',
          fontSize: 11, fontFamily: 'var(--font-mono)',
          color: 'var(--mist)', lineHeight: 1.6,
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
  const hasPromptData = !!step.promptData && (!!step.promptData.systemPrompt || (step.promptData.messages?.length ?? 0) > 0)
  const [showPromptData, setShowPromptData] = useState(false)

  const formatMessages = (msgs: unknown[]): string => {
    try {
      return JSON.stringify(msgs, null, 2)
    } catch {
      return String(msgs)
    }
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 14px 7px 26px',
        borderTop: '1px solid var(--border-subtle)',
      }}>
        <Brain size={12} style={{ color: 'var(--indigo)', flexShrink: 0 }} />
        <span style={{
          fontSize: 12, fontWeight: 500, color: 'var(--mist)',
          fontFamily: 'var(--font-mono)',
        }}>
          {tb('trace.modelResponse')}
        </span>
        {step.usage && (
          <span style={{
            fontSize: 10, color: 'var(--smoke)',
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
              background: 'var(--surface)',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)',
              fontSize: 11, color: 'var(--mist)', lineHeight: 1.6,
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
                  transition: 'transform 150ms ease',
                  transform: showPromptData ? 'rotate(0deg)' : 'rotate(-90deg)',
                }} />
                {showPromptData ? 'Hide' : 'Show'} prompt data
              </button>
              {showPromptData && (
                <div style={{ marginTop: 6 }}>
                  {step.promptData!.systemPrompt && (
                    <PromptSection label="System Prompt" data={step.promptData!.systemPrompt} color="var(--indigo)" />
                  )}
                  {(step.promptData!.messages?.length ?? 0) > 0 && (
                    <PromptSection label="Messages (IN)" data={formatMessages(step.promptData!.messages)} color="var(--indigo)" />
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
  const toolSteps = steps.filter((s) => s.stage === 'Skills & tools' || s.stage === 'Knowledge retrieval')
  const toolCount = toolSteps.reduce((sum, s) => sum + (s.detail?.length || 0), 0)
  const hasLiveTools = isLatest && isResponding && liveTools.length > 0
  const hasTraceData = steps.length > 0

  const chevronStyle: React.CSSProperties = {
    transition: 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)',
    transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
    color: 'var(--smoke)', flexShrink: 0,
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px', cursor: 'pointer',
        borderBottom: isExpanded ? 'none' : '1px solid var(--border-subtle)',
      }}
        onClick={() => onToggleTurn(turnIdx)}
      >
        <div style={{
          width: 3, height: 22, borderRadius: 2, flexShrink: 0,
          background: isLatest ? 'var(--indigo)' : 'var(--obsidian)',
        }} />
        <span style={{
          fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
          color: isExpanded ? 'var(--mist)' : 'var(--fog)',
        }}>
          Turn {turnIdx + 1}
        </span>
        {hasLiveTools && (
          <Loader2 size={12} style={{
            color: 'var(--indigo)', animation: 'spin 1s linear infinite', flexShrink: 0,
          }} />
        )}
        {cacheRead > 0 && (
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-sm)',
            background: 'rgba(46,160,74,0.1)', color: 'var(--malachite)',
            fontFamily: 'var(--font-mono)',
          }}>
            {cachePct}% cache
          </span>
        )}
        <span style={{
          fontSize: 11, color: hasLiveTools && !hasTraceData ? 'var(--indigo)' : 'var(--fog)',
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
        <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
          {modelStep && (
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
              gap: 6, padding: '6px 14px 10px 26px',
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
            const isSkill = step.stage === 'Skills & tools' || step.stage === 'Knowledge retrieval'

            if (isSkill && step.detail?.length > 0) {
              return step.detail.map(([actionType, detailText], di) => {
                const toolKey = `${turnIdx}-${i}-${di}`
                const toolName = step.summary?.split(' → ')?.[di] || actionType.replace('skill_', '')
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

            return null
          })}

          {/* Live tools during streaming — rendered inside the current turn */}
          {hasLiveTools && liveTools.map((t, i) => (
            <div key={`live-${i}`} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 14px 7px 26px',
            }}>
              {t.status === 'running' ? (
                <Loader2 size={12} style={{
                  color: 'var(--amber)', animation: 'spin 1s linear infinite', flexShrink: 0,
                }} />
              ) : t.status === 'error' ? (
                <XCircle size={12} style={{ color: 'var(--vermillion)', flexShrink: 0 }} />
              ) : (
                <CheckCircle2 size={12} style={{ color: 'var(--malachite)', flexShrink: 0 }} />
              )}
              <span style={{
                fontSize: 12, fontWeight: 500,
                color: t.status === 'error' ? 'var(--vermillion)' : 'var(--mist)',
                fontFamily: 'var(--font-mono)',
              }}>
                {t.name}
              </span>
              <span style={{
                fontSize: 11, color: t.status === 'running' ? 'var(--amber)' : t.status === 'error' ? 'var(--vermillion)' : 'var(--smoke)',
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
  const totalCount = liveTools.length + turnTraces.reduce((sum, t) => sum + t.length, 0)
  const hasData = turnTraces.length > 0 || liveTools.length > 0

  /* ── Collapsed strip ── */
  if (collapsed) {
    return (
      <div style={{
        width: 32, flexShrink: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-start', paddingTop: 12,
        borderLeft: '1px solid var(--border-subtle)',
        background: 'var(--surface)', cursor: 'pointer',
      }} onClick={onExpand}>
        <ChevronLeft size={14} style={{ color: 'var(--fog)', opacity: 0.5 }} />
        {totalCount > 0 && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: 'var(--indigo)',
            marginTop: 6, writingMode: 'vertical-rl',
          }}>
            {totalCount}
          </span>
        )}
      </div>
    )
  }

  /* ── Expanded sidebar ── */
  return (
    <aside style={{
      width: 340, flexShrink: 0,
      borderLeft: '1px solid var(--border-subtle)',
      background: 'rgba(255, 255, 255, 0.92)',
      backdropFilter: 'blur(20px) saturate(150%)',
      WebkitBackdropFilter: 'blur(20px) saturate(150%)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <TraceHeader count={totalCount} onCollapse={onCollapse} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {!hasData ? (
          <div style={{
            padding: '24px 20px', textAlign: 'center',
            fontSize: 12, color: 'var(--smoke)', lineHeight: 1.6,
          }}>
            Send a message to see the trace.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Session metrics */}
            {(turnTraces.length > 0 || liveTools.length > 0) && (
              <SessionMetricsGrid metrics={sessionMetrics} tb={tb} />
            )}

            {/* Completed turns + live turn (merged) */}
            {turnTraces.map((steps, turnIdx) => {
              const isLatest = turnIdx === turnTraces.length - 1
              // Show live tools on the latest turn when responding
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

            {/* Render hints for completed tools */}
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

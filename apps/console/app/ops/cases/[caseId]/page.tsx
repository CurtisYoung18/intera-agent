'use client'

import { useState, useEffect, useMemo, use } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Cpu, Zap, Clock, Wrench, BarChart3, ChevronDown } from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import { CaseTraceTimeline, type TraceRow } from '@/components/ops/case-trace-view'
import { useConsoleLocale } from '@/components/locale-provider'
import ReactMarkdown from 'react-markdown'
import { apiClient } from '@/lib/api/client'
import type { CaseDetailResponse } from '@intera/shared/contracts/cases'

interface CaseData {
  id: string; type: string; status: string; goal: string | null
  createdAt: string; updatedAt: string; chatId?: string | null
  _count?: { messages: number; traces: number }
  memory?: {
    confirmedFacts: string; missingFacts: string; toolsCalled: string
    toolResults: string; summary?: string; todos?: string
  } | null
}

interface MsgItem {
  id: string; role: string; content: string; createdAt: string
}

interface ToolCall {
  name: string; input: Record<string, unknown> | null
  output: Record<string, unknown> | null; latencyMs: number | null
  createdAt: string
}

function normalizeTraceActionType(actionType: string): string {
  return actionType
}

interface IterationMetrics {
  iteration: number
  inputTokens: number; outputTokens: number; cacheReadTokens: number
  llmWallMs: number; toolsWallMs: number; toolCount: number
  model?: string
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export default function CaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params)
  const router = useRouter()
  const { t } = useConsoleLocale()

  const [caseData, setCaseData] = useState<CaseData | null>(null)
  const [traces, setTraces] = useState<TraceRow[]>([])
  const [messages, setMessages] = useState<MsgItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showMessages, setShowMessages] = useState(true)
  const [showTraces, setShowTraces] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [caseResult, tracesResult, msgsResult] = await Promise.all([
          apiClient<CaseDetailResponse>(`/api/cases/${encodeURIComponent(caseId)}`),
          apiClient<{ traces: TraceRow[] }>(`/api/cases/${encodeURIComponent(caseId)}/traces?limit=500`),
          apiClient<{ messages: MsgItem[] }>(`/api/cases/${encodeURIComponent(caseId)}/messages?limit=200`),
        ])
        setCaseData(caseResult.data.case as unknown as CaseData)
        setTraces(tracesResult.data.traces ?? [])
        setMessages(msgsResult.data.messages ?? [])
      } catch (e) { console.error('ProcedureRun load failed:', e) }
      finally { setLoading(false) }
    }
    load()
  }, [caseId])

  // ── Metrics from traces ──
  const metrics = useMemo(() => {
    let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0
    let llmCalls = 0, totalWallMs = 0
    let firstTs: number | null = null, lastTs: number | null = null
    const toolCalls: ToolCall[] = []
    const iterMetrics = new Map<number, IterationMetrics>()

    for (const t of traces) {
      const ts = new Date(t.createdAt).getTime()
      if (firstTs == null || ts < firstTs) firstTs = ts
      if (lastTs == null || ts > lastTs) lastTs = ts

      const p = (() => { try { return t.payload ? JSON.parse(t.payload) : null } catch { return null } })()

      // Token metrics from llm_response
      if (t.actionType === 'llm_response' && p?.usage && typeof p.iteration === 'number') {
        const u = p.usage as Record<string, number>
        inputTokens += u.input_tokens ?? 0
        outputTokens += u.output_tokens ?? 0
        cacheReadTokens += u.cache_read_input_tokens ?? 0
        cacheWriteTokens += u.cache_creation_input_tokens ?? 0
        llmCalls++

        const iter = p.iteration as number
        const im = iterMetrics.get(iter) || { iteration: iter, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, llmWallMs: 0, toolsWallMs: 0, toolCount: 0, model: undefined as string | undefined }
        im.inputTokens += u.input_tokens ?? 0
        im.outputTokens += u.output_tokens ?? 0
        im.cacheReadTokens += u.cache_read_input_tokens ?? 0
        im.model = (p.model as string) || im.model
        iterMetrics.set(iter, im)
      }

      // Track tool calls from tool_result traces.
      if (normalizeTraceActionType(t.actionType) === 'tool_result' && p) {
        const input = (() => { try { return t.detail ? JSON.parse(t.detail) : null } catch { return null } })()
        toolCalls.push({
          name: (p.toolName as string) || t.title,
          input: (p.input ?? input) as Record<string, unknown> | null,
          output: (p.output ?? p.result) as Record<string, unknown> | null,
          latencyMs: typeof p.latencyMs === 'number' ? p.latencyMs : null,
          createdAt: t.createdAt,
        })

        // Only attach to per-iteration metrics when iteration is known.
        // Tool traces without iteration metadata are displayed but not counted.
        if (typeof p.iteration !== 'number') continue

        const iter = p.iteration as number
        const im2 = iterMetrics.get(iter) || { iteration: iter, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, llmWallMs: 0, toolsWallMs: 0, toolCount: 0, model: undefined as string | undefined }
        im2.toolCount++
        if (typeof p.latencyMs === 'number') im2.toolsWallMs += p.latencyMs
        iterMetrics.set(iter, im2)
      }

      // Loop decision snapshots with timing
      // Skip traces without iteration field (e.g. Profiler Snapshot) —
      // they have no iteration-level data and would create a ghost iter=0 row.
      if (t.actionType === 'loop_decision' && p && typeof p.iteration === 'number') {
        const iter = p.iteration as number
        const im3 = iterMetrics.get(iter) || { iteration: iter, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, llmWallMs: 0, toolsWallMs: 0, toolCount: 0, model: undefined as string | undefined }
        im3.llmWallMs = (p.llmWallMs as number) || im3.llmWallMs
        iterMetrics.set(iter, im3)
      }
    }

    if (firstTs && lastTs) totalWallMs = lastTs - firstTs
    return {
      inputTokens, outputTokens, cacheWriteTokens,
      llmCalls, totalWallMs, toolCalls,
      totalTokens: inputTokens + outputTokens,
      cacheReadTokens,
      iterMetrics: Array.from(iterMetrics.values()).sort((a, b) => a.iteration - b.iteration),
    }
  }, [traces])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <OrganicLoader icon="spin" size={28} className="text-indigo/60" />
      </div>
    )
  }

  if (!caseData) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-[var(--fog)]">{t('caseDetail.caseNotFound')}</p>
        <button onClick={() => router.back()} className="text-indigo text-sm hover:underline">{t('caseDetail.goBack')}</button>
      </div>
    )
  }

  const statusColor: Record<string, string> = {
    created: '#a09888', collecting: '#5b8af7', investigating: '#6366f1',
    waiting_human: '#d4912e', resolved: '#2ea04a', escalated: '#e64539',
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[960px] flex-col px-4 py-4 sm:px-6">
      {/* Header */}
      <header className="sticky top-0 z-30 mb-4 flex flex-shrink-0 items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white/55 px-4 py-3 shadow-[var(--shadow-card)] backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => router.back()}
            className="console-btn-icon-square" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-semibold tracking-tight text-[var(--mist)]">
              ProcedureRun · {caseData.type.replace(/_/g, ' ')}
              <span className="ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"
                style={{ borderColor: `${statusColor[caseData.status] || '#a09888'}44`, color: statusColor[caseData.status] || '#a09888' }}>
                {caseData.status}
              </span>
            </h1>
            <p className="mt-0.5 text-[11px] text-[var(--fog)]/70">
              {caseData.id} · {t('caseDetail.statsMsgs', { n: caseData._count?.messages ?? messages.length })} · {t('caseDetail.statsTraces', { n: caseData._count?.traces ?? traces.length })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/cases/${encodeURIComponent(caseData.id)}/export`}
            className="text-[11px] text-[var(--fog)] hover:text-[var(--mist)] whitespace-nowrap px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] hover:bg-black/[0.03] transition-colors"
            onClick={(e) => { e.preventDefault(); window.open(`/api/cases/${encodeURIComponent(caseData.id)}/export`, '_blank') }}
          >
            Export .md
          </a>
          {caseData.chatId && (
            <button onClick={() => router.push(`/ops/chats/${encodeURIComponent(caseData.chatId!)}`)}
              className="text-[11px] text-indigo hover:underline whitespace-nowrap">
              {t('caseDetail.viewChat')}
            </button>
          )}
        </div>
      </header>

      {/* Metrics cards */}
      {metrics.llmCalls > 0 && (
        <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard icon={<Cpu className="w-3.5 h-3.5" />} label={t('caseDetail.llmCalls')} value={String(metrics.llmCalls)} />
          <MetricCard icon={<Zap className="w-3.5 h-3.5" />} label={t('caseDetail.totalTokens')} value={fmtTokens(metrics.totalTokens)} />
          <MetricCard icon={<Clock className="w-3.5 h-3.5" />} label={t('caseDetail.wallTime')} value={fmtMs(metrics.totalWallMs)} />
          <MetricCard icon={<Wrench className="w-3.5 h-3.5" />} label={t('caseDetail.toolCallsMetric')} value={String(metrics.toolCalls.length)} />
        </div>
      )}

      {/* Token breakdown */}
      {metrics.llmCalls > 0 && (
        <div className="mb-4 rounded-2xl border border-indigo/[0.08] bg-white/70 p-5 space-y-4">
          <h3 className="text-[13px] font-bold text-[var(--mist)]">{t('caseDetail.tokenBreakdown')}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label={t('caseDetail.inputTokens')} value={metrics.inputTokens.toLocaleString()} />
            <Stat label={t('caseDetail.outputTokens')} value={metrics.outputTokens.toLocaleString()} />
            <Stat label={t('caseDetail.cacheRead')} value={metrics.cacheReadTokens.toLocaleString()} sub={metrics.cacheReadTokens > 0 ? (
  (() => {
    // Warm rate: exclude cold-start iterations (cacheRead === 0) to show steady-state performance.
    // The per-iteration table shows full detail for each iteration.
    const warmInput = metrics.iterMetrics
      .filter(im => im.inputTokens > 0 && im.cacheReadTokens > 0)
      .reduce((s, im) => s + im.inputTokens + im.cacheReadTokens, 0)
    const warmCache = metrics.iterMetrics
      .filter(im => im.inputTokens > 0 && im.cacheReadTokens > 0)
      .reduce((s, im) => s + im.cacheReadTokens, 0)
    if (warmInput > 0 && warmCache > 0) {
      const warmRate = ((warmCache / warmInput) * 100).toFixed(0)
      return t('caseDetail.cacheHitRateWarm', { rate: warmRate })
    }
    return t('caseDetail.cacheHitRate', { rate: ((metrics.cacheReadTokens / Math.max(metrics.inputTokens + metrics.cacheReadTokens, 1)) * 100).toFixed(0) })
  })()) : undefined} />
            <Stat label={t('caseDetail.cacheWrite')} value={metrics.cacheWriteTokens.toLocaleString()} />
            <Stat label={t('caseDetail.avgTokensPerCall')} value={metrics.llmCalls > 0 ? (metrics.totalTokens / metrics.llmCalls).toFixed(0) : '0'} />
            <Stat label={t('caseDetail.avgOutputPerCall')} value={metrics.llmCalls > 0 ? (metrics.outputTokens / metrics.llmCalls).toFixed(0) : '0'} />
            <Stat label={t('caseDetail.tokensPerSec')} value={metrics.totalWallMs > 0 ? ((metrics.outputTokens / (metrics.totalWallMs / 1000))).toFixed(0) : '0'} />
          </div>
        </div>
      )}

      {/* Per-iteration metrics */}
      {metrics.iterMetrics.length > 0 && (
        <div className="mb-4 rounded-2xl border border-black/[0.06] bg-white/60 p-4">
          <h3 className="text-[13px] font-bold text-[var(--mist)] mb-3">{t('caseDetail.perIteration')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[var(--fog)]/60 border-b border-black/[0.06]">
                  <th className="pb-2 pr-3 font-medium">{t('caseDetail.iterCol')}</th>
                  <th className="pb-2 pr-3 font-medium">{t('caseDetail.modelCol')}</th>
                  <th className="pb-2 pr-3 font-medium text-right">{t('caseDetail.inputCol')}</th>
                  <th className="pb-2 pr-3 font-medium text-right">{t('caseDetail.outputCol')}</th>
                  <th className="pb-2 pr-3 font-medium text-right">{t('caseDetail.cacheCol')}</th>
                  <th className="pb-2 pr-3 font-medium text-right">{t('caseDetail.cacheRateCol')}</th>
                  <th className="pb-2 pr-3 font-medium text-right">{t('caseDetail.llmTimeCol')}</th>
                  <th className="pb-2 pr-3 font-medium text-right">{t('caseDetail.toolsTimeCol')}</th>
                  <th className="pb-2 pr-3 font-medium text-right">{t('caseDetail.skillsCol')}</th>
                </tr>
              </thead>
              <tbody>
                {metrics.iterMetrics.map((im) => (
                  <tr key={im.iteration} className="border-b border-black/[0.03] hover:bg-black/[0.01]">
                    <td className="py-2 pr-3 font-mono text-indigo">{`#${im.iteration}`}</td>
                    <td className="py-2 pr-3 text-[var(--fog)]/70 max-w-[120px] truncate">{im.model || '-'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{im.inputTokens.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{im.outputTokens.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{im.cacheReadTokens > 0 ? im.cacheReadTokens.toLocaleString() : '-'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{im.cacheReadTokens > 0 ? `${((im.cacheReadTokens / Math.max(im.inputTokens + im.cacheReadTokens, 1)) * 100).toFixed(0)}%` : '-'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{im.llmWallMs > 0 ? fmtMs(im.llmWallMs) : '-'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{im.toolsWallMs > 0 ? fmtMs(im.toolsWallMs) : '-'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{im.toolCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tool calls with I/O */}
      {metrics.toolCalls.length > 0 && (
        <div className="mb-4 rounded-2xl border border-black/[0.06] bg-white/60 p-4">
          <h3 className="text-[13px] font-bold text-[var(--mist)] mb-3">{t('caseDetail.toolCalls', { n: metrics.toolCalls.length })}</h3>
          <div className="space-y-2">
            {metrics.toolCalls.map((tc, i) => (
              <ToolCallCard key={i} toolCall={tc} t={t as any} />
            ))}
          </div>
        </div>
      )}

      {/* Trace timeline */}
      {traces.length > 0 && (
        <div className="mb-4 rounded-2xl border border-black/[0.06] bg-white/60 p-4">
          <button onClick={() => setShowTraces(!showTraces)}
            className="flex items-center gap-2 w-full text-left mb-2">
            <ChevronDown className={`h-4 w-4 text-[var(--fog)]/60 transition-transform ${showTraces ? '' : '-rotate-90'}`} />
            <h3 className="text-[13px] font-bold text-[var(--mist)]">{t('caseDetail.timelineSection')} ({traces.length})</h3>
          </button>
          {showTraces && (
            <div className="max-h-[500px] overflow-auto">
              <CaseTraceTimeline traces={traces} t={t as any} />
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      {messages.length > 0 && (
        <div className="mb-4 rounded-2xl border border-black/[0.06] bg-white/60 p-4">
          <button onClick={() => setShowMessages(!showMessages)}
            className="flex items-center gap-2 w-full text-left mb-2">
            <ChevronDown className={`h-4 w-4 text-[var(--fog)]/60 transition-transform ${showMessages ? '' : '-rotate-90'}`} />
            <h3 className="text-[13px] font-bold text-[var(--mist)]">{t('caseDetail.messages', { n: messages.length })}</h3>
          </button>
          {showMessages && (
            <div className="space-y-3 max-h-[400px] overflow-auto">
              {messages.map((m) => (
                <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`mt-0.5 h-6 w-6 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                    m.role === 'user' ? 'bg-indigo/20 text-indigo' : 'bg-black/[0.04] text-[var(--fog)]'
                  }`}>
                    {m.role === 'user' ? 'U' : 'A'}
                  </div>
                  <div className={`min-w-0 max-w-[80%] rounded-xl px-3 py-2 text-[12px] leading-relaxed ${
                    m.role === 'user' ? 'bg-indigo/[0.06]' : 'bg-white/80 border border-black/[0.05]'
                  }`}>
                    {m.content.startsWith('Tool ') ? (
                      <pre className="whitespace-pre-wrap break-words text-[10px] font-mono text-[var(--fog)]">{m.content}</pre>
                    ) : (
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    )}
                    <span className="block mt-1 text-[9px] text-[var(--fog)]/50">{fmtTime(m.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToolCallCard({ toolCall: tc, t }: { toolCall: ToolCall; t: (key: string, vars?: Record<string, unknown>) => string }) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className="rounded-lg border border-black/[0.04] bg-white/40 overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-black/[0.01] transition-colors">
        <Wrench className="h-3 w-3 text-[var(--fog)]/60" />
        <span className="text-[12px] font-medium text-[var(--mist)]">{tc.name}</span>
        {tc.latencyMs != null && (
          <span className="text-[10px] text-[var(--fog)]/50 ml-auto">{fmtMs(tc.latencyMs)}</span>
        )}
        <ChevronDown className={`h-3 w-3 text-[var(--fog)]/40 transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </button>
      {expanded && (
        <div className="border-t border-black/[0.04] px-3 py-2 space-y-2 text-[11px]">
          {tc.input && (
            <div>
              <span className="text-[var(--fog)]/60 font-medium">{t('caseDetail.toolInput')}:</span>
              <pre className="mt-0.5 whitespace-pre-wrap break-words text-[10px] font-mono bg-black/[0.02] rounded p-2 max-h-[200px] overflow-auto">
                {JSON.stringify(tc.input, null, 2)}
              </pre>
            </div>
          )}
          {tc.output && (
            <div>
              <span className="text-[var(--fog)]/60 font-medium">{t('caseDetail.toolOutput')}:</span>
              <pre className="mt-0.5 whitespace-pre-wrap break-words text-[10px] font-mono bg-black/[0.02] rounded p-2 max-h-[200px] overflow-auto">
                {JSON.stringify(tc.output, null, 2)}
              </pre>
            </div>
          )}
          <span className="text-[9px] text-[var(--fog)]/40">{fmtTime(tc.createdAt)}</span>
        </div>
      )}
    </div>
  )
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-black/[0.05] bg-white/60 px-3 py-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo/[0.08] text-indigo">{icon}</div>
      <div>
        <p className="text-[10px] text-[var(--fog)]">{label}</p>
        <p className="text-[13px] font-semibold text-[var(--mist)]">{value}</p>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-black/[0.04] bg-white/40 px-3 py-2">
      <p className="text-[10px] text-[var(--fog)]">{label}</p>
      <p className="text-[14px] font-semibold text-[var(--mist)]">{value}</p>
      {sub && <p className="text-[10px] text-teal-500">{sub}</p>}
    </div>
  )
}

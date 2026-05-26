'use client'

import { useState, useEffect, useMemo, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  MessageSquare,
  User,
  Bot,
  Trash2,
  BarChart3,
  Clock,
  Zap,
  Cpu,
} from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import ExportButton from '@/components/ui/export-button'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
// Trace timeline rendered inline below
import { useConsoleLocale } from '@/components/locale-provider'

interface MsgItem {
  id: string; role: string; content: string; createdAt: string
  caseId: string; caseType?: string; caseStatus?: string
}

interface CaseSummary {
  id: string; type: string; status: string; goal: string | null
  createdAt: string; updatedAt: string
  _count?: { messages: number }
}

interface ChatSession {
  chatId: string; userId: string; cases: CaseSummary[]
  messageCount: number; lastActivity: string; hasHumanTask: boolean
}

interface TraceItem {
  id: string; actionType: string; title: string; detail: string | null
  payload: string | null; createdAt: string; caseId: string
}

interface Metrics {
  totalTokens: number; inputTokens: number; outputTokens: number
  cacheReadTokens: number; cacheWriteTokens: number; compactTokens: number
  turnWallMs: number; toolPhaseMs: number; llmCalls: number
}

const STATUS_COLOR: Record<string, string> = {
  created: '#a09888', collecting: '#5b8af7', investigating: '#6366f1',
  waiting_human: '#d4912e', resolved: '#2ea04a', escalated: '#e64539',
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function CasePill({ caseItem }: { caseItem: CaseSummary }) {
  const color = STATUS_COLOR[caseItem.status] ?? '#a09888'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold"
      style={{ borderColor: `${color}44`, color, background: `${color}0f` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {caseItem.type.replace(/_/g, ' ')}
      <span className="opacity-60">#{caseItem.id.slice(0, 8)}</span>
    </span>
  )
}

function MessageRow({ msg }: { msg: MsgItem }) {
  const isUser = msg.role === 'user'
  const isToolResult = msg.content.startsWith('Tool ') && msg.role === 'assistant'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ${
        isUser ? 'bg-indigo/80' : 'bg-[var(--surface)] border border-black/[0.06]'}`}>
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5 text-indigo/60" />}
      </div>
      <div className={`min-w-0 max-w-[72%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser ? 'bg-indigo/[0.12] text-[var(--mist)] rounded-tr-sm'
          : isToolResult ? 'bg-black/[0.04] font-mono text-[11px] text-[var(--fog)] rounded-tl-sm border border-black/[0.05]'
          : 'bg-white/80 text-[var(--mist)] shadow-[var(--shadow-card)] rounded-tl-sm border border-black/[0.06]'}`}>
          {isToolResult ? <pre className="whitespace-pre-wrap break-words">{msg.content}</pre>
          : <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>}
        </div>
        <span className="text-[10px] text-[var(--fog)]/60">{fmtTime(msg.createdAt)}</span>
      </div>
    </div>
  )
}

function computeMetrics(traces: TraceItem[]): Metrics {
  const m: Metrics = {
    totalTokens: 0, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, compactTokens: 0,
    turnWallMs: 0, toolPhaseMs: 0, llmCalls: 0,
  }
  let firstTs: number | null = null
  let lastTs: number | null = null

  for (const t of traces) {
    const ts = new Date(t.createdAt).getTime()
    if (firstTs == null || ts < firstTs) firstTs = ts
    if (lastTs == null || ts > lastTs) lastTs = ts

    if (t.actionType === 'llm_response' && t.payload) {
      try {
        const p = JSON.parse(t.payload) as Record<string, unknown>
        const usage = (p.usage ?? {}) as Record<string, number>
        m.inputTokens += usage.input_tokens ?? usage.inputTokens ?? 0
        m.outputTokens += usage.output_tokens ?? usage.outputTokens ?? 0
        m.cacheReadTokens += usage.cache_read_input_tokens ?? 0
        m.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0
        m.compactTokens += (p as Record<string, number>).compactTokens ?? 0
        m.totalTokens += (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
        m.llmCalls++
      } catch { /* skip malformed */ }
    }
    if (t.actionType === 'loop_decision' && t.payload) {
      try {
        const p = JSON.parse(t.payload) as Record<string, unknown>
        m.toolPhaseMs += (p.toolPhaseMs as number) ?? 0
      } catch { /* skip */ }
    }
  }
  if (firstTs && lastTs) m.turnWallMs = lastTs - firstTs
  return m
}

export default function ChatDetailPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = use(params)
  const decodedChatId = decodeURIComponent(chatId)
  const router = useRouter()

  const [session, setSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<MsgItem[]>([])
  const [traces, setTraces] = useState<TraceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showTraces, setShowTraces] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const metrics = useMemo(() => computeMetrics(traces), [traces])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [sessRes, tracesRes] = await Promise.all([
          fetch('/api/chats?limit=200'),
          fetch(`/api/chats/${encodeURIComponent(decodedChatId)}/traces?limit=200`),
        ])
        const sessData = (await sessRes.json()) as { sessions: ChatSession[] }
        const found = sessData.sessions.find((s) => s.chatId === decodedChatId)
        if (!found) { setLoading(false); return }
        setSession(found)

        const tracesData = (await tracesRes.json()) as { traces: TraceItem[] }
        setTraces(tracesData.traces ?? [])

        const msgArrays = await Promise.all(
          found.cases.map(async (c) => {
            const r = await fetch(`/api/cases/${c.id}/messages?limit=200`)
            if (!r.ok) return []
            const d = (await r.json()) as { messages: { id: string; role: string; content: string; createdAt: string }[] }
            return d.messages.map((m) => ({ ...m, caseId: c.id, caseType: c.type, caseStatus: c.status }))
          }),
        )
        setMessages(msgArrays.flat().sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()))
      } catch (e) { console.error('Chat load failed:', e) }
      finally { setLoading(false) }
    }
    load()
  }, [decodedChatId])

  type Row = { type: 'msg'; msg: MsgItem } | { type: 'case_banner'; c: CaseSummary }
  const rows: Row[] = []
  let lastCaseId = ''
  for (const msg of messages) {
    if (msg.caseId !== lastCaseId) {
      const c = session?.cases.find((x) => x.id === msg.caseId)
      if (c) rows.push({ type: 'case_banner', c })
      lastCaseId = msg.caseId
    }
    rows.push({ type: 'msg', msg })
  }

  async function handleDelete() {
    if (!session) return
    if (!confirm(`Delete chat ${decodedChatId.slice(0, 16)}… and all ${session.cases.length} case(s)?`)) return
    setDeleting(true)
    try {
      await fetch(`/api/chats/${encodeURIComponent(decodedChatId)}`, { method: 'DELETE' })
      router.push('/ops/chats')
    } catch { alert('Delete failed'); setDeleting(false) }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[960px] flex-col px-4 py-4 sm:px-6">
      {/* Toolbar */}
      <header className="sticky top-0 z-30 mb-4 flex flex-shrink-0 items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white/55 px-4 py-3 shadow-[var(--shadow-card)] backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => router.push('/ops/chats')}
            className="console-btn-icon-square" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-semibold tracking-tight text-[var(--mist)]">
              Chat · {session?.userId ?? decodedChatId.slice(0, 16) + '…'}
            </h1>
            {session && (
              <p className="mt-0.5 text-[11px] text-[var(--fog)]/70">
                {session.cases.length} case{session.cases.length !== 1 ? 's' : ''} · {session.messageCount} msgs · {traces.length} traces
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {session?.cases.map((c) => <CasePill key={c.id} caseItem={c} />)}
          {!loading && session && (
            <>
              <ExportButton filename={`chat-${decodedChatId.slice(0, 8)}`} label="Export"
                getData={() => ({ session, messages, traces, exportedAt: new Date().toISOString() })} />
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--fog)]/50 hover:text-[var(--vermillion)] transition-colors">
                {deleting ? <OrganicLoader icon="spin" size={14} className="text-[var(--vermillion)]" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Metrics bar + Analysis toggle */}
      <div className="mb-4 space-y-3">
        {metrics.llmCalls > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard icon={<Cpu className="w-3.5 h-3.5" />} label="LLM Calls" value={String(metrics.llmCalls)} />
            <MetricCard icon={<Zap className="w-3.5 h-3.5" />} label="Tokens" value={(metrics.totalTokens / 1000).toFixed(1) + 'K'} />
            <MetricCard icon={<Clock className="w-3.5 h-3.5" />} label="Wall Time" value={fmtMs(metrics.turnWallMs)} />
            <MetricCard icon={<BarChart3 className="w-3.5 h-3.5" />} label="Tool Phase" value={fmtMs(metrics.toolPhaseMs)} />
          </div>
        )}
        <div className="flex justify-end gap-2">
          {traces.length > 0 && (
            <button onClick={() => setShowTraces(!showTraces)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-black/[0.06] bg-white/60 hover:bg-white transition-colors">
              <BarChart3 className="w-3.5 h-3.5" />
              {showTraces ? 'Hide Trace' : `Traces (${traces.length})`}
            </button>
          )}
          {metrics.llmCalls > 0 && (
            <button onClick={() => setShowAnalysis(!showAnalysis)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-indigo/20 bg-indigo/[0.04] hover:bg-indigo/[0.08] transition-colors text-indigo">
              <Zap className="w-3.5 h-3.5" />
              {showAnalysis ? 'Hide Analysis' : 'Analysis'}
            </button>
          )}
        </div>
      </div>

      {/* Analysis panel */}
      {showAnalysis && metrics.llmCalls > 0 && (
        <div className="mb-4 rounded-2xl border border-indigo/[0.08] bg-white/70 p-5 space-y-4">
          <h3 className="text-[13px] font-bold text-[var(--mist)]">Token & Timing Analysis</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <AnalysisStat label="Input Tokens" value={metrics.inputTokens.toLocaleString()} />
            <AnalysisStat label="Output Tokens" value={metrics.outputTokens.toLocaleString()} />
            <AnalysisStat label="Cache Read" value={metrics.cacheReadTokens.toLocaleString()} sub={metrics.cacheReadTokens > 0 ? `${((metrics.cacheReadTokens / Math.max(metrics.totalTokens, 1)) * 100).toFixed(0)}% hit` : undefined} />
            <AnalysisStat label="Cache Write" value={metrics.cacheWriteTokens.toLocaleString()} />
            {metrics.compactTokens > 0 && (
              <AnalysisStat label="Compact Tokens" value={metrics.compactTokens.toLocaleString()} />
            )}
            <AnalysisStat label="Avg Tokens/Call" value={metrics.llmCalls > 0 ? (metrics.totalTokens / metrics.llmCalls).toFixed(0) : '0'} />
            <AnalysisStat label="Avg Output/Call" value={metrics.llmCalls > 0 ? (metrics.outputTokens / metrics.llmCalls).toFixed(0) : '0'} />
            <AnalysisStat label="Tokens/sec" value={metrics.turnWallMs > 0 ? ((metrics.outputTokens / (metrics.turnWallMs / 1000))).toFixed(0) : '0'} />
          </div>
          {session && (
            <div className="pt-2 border-t border-black/[0.04]">
              <h4 className="text-[11px] font-semibold text-[var(--fog)] mb-2">Per-Case Summary</h4>
              <div className="space-y-1.5">
                {session.cases.map((c) => {
                  const caseTraces = traces.filter((t) => t.caseId === c.id)
                  const caseSkills = caseTraces.filter((t) => t.actionType === 'skill_called').length
                  return (
                    <div key={c.id} className="flex items-center gap-2 text-[11px]">
                      <span className="w-16 text-[var(--fog)]/50">{c.id.slice(0, 8)}</span>
                      <span className="text-[var(--mist)]">{c.type.replace(/_/g, ' ')}</span>
                      <span className="text-[var(--fog)]/50">· {caseTraces.length} traces · {caseSkills} skills</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Trace timeline */}
      {showTraces && traces.length > 0 && (
        <div className="mb-4 rounded-2xl border border-black/[0.06] bg-white/60 p-4 max-h-[400px] overflow-auto">
          <TraceList traces={traces} />
        </div>
      )}

      {/* Messages */}
      <main className="flex-1 overflow-y-auto rounded-2xl border border-black/[0.06] bg-gradient-to-br from-white/60 to-white/30 p-4 shadow-[var(--shadow-card)] backdrop-blur-xl">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <OrganicLoader icon="spin" size={28} className="text-indigo/60" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-[var(--fog)]">
            <MessageSquare className="mb-2 h-8 w-8 opacity-20" strokeWidth={1} />
            <p className="text-[13px]">No messages</p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((row, i) => {
              if (row.type === 'case_banner') {
                return (
                  <div key={`banner-${row.c.id}`} className="flex items-center gap-3 py-2">
                    <div className="h-px flex-1 bg-black/[0.06]" />
                    <CasePill caseItem={row.c} />
                    <div className="h-px flex-1 bg-black/[0.06]" />
                  </div>
                )
              }
              return <MessageRow key={row.msg.id} msg={row.msg} />
            })}
          </div>
        )}
      </main>
    </div>
  )
}

function TraceList({ traces }: { traces: TraceItem[] }) {
  const ACTION_COLORS: Record<string, string> = {
    user_message: '#6366f1', case_created: '#2ea04a', skill_called: '#5b8af7',
    skill_result: '#14b8a6', human_task_created: '#d4912e', final_resolution: '#2ea04a',
    llm_request_start: '#8b6ff5', llm_response: '#8b6ff5', error: '#e64539',
    escalated: '#e64539', loop_decision: '#a09888',
    queue_message_enqueued: '#f0b050', queue_message_consumed: '#f0b050',
    agent_tree_node: '#7c3aed',
  }
  return (
    <div className="space-y-1">
      {traces.slice().reverse().map((t) => (
        <div key={t.id} className="flex items-start gap-2 py-1.5 text-[11px]">
          <span className="mt-0.5 h-1.5 w-1.5 rounded-full flex-shrink-0"
            style={{ background: ACTION_COLORS[t.actionType] ?? '#a09888' }} />
          <span className="text-[var(--fog)]/50 w-14 flex-shrink-0">{fmtTime(t.createdAt)}</span>
          <span className="text-[var(--fog)] w-28 flex-shrink-0 truncate">{t.actionType}</span>
          <span className="text-[var(--mist)] truncate">{t.title}</span>
          {t.detail && <span className="text-[var(--fog)]/50 truncate ml-1">{t.detail}</span>}
        </div>
      ))}
    </div>
  )
}

function AnalysisStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-black/[0.04] bg-white/40 px-3 py-2">
      <p className="text-[10px] text-[var(--fog)]">{label}</p>
      <p className="text-[14px] font-semibold text-[var(--mist)]">{value}</p>
      {sub && <p className="text-[10px] text-teal-500">{sub}</p>}
    </div>
  )
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-black/[0.05] bg-white/60 px-3 py-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo/[0.08] text-indigo">
        {icon}
      </div>
      <div>
        <p className="text-[10px] text-[var(--fog)]">{label}</p>
        <p className="text-[13px] font-semibold text-[var(--mist)]">{value}</p>
      </div>
    </div>
  )
}

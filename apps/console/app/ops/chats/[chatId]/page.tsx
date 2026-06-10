'use client'

import { useState, useEffect, useMemo, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  MessageSquare,
  User,
  Bot,
  Trash2,
  BarChart3,
  Clock,
  Zap,
  Cpu,
  ChevronDown,
} from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import ExportButton from '@/components/ui/export-button'
import MessageContent from '@/components/chat/message-content'
import { ConsoleBackButton } from '@/components/ui/console-chrome'
import { apiClient } from '@/lib/api/client'
import type { ChatsListResponse, ChatDeleteResponse } from '@intera/shared/contracts/chats'

interface MsgItem {
  id: string; role: string; content: string; createdAt: string
  caseId: string; caseType?: string; caseStatus?: string
}

interface CaseSummary {
  id: string; type: string; status: string; goal: string | null
  createdAt: string; updatedAt: string
  _count?: { messages: number }
}

function normalizeTraceActionType(actionType: string): string {
  return actionType
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
          <MessageContent content={msg.content} />
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
  }
  if (firstTs && lastTs && m.turnWallMs === 0) m.turnWallMs = lastTs - firstTs
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
  const [showMemory, setShowMemory] = useState(false)
  const [memoryData, setMemoryData] = useState<any>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [compactResult, setCompactResult] = useState<any>(null)
  const [compacting, setCompacting] = useState(false)
  const [profileResult, setProfileResult] = useState<any>(null)
  const [updatingProfile, setUpdatingProfile] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadMemory = async () => {
    setMemoryLoading(true)
    try {
      const r = await apiClient(`/api/chats/${encodeURIComponent(decodedChatId)}/memory`)
      setMemoryData(r.data)
    } catch { /* ignore */ }
    finally { setMemoryLoading(false) }
  }
  const toggleMemory = () => {
    const next = !showMemory
    setShowMemory(next)
    if (next && !memoryData) loadMemory()
  }
  const handleCompact = async () => {
    setCompacting(true)
    setCompactResult(null)
    try {
      const r = await apiClient(`/api/chats/${encodeURIComponent(decodedChatId)}/compact`, { method: 'POST' })
      setCompactResult(r.data)
      loadMemory()
    } catch { setCompactResult({ error: 'Compact failed' }) }
    finally { setCompacting(false) }
  }
  const handleUpdateProfile = async () => {
    setUpdatingProfile(true)
    setProfileResult(null)
    try {
      const r = await apiClient(`/api/chats/${encodeURIComponent(decodedChatId)}/update-profile`, { method: 'POST' })
      setProfileResult(r.data)
    } catch { setProfileResult({ error: 'Update failed' }) }
    finally { setUpdatingProfile(false) }
  }

  const metrics = useMemo(() => computeMetrics(traces), [traces])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [sessResult, tracesResult] = await Promise.all([
          apiClient<ChatsListResponse>('/api/chats?limit=200'),
          apiClient<{ traces: TraceItem[] }>(`/api/chats/${encodeURIComponent(decodedChatId)}/traces?limit=200`),
        ])
        const found = sessResult.data.sessions.find((s) => s.chatId === decodedChatId)
        if (!found) { setLoading(false); return }
        setSession(found)

        setTraces(tracesResult.data.traces ?? [])

        const msgArrays = await Promise.all(
          found.cases.map(async (c) => {
            try {
              const r = await apiClient<{ messages: { id: string; role: string; content: string; createdAt: string }[] }>(
                `/api/cases/${c.id}/messages?limit=200`,
              )
              return r.data.messages.map((m) => ({ ...m, caseId: c.id, caseType: c.type, caseStatus: c.status }))
            } catch {
              return []
            }
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
    if (!confirm(`Delete chat ${decodedChatId.slice(0, 16)}… and all ${session.cases.length} linked ProcedureRun(s)?`)) return
    setDeleting(true)
    try {
      await apiClient<ChatDeleteResponse>(`/api/chats/${encodeURIComponent(decodedChatId)}`, { method: 'DELETE' })
      router.push('/operate/conversations')
    } catch { alert('Delete failed'); setDeleting(false) }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[1320px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
      {/* Toolbar */}
      <header className="sticky top-0 z-30 rounded-[26px] border border-black/[0.06] bg-white/[0.68] px-4 py-4 shadow-[var(--shadow-card)] backdrop-blur-xl sm:px-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <ConsoleBackButton
                label="Conversations"
                ariaLabel="Back to conversations"
                onClick={() => router.push('/operate/conversations')}
              />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#357f7c]">Operate</p>
                <h1 className="truncate text-[16px] font-semibold tracking-tight text-[var(--mist)]">
                  Chat · {session?.userId ?? `${decodedChatId.slice(0, 16)}…`}
                </h1>
                {session ? (
                  <p className="mt-1 text-[12px] text-[var(--fog)]/80">
                    {session.cases.length} ProcedureRun{session.cases.length !== 1 ? 's' : ''} · {session.messageCount} msgs · {traces.length} traces
                  </p>
                ) : null}
              </div>
            </div>

            {!loading && session ? (
              <div className="flex flex-wrap items-center gap-2">
                {session.userId && (() => {
                  // UserProfile is keyed by a stable profileKey (user:<id> / chat:<chatId>),
                  // matching how the agent loop & compact write it. Link to that key.
                  const userKey = session.userId.trim()
                  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userKey)
                  const profileKey = (userKey && userKey !== 'anonymous' && !isUuid) ? `user:${userKey}` : `chat:${decodedChatId}`
                  return (
                    <Link
                      href={`/operate/handoff/${encodeURIComponent(profileKey)}`}
                      className="inline-flex items-center gap-1.5 rounded-[14px] border border-indigo/18 bg-indigo/[0.06] px-3 py-2 text-[12px] font-medium text-indigo transition-colors hover:bg-indigo/[0.1]"
                      title="Open this user's profile (cross-chat history & preferences)"
                    >
                      <User className="h-3.5 w-3.5" />
                      User
                    </Link>
                  )
                })()}
                <ExportButton
                  filename={`chat-${decodedChatId.slice(0, 8)}`}
                  label="Export"
                  getData={() => ({ session, messages, traces, exportedAt: new Date().toISOString() })}
                />
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[14px] border border-black/[0.06] bg-white/80 text-[var(--fog)]/60 transition-colors hover:border-[var(--vermillion)]/18 hover:bg-[var(--vermillion)]/[0.08] hover:text-[var(--vermillion)]"
                >
                  {deleting ? <OrganicLoader icon="spin" size={14} className="text-[var(--vermillion)]" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            ) : null}
          </div>

          {session?.cases.length ? (
            <div className="flex flex-wrap gap-2">
              {session.cases.map((caseItem) => (
                <div key={caseItem.id} className="flex items-center gap-1.5">
                  <CasePill caseItem={caseItem} />
                  <Link
                    href={`/operate/conversations/cases/${encodeURIComponent(caseItem.id)}`}
                    className="console-btn-icon-square h-8 w-8"
                    title="View ProcedureRun details"
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {/* Metrics bar + Analysis toggle */}
      <div className="space-y-3">
        {metrics.llmCalls > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard icon={<Cpu className="w-3.5 h-3.5" />} label="LLM Calls" value={String(metrics.llmCalls)} />
            <MetricCard icon={<Zap className="w-3.5 h-3.5" />} label="Tokens" value={(metrics.totalTokens / 1000).toFixed(1) + 'K'} />
            <MetricCard icon={<Clock className="w-3.5 h-3.5" />} label="Wall Time" value={fmtMs(metrics.turnWallMs)} />
            <MetricCard icon={<BarChart3 className="w-3.5 h-3.5" />} label="Tool Phase" value={fmtMs(metrics.toolPhaseMs)} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={toggleMemory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-teal/20 bg-teal/[0.04] hover:bg-teal/[0.08] transition-colors text-teal">
            <MessageSquare className="w-3.5 h-3.5" />
            {showMemory ? 'Hide Memory' : 'Memory'}
          </button>
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
              <h4 className="text-[11px] font-semibold text-[var(--fog)] mb-2">Per-ProcedureRun Summary</h4>
              <div className="space-y-1.5">
                {session.cases.map((c) => {
                  const caseTraces = traces.filter((t) => t.caseId === c.id)
                  const caseTools = caseTraces.filter((t) => normalizeTraceActionType(t.actionType) === 'tool_call').length
                  return (
                    <div key={c.id} className="flex items-center gap-2 text-[11px]">
                      <span className="w-16 text-[var(--fog)]/50">{c.id.slice(0, 8)}</span>
                      <span className="text-[var(--mist)]">{c.type.replace(/_/g, ' ')}</span>
                      <span className="text-[var(--fog)]/50">· {caseTraces.length} traces · {caseTools} tools</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Memory panel */}
      {showMemory && (
        <div className="mb-4 rounded-2xl border border-teal/[0.08] bg-white/70 p-5 space-y-4">
          {/* Header + action buttons */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-[13px] font-bold text-[var(--mist)]">Chat Memory</h3>
            <div className="flex gap-2 flex-wrap">
              {/* Compact Chat — generate a summary of this conversation */}
              <button onClick={handleCompact} disabled={compacting}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg border border-teal/20 bg-teal/[0.06] text-teal hover:bg-teal/[0.12] disabled:opacity-50"
                title="Generate a summary of this conversation">
                <Zap className="w-3 h-3" />
                {compacting ? 'Compacting…' : 'Compact Chat'}
              </button>
              {/* Update User Profile — merges chat summaries into the cross-chat UserProfile */}
              <button onClick={handleUpdateProfile} disabled={updatingProfile}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg border border-indigo/20 bg-indigo/[0.04] text-indigo hover:bg-indigo/[0.08] disabled:opacity-50"
                title="Merge this chat's summaries into the user's cross-chat profile">
                <User className="w-3 h-3" />
                {updatingProfile ? 'Updating…' : 'Update User Profile'}
              </button>
              {/* Link to full User Profile page */}
              {memoryData?.profile && (
                <Link href={`/operate/handoff/${encodeURIComponent(memoryData.profile.userId)}`}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg border border-black/[0.06] text-[var(--fog)] hover:text-[var(--mist)] hover:border-black/10">
                  <User className="w-3 h-3" /> View Profile →
                </Link>
              )}
            </div>
          </div>

          {/* Compact Chat result banner */}
          {compactResult && !compactResult.error && (
            <div className="rounded-xl border border-teal/10 bg-teal/[0.04] p-3 text-[11px] text-[var(--mist)]">
              ✓ Compact complete · Model: {compactResult.compactModel} · {compactResult.beforeChars?.toLocaleString()} → {compactResult.afterChars?.toLocaleString()} chars
              {!compactResult.summary && <span className="ml-2 text-amber">(no summary generated — conversation may be too short)</span>}
            </div>
          )}
          {compactResult?.error && (
            <div className="rounded-xl border border-vermillion/10 bg-vermillion/[0.04] p-3 text-[11px] text-vermillion">{compactResult.error}</div>
          )}

          {/* Update User Profile result banner */}
          {profileResult && !profileResult.error && (
            <div className="rounded-xl border border-indigo/10 bg-indigo/[0.04] p-3 text-[11px] text-[var(--mist)]">
              ✓ User Profile updated · {profileResult.memoriesMerged} summaries merged · Profile key: <code className="font-mono text-indigo/80">{profileResult.profileKey}</code>
            </div>
          )}
          {profileResult?.error && (
            <div className="rounded-xl border border-vermillion/10 bg-vermillion/[0.04] p-3 text-[11px] text-vermillion">{profileResult.error}</div>
          )}

          {memoryLoading ? (
            <div className="flex h-24 items-center justify-center">
              <OrganicLoader icon="spin" size={20} className="text-indigo/60" />
            </div>
          ) : memoryData ? (
            <>
              {/* Per-ProcedureRun working memory */}
              {memoryData.memories?.map((mem: any) => (
                <div key={mem.caseId} className="rounded-xl border border-black/[0.04] bg-white/40 p-3">
                  <p className="text-[10px] text-[var(--fog)]/50 mb-2">ProcedureRun {mem.caseId.slice(0, 8)}</p>
                  {mem.summary ? (
                    <div className="text-[11px] text-[var(--mist)] leading-relaxed max-h-[240px] overflow-auto">
                      <MessageContent content={mem.summary.slice(0, 3000)} />
                    </div>
                  ) : (
                    <p className="text-[11px] text-[var(--fog)]/50 italic">No summary yet — click "Compact Chat" to generate one.</p>
                  )}
                  <div className="mt-2 flex gap-3 text-[10px] text-[var(--fog)]/50">
                    <span>{(mem.toolsCalled?.length ?? 0)} tools</span>
                    <span>{Object.keys(mem.confirmedFacts ?? {}).length} facts</span>
                  </div>
                </div>
              ))}
              {(!memoryData.memories || memoryData.memories.length === 0) && (
                <p className="text-[12px] text-[var(--fog)]/50 py-4 text-center">No memory data for this chat yet.</p>
              )}

              {/* User Profile preview (cross-chat accumulation) */}
              {memoryData.profile?.profile && (
                <div className="rounded-xl border border-indigo/[0.08] bg-indigo/[0.03] p-3">
                  <p className="text-[10px] font-medium text-indigo/70 mb-2">User Profile (cross-chat)</p>
                  <div className="text-[11px] text-[var(--mist)] leading-relaxed max-h-[160px] overflow-auto">
                    <MessageContent content={memoryData.profile.profile.slice(0, 1500)} />
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Trace timeline */}
      {showTraces && traces.length > 0 && (
        <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.66] p-4 max-h-[400px] overflow-auto shadow-[var(--shadow-card)]">
          <TraceList traces={traces} />
        </div>
      )}

      {/* Messages */}
      <main className="flex-1 overflow-y-auto rounded-[26px] border border-black/[0.06] bg-gradient-to-br from-white/[0.72] to-white/[0.42] p-4 shadow-[var(--shadow-card)] backdrop-blur-xl">
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

const ACTION_COLORS: Record<string, string> = {
  user_message: '#6366f1', case_created: '#2ea04a', tool_call: '#5b8af7',
  tool_result: '#14b8a6', human_task_created: '#d4912e', final_resolution: '#2ea04a',
  llm_request_start: '#8b6ff5', llm_response: '#8b6ff5', error: '#e64539',
  escalated: '#e64539', loop_decision: '#a09888',
  queue_message_enqueued: '#f0b050', queue_message_consumed: '#f0b050',
  agent_tree_node: '#7c3aed',
}

const FILTER_KEYS = ['All', 'LLM', 'Tools', 'Hooks'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

const STORAGE_KEY = 'trace-viewer-filters'

function matchFilter(actionType: string, activeFilters: Set<string>): boolean {
  const normalizedActionType = normalizeTraceActionType(actionType)
  if (activeFilters.size === 0 || activeFilters.has('All')) return true
  if (activeFilters.has('LLM') && (normalizedActionType.startsWith('llm_') || normalizedActionType === 'stream_event')) return true
  if (activeFilters.has('Tools') && normalizedActionType.startsWith('tool_')) return true
  if (activeFilters.has('Hooks') && (normalizedActionType === 'hook_hit' || normalizedActionType === 'loop_decision')) return true
  return false
}

function parseIteration(trace: TraceItem): number | null {
  // Check payload first, then detail as fallback
  for (const raw of [trace.payload, trace.detail]) {
    if (!raw) continue
    try {
      const p = JSON.parse(raw)
      if (typeof p.iteration === 'number') return p.iteration as number
    } catch { /* skip */ }
  }
  return null
}

function TraceList({ traces }: { traces: TraceItem[] }) {
  const [expandedIterations, setExpandedIterations] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return new Set(JSON.parse(stored) as string[])
    } catch { /* empty */ }
    return new Set(['All'])
  })

  // Persist filter selection
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...filters]))
  }, [filters])

  const toggleFilter = (key: string) => {
    setFilters((prev) => {
      const next = new Set(prev)
      if (key === 'All') {
        if (prev.has('All')) return new Set()
        return new Set(['All'])
      }
      next.delete('All')
      if (prev.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Filter and group by iteration
  const { groups, unassigned } = useMemo(() => {
    const filtered = traces.filter((t) => matchFilter(t.actionType, filters))

    const g = new Map<number, TraceItem[]>()
    const u: TraceItem[] = []

    for (const t of filtered) {
      const iter = parseIteration(t)
      if (iter != null) {
        if (!g.has(iter)) g.set(iter, [])
        g.get(iter)!.push(t)
      } else {
        u.push(t)
      }
    }

    return { groups: g, unassigned: u }
  }, [traces, filters])

  // Initialize expanded state: latest iteration expanded, others collapsed
  const sortedIterations = useMemo(() => Array.from(groups.keys()).sort((a, b) => a - b), [groups])
  useEffect(() => {
    const init = new Set<string>()
    init.add('Initial')
    if (sortedIterations.length > 0) init.add(`Iteration ${sortedIterations[sortedIterations.length - 1]}`)
    setExpandedIterations(init)
  }, [sortedIterations])

  const toggleExpanded = (key: string) => {
    setExpandedIterations((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const totalFiltered = unassigned.length + sortedIterations.reduce((s, i) => s + (groups.get(i)?.length ?? 0), 0)

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-black/[0.06]">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--smoke)] mr-1">Filter:</span>
        {FILTER_KEYS.map((k) => {
          const active = filters.has(k) || (k === 'All' && filters.size === 0)
          return (
            <button
              key={k}
              onClick={() => toggleFilter(k)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                active
                  ? 'bg-indigo/[0.08] border-indigo/30 text-indigo font-medium'
                  : 'border-black/[0.06] text-[var(--fog)]/60 hover:border-black/[0.12]'
              }`}
            >
              {k}
            </button>
          )
        })}
        <span className="text-[10px] text-[var(--fog)]/40 ml-1">{totalFiltered} traces</span>
      </div>

      {/* Initial group (traces without iteration) */}
      {unassigned.length > 0 && (
        <div className="rounded-lg border border-black/[0.06] overflow-hidden">
          <button
            type="button"
            onClick={() => toggleExpanded('Initial')}
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-black/[0.02] transition-colors"
          >
            <ChevronDown
              className={`h-3 w-3 text-[var(--fog)]/60 transition-transform ${expandedIterations.has('Initial') ? '' : '-rotate-90'}`}
            />
            <span className="text-[11px] font-semibold text-[var(--fog)]">Initial</span>
            <span className="text-[10px] text-[var(--fog)]/40">{unassigned.length} traces</span>
          </button>
          {expandedIterations.has('Initial') && (
            <div className="border-t border-black/[0.04]">
              {unassigned.map((t) => {
                const actionType = normalizeTraceActionType(t.actionType)
                return (
                  <div key={t.id} className="flex flex-col gap-1.5 border-b border-black/[0.02] px-3 py-2 text-[11px] last:border-b-0 sm:flex-row sm:items-start sm:gap-2">
                    <span className="mt-0.5 h-1.5 w-1.5 rounded-full flex-shrink-0"
                      style={{ background: ACTION_COLORS[actionType] ?? '#a09888' }} />
                    <span className="text-[var(--fog)]/50 sm:w-14 sm:flex-shrink-0">{fmtTime(t.createdAt)}</span>
                    <span className="text-[var(--fog)] sm:w-28 sm:flex-shrink-0">{actionType}</span>
                    <span className="text-[var(--mist)] break-words">{t.title}</span>
                    {t.detail && <span className="text-[var(--fog)]/50 break-words sm:ml-1">{t.detail}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Iteration groups */}
      {sortedIterations.map((iter) => {
        const group = groups.get(iter)!
        const key = `Iteration ${iter}`
        return (
          <div key={key} className="rounded-lg border border-indigo/[0.08] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleExpanded(key)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-indigo/[0.02] transition-colors"
            >
              <ChevronDown
                className={`h-3 w-3 text-indigo/60 transition-transform ${expandedIterations.has(key) ? '' : '-rotate-90'}`}
              />
              <span className="text-[11px] font-semibold text-indigo/80">{key}</span>
              <span className="text-[10px] text-[var(--fog)]/40">{group.length} traces</span>
            </button>
            {expandedIterations.has(key) && (
              <div className="border-t border-indigo/[0.06]">
                {group.map((t) => {
                  const actionType = normalizeTraceActionType(t.actionType)
                  return (
                    <div key={t.id} className="flex flex-col gap-1.5 border-b border-black/[0.02] px-3 py-2 text-[11px] last:border-b-0 sm:flex-row sm:items-start sm:gap-2">
                      <span className="mt-0.5 h-1.5 w-1.5 rounded-full flex-shrink-0"
                        style={{ background: ACTION_COLORS[actionType] ?? '#a09888' }} />
                      <span className="text-[var(--fog)]/50 sm:w-14 sm:flex-shrink-0">{fmtTime(t.createdAt)}</span>
                      <span className="text-[var(--fog)] sm:w-28 sm:flex-shrink-0">{actionType}</span>
                      <span className="text-[var(--mist)] break-words">{t.title}</span>
                      {t.detail && <span className="text-[var(--fog)]/50 break-words sm:ml-1">{t.detail}</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          )
      })}

      {totalFiltered === 0 && (
        <p className="text-center text-[12px] text-[var(--fog)]/50 py-6">No traces match the selected filters.</p>
      )}
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

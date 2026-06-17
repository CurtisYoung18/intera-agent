'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
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
} from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import ExportButton from '@/components/ui/export-button'
import MessageContent from '@/components/chat/message-content'
import { CaseTraceTimeline } from '@/components/ops/case-trace-view'
import SourceTruthPill from '@/components/operate/source-truth-pill'
import { useConsoleLocale } from '@/components/locale-provider'
import { ConsoleBackButton } from '@/components/ui/console-chrome'
import { apiClient } from '@/lib/api/client'
import { useAgentContext } from '@/lib/agent/agent-context'
import { computeConversationMetrics } from '@/components/operate/conversation-metrics'
import {
  summarizeConversationSourceTruth,
  summarizeToolPairing,
} from '@/lib/operate/runtime-truth'
import type { ChatDeleteResponse } from '@intera/shared/contracts/chats'
import type { ContentBlock } from '@intera/shared/types'

interface MsgItem {
  id: string; role: string; content: string; createdAt: string
  contentBlocks?: ContentBlock[]
  runId?: string | null; procedureType?: string; procedureStatus?: string
}

interface CaseSummary {
  id: string; runId?: string | null; type: string; status: string; source: string; goal: string | null
  createdAt: string; updatedAt: string
  _count?: { messages: number }
}

function normalizeTraceActionType(actionType: string): string {
  return actionType
}

interface ChatSession {
  chatId: string; userId: string; cases: CaseSummary[]
  messageCount: number; lastActivity: string; hasHumanTask: boolean
  externalChatId?: string | null
}

interface TraceItem {
  id: string; actionType: string; title: string; detail: string | null
  payload: string | null; createdAt: string; runId?: string | null
}

const STATUS_COLOR: Record<string, string> = {
  created: '#a09888', collecting: '#5b8af7', investigating: '#6366f1',
  waiting_human: '#d4912e', resolved: '#2ea04a', escalated: '#e64539',
}

const STATUS_LABEL_ZH: Record<string, string> = {
  created: '已创建', collecting: '收集中', investigating: '排查中',
  waiting_human: '等待人工', resolved: '已解决', escalated: '已升级',
}

function statusLabel(status: string, isZh: boolean): string {
  if (isZh) return STATUS_LABEL_ZH[status] ?? status.replace(/_/g, ' ')
  return status.replace(/_/g, ' ')
}

function fmtTime(iso: string, locale: 'en' | 'zh'): string {
  return new Date(iso).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
      {caseItem.runId ? <span className="opacity-60">#{caseItem.runId.slice(0, 8)}</span> : null}
    </span>
  )
}

function MessageRow({ msg, locale }: { msg: MsgItem; locale: 'en' | 'zh' }) {
  const isUser = msg.role === 'user'
  const isToolResult = msg.content.startsWith('Tool ') && msg.role === 'assistant'
  const roleLabel = msg.role === 'user'
    ? (locale === 'zh' ? '用户' : 'User')
    : msg.role === 'system'
      ? (locale === 'zh' ? '系统' : 'System')
      : (locale === 'zh' ? '助手' : 'Assistant')
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ${
        isUser ? 'bg-indigo/80' : 'bg-[var(--surface)] border border-black/[0.06]'}`}>
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5 text-indigo/60" />}
      </div>
      <div className={`min-w-0 max-w-[72%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <span className="text-[11px] font-semibold text-[var(--fog)]/55">{roleLabel}</span>
        <div className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser ? 'bg-indigo/[0.12] text-[var(--mist)] rounded-tr-sm'
          : isToolResult ? 'bg-black/[0.04] font-mono text-[11px] text-[var(--fog)] rounded-tl-sm border border-black/[0.05]'
          : 'bg-white/80 text-[var(--mist)] shadow-[var(--shadow-card)] rounded-tl-sm border border-black/[0.06]'}`}>
          <MessageContent content={msg.content} contentBlocks={msg.contentBlocks} imagePreviewMode="auto" />
        </div>
        <span className="text-[10px] text-[var(--fog)]/60">{fmtTime(msg.createdAt, locale)}</span>
      </div>
    </div>
  )
}

type DetailTab = 'timeline' | 'memory'

export default function ConversationDetailWorkspace({ chatId }: { chatId: string }) {
  const decodedChatId = decodeURIComponent(chatId)
  const router = useRouter()
  const { t, locale } = useConsoleLocale()
  const { selectedAgentId, loading: agentLoading } = useAgentContext()
  const isZh = locale === 'zh'

  const [session, setSession] = useState<ChatSession | null>(null)
  const [resolvedChatId, setResolvedChatId] = useState(decodedChatId)
  const [messages, setMessages] = useState<MsgItem[]>([])
  const [traces, setTraces] = useState<TraceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<DetailTab | null>(null)
  const [memoryData, setMemoryData] = useState<any>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [compactResult, setCompactResult] = useState<any>(null)
  const [compacting, setCompacting] = useState(false)
  const [profileResult, setProfileResult] = useState<any>(null)
  const [updatingProfile, setUpdatingProfile] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const activeChatId = resolvedChatId || decodedChatId
  const withAgent = useCallback((path: string) => {
    if (!selectedAgentId) return path
    return `${path}${path.includes('?') ? '&' : '?'}agentId=${encodeURIComponent(selectedAgentId)}`
  }, [selectedAgentId])

  const loadMemory = async () => {
    setMemoryLoading(true)
    try {
      const r = await apiClient(withAgent(`/api/chats/${encodeURIComponent(activeChatId)}/memory`))
      setMemoryData(r.data)
    } catch { /* ignore */ }
    finally { setMemoryLoading(false) }
  }
  // Nav buttons toggle a detail panel between the overview and the transcript.
  const selectTab = (tab: DetailTab) => {
    setActiveTab((prev) => (prev === tab ? null : tab))
    if (tab === 'memory' && !memoryData && !memoryLoading) loadMemory()
  }
  const handleCompact = async () => {
    setCompacting(true)
    setCompactResult(null)
    try {
      const r = await apiClient(withAgent(`/api/chats/${encodeURIComponent(activeChatId)}/compact`), { method: 'POST' })
      setCompactResult(r.data)
      loadMemory()
    } catch { setCompactResult({ error: 'Compact failed' }) }
    finally { setCompacting(false) }
  }
  const handleUpdateProfile = async () => {
    setUpdatingProfile(true)
    setProfileResult(null)
    try {
      const r = await apiClient(withAgent(`/api/chats/${encodeURIComponent(activeChatId)}/update-profile`), { method: 'POST' })
      setProfileResult(r.data)
    } catch { setProfileResult({ error: 'Update failed' }) }
    finally { setUpdatingProfile(false) }
  }

  const metrics = useMemo(() => computeConversationMetrics(traces), [traces])
  const conversationTruth = useMemo(
    () =>
      summarizeConversationSourceTruth(
        (session?.cases ?? []).map((caseItem) => ({ source: caseItem.source, userId: session?.userId })),
      ),
    [session],
  )
  const toolPairing = useMemo(
    () =>
      summarizeToolPairing(
        traces.map((trace) => ({
          actionType: trace.actionType,
          title: trace.title,
          detail: trace.detail,
          payload: trace.payload,
        })),
      ),
    [traces],
  )
  const unassignedTraces = useMemo(() => {
    const knownRunIds = new Set((session?.cases.map((caseItem) => caseItem.runId).filter(Boolean) as string[]) ?? [])
    const unassigned: TraceItem[] = []

    for (const trace of traces) {
      if (!trace.runId || !knownRunIds.has(trace.runId)) {
        unassigned.push(trace)
        continue
      }
    }

    return unassigned
  }, [session, traces])
  const toolTraceCount = useMemo(
    () => traces.filter((trace) => normalizeTraceActionType(trace.actionType) === 'tool_result').length,
    [traces],
  )

  useEffect(() => {
    async function load() {
      if (agentLoading) return
      if (!selectedAgentId) {
        setSession(null)
        setMessages([])
        setTraces([])
        setLoading(false)
        return
      }
      setLoading(true)
      setSession(null)
      setMessages([])
      setTraces([])
      setMemoryData(null)
      try {
        const detail = await apiClient<{
          session: ChatSession
          requestedChatId: string
          resolvedChatId: string
          externalChatId?: string | null
        }>(withAgent(`/api/chats/${encodeURIComponent(decodedChatId)}`))
        const found = detail.data.session
        setSession(found)
        setResolvedChatId(detail.data.resolvedChatId || found.chatId)

        const canonicalChatId = detail.data.resolvedChatId || found.chatId
        const [tracesResult, msgResult] = await Promise.all([
          apiClient<{ traces: TraceItem[] }>(withAgent(`/api/chats/${encodeURIComponent(canonicalChatId)}/traces?limit=200`)),
          apiClient<{ messages: MsgItem[] }>(
            withAgent(`/api/chats/${encodeURIComponent(canonicalChatId)}/messages?limit=500`),
          ),
        ])
        setTraces(tracesResult.data.traces ?? [])
        setMessages((msgResult.data.messages ?? []).sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()))
      } catch (e) { console.error('Chat load failed:', e) }
      finally { setLoading(false) }
    }
    load()
  }, [agentLoading, decodedChatId, selectedAgentId, withAgent])

  type Row = { type: 'msg'; msg: MsgItem } | { type: 'case_banner'; c: CaseSummary }
  const rows: Row[] = []
  let lastRunId = ''
  for (const msg of messages) {
    const runId = msg.runId ?? ''
    if (runId !== lastRunId) {
      const c = session?.cases.find((x) => x.runId === runId)
      if (c) rows.push({ type: 'case_banner', c })
      lastRunId = runId
    }
    rows.push({ type: 'msg', msg })
  }

  async function handleDelete() {
    if (!session) return
    if (!confirm(isZh ? `删除会话 ${decodedChatId.slice(0, 16)}… 以及关联的 ${session.cases.length} 个 ProcedureRun？` : `Delete chat ${decodedChatId.slice(0, 16)}… and all ${session.cases.length} linked ProcedureRun(s)?`)) return
    setDeleting(true)
    try {
      await apiClient<ChatDeleteResponse>(withAgent(`/api/chats/${encodeURIComponent(activeChatId)}`), { method: 'DELETE' })
      router.push(withAgent('/operate/conversations'))
    } catch { alert(isZh ? '删除失败' : 'Delete failed'); setDeleting(false) }
  }

  const latestStatus = session?.cases.length ? session.cases[session.cases.length - 1].status : null
  const navButtons: ReadonlyArray<readonly [DetailTab, string, string]> = [
    ...(unassignedTraces.length > 0 ? [['timeline', '会话级时间线', 'Chat-level timeline'] as const] : []),
    ['memory', '记忆', 'Memory'] as const,
  ]

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[1100px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
      <header className="sticky top-0 z-30 rounded-[26px] border border-black/[0.06] bg-white/[0.68] px-4 py-4 shadow-[var(--shadow-card)] backdrop-blur-xl sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <ConsoleBackButton
              label={isZh ? '会话' : 'Conversations'}
              ariaLabel={isZh ? '返回会话列表' : 'Back to conversations'}
              onClick={() => router.push(withAgent('/operate/conversations'))}
            />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#357f7c]">{isZh ? '运营' : 'Operate'}</p>
              <h1 className="truncate text-[16px] font-semibold tracking-tight text-[var(--mist)]">
                {conversationTruth.kind === 'synthetic_review'
                  ? (isZh ? '评审记录 · Playground 导出' : 'Review transcript · Playground export')
                  : conversationTruth.kind === 'mixed'
                    ? (isZh ? '会话 · 混合来源' : 'Conversation · Mixed sources')
                    : `${isZh ? '会话' : 'Chat'} · ${session?.userId ?? `${decodedChatId.slice(0, 16)}…`}`}
              </h1>
              {session ? (
                <p className="mt-1 text-[12px] text-[var(--fog)]/80">
                  {session.cases.length} {isZh ? '个流程运行' : `ProcedureRun${session.cases.length !== 1 ? 's' : ''}`} · {session.messageCount} {isZh ? '条消息' : 'msgs'} · {traces.length} {isZh ? '个时间线事件' : 'timeline events'}
                  {latestStatus ? <> · <span style={{ color: STATUS_COLOR[latestStatus] ?? undefined }}>{statusLabel(latestStatus, isZh)}</span></> : null}
                </p>
              ) : null}
            </div>
          </div>

          {!loading && session ? (
            <div className="flex flex-wrap items-center gap-2">
              <SourceTruthPill truth={conversationTruth} />
              {session.userId && conversationTruth.kind !== 'synthetic_review' && (() => {
                const userKey = session.userId.trim()
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userKey)
                const profileKey = (userKey && userKey !== 'anonymous' && !isUuid) ? `user:${userKey}` : `chat:${decodedChatId}`
                return (
                  <Link
                    href={withAgent(`/operate/handoff/${encodeURIComponent(profileKey)}`)}
                    className="inline-flex items-center gap-1.5 rounded-[14px] border border-indigo/18 bg-indigo/[0.06] px-3 py-2 text-[12px] font-medium text-indigo transition-colors hover:bg-indigo/[0.1]"
                    title={isZh ? '打开该用户档案（跨会话历史与偏好）' : "Open this user's profile (cross-chat history & preferences)"}
                  >
                    <User className="h-3.5 w-3.5" />
                    {isZh ? '用户' : 'User'}
                  </Link>
                )
              })()}
              <ExportButton
                filename={`chat-${decodedChatId.slice(0, 8)}`}
                label={isZh ? '导出' : 'Export'}
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
      </header>

      {conversationTruth.isSynthetic ? (
        <div className={`rounded-2xl border px-4 py-3 text-[13px] leading-6 shadow-[var(--shadow-card)] ${
          conversationTruth.kind === 'mixed'
            ? 'border-vermillion/18 bg-vermillion/[0.06] text-[var(--mist)]'
            : 'border-amber/18 bg-amber/[0.06] text-[var(--mist)]'
        }`}>
          <p className={`font-semibold ${conversationTruth.kind === 'mixed' ? 'text-vermillion' : 'text-amber'}`}>
            {conversationTruth.label}
          </p>
          <p className="mt-1 text-[var(--fog)]">{conversationTruth.description}</p>
        </div>
      ) : null}

      {/* 顶部：总览（指标 + 状态 + 流程运行） */}
      <section className="rounded-[26px] border border-black/[0.06] bg-white/[0.6] p-4 shadow-[var(--shadow-card)] sm:p-5">
        {metrics.llmCalls > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MetricCard icon={<Cpu className="w-3.5 h-3.5" />} label={isZh ? 'LLM 调用' : 'LLM Calls'} value={String(metrics.llmCalls)} />
              <MetricCard icon={<Zap className="w-3.5 h-3.5" />} label={isZh ? 'Token' : 'Tokens'} value={(metrics.totalTokens / 1000).toFixed(1) + 'K'} />
              <MetricCard icon={<Clock className="w-3.5 h-3.5" />} label={isZh ? '总耗时' : 'Wall Time'} value={fmtMs(metrics.turnWallMs)} />
              <MetricCard icon={<BarChart3 className="w-3.5 h-3.5" />} label={isZh ? '工具阶段' : 'Tool Phase'} value={fmtMs(metrics.toolPhaseMs)} />
            </div>
            <details className="overflow-hidden rounded-xl border border-black/[0.05] bg-white/40">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[11px] font-medium text-[var(--fog)] hover:bg-black/[0.02]">
                <span>{isZh ? 'Token 与耗时明细' : 'Token & timing breakdown'}</span>
                <span className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10px]">{isZh ? '高级' : 'Advanced'}</span>
              </summary>
              <div className="grid grid-cols-2 gap-2.5 border-t border-black/[0.04] px-3 py-3 sm:grid-cols-4">
                <AnalysisStat label={isZh ? '输入 Token' : 'Input Tokens'} value={metrics.inputTokens.toLocaleString()} />
                <AnalysisStat label={isZh ? '输出 Token' : 'Output Tokens'} value={metrics.outputTokens.toLocaleString()} />
                <AnalysisStat label={isZh ? '缓存命中' : 'Cache Read'} value={metrics.cacheReadTokens.toLocaleString()} />
                <AnalysisStat label={isZh ? '缓存写入' : 'Cache Write'} value={metrics.cacheWriteTokens.toLocaleString()} />
                <AnalysisStat label={isZh ? '每次平均 Token' : 'Avg Tokens/Call'} value={metrics.llmCalls > 0 ? (metrics.totalTokens / metrics.llmCalls).toFixed(0) : '0'} />
                <AnalysisStat label={isZh ? '每次平均输出' : 'Avg Output/Call'} value={metrics.llmCalls > 0 ? (metrics.outputTokens / metrics.llmCalls).toFixed(0) : '0'} />
                <AnalysisStat label={isZh ? '每秒 Token' : 'Tokens/sec'} value={metrics.turnWallMs > 0 ? ((metrics.outputTokens / (metrics.turnWallMs / 1000))).toFixed(0) : '0'} />
                {metrics.compactTokens > 0 && (
                  <AnalysisStat label={isZh ? '摘要 Token' : 'Compact Tokens'} value={metrics.compactTokens.toLocaleString()} />
                )}
              </div>
            </details>
          </div>
        )}
        {session ? (
          <div className={`${metrics.llmCalls > 0 ? 'mt-4 border-t border-black/[0.05] pt-4' : ''} space-y-2`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]/70">{isZh ? '运行分析' : 'Run analysis'}</p>
            <Link
              href={withAgent(`/operate/conversations/${encodeURIComponent(activeChatId)}/analysis`)}
              className="flex flex-col gap-3 rounded-2xl border border-black/[0.06] bg-white/70 px-4 py-3 transition-colors hover:border-indigo/20 hover:bg-white/90 sm:flex-row sm:items-center sm:justify-between"
              title={isZh ? '查看整个会话的工具、Token、耗时与完整 Trace' : 'View whole-chat tools, tokens, timing, and full trace'}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo/[0.08] text-indigo">
                  <BarChart3 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--mist)]">{isZh ? '会话运行分析' : 'Chat run analysis'}</p>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--fog)]">
                    {isZh ? '按整个 Chat 聚合，不再绑定单个 ProcedureRun' : 'Aggregated by whole chat, not a single ProcedureRun'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--fog)]">
                <span className="rounded-lg border border-black/[0.05] bg-black/[0.02] px-2 py-1">{session.cases.length} {isZh ? '个流程记录' : 'flow records'}</span>
                <span className="rounded-lg border border-black/[0.05] bg-black/[0.02] px-2 py-1">{toolTraceCount} {isZh ? '次工具' : 'tools'}</span>
                <span className="rounded-lg border border-black/[0.05] bg-black/[0.02] px-2 py-1">{traces.length} trace</span>
              </div>
            </Link>
          </div>
        ) : null}
      </section>

      {/* 具体分析：导航按钮 */}
      <div className="flex flex-wrap gap-2">
        {navButtons.map(([key, zh, en]) => (
          <button
            key={key}
            type="button"
            onClick={() => selectTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[12.5px] font-medium transition ${
              activeTab === key
                ? 'border-indigo/25 bg-indigo/[0.08] text-indigo'
                : 'border-black/[0.07] bg-white/70 text-[var(--fog)] hover:text-[var(--mist)]'
            }`}
          >
            {key === 'timeline' ? <BarChart3 className="h-3.5 w-3.5" /> : key === 'memory' ? <MessageSquare className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
            {isZh ? zh : en}
            {key === 'timeline' && traces.length > 0 ? <span className="opacity-60">({traces.length})</span> : null}
          </button>
        ))}
      </div>

      {/* Main page stays lightweight; full chat-level evidence lives in the analysis sub-page. */}
      {activeTab === 'timeline' && (
        unassignedTraces.length > 0 ? (
          <section className="rounded-2xl border border-black/[0.06] bg-white/[0.66] p-4">
            <div className="mb-3">
              <h3 className="text-[12px] font-semibold text-[var(--mist)]">{isZh ? '会话级时间线' : 'Chat-level timeline'}</h3>
              <p className="mt-1 text-[11px] leading-5 text-[var(--fog)]">
                {isZh ? '这些事件记录在会话层；完整工具 input/output、Token 与耗时请进入上方「会话运行分析」。' : 'These events were recorded at the chat level. Open Chat run analysis above for full tool input/output, tokens, and timing.'}
              </p>
            </div>
            <CaseTraceTimeline traces={unassignedTraces} t={t} groupByIteration={false} />
          </section>
        ) : (
          <p className="rounded-2xl border border-dashed border-black/[0.08] bg-white/50 px-4 py-8 text-center text-[12px] text-[var(--fog)]">
            {isZh ? '没有会话级事件；请打开上方「会话运行分析」查看完整时间线与证据。' : 'No chat-level events. Open Chat run analysis above for the full timeline and evidence.'}
          </p>
        )
      )}

      {/* Memory */}
      {activeTab === 'memory' && (
        <div className="space-y-4 rounded-2xl border border-black/[0.06] bg-white/[0.66] p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-[13px] font-semibold text-[var(--mist)]">{isZh ? '会话记忆' : 'Chat Memory'}</h3>
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleCompact} disabled={compacting}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg border border-teal/20 bg-teal/[0.06] text-teal hover:bg-teal/[0.12] disabled:opacity-50"
                title={isZh ? '为这段会话生成摘要' : 'Generate a summary of this conversation'}>
                <Zap className="w-3 h-3" />
                {compacting ? (isZh ? '生成中…' : 'Compacting…') : (isZh ? '生成摘要' : 'Compact Chat')}
              </button>
              <button onClick={handleUpdateProfile} disabled={updatingProfile}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg border border-indigo/20 bg-indigo/[0.04] text-indigo hover:bg-indigo/[0.08] disabled:opacity-50"
                title={isZh ? '把这段会话的摘要合并进用户的跨会话档案' : "Merge this chat's summaries into the user's cross-chat profile"}>
                <User className="w-3 h-3" />
                {updatingProfile ? (isZh ? '更新中…' : 'Updating…') : (isZh ? '更新用户档案' : 'Update User Profile')}
              </button>
              {memoryData?.profile && (
                <Link href={withAgent(`/operate/handoff/${encodeURIComponent(memoryData.profile.userId)}`)}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg border border-black/[0.06] text-[var(--fog)] hover:text-[var(--mist)] hover:border-black/10">
                  <User className="w-3 h-3" /> {isZh ? '查看档案' : 'View Profile'} →
                </Link>
              )}
            </div>
          </div>

          {compactResult && !compactResult.error && (
            <div className="rounded-xl border border-teal/10 bg-teal/[0.04] p-3 text-[11px] text-[var(--mist)]">
              ✓ {isZh ? '摘要已生成' : 'Compact complete'} · Model: {compactResult.compactModel} · {compactResult.beforeChars?.toLocaleString()} → {compactResult.afterChars?.toLocaleString()} chars
              {!compactResult.summary && <span className="ml-2 text-amber">{isZh ? '（没有生成摘要，可能是会话太短）' : '(no summary generated — conversation may be too short)'}</span>}
            </div>
          )}
          {compactResult?.error && (
            <div className="rounded-xl border border-vermillion/10 bg-vermillion/[0.04] p-3 text-[11px] text-vermillion">{compactResult.error}</div>
          )}

          {profileResult && !profileResult.error && (
            <div className="rounded-xl border border-indigo/10 bg-indigo/[0.04] p-3 text-[11px] text-[var(--mist)]">
              ✓ {isZh ? '用户档案已更新' : 'User Profile updated'} · {profileResult.memoriesMerged} {isZh ? '条摘要已合并' : 'summaries merged'} · Profile key: <code className="font-mono text-indigo/80">{profileResult.profileKey}</code>
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
              {memoryData.memories?.map((mem: any, index: number) => (
                <div key={mem.runId ?? `chat-memory-${index}`} className="rounded-xl border border-black/[0.04] bg-white/40 p-3">
                  <p className="text-[10px] text-[var(--fog)]/50 mb-2">{mem.runId ? `${isZh ? '流程运行' : 'ProcedureRun'} ${mem.runId.slice(0, 8)}` : (isZh ? '会话记忆' : 'Chat memory')}</p>
                  {mem.summary ? (
                    <div className="text-[11px] text-[var(--mist)] leading-relaxed max-h-[240px] overflow-auto">
                      <MessageContent content={mem.summary.slice(0, 3000)} />
                    </div>
                  ) : (
                    <p className="text-[11px] text-[var(--fog)]/50 italic">{isZh ? '还没有摘要，点击「生成摘要」生成。' : 'No summary yet — click "Compact Chat" to generate one.'}</p>
                  )}
                  <div className="mt-2 flex gap-3 text-[10px] text-[var(--fog)]/50">
                    <span>{(mem.toolsCalled?.length ?? 0)} {isZh ? '个工具' : 'tools'}</span>
                    <span>{(mem.keyEvents?.length ?? 0)} {isZh ? '个事件' : 'events'}</span>
                    <span>{(mem.missingFacts?.length ?? 0)} {isZh ? '个缺口' : 'gaps'}</span>
                  </div>
                </div>
              ))}
              {(!memoryData.memories || memoryData.memories.length === 0) && (
                <p className="text-[12px] text-[var(--fog)]/50 py-4 text-center">{isZh ? '这段会话还没有记忆数据。' : 'No memory data for this chat yet.'}</p>
              )}

              {memoryData.profile?.profile && (
                <div className="rounded-xl border border-indigo/[0.08] bg-indigo/[0.03] p-3">
                  <p className="text-[10px] font-medium text-indigo/70 mb-2">{isZh ? '用户档案（跨会话）' : 'User Profile (cross-chat)'}</p>
                  <div className="text-[11px] text-[var(--mist)] leading-relaxed max-h-[160px] overflow-auto">
                    <MessageContent content={memoryData.profile.profile.slice(0, 1500)} />
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-[12px] text-[var(--fog)]/50 py-4 text-center">{isZh ? '点击上方按钮加载或生成记忆。' : 'Use the actions above to load or generate memory.'}</p>
          )}
        </div>
      )}

      {/* 聊天框 — conversation transcript */}
      <main className="flex-1 min-h-[480px] overflow-y-auto rounded-[26px] border border-black/[0.06] bg-gradient-to-br from-white/[0.72] to-white/[0.42] p-4 shadow-[var(--shadow-card)] backdrop-blur-xl">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <OrganicLoader icon="spin" size={28} className="text-indigo/60" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-[var(--fog)]">
            <MessageSquare className="mb-2 h-8 w-8 opacity-20" strokeWidth={1} />
            <p className="text-[13px]">{isZh ? '没有消息' : 'No messages'}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((row) => {
              if (row.type === 'case_banner') {
                return (
                  <div key={`banner-${row.c.id}`} className="flex items-center gap-3 py-2">
                    <div className="h-px flex-1 bg-black/[0.06]" />
                    <CasePill caseItem={row.c} />
                    <div className="h-px flex-1 bg-black/[0.06]" />
                  </div>
                )
              }
              return <MessageRow key={row.msg.id} msg={row.msg} locale={locale} />
            })}
          </div>
        )}
      </main>
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

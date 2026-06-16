'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowUpRight,
  Clock3,
  Handshake,
  Loader2,
  MessageSquare,
  Search,
  Trash2,
  User,
} from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ExportButton from '@/components/ui/export-button'
import { ConsoleStatusPill } from '@/components/ui/console-chrome'
import SourceTruthPill from '@/components/operate/source-truth-pill'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient } from '@/lib/api/client'
import { useAgentContext } from '@/lib/agent/agent-context'
import { summarizeConversationSourceTruth } from '@/lib/operate/runtime-truth'
import type { ChatsListResponse, ChatDeleteResponse } from '@intera/shared/contracts/chats'

interface CaseSummary {
  id: string
  type: string
  status: string
  source: string
  goal: string | null
  createdAt: string
  updatedAt: string
  _count?: { messages: number }
}

interface ChatSession {
  chatId: string
  userId: string
  cases: CaseSummary[]
  messageCount: number
  lastActivity: string
  hasHumanTask: boolean
}

function fmtRelative(iso: string, locale: 'en' | 'zh'): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return locale === 'zh' ? '刚刚' : 'just now'
  if (minutes < 60) return locale === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return locale === 'zh' ? `${hours} 小时前` : `${hours}h ago`
  return locale === 'zh' ? `${Math.floor(hours / 24)} 天前` : `${Math.floor(hours / 24)}d ago`
}

function ConversationRow({
  session,
  agentId,
  onDelete,
  deleting,
}: {
  session: ChatSession
  agentId: string | null
  onDelete: (chatId: string) => void
  deleting: boolean
}) {
  const { locale } = useConsoleLocale()
  const isZh = locale === 'zh'
  const latestCase = session.cases[0]
  const waitingCount = session.cases.filter((item) => item.status === 'waiting_human').length
  const sourceTruth = summarizeConversationSourceTruth(
    session.cases.map((caseItem) => ({ source: caseItem.source, userId: session.userId })),
  )
  const displayUserLabel = sourceTruth.kind === 'synthetic_review' ? (isZh ? 'Playground 导出' : 'Playground export') : session.userId
  const href = agentId
    ? `/operate/conversations/${encodeURIComponent(session.chatId)}?agentId=${encodeURIComponent(agentId)}`
    : `/operate/conversations/${encodeURIComponent(session.chatId)}`

  return (
    <div className="group relative min-w-0">
      <Link
        href={href}
        className="block rounded-[24px] border border-black/[0.06] bg-white/[0.72] p-4 shadow-[var(--shadow-card)] backdrop-blur-xl transition-all hover:-translate-y-[1px] hover:border-indigo/16 hover:bg-white/82"
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
          <div className="flex min-w-0 items-start gap-3 xl:w-[25%]">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[18px] border border-indigo/14 bg-indigo/[0.08] text-indigo shadow-[inset_0_1px_0_rgba(255,255,255,0.66)]">
              <User className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-[14px] font-semibold text-[var(--mist)]">{displayUserLabel}</p>
                <SourceTruthPill truth={sourceTruth} />
                {session.hasHumanTask ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber/20 bg-amber/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-amber">
                    <Handshake className="h-3 w-3" />
                    {isZh ? '人工任务' : 'HumanTask'}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 truncate font-mono text-[11px] text-[var(--fog)]">
                {sourceTruth.kind === 'synthetic_review' ? (isZh ? '评审会话' : 'Review chat') : (isZh ? '会话' : 'Chat')} {session.chatId}
              </p>
            </div>
          </div>

          <div className="min-w-0 xl:w-[45%]">
            <div className="flex flex-wrap items-center gap-2">
              {latestCase ? <ConsoleStatusPill status={latestCase.status}>{latestCase.status.replace(/_/g, ' ')}</ConsoleStatusPill> : null}
              {session.cases.map((caseItem) => (
                <span
                  key={caseItem.id}
                  className="inline-flex items-center rounded-full border border-black/[0.05] bg-white/82 px-2.5 py-1 text-[11px] font-medium text-[var(--mist)]"
                >
                  {caseItem.type.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
            <p className="mt-3 line-clamp-2 text-[13px] leading-6 text-[var(--fog)]">
              {latestCase?.goal ||
                (sourceTruth.isSynthetic
                  ? (isZh
                    ? '这是从 Playground 导出的评审副本。打开会话后可以查看偏评审用途的运行证据。'
                    : 'Synthetic review copy from Playground export. Open the conversation to inspect review-oriented runtime evidence.')
                  : (isZh
                    ? '还没有记录明确目标。打开会话后可以查看当前 ProcedureRun 和 trace 上下文。'
                    : 'No explicit goal recorded yet. Open the conversation to inspect the active ProcedureRun and trace context.'))}
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-3 xl:ml-auto xl:w-[30%]">
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <span className="rounded-full border border-black/[0.05] bg-black/[0.025] px-2.5 py-1 text-[11px] text-[var(--fog)]">
                {session.messageCount} {isZh ? '条消息' : 'msgs'}
              </span>
              <span className="rounded-full border border-black/[0.05] bg-black/[0.025] px-2.5 py-1 text-[11px] text-[var(--fog)]">
                {session.cases.length} {isZh ? '个 ProcedureRun' : `ProcedureRun${session.cases.length === 1 ? '' : 's'}`}
              </span>
              {waitingCount > 0 ? (
                <span className="rounded-full border border-amber/18 bg-amber/[0.07] px-2.5 py-1 text-[11px] text-amber">
                  {waitingCount} {isZh ? '个待人工' : 'waiting_human'}
                </span>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 xl:justify-end">
              <div className="inline-flex items-center gap-1.5 text-[11px] text-[var(--fog)]">
                <Clock3 className="h-3.5 w-3.5" />
                {fmtRelative(session.lastActivity, locale)}
              </div>
              <span className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo transition-colors group-hover:text-[var(--mist)]">
                {isZh ? '打开' : 'Open'}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </div>
      </Link>

      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onDelete(session.chatId)
        }}
        disabled={deleting}
        className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-[14px] border border-transparent bg-white/72 text-[var(--vermillion)]/55 opacity-100 shadow-[0_10px_24px_rgba(21,23,25,0.04)] transition-all hover:border-[var(--vermillion)]/18 hover:bg-[var(--vermillion)]/[0.08] hover:text-[var(--vermillion)] disabled:pointer-events-none disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        aria-label={isZh ? '删除会话' : 'Delete chat session'}
        title={isZh ? '删除会话' : 'Delete chat session'}
      >
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'indigo' | 'teal' | 'amber' | 'neutral' }) {
  const toneClass: Record<typeof tone, string> = {
    indigo: 'border-indigo/18 bg-indigo/[0.07] text-indigo',
    teal: 'border-[#357f7c]/18 bg-[#357f7c]/[0.07] text-[#357f7c]',
    amber: 'border-amber/18 bg-amber/[0.07] text-amber',
    neutral: 'border-black/[0.06] bg-white/82 text-[var(--mist)]',
  }

  return (
    <div className={`min-w-[132px] rounded-[20px] border px-4 py-3 ${toneClass[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em]">{label}</p>
      <p className="mt-1 text-[19px] font-semibold">{value}</p>
    </div>
  )
}

export default function ConversationsWorkspace() {
  const { locale } = useConsoleLocale()
  const isZh = locale === 'zh'
  const { selectedAgentId, loading: agentLoading, loadError: agentLoadError } = useAgentContext()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async (showLoading = false) => {
    if (agentLoading) return
    if (!selectedAgentId) {
      setSessions([])
      setTotal(0)
      setLoadError(agentLoadError || (isZh ? '没有可用 Agent' : 'No agent available'))
      setLoading(false)
      return
    }
    if (showLoading) setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '200', agentId: selectedAgentId })
      const result = await apiClient<ChatsListResponse>(`/api/chats?${params.toString()}`)
      setSessions(result.data.sessions)
      setTotal(result.data.total)
      setLoadError(null)
    } catch {
      if (showLoading) {
        setSessions([])
        setTotal(0)
      }
      setLoadError(isZh ? '加载会话失败' : 'Failed to load conversations')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [agentLoadError, agentLoading, isZh, selectedAgentId])

  useEffect(() => {
    load(true)
    const intervalId = setInterval(() => load(false), 15_000)
    return () => clearInterval(intervalId)
  }, [load])

  const handleDelete = useCallback(async (chatId: string) => {
    const label = `${chatId.slice(0, 16)}…`
    if (!confirm(isZh ? `删除会话 ${label} 以及所有关联的 ProcedureRun？\n这个操作无法撤销。` : `Delete chat session ${label} and all linked ProcedureRuns?\nThis cannot be undone.`)) return
    setDeletingId(chatId)
    try {
      const query = selectedAgentId ? `?agentId=${encodeURIComponent(selectedAgentId)}` : ''
      await apiClient<ChatDeleteResponse>(`/api/chats/${encodeURIComponent(chatId)}${query}`, { method: 'DELETE' })
      setSessions((prev) => prev.filter((item) => item.chatId !== chatId))
      setTotal((prev) => prev - 1)
    } catch {
      alert(isZh ? '删除失败，网络异常' : 'Failed to delete — network error')
    } finally {
      setDeletingId(null)
    }
  }, [isZh, selectedAgentId])

  const filtered = sessions.filter((session) => {
    if (!search) return true
    const query = search.toLowerCase()
    return (
      session.userId.toLowerCase().includes(query) ||
      session.chatId.toLowerCase().includes(query) ||
      session.cases.some((caseItem) => caseItem.type.toLowerCase().includes(query) || caseItem.id.toLowerCase().includes(query))
    )
  })

  const waitingCount = sessions.filter((session) => session.hasHumanTask || session.cases.some((item) => item.status === 'waiting_human')).length
  const procedureRunCount = sessions.reduce((sum, session) => sum + session.cases.length, 0)
  const latestActivity = sessions[0]?.lastActivity ? fmtRelative(sessions[0].lastActivity, locale) : (isZh ? '暂无活动' : 'No activity')
  const hasVisibleData = sessions.length > 0 || total > 0

  return (
    <div className="mx-auto flex max-w-[1580px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="rounded-[28px] border border-black/[0.06] bg-white/[0.72] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo/18 bg-indigo/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-indigo">
                <MessageSquare className="h-3.5 w-3.5" />
                {isZh ? '运营' : 'Operate'}
              </div>
              <h1 className="mt-3 text-[clamp(1.45rem,2vw,1.95rem)] font-semibold tracking-tight text-[var(--mist)]">
                {isZh ? '会话' : 'Conversations'}
              </h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--fog)]">
                {isZh
                  ? '浏览实时会话，找到需要关注的 ProcedureRun，并深入查看对话记录、用户、Trace 或记忆详情，同时保持平稳的运营视角。'
                  : 'Scan live Chats, find the ProcedureRuns that need attention, and move into transcript, User, Trace, or Memory detail without losing the calm operating context.'}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <MetricCard label={isZh ? '会话数' : 'Chats'} value={String(total)} tone="neutral" />
              <MetricCard label={isZh ? '待接手' : 'Waiting handoff'} value={String(waitingCount)} tone="amber" />
              <MetricCard label={isZh ? 'ProcedureRun 数' : 'ProcedureRuns'} value={String(procedureRunCount)} tone="teal" />
              <MetricCard label={isZh ? '最近活动' : 'Latest activity'} value={latestActivity} tone="indigo" />
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-[360px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--smoke)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isZh ? '按用户、会话或 Procedure 类型搜索' : 'Search by user, chat, or Procedure type'}
                className="glass-input-console h-11 rounded-[16px] bg-white/86 pl-11 text-[13px] placeholder:text-[var(--fog)]/55"
              />
            </div>

            {sessions.length > 0 ? (
              <ExportButton
                filename="conversations-list"
                label={isZh ? '导出当前可见会话为 JSON' : 'Export visible conversations as JSON'}
                getData={() => ({
                  _version: 'intera_console_conversations_export_v1',
                  exportedAt: new Date().toISOString(),
                  filter: search || null,
                  total,
                  agentId: selectedAgentId,
                  shown: filtered.length,
                  sessions: filtered,
                })}
              />
            ) : null}
          </div>
        </div>
      </header>

      {loadError && hasVisibleData ? (
        <div className="inline-flex items-center gap-2 self-start rounded-full border border-vermillion/18 bg-vermillion/[0.06] px-3 py-1.5 text-[12px] text-vermillion shadow-[var(--shadow-card)]">
          <AlertCircle className="h-3.5 w-3.5" />
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <ListSkeleton count={6} />
      ) : loadError && !hasVisibleData ? (
        <section className="mx-auto w-full max-w-xl rounded-[28px] border border-dashed border-vermillion/18 bg-white/[0.6] px-6 py-16 text-center shadow-[var(--shadow-card)]">
          <AlertCircle className="mx-auto h-8 w-8 text-vermillion/60" />
          <h2 className="mt-4 text-[16px] font-semibold text-[var(--mist)]">{isZh ? '暂时无法加载会话' : 'Unable to load conversations'}</h2>
          <p className="mt-2 text-[13px] leading-6 text-[var(--fog)]">
            {isZh ? '刚才会话收件箱没能读取实时 chat 数据。等本地 session 和数据源可用后再重试。' : 'The conversation inbox could not read live chat data just now. Retry after the local session and data source are available.'}
          </p>
          <button
            type="button"
            onClick={() => void load(true)}
            className="mt-5 inline-flex items-center justify-center rounded-[16px] border border-indigo/20 bg-indigo/[0.08] px-4 py-2.5 text-[13px] font-semibold text-indigo transition-all hover:bg-indigo/[0.14]"
          >
            {isZh ? '重试收件箱' : 'Retry inbox'}
          </button>
        </section>
      ) : filtered.length === 0 ? (
        <div className="mx-auto w-full max-w-xl rounded-[28px] border border-dashed border-black/[0.08] bg-white/[0.56] px-6 py-16 text-center shadow-[var(--shadow-card)]">
          <EmptyState
            icon={MessageSquare}
            title={search ? (isZh ? '没有匹配的会话' : 'No matching conversations') : (isZh ? '还没有会话' : 'No conversations yet')}
            description={
              search
                ? (isZh ? '试试别的用户、会话 ID 或 Procedure 类型。' : 'Try a different user, chat ID, or Procedure type.')
                : (isZh ? '一旦 Console 开始收到实时 chat 活动，会话就会出现在这里。' : 'Conversations will appear here once the Console starts receiving live chat activity.')
            }
          />
        </div>
      ) : (
        <section className="space-y-3">
          {filtered.map((session) => (
            <ConversationRow
              key={session.chatId}
              session={session}
              agentId={selectedAgentId}
              onDelete={handleDelete}
              deleting={deletingId === session.chatId}
            />
          ))}
        </section>
      )}

      {!loading && total > filtered.length ? (
        <div className="inline-flex items-center gap-2 self-start rounded-full border border-black/[0.05] bg-white/[0.68] px-3 py-1.5 text-[12px] text-[var(--fog)] shadow-[var(--shadow-card)]">
          <AlertCircle className="h-3.5 w-3.5" />
          {isZh ? `显示 ${filtered.length} / ${total} 个会话。` : `Showing ${filtered.length} of ${total} conversations.`}
        </div>
      ) : null}
    </div>
  )
}

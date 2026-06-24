'use client'

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Gauge,
  Handshake,
  Loader2,
  MessageSquare,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient, ApiClientError } from '@/lib/api/client'
import { useAgentContext } from '@/lib/agent/agent-context'
import type { CaseDetailResponse, CasesListResponse } from '@intera/shared/contracts/cases'
import type { HandoffMetrics, HandoffMetricsResponse } from '@intera/shared/contracts/handoff'

interface HandoffCaseSummary {
  id: string
  runId?: string | null
  chatId?: string
  type: string
  status: string
  goal: string | null
  createdAt: string
  updatedAt: string
  summary?: string | null
  messageCount?: number
}

interface HandoffTask {
  id?: string
  queue?: string | null
  question?: string | null
  status?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

interface HandoffCaseDetail {
  id: string
  runId?: string | null
  userId: string
  chatId: string
  type: string
  status: string
  goal: string | null
  blocker: string | null
  createdAt: string
  updatedAt: string
  memory: {
    summary: string | null
    todos: string | null
  } | null
  humanTasks?: HandoffTask[]
  _count?: {
    messages: number
    traces: number
  }
}

const HANDOFF_PAGE_SIZE = 10

function fmtRelative(iso: string, locale: 'en' | 'zh') {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.max(0, Math.floor(diff / 60_000))
  if (mins < 1) return locale === 'zh' ? '刚刚' : 'just now'
  if (mins < 60) return locale === 'zh' ? `${mins} 分钟` : `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return locale === 'zh' ? `${hours} 小时` : `${hours}h`
  return locale === 'zh' ? `${Math.floor(hours / 24)} 天` : `${Math.floor(hours / 24)}d`
}

function fmtTimestamp(iso: string | null | undefined, locale: 'en' | 'zh') {
  if (!iso) return locale === 'zh' ? '未记录' : 'Not recorded'
  return new Date(iso).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtNumber(value: number | null | undefined, locale: 'en' | 'zh') {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(value ?? 0)
}

function fmtPercent(value: number | null | undefined) {
  return `${Math.round((value ?? 0) * 1000) / 10}%`
}

function hasMeaningfulText(value: string | null | undefined) {
  return Boolean(value?.trim())
}

export default function HumanHandoffPage() {
  const { locale } = useConsoleLocale()
  const { selectedAgentId, loading: agentLoading, loadError: agentLoadError } = useAgentContext()
  const isZh = locale === 'zh'
  const withAgent = useMemo(() => {
    return (path: string) => {
      if (!selectedAgentId) return path
      return `${path}${path.includes('?') ? '&' : '?'}agentId=${encodeURIComponent(selectedAgentId)}`
    }
  }, [selectedAgentId])
  const [cases, setCases] = useState<HandoffCaseSummary[]>([])
  const [caseTotal, setCaseTotal] = useState(0)
  const [metrics, setMetrics] = useState<HandoffMetrics | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [detail, setDetail] = useState<HandoffCaseDetail | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPage(0)
  }, [selectedAgentId])

  useEffect(() => {
    let active = true

    async function loadHandoffs() {
      if (agentLoading) return
      if (!selectedAgentId) {
        setLoading(false)
        setCases([])
        setCaseTotal(0)
        setMetrics(null)
        setSelectedRunId(null)
        setError(agentLoadError || (isZh ? '没有可用 Agent' : 'No agent available'))
        return
      }
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          handoff: 'active',
          limit: String(HANDOFF_PAGE_SIZE),
          offset: String(page * HANDOFF_PAGE_SIZE),
          agentId: selectedAgentId,
        })
        const metricsParams = new URLSearchParams({ agentId: selectedAgentId })
        const [result, metricsResult] = await Promise.all([
          apiClient<CasesListResponse>(`/api/cases?${params.toString()}`),
          apiClient<HandoffMetricsResponse>(`/api/operate/handoff/metrics?${metricsParams.toString()}`),
        ])
        if (!active) return
        const nextCases = result.data.cases as HandoffCaseSummary[]
        const total = result.data.total
        setCases(nextCases)
        setCaseTotal(total)
        setMetrics(metricsResult.data.metrics)
        if (nextCases.length === 0 && total > 0 && page > 0) {
          setPage(Math.max(0, Math.ceil(total / HANDOFF_PAGE_SIZE) - 1))
          return
        }
        setSelectedRunId((prev) => {
          if (prev && nextCases.some((item) => item.runId === prev)) return prev
          return nextCases[0]?.runId ?? null
        })
      } catch (err) {
        if (!active) return
        setError(err instanceof ApiClientError ? err.envelope.error.message : (isZh ? '加载人工接管列表失败' : 'Failed to load handoff list'))
        setCases([])
        setCaseTotal(0)
        setMetrics(null)
        setSelectedRunId(null)
      } finally {
        if (active) setLoading(false)
      }
    }

    loadHandoffs()
    return () => {
      active = false
    }
  }, [agentLoadError, agentLoading, isZh, page, selectedAgentId])

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null)
      return
    }
    const runId = selectedRunId

    let active = true

    async function loadDetail() {
      setDetailLoading(true)
      try {
        const result = await apiClient<CaseDetailResponse>(withAgent(`/api/runs/${encodeURIComponent(runId)}`))
        if (!active) return
        setDetail(result.data.case as HandoffCaseDetail)
      } catch (err) {
        if (!active) return
        setDetail(null)
        setError(err instanceof ApiClientError ? err.envelope.error.message : (isZh ? '加载人工接管详情失败' : 'Failed to load handoff detail'))
      } finally {
        if (active) setDetailLoading(false)
      }
    }

    loadDetail()
    return () => {
      active = false
    }
  }, [selectedRunId, withAgent])

  const procedureTypes = useMemo(() => new Set(cases.map((item) => item.type)).size, [cases])
  const latestTask = detail?.humanTasks?.[0]
  const totalConversations = metrics?.totalConversations ?? 0
  const totalProcedureRuns = metrics?.totalProcedureRuns ?? 0
  const escalatedConversations = metrics?.escalatedConversations ?? 0
  const totalPages = Math.max(1, Math.ceil(caseTotal / HANDOFF_PAGE_SIZE))
  const canGoPrev = page > 0
  const canGoNext = page + 1 < totalPages
  const runSummary = hasMeaningfulText(detail?.memory?.summary) ? detail?.memory?.summary?.trim() ?? null : null
  const runTodos = hasMeaningfulText(detail?.memory?.todos) ? detail?.memory?.todos?.trim() ?? null : null
  const hasRunNotes = Boolean(runSummary || runTodos)
  const escalationSubcopy = isZh
    ? `${fmtNumber(escalatedConversations, locale)} / ${fmtNumber(totalConversations, locale)} 个对话`
    : `${fmtNumber(escalatedConversations, locale)} / ${fmtNumber(totalConversations, locale)} chats`
  const generatedAt = metrics?.generatedAt ? fmtTimestamp(metrics.generatedAt, locale) : (isZh ? '未同步' : 'Not synced')

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <OrganicLoader icon="spin" size={28} className="text-indigo/60" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full min-w-0 max-w-full flex-col gap-5 px-4 py-6 sm:px-6 lg:max-w-[1600px] lg:px-8">
      <header className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-lavender/20 bg-lavender/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-lavender">
              <Handshake className="h-3.5 w-3.5" />
              {isZh ? '人工接管' : 'Human Ops'}
            </div>
            <h1 className="mt-3 text-[clamp(1.45rem,2vw,1.95rem)] font-semibold tracking-tight text-[var(--mist)]">{isZh ? '人工接管指挥台' : 'Human Handoff Console'}</h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--fog)]">
              {isZh
                ? '从总对话量、转人工占比和已转接状态判断当前 Agent 的转接负载；转人工统计只认真实 HumanTask。'
                : 'Track total conversations, escalation rate, and human-task-backed handoffs for the active agent.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/build/components/procedures"
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/84 px-3 py-1.5 text-[11px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/18 hover:text-indigo"
            >
              {isZh ? '流程' : 'Procedures'}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/build/components/hooks"
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/84 px-3 py-1.5 text-[11px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/18 hover:text-indigo"
            >
              {isZh ? '钩子' : 'Hooks'}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <KpiTile
            icon={MessageSquare}
            label={isZh ? 'Agent 总对话' : 'Agent chats'}
            value={fmtNumber(totalConversations, locale)}
            detail={isZh ? `${fmtNumber(totalProcedureRuns, locale)} 次流程运行` : `${fmtNumber(totalProcedureRuns, locale)} ProcedureRuns`}
            tone="neutral"
          />
          <KpiTile
            icon={Gauge}
            label={isZh ? '转人工占比' : 'Handoff rate'}
            value={fmtPercent(metrics?.escalationRate)}
            detail={escalationSubcopy}
            tone="amber"
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <SignalStrip
            icon={BarChart3}
            label={isZh ? '已转接流程类型' : 'Escalated procedure types'}
            value={fmtNumber(metrics?.handoffProcedureTypes ?? procedureTypes, locale)}
          />
          <SignalStrip
            icon={Clock3}
            label={isZh ? '总消息量' : 'Total messages'}
            value={fmtNumber(metrics?.totalMessages ?? 0, locale)}
          />
          <SignalStrip
            icon={Clock3}
            label={isZh ? '指标更新时间' : 'Metrics synced'}
            value={generatedAt}
          />
        </div>
      </header>

      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-vermillion/20 bg-vermillion/[0.06] px-4 py-3 text-[13px] text-vermillion">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {error && cases.length === 0 ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-dashed border-vermillion/18 bg-white/[0.58] px-6 text-center shadow-[var(--shadow-card)]">
          <AlertCircle className="h-6 w-6 text-vermillion/60" />
          <h2 className="mt-4 text-[15px] font-semibold text-[var(--mist)]">{isZh ? '暂时无法读取接管列表' : 'Unable to read handoffs'}</h2>
          <p className="mt-2 max-w-md text-[13px] leading-6 text-[var(--fog)]">
            {isZh ? '刚才没能加载人工接管列表，所以这个视图会先停在这里，而不是假装没有转人工会话。' : 'The handoff list could not load just now, so this view pauses instead of pretending there are no escalated conversations.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center justify-center rounded-full border border-indigo/20 bg-indigo/[0.08] px-4 py-2 text-[12px] font-semibold text-indigo transition-colors hover:bg-indigo/[0.14]"
          >
            {isZh ? '重试' : 'Retry'}
          </button>
        </div>
      ) : cases.length === 0 ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-dashed border-black/[0.08] bg-white/55 px-6 text-center shadow-[var(--shadow-card)]">
          <Sparkles className="h-6 w-6 text-indigo/55" />
          <h2 className="mt-4 text-[15px] font-semibold text-[var(--mist)]">{isZh ? '当前没有已转接会话' : 'No active escalations'}</h2>
          <p className="mt-2 max-w-md text-[13px] leading-6 text-[var(--fog)]">
            {isZh ? '当前没有会话带有未处理人工任务。只要新的流程运行创建人工任务，它就会出现在这里。' : 'No conversation currently has an open HumanTask. New escalations appear here once a ProcedureRun creates a human task.'}
          </p>
          <Link
            href={withAgent('/operate/conversations')}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white px-4 py-2 text-[12px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/20 hover:text-indigo"
          >
            {isZh ? '打开会话' : 'Open Conversations'}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <section className="min-w-0 rounded-[28px] border border-black/[0.06] bg-white/68 p-4 shadow-[var(--shadow-card)] backdrop-blur-xl">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold text-[var(--mist)]">{isZh ? '已转接会话' : 'Escalated conversations'}</h2>
                <p className="text-[11px] text-[var(--fog)]">{isZh ? '按最近转人工活动排序；每条都对应真实人工任务。' : 'Sorted by latest escalation activity; every row has a real HumanTask.'}</p>
              </div>
              <Link href={withAgent('/operate/conversations')} className="flex-shrink-0 text-[11px] font-medium text-indigo/70 hover:text-indigo">
                {isZh ? '全部会话' : 'All conversations'}
              </Link>
            </div>

            <div className="min-w-0 space-y-3">
              {cases.map((item) => {
                const selected = item.runId === selectedRunId
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => item.runId ? setSelectedRunId(item.runId) : undefined}
                    className={`min-w-0 w-full rounded-2xl border px-4 py-3 text-left transition-[border-color,transform,box-shadow] ${
                      selected
                        ? 'border-indigo/30 bg-indigo/[0.06] shadow-[0_10px_25px_-18px_rgba(79,70,229,0.6)]'
                        : 'border-black/[0.06] bg-white/80 hover:-translate-y-[1px] hover:border-black/[0.12]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[13px] font-semibold text-[var(--mist)]">{item.chatId || item.id}</p>
                        <p className="mt-1 truncate text-[11px] text-[var(--fog)]">{item.type.replace(/_/g, ' ')} · {item.goal || (isZh ? '没有记录明确目标。' : 'No explicit goal recorded.')}</p>
                      </div>
                      <span className="rounded-full border border-amber/20 bg-amber/[0.08] px-2 py-1 text-[10px] font-semibold text-amber">
                        {isZh ? '已转接' : 'escalated'}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--fog)]">
                      {item.runId ? <span className="rounded-full bg-black/[0.04] px-2 py-1">{item.runId.slice(0, 8)}</span> : null}
                      <span className="rounded-full bg-black/[0.04] px-2 py-1">{item.messageCount ?? '0'} {isZh ? '条消息' : 'msgs'}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2 py-1">
                        <Clock3 className="h-3 w-3" />
                        {fmtRelative(item.updatedAt, locale)} {isZh ? '已转接' : 'escalated'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] px-1 pt-4">
              <p className="text-[11px] text-[var(--fog)]">
                {isZh
                  ? `第 ${fmtNumber(page + 1, locale)} / ${fmtNumber(totalPages, locale)} 页 · 共 ${fmtNumber(caseTotal, locale)} 条 · 每页 ${HANDOFF_PAGE_SIZE} 条`
                  : `Page ${fmtNumber(page + 1, locale)} / ${fmtNumber(totalPages, locale)} · ${fmtNumber(caseTotal, locale)} total · ${HANDOFF_PAGE_SIZE} per page`}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  disabled={!canGoPrev}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-white text-[var(--mist)] transition-colors hover:border-indigo/20 hover:text-indigo disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={isZh ? '上一页' : 'Previous page'}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                  disabled={!canGoNext}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-white text-[var(--mist)] transition-colors hover:border-indigo/20 hover:text-indigo disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={isZh ? '下一页' : 'Next page'}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>

          <section className="min-w-0 rounded-[28px] border border-black/[0.06] bg-white/72 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
            {detailLoading ? (
              <div className="flex min-h-[320px] items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-indigo/60" />
              </div>
            ) : detail ? (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 border-b border-black/[0.06] pb-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--fog)]">{isZh ? '当前流程运行' : 'Selected ProcedureRun'}</p>
                    <h2 className="mt-1 text-[18px] font-semibold text-[var(--mist)]">{detail.type.replace(/_/g, ' ')}</h2>
                    <p className="mt-1 break-words text-[12px] text-[var(--fog)]">
                      {isZh
                        ? `用户 ${detail.userId} · 会话 ${detail.chatId} · 更新于 ${fmtTimestamp(detail.updatedAt, locale)}`
                        : `User ${detail.userId} · Chat ${detail.chatId} · updated ${fmtTimestamp(detail.updatedAt, locale)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={withAgent(`/operate/conversations/${encodeURIComponent(detail.chatId)}`)}
                      className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white px-4 py-2 text-[12px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/20 hover:text-indigo"
                    >
                      {isZh ? '打开会话' : 'Open conversation'}
                    </Link>
                    <Link
                      href={withAgent(`/operate/conversations/runs/${encodeURIComponent(detail.runId ?? '')}`)}
                      className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white px-4 py-2 text-[12px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/20 hover:text-indigo"
                    >
                      {isZh ? '打开流程运行详情' : 'Open ProcedureRun detail'}
                    </Link>
                  </div>
                </div>

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                  <div className="space-y-4">
                    <Panel title={isZh ? '内部转人工备注' : 'Handoff note'} description={isZh ? '来自真实人工任务的接手说明，用于人工同事快速理解上下文。' : 'Internal handoff note from the persisted HumanTask.'}>
                      {latestTask ? (
                        <div className="space-y-3">
                          <div className="grid gap-2 sm:grid-cols-3">
                            <InlineRow label={isZh ? '接管队列' : 'Queue'} value={latestTask.queue || (isZh ? '未设置' : 'Not set')} />
                            <InlineRow label={isZh ? '状态' : 'Status'} value={latestTask.status || (isZh ? '待处理' : 'pending')} />
                            <InlineRow label={isZh ? '创建时间' : 'Created'} value={fmtTimestamp(latestTask.createdAt, locale)} />
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">{isZh ? '备注内容' : 'Handoff note'}</p>
                            <p className="mt-1 whitespace-pre-wrap rounded-2xl border border-black/[0.06] bg-white/80 px-4 py-3 text-[13px] leading-6 text-[var(--mist)]">
                              {latestTask.question || (isZh ? '没有保存内部备注。' : 'No handoff note stored.')}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[13px] text-[var(--fog)]">{isZh ? '这个流程运行没有关联到真实人工任务，不能作为已转接证据。' : 'No persisted HumanTask is linked to this ProcedureRun, so it should not be treated as escalated evidence.'}</p>
                      )}
                    </Panel>

                    <div className="grid gap-3 md:grid-cols-3">
                      <DetailCard label={isZh ? '当前阻塞点' : 'Current blocker'} value={detail.blocker || (isZh ? '未记录' : 'Not recorded')} />
                      <DetailCard label={isZh ? '消息数' : 'Messages'} value={String(detail._count?.messages ?? 0)} />
                      <DetailCard label={isZh ? '时间线事件' : 'Timeline events'} value={String(detail._count?.traces ?? 0)} />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Panel title={isZh ? '转接时间线' : 'Escalation timeline'} description={isZh ? '当前人工任务转接记录的关键时间点。' : 'Quick checkpoints for the current HumanTask-backed escalation.'}>
                      <div className="space-y-3">
                        <TimelineRow label={isZh ? '创建时间' : 'Created'} value={fmtTimestamp(detail.createdAt, locale)} />
                        <TimelineRow label={isZh ? '转人工时间' : 'Escalated'} value={fmtTimestamp(latestTask?.createdAt ?? detail.updatedAt, locale)} />
                        <TimelineRow label={isZh ? '最近转人工活动' : 'Last escalation activity'} value={fmtTimestamp(detail.updatedAt, locale)} />
                        <TimelineRow label={isZh ? '转接时长' : 'Escalation age'} value={fmtRelative(detail.updatedAt, locale)} />
                      </div>
                    </Panel>

                    {hasRunNotes ? (
                      <Panel title={isZh ? '运行备注' : 'Run notes'} description={isZh ? '当前流程运行携带的真实摘要和下一步引导。' : 'Current summary and next-step guidance carried with the ProcedureRun.'}>
                        <div className="space-y-3 text-[13px] leading-6 text-[var(--mist)]">
                          {runSummary ? (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">{isZh ? '摘要' : 'Summary'}</p>
                              <p className="mt-1 whitespace-pre-wrap">{runSummary}</p>
                            </div>
                          ) : null}
                          {runTodos ? (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">{isZh ? '待办项' : 'Open items'}</p>
                              <p className="mt-1 whitespace-pre-wrap">{runTodos}</p>
                            </div>
                          ) : null}
                        </div>
                      </Panel>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-black/[0.08] bg-white/55 text-[13px] text-[var(--fog)]">
                {isZh ? '选择一个已转接流程运行，就能在这里查看人工任务和内部备注。' : 'Select an escalated ProcedureRun to inspect its HumanTask and handoff note.'}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

type KpiTone = 'neutral' | 'indigo' | 'amber' | 'vermillion'

function KpiTile({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  tone: KpiTone
}) {
  const toneClass: Record<KpiTone, string> = {
    neutral: 'border-black/[0.06] bg-white/[0.78] text-[var(--mist)]',
    indigo: 'border-indigo/18 bg-indigo/[0.07] text-indigo',
    amber: 'border-amber/18 bg-amber/[0.07] text-amber',
    vermillion: 'border-vermillion/18 bg-vermillion/[0.07] text-vermillion',
  }

  return (
    <div className={`min-h-[124px] rounded-[24px] border p-4 shadow-[var(--shadow-card)] backdrop-blur-xl ${toneClass[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em]">{label}</p>
        <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[14px] border border-current/15 bg-white/55">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-4 text-[clamp(1.45rem,2vw,2rem)] font-semibold leading-none">{value}</p>
      <p className="mt-2 truncate text-[11px] font-medium opacity-75">{detail}</p>
    </div>
  )
}

function SignalStrip({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex min-h-[64px] items-center justify-between gap-4 rounded-[20px] border border-black/[0.06] bg-white/[0.68] px-4 py-3 shadow-[0_12px_28px_rgba(21,23,25,0.04)] backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[15px] border border-black/[0.06] bg-black/[0.025] text-[var(--fog)]">
          <Icon className="h-4 w-4" />
        </span>
        <p className="truncate text-[12px] font-medium text-[var(--fog)]">{label}</p>
      </div>
      <p className="min-w-0 truncate text-right text-[13px] font-semibold text-[var(--mist)]">{value}</p>
    </div>
  )
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white/75 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">{label}</p>
      <p className="mt-1 text-[13px] text-[var(--mist)]">{value}</p>
    </div>
  )
}

function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="rounded-[24px] border border-black/[0.06] bg-white/75 p-4">
      <h3 className="text-[14px] font-semibold text-[var(--mist)]">{title}</h3>
      <p className="mt-1 text-[11px] leading-5 text-[var(--fog)]">{description}</p>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function InlineRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white/80 px-4 py-3">
      <span className="text-[11px] font-medium text-[var(--fog)]">{label}</span>
      <span className="text-[12px] font-medium text-[var(--mist)]">{value}</span>
    </div>
  )
}

function TimelineRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-black/[0.06] bg-white/80 px-4 py-3">
      <div className="mt-1 h-2.5 w-2.5 rounded-full bg-indigo/55" />
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">{label}</p>
        <p className="mt-1 text-[13px] text-[var(--mist)]">{value}</p>
      </div>
    </div>
  )
}

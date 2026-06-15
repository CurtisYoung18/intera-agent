'use client'

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
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

export default function HumanHandoffPage() {
  const { locale } = useConsoleLocale()
  const isZh = locale === 'zh'
  const [cases, setCases] = useState<HandoffCaseSummary[]>([])
  const [metrics, setMetrics] = useState<HandoffMetrics | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [detail, setDetail] = useState<HandoffCaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadHandoffs() {
      setLoading(true)
      setError(null)
      try {
        const [result, metricsResult] = await Promise.all([
          apiClient<CasesListResponse>('/api/cases?status=waiting_human&limit=100'),
          apiClient<HandoffMetricsResponse>('/api/operate/handoff/metrics'),
        ])
        if (!active) return
        const nextCases = result.data.cases as HandoffCaseSummary[]
        setCases(nextCases)
        setMetrics(metricsResult.data.metrics)
        setSelectedRunId((prev) => {
          if (prev && nextCases.some((item) => item.runId === prev)) return prev
          return nextCases[0]?.runId ?? null
        })
      } catch (err) {
        if (!active) return
        setError(err instanceof ApiClientError ? err.envelope.error.message : (isZh ? '加载人工接管列表失败' : 'Failed to load handoff list'))
        setCases([])
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
  }, [])

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
        const result = await apiClient<CaseDetailResponse>(`/api/runs/${encodeURIComponent(runId)}`)
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
  }, [selectedRunId])

  const handoffListCount = cases.length
  const activeHandoffProcedureRuns = metrics?.activeHandoffProcedureRuns ?? handoffListCount
  const activeHandoffConversations = metrics?.activeHandoffConversations ?? handoffListCount
  const procedureTypes = useMemo(() => new Set(cases.map((item) => item.type)).size, [cases])
  const latestTask = detail?.humanTasks?.[0]
  const totalConversations = metrics?.totalConversations ?? 0
  const totalProcedureRuns = metrics?.totalProcedureRuns ?? 0
  const escalatedConversations = metrics?.escalatedConversations ?? 0
  const escalatedProcedureRuns = metrics?.escalatedProcedureRuns ?? activeHandoffProcedureRuns
  const escalationSubcopy = isZh
    ? `${fmtNumber(escalatedConversations, locale)} / ${fmtNumber(totalConversations, locale)} 个对话`
    : `${fmtNumber(escalatedConversations, locale)} / ${fmtNumber(totalConversations, locale)} chats`
  const handoffActiveSubcopy = isZh
    ? `${fmtNumber(activeHandoffProcedureRuns, locale)} 个 ProcedureRun 已交给人工`
    : `${fmtNumber(activeHandoffProcedureRuns, locale)} human-owned ProcedureRuns`
  const procedureRunSubcopy = isZh
    ? `${fmtNumber(metrics?.activeHumanTasks ?? 0, locale)} 个未处理 HumanTask`
    : `${fmtNumber(metrics?.activeHumanTasks ?? 0, locale)} active HumanTasks`
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
                ? '从总对话量、转人工占比和人工接管状态判断当前 Agent 的转接负载。'
                : 'Track total conversations, handoff rate, and human-owned conversations for the active agent.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/build/components/procedures"
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/84 px-3 py-1.5 text-[11px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/18 hover:text-indigo"
            >
              {isZh ? 'Procedures' : 'Procedures'}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/build/components/hooks"
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/84 px-3 py-1.5 text-[11px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/18 hover:text-indigo"
            >
              {isZh ? 'Hooks' : 'Hooks'}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            icon={MessageSquare}
            label={isZh ? 'Agent 总对话' : 'Agent chats'}
            value={fmtNumber(totalConversations, locale)}
            detail={`${fmtNumber(totalProcedureRuns, locale)} ProcedureRuns`}
            tone="neutral"
          />
          <KpiTile
            icon={Gauge}
            label={isZh ? '转人工占比' : 'Handoff rate'}
            value={fmtPercent(metrics?.escalationRate)}
            detail={escalationSubcopy}
            tone="indigo"
          />
          <KpiTile
            icon={Handshake}
            label={isZh ? '人工接管中' : 'Human-owned'}
            value={fmtNumber(activeHandoffConversations, locale)}
            detail={handoffActiveSubcopy}
            tone="amber"
          />
          <KpiTile
            icon={Activity}
            label={isZh ? '转人工 ProcedureRun' : 'Handoff ProcedureRuns'}
            value={fmtNumber(escalatedProcedureRuns, locale)}
            detail={procedureRunSubcopy}
            tone="vermillion"
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <SignalStrip
            icon={BarChart3}
            label={isZh ? '接管 Procedure 类型' : 'Handoff procedure types'}
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
            {isZh ? '刚才没能加载人工接管列表，所以这个视图会先停在这里，而不是假装没有转人工会话。' : 'The handoff list could not load just now, so this view pauses instead of pretending there are no human-owned conversations.'}
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
          <h2 className="mt-4 text-[15px] font-semibold text-[var(--mist)]">{isZh ? '当前没有人工接管会话' : 'No active handoffs'}</h2>
          <p className="mt-2 max-w-md text-[13px] leading-6 text-[var(--fog)]">
            {isZh ? '当前没有会话处于人工接管中。只要新的 ProcedureRun 转人工，它就会出现在这里。' : 'No conversation is currently human-owned. New handoffs will appear here as soon as a ProcedureRun is transferred to a human.'}
          </p>
          <Link
            href="/operate/conversations"
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
                <h2 className="text-[14px] font-semibold text-[var(--mist)]">{isZh ? '人工接管会话' : 'Human-owned Conversations'}</h2>
                <p className="text-[11px] text-[var(--fog)]">{isZh ? '按最近接管活动排序。' : 'Sorted by latest handoff activity.'}</p>
              </div>
              <Link href="/operate/conversations" className="flex-shrink-0 text-[11px] font-medium text-indigo/70 hover:text-indigo">
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
                        <p className="truncate text-[13px] font-semibold text-[var(--mist)]">{item.type.replace(/_/g, ' ')}</p>
                        <p className="mt-1 truncate text-[11px] text-[var(--fog)]">{item.goal || (isZh ? '没有记录明确目标。' : 'No explicit goal recorded.')}</p>
                      </div>
                      <span className="rounded-full border border-amber/20 bg-amber/[0.08] px-2 py-1 text-[10px] font-semibold text-amber">
                        {isZh ? '已转人工' : 'human-owned'}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--fog)]">
                      {item.runId ? <span className="rounded-full bg-black/[0.04] px-2 py-1">{item.runId.slice(0, 8)}</span> : null}
                      <span className="rounded-full bg-black/[0.04] px-2 py-1">{item.messageCount ?? '0'} {isZh ? '条消息' : 'msgs'}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2 py-1">
                        <Clock3 className="h-3 w-3" />
                        {fmtRelative(item.updatedAt, locale)} {isZh ? '接管中' : 'human-owned'}
                      </span>
                    </div>
                  </button>
                )
              })}
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
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--fog)]">{isZh ? '当前 ProcedureRun' : 'Selected ProcedureRun'}</p>
                    <h2 className="mt-1 text-[18px] font-semibold text-[var(--mist)]">{detail.type.replace(/_/g, ' ')}</h2>
                    <p className="mt-1 break-words text-[12px] text-[var(--fog)]">
                      {isZh
                        ? `用户 ${detail.userId} · 会话 ${detail.chatId} · 更新于 ${fmtTimestamp(detail.updatedAt, locale)}`
                        : `User ${detail.userId} · Chat ${detail.chatId} · updated ${fmtTimestamp(detail.updatedAt, locale)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/operate/conversations/${encodeURIComponent(detail.chatId)}`}
                      className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white px-4 py-2 text-[12px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/20 hover:text-indigo"
                    >
                      {isZh ? '打开会话' : 'Open conversation'}
                    </Link>
                    <Link
                      href={`/operate/conversations/runs/${encodeURIComponent(detail.runId ?? '')}`}
                      className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white px-4 py-2 text-[12px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/20 hover:text-indigo"
                    >
                      {isZh ? '打开 ProcedureRun 详情' : 'Open ProcedureRun detail'}
                    </Link>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <DetailCard label={isZh ? '当前阻塞点' : 'Current blocker'} value={detail.blocker || (isZh ? '未记录' : 'Not recorded')} />
                  <DetailCard label={isZh ? '消息数' : 'Messages'} value={String(detail._count?.messages ?? 0)} />
                  <DetailCard label={isZh ? '时间线事件' : 'Timeline events'} value={String(detail._count?.traces ?? 0)} />
                </div>

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                  <div className="space-y-4">
                    <Panel title={isZh ? '最新人工任务' : 'Latest human task'} description={isZh ? '接管目标，以及 Agent 交给人工处理的请求内容。' : 'Handoff target and the request the agent handed to a human operator.'}>
                      {latestTask ? (
                        <div className="space-y-3">
                          <InlineRow label={isZh ? '接管目标' : 'Target'} value={latestTask.queue || (isZh ? '未设置' : 'Not set')} />
                          <InlineRow label={isZh ? '状态' : 'Status'} value={latestTask.status || (isZh ? '待处理' : 'pending')} />
                          <InlineRow label={isZh ? '创建时间' : 'Created'} value={fmtTimestamp(latestTask.createdAt, locale)} />
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">{isZh ? '问题' : 'Question'}</p>
                            <p className="mt-1 rounded-2xl border border-black/[0.06] bg-white/80 px-4 py-3 text-[13px] leading-6 text-[var(--mist)]">
                              {latestTask.question || (isZh ? '没有保存给人工操作员的问题。' : 'No operator question stored.')}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[13px] text-[var(--fog)]">{isZh ? '这个 ProcedureRun 没有返回任何 human task 载荷。' : 'No human task payload was returned for this ProcedureRun.'}</p>
                      )}
                    </Panel>

                    <Panel title={isZh ? '运行备注' : 'Run notes'} description={isZh ? 'ProcedureRun 当前携带的摘要和下一步引导。' : 'Current summary and next-step guidance carried with the ProcedureRun.'}>
                      <div className="space-y-3 text-[13px] leading-6 text-[var(--mist)]">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">{isZh ? '摘要' : 'Summary'}</p>
                          <p className="mt-1">{detail.memory?.summary || (isZh ? '还没有记录摘要。' : 'No summary recorded yet.')}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">{isZh ? '待办项' : 'Open items'}</p>
                          <p className="mt-1">{detail.memory?.todos || (isZh ? '还没有记录待办项。' : 'No open items recorded.')}</p>
                        </div>
                      </div>
                    </Panel>
                  </div>

                  <Panel title={isZh ? '接管时间线' : 'Handoff timeline'} description={isZh ? '当前转人工记录的关键时间点。' : 'Quick checkpoints for the current handoff record.'}>
                    <div className="space-y-3">
                      <TimelineRow label={isZh ? '创建时间' : 'Created'} value={fmtTimestamp(detail.createdAt, locale)} />
                      <TimelineRow label={isZh ? '转人工时间' : 'Handed off'} value={fmtTimestamp(latestTask?.createdAt ?? detail.updatedAt, locale)} />
                      <TimelineRow label={isZh ? '最近接管活动' : 'Last handoff activity'} value={fmtTimestamp(detail.updatedAt, locale)} />
                      <TimelineRow label={isZh ? '接管时长' : 'Handoff age'} value={fmtRelative(detail.updatedAt, locale)} />
                    </div>
                  </Panel>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-black/[0.08] bg-white/55 text-[13px] text-[var(--fog)]">
                {isZh ? '选择一个转人工 ProcedureRun，就能在这里查看接管详情。' : 'Select a human-owned ProcedureRun to inspect its handoff detail.'}
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

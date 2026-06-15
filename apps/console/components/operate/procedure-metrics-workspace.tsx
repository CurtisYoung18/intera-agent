'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import EmptyState from '@/components/ui/empty-state'
import { ConsoleStatusPill } from '@/components/ui/console-chrome'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient } from '@/lib/api/client'
import type { ProcedureMetricsRow, ProcedureMetricsSummary } from '@/lib/operate/procedure-metrics'

interface ProcedureMetricsResponse {
  metrics: ProcedureMetricsSummary
}

function fmtPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function fmtTime(iso: string | null, locale: 'en' | 'zh'): string {
  if (!iso) return locale === 'zh' ? '暂无活动' : 'No activity'
  return new Date(iso).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function humanizeProcedureId(value: string): string {
  return value.replace(/[_-]/g, ' ')
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'teal' | 'amber' | 'indigo' | 'rose' | 'neutral'
}) {
  const toneClass: Record<typeof tone, string> = {
    teal: 'border-[#357f7c]/18 bg-[#357f7c]/[0.07] text-[#357f7c]',
    amber: 'border-amber/18 bg-amber/[0.08] text-amber',
    indigo: 'border-indigo/18 bg-indigo/[0.08] text-indigo',
    rose: 'border-vermillion/18 bg-vermillion/[0.06] text-vermillion',
    neutral: 'border-black/[0.06] bg-white/82 text-[var(--mist)]',
  }

  return (
    <div className={`rounded-[22px] border px-4 py-3 shadow-[0_14px_40px_rgba(21,23,25,0.04)] ${toneClass[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em]">{label}</p>
      <p className="mt-1 text-[22px] font-semibold leading-none">{value}</p>
    </div>
  )
}

function ProcedureRow({ row }: { row: ProcedureMetricsRow }) {
  const { locale } = useConsoleLocale()
  const isZh = locale === 'zh'
  const terminalKnown = row.resolvedByAgent + row.handedOff + row.abandoned

  return (
    <article className="rounded-[28px] border border-black/[0.06] bg-white/[0.74] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-[18px] border border-[#357f7c]/14 bg-[#357f7c]/[0.08] text-[#357f7c]">
              <BarChart3 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-[17px] font-semibold capitalize text-[var(--mist)]">
                {humanizeProcedureId(row.procedureId)}
              </h2>
              <p className="mt-1 font-mono text-[11px] text-[var(--fog)]">{row.procedureId}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <ConsoleStatusPill status="completed">
              {isZh ? `AI 解决 ${row.resolvedByAgent}` : `Resolved ${row.resolvedByAgent}`}
            </ConsoleStatusPill>
            <ConsoleStatusPill status="waiting_human">
              {isZh ? `转人工 ${row.handedOff}` : `Handed off ${row.handedOff}`}
            </ConsoleStatusPill>
            <ConsoleStatusPill status={row.unknownTerminal > 0 ? 'blocked' : 'active'}>
              {isZh ? `未知终态 ${row.unknownTerminal}` : `Unknown terminal ${row.unknownTerminal}`}
            </ConsoleStatusPill>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[520px]">
          <MetricCard label={isZh ? '运行数' : 'Runs'} value={String(row.runs)} tone="neutral" />
          <MetricCard label={isZh ? '解决率' : 'Resolution'} value={fmtPercent(row.resolutionRate)} tone="teal" />
          <MetricCard label={isZh ? '转人工率' : 'Handoff'} value={fmtPercent(row.handoffRate)} tone="amber" />
          <MetricCard
            label={isZh ? '中位轮次' : 'Median turns'}
            value={row.medianTurnsToTerminal === null ? 'n/a' : String(row.medianTurnsToTerminal)}
            tone="indigo"
          />
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.76fr)]">
        <section className="rounded-[22px] border border-black/[0.05] bg-black/[0.018] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--fog)]">
              {isZh ? '最近 ProcedureRuns' : 'Recent ProcedureRuns'}
            </h3>
            <span className="text-[11px] text-[var(--fog)]">
              {terminalKnown}/{row.runs} {isZh ? '已知终态' : 'known terminal'}
            </span>
          </div>
          <div className="space-y-2">
            {row.recentRuns.map((run) => (
              <div
                key={run.id}
                className="flex flex-col gap-2 rounded-[18px] border border-black/[0.05] bg-white/78 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-[var(--mist)]">{run.id}</span>
                    <ConsoleStatusPill status={run.status}>{run.outcome ?? run.status}</ConsoleStatusPill>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-[var(--fog)]">
                    {run.currentStepId ? `${isZh ? '当前步骤' : 'Step'} ${run.currentStepId}` : (isZh ? '无活动步骤' : 'No active step')}
                    {' · '}
                    {run.turnsToTerminal === null ? (isZh ? '未终止' : 'not terminal') : `${run.turnsToTerminal} ${isZh ? '轮' : 'turns'}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {run.chatId ? (
                    <Link
                      href={`/operate/conversations/${encodeURIComponent(run.chatId)}`}
                      className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--fog)] hover:text-[var(--mist)]"
                    >
                      {isZh ? '对话' : 'Chat'}
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  ) : null}
                  <Link
                    href={`/operate/conversations/runs/${encodeURIComponent(run.id)}`}
                    className="inline-flex items-center gap-1 rounded-full border border-indigo/18 bg-indigo/[0.08] px-2.5 py-1 text-[11px] font-medium text-indigo hover:bg-indigo/[0.12]"
                  >
                    {isZh ? '详情' : 'Detail'}
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="rounded-[22px] border border-black/[0.05] bg-white/[0.68] p-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--fog)]">
            {isZh ? 'Top blockers' : 'Top blockers'}
          </h3>
          {row.topBlockers.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {row.topBlockers.map((blocker) => (
                <span
                  key={blocker.label}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-amber/18 bg-amber/[0.07] px-3 py-1.5 text-[11px] font-medium text-amber"
                >
                  <span className="truncate">{blocker.label}</span>
                  <span className="font-mono">{blocker.count}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[12px] leading-6 text-[var(--fog)]">
              {isZh ? '暂无 blocker 证据。' : 'No blocker evidence recorded yet.'}
            </p>
          )}

          <Link
            href={`/build/components/procedures/${encodeURIComponent(row.procedureId)}`}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[18px] border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-4 py-3 text-[13px] font-semibold text-[#2b7370] transition-all hover:bg-[#357f7c]/[0.13]"
          >
            <BookOpen className="h-4 w-4" />
            {isZh ? '打开 playbook' : 'Open playbook'}
          </Link>
        </aside>
      </div>
    </article>
  )
}

export default function ProcedureMetricsWorkspace() {
  const { locale } = useConsoleLocale()
  const isZh = locale === 'zh'
  const [summary, setSummary] = useState<ProcedureMetricsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const result = await apiClient<ProcedureMetricsResponse>('/api/operate/procedures/metrics')
      setSummary(result.data.metrics)
      setLoadError(null)
    } catch {
      setLoadError(isZh ? '加载流程指标失败' : 'Failed to load Procedure metrics')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [isZh])

  useEffect(() => {
    void load(true)
    const intervalId = setInterval(() => void load(false), 30_000)
    return () => clearInterval(intervalId)
  }, [load])

  const rows = summary?.rows ?? []

  return (
    <div className="mx-auto flex max-w-[1580px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="rounded-[28px] border border-black/[0.06] bg-white/[0.72] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#357f7c]">
              <ShieldCheck className="h-3.5 w-3.5" />
              {isZh ? '运营反馈' : 'Operate feedback'}
            </div>
            <h1 className="mt-3 text-[clamp(1.45rem,2vw,1.95rem)] font-semibold tracking-tight text-[var(--mist)]">
              {isZh ? '流程指标' : 'Procedure metrics'}
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--fog)]">
              {isZh
                ? '按 Procedure 聚合真实运行结果，追踪 AI 解决、转人工、放弃、未知终态和 blocker。这里展示的是运营反馈，不替代逐条生产 receipt。'
                : 'Group live ProcedureRuns by playbook and track AI resolution, human handoff, abandonment, unknown terminals, and blockers. This is operating feedback, not a replacement for per-run production receipts.'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[16px] border border-black/[0.06] bg-white/82 px-4 text-[13px] font-semibold text-[var(--mist)] shadow-[0_14px_38px_rgba(21,23,25,0.05)] transition-all hover:-translate-y-[1px] disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {isZh ? '刷新' : 'Refresh'}
          </button>
        </div>

        {summary ? (
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
            <MetricCard label={isZh ? '总运行' : 'Total runs'} value={String(summary.totalRuns)} tone="neutral" />
            <MetricCard label={isZh ? 'AI 解决' : 'AI resolved'} value={fmtPercent(summary.resolutionRate)} tone="teal" />
            <MetricCard label={isZh ? '转人工' : 'Handoff'} value={fmtPercent(summary.handoffRate)} tone="amber" />
            <MetricCard label={isZh ? '放弃' : 'Abandoned'} value={fmtPercent(summary.abandonmentRate)} tone="rose" />
            <MetricCard label={isZh ? '未知终态' : 'Unknown terminal'} value={String(summary.unknownTerminal)} tone="indigo" />
            <MetricCard label={isZh ? '最近活动' : 'Latest'} value={fmtTime(summary.latestActivityAt, locale)} tone="neutral" />
          </div>
        ) : null}
      </header>

      {loadError ? (
        <div className="inline-flex items-center gap-2 self-start rounded-full border border-vermillion/18 bg-vermillion/[0.06] px-3 py-1.5 text-[12px] text-vermillion shadow-[var(--shadow-card)]">
          <AlertCircle className="h-3.5 w-3.5" />
          {loadError}
        </div>
      ) : null}

      {loading && !summary ? (
        <section className="rounded-[28px] border border-black/[0.06] bg-white/[0.64] p-8 text-center shadow-[var(--shadow-card)]">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#357f7c]" />
          <p className="mt-3 text-[13px] text-[var(--fog)]">
            {isZh ? '正在读取流程指标...' : 'Loading Procedure metrics...'}
          </p>
        </section>
      ) : rows.length === 0 ? (
        <section className="mx-auto w-full max-w-xl rounded-[28px] border border-dashed border-black/[0.08] bg-white/[0.56] px-6 py-16 text-center shadow-[var(--shadow-card)]">
          <EmptyState
            icon={Clock3}
            title={isZh ? '还没有 ProcedureRun 指标' : 'No Procedure metrics yet'}
            description={isZh
              ? '当生产或本地运行产生 ProcedureRun 后，这里会按流程展示解决率、转人工率和 blocker。'
              : 'Once production or local runs create ProcedureRuns, this view will show resolution, handoff, and blocker signals by playbook.'}
          />
        </section>
      ) : (
        <section className="space-y-4">
          {rows.map((row) => (
            <ProcedureRow key={row.procedureId} row={row} />
          ))}
        </section>
      )}
    </div>
  )
}

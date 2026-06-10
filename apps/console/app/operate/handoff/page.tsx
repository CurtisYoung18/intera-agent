'use client'

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRight, ArrowUpRight, Clock3, Handshake, Loader2, Sparkles } from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import { apiClient, ApiClientError } from '@/lib/api/client'
import type { CaseDetailResponse, CasesListResponse } from '@intera/shared/contracts/cases'

interface HandoffCaseSummary {
  id: string
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

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.max(0, Math.floor(diff / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function fmtTimestamp(iso: string | null | undefined) {
  if (!iso) return 'Not recorded'
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function avgWaitLabel(cases: HandoffCaseSummary[]) {
  if (cases.length === 0) return '0m'
  const avgMinutes = Math.round(
    cases.reduce((sum, item) => sum + (Date.now() - new Date(item.updatedAt).getTime()) / 60_000, 0) / cases.length,
  )
  if (avgMinutes < 60) return `${avgMinutes}m`
  const hours = Math.round((avgMinutes / 60) * 10) / 10
  return `${hours}h`
}

export default function HumanHandoffPage() {
  const [cases, setCases] = useState<HandoffCaseSummary[]>([])
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null)
  const [detail, setDetail] = useState<HandoffCaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadQueue() {
      setLoading(true)
      setError(null)
      try {
        const result = await apiClient<CasesListResponse>('/api/cases?status=waiting_human&limit=100')
        if (!active) return
        const nextCases = result.data.cases as HandoffCaseSummary[]
        setCases(nextCases)
        setSelectedCaseId((prev) => {
          if (prev && nextCases.some((item) => item.id === prev)) return prev
          return nextCases[0]?.id ?? null
        })
      } catch (err) {
        if (!active) return
        setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to load handoff queue')
        setCases([])
        setSelectedCaseId(null)
      } finally {
        if (active) setLoading(false)
      }
    }

    loadQueue()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selectedCaseId) {
      setDetail(null)
      return
    }
    const caseId = selectedCaseId

    let active = true

    async function loadDetail() {
      setDetailLoading(true)
      try {
        const result = await apiClient<CaseDetailResponse>(`/api/cases/${encodeURIComponent(caseId)}`)
        if (!active) return
        setDetail(result.data.case as HandoffCaseDetail)
      } catch (err) {
        if (!active) return
        setDetail(null)
        setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to load handoff detail')
      } finally {
        if (active) setDetailLoading(false)
      }
    }

    loadDetail()
    return () => {
      active = false
    }
  }, [selectedCaseId])

  const queueCount = cases.length
  const procedureTypes = useMemo(() => new Set(cases.map((item) => item.type)).size, [cases])
  const longestWait = useMemo(() => {
    if (cases.length === 0) return '0m'
    const oldest = [...cases].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())[0]
    return fmtRelative(oldest.updatedAt)
  }, [cases])
  const latestTask = detail?.humanTasks?.[0]

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <OrganicLoader icon="spin" size={28} className="text-indigo/60" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 rounded-[28px] border border-black/[0.06] bg-white/70 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-lavender/20 bg-lavender/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-lavender">
            <Handshake className="h-3.5 w-3.5" />
            Handoff
          </div>
          <h1 className="mt-3 text-[clamp(1.4rem,2vw,1.9rem)] font-semibold tracking-tight text-[var(--mist)]">Human Handoff</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[var(--fog)]">
            Review `waiting_human` ProcedureRuns, inspect the latest HumanTask request, and jump into the linked Chat or ProcedureRun detail without leaving the Operate lane.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <MetricCard label="Queue" value={String(queueCount)} accent="amber" />
            <MetricCard label="Avg wait" value={avgWaitLabel(cases)} accent="indigo" />
            <MetricCard label="Procedure types" value={String(procedureTypes)} accent="teal" />
            <MetricCard label="Longest wait" value={longestWait} accent="vermillion" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/build/components/procedures"
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/84 px-3 py-1.5 text-[11px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/18 hover:text-indigo"
            >
              Procedures
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/build/components/hooks"
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/84 px-3 py-1.5 text-[11px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/18 hover:text-indigo"
            >
              Hooks
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-vermillion/20 bg-vermillion/[0.06] px-4 py-3 text-[13px] text-vermillion">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {cases.length === 0 ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-dashed border-black/[0.08] bg-white/55 px-6 text-center shadow-[var(--shadow-card)]">
          <Sparkles className="h-6 w-6 text-indigo/55" />
          <h2 className="mt-4 text-[15px] font-semibold text-[var(--mist)]">No active handoffs</h2>
          <p className="mt-2 max-w-md text-[13px] leading-6 text-[var(--fog)]">
            The queue is clear right now. New human-task escalations will appear here as soon as a ProcedureRun moves to `waiting_human`.
          </p>
          <Link
            href="/operate/conversations"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white px-4 py-2 text-[12px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/20 hover:text-indigo"
          >
            Open Conversations
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <section className="rounded-[28px] border border-black/[0.06] bg-white/68 p-4 shadow-[var(--shadow-card)] backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between px-1">
              <div>
                <h2 className="text-[14px] font-semibold text-[var(--mist)]">Waiting Queue</h2>
                <p className="text-[11px] text-[var(--fog)]">Sorted by latest queue activity.</p>
              </div>
              <Link href="/operate/conversations" className="text-[11px] font-medium text-indigo/70 hover:text-indigo">
                All conversations
              </Link>
            </div>

            <div className="space-y-3">
              {cases.map((item) => {
                const selected = item.id === selectedCaseId
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedCaseId(item.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-[border-color,transform,box-shadow] ${
                      selected
                        ? 'border-indigo/30 bg-indigo/[0.06] shadow-[0_10px_25px_-18px_rgba(79,70,229,0.6)]'
                        : 'border-black/[0.06] bg-white/80 hover:-translate-y-[1px] hover:border-black/[0.12]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-[var(--mist)]">{item.type.replace(/_/g, ' ')}</p>
                        <p className="mt-1 truncate text-[11px] text-[var(--fog)]">{item.goal || 'No explicit goal recorded.'}</p>
                      </div>
                      <span className="rounded-full border border-amber/20 bg-amber/[0.08] px-2 py-1 text-[10px] font-semibold text-amber">
                        waiting_human
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[var(--fog)]">
                      <span className="rounded-full bg-black/[0.04] px-2 py-1">{item.id.slice(0, 8)}</span>
                      <span className="rounded-full bg-black/[0.04] px-2 py-1">{item.messageCount ?? '0'} msgs</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2 py-1">
                        <Clock3 className="h-3 w-3" />
                        {fmtRelative(item.updatedAt)} waiting
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="rounded-[28px] border border-black/[0.06] bg-white/72 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
            {detailLoading ? (
              <div className="flex min-h-[320px] items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-indigo/60" />
              </div>
            ) : detail ? (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 border-b border-black/[0.06] pb-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--fog)]">Selected ProcedureRun</p>
                    <h2 className="mt-1 text-[18px] font-semibold text-[var(--mist)]">{detail.type.replace(/_/g, ' ')}</h2>
                    <p className="mt-1 text-[12px] text-[var(--fog)]">
                      User {detail.userId} · Chat {detail.chatId} · updated {fmtTimestamp(detail.updatedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/operate/conversations/${encodeURIComponent(detail.chatId)}`}
                      className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white px-4 py-2 text-[12px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/20 hover:text-indigo"
                    >
                      Open conversation
                    </Link>
                    <Link
                      href={`/operate/conversations/cases/${encodeURIComponent(detail.id)}`}
                      className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white px-4 py-2 text-[12px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/20 hover:text-indigo"
                    >
                      Open ProcedureRun detail
                    </Link>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <DetailCard label="Current blocker" value={detail.blocker || 'Not recorded'} />
                  <DetailCard label="Messages" value={String(detail._count?.messages ?? 0)} />
                  <DetailCard label="Traces" value={String(detail._count?.traces ?? 0)} />
                </div>

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                  <div className="space-y-4">
                    <Panel title="Latest human task" description="Queue target and the request the agent handed to a human operator.">
                      {latestTask ? (
                        <div className="space-y-3">
                          <InlineRow label="Queue" value={latestTask.queue || 'Not set'} />
                          <InlineRow label="Status" value={latestTask.status || 'pending'} />
                          <InlineRow label="Created" value={fmtTimestamp(latestTask.createdAt)} />
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">Question</p>
                            <p className="mt-1 rounded-2xl border border-black/[0.06] bg-white/80 px-4 py-3 text-[13px] leading-6 text-[var(--mist)]">
                              {latestTask.question || 'No operator question stored.'}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[13px] text-[var(--fog)]">No human task payload was returned for this ProcedureRun.</p>
                      )}
                    </Panel>

                    <Panel title="Run notes" description="Current summary and next-step guidance carried with the ProcedureRun.">
                      <div className="space-y-3 text-[13px] leading-6 text-[var(--mist)]">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">Summary</p>
                          <p className="mt-1">{detail.memory?.summary || 'No summary recorded yet.'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">Open items</p>
                          <p className="mt-1">{detail.memory?.todos || 'No open items recorded.'}</p>
                        </div>
                      </div>
                    </Panel>
                  </div>

                  <Panel title="Queue timeline" description="Quick checkpoints for the current handoff record.">
                    <div className="space-y-3">
                      <TimelineRow label="Created" value={fmtTimestamp(detail.createdAt)} />
                      <TimelineRow label="Entered queue" value={fmtTimestamp(latestTask?.createdAt ?? detail.updatedAt)} />
                      <TimelineRow label="Last queue activity" value={fmtTimestamp(detail.updatedAt)} />
                      <TimelineRow label="Relative wait" value={fmtRelative(detail.updatedAt)} />
                    </div>
                  </Panel>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-black/[0.08] bg-white/55 text-[13px] text-[var(--fog)]">
                Select a waiting ProcedureRun to inspect its handoff detail.
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

type Accent = 'amber' | 'indigo' | 'teal' | 'vermillion'

function MetricCard({ label, value, accent }: { label: string; value: string; accent: Accent }) {
  const accentMap: Record<Accent, string> = {
    amber: 'text-amber border-amber/20 bg-amber/[0.06]',
    indigo: 'text-indigo border-indigo/20 bg-indigo/[0.06]',
    teal: 'text-[#357f7c] border-[#357f7c]/20 bg-[#357f7c]/[0.06]',
    vermillion: 'text-vermillion border-vermillion/20 bg-vermillion/[0.06]',
  }

  return (
    <div className={`min-w-[120px] rounded-2xl border px-4 py-3 ${accentMap[accent]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em]">{label}</p>
      <p className="mt-1 text-[18px] font-semibold">{value}</p>
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

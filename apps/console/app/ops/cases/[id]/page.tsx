'use client'

import { useState, useEffect, use, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useConsoleLocale } from '@/components/locale-provider'
import { translatedCaseStatus, translatedMsgRole } from '@/lib/i18n/dictionaries'
import { ConsoleBackButton, ConsoleStatusPill, ConsoleToolbarButton } from '@/components/ui/console-chrome'
import { Zap, Clock, Cpu, Brain, Tag, User, Calendar } from 'lucide-react'
import { CaseTraceTimeline } from '@/components/ops/case-trace-view'
import { caseIdBadge } from '@/lib/ops-case-display'

interface MsgItem {
  id: string
  role: string
  content: string
  createdAt: string
}

interface CaseData {
  id: string
  type: string
  status: string
  userId: string
  goal: string | null
  blocker: string | null
  createdAt: string
  updatedAt: string
  memory?: {
    confirmedFacts: string
    missingFacts: string
    skillsCalled: string
    summary: string | null
  } | null
  _count?: { messages: number; traces: number }
}

function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function fmtLatency(ms: number): string {
  if (ms >= 60_000) return (ms / 60_000).toFixed(1) + 'm'
  if (ms >= 1_000) return (ms / 1_000).toFixed(1) + 's'
  return ms + 'ms'
}

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { t } = useConsoleLocale()
  const [caseData, setCaseData] = useState<CaseData | null>(null)
  const [traces, setTraces] = useState<
    {
      id: string
      actionType: string
      title: string
      detail: string | null
      payload: string | null
      createdAt: string
    }[]
  >([])
  const [messages, setMessages] = useState<MsgItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [caseRes, traceRes, msgRes] = await Promise.all([
          fetch(`/api/cases/${id}`),
          fetch(`/api/cases/${id}/traces?limit=200`),
          fetch(`/api/cases/${id}/messages?limit=200`),
        ])
        if (caseRes.ok) {
          const d = await caseRes.json()
          setCaseData(d.case)
        }
        if (traceRes.ok) {
          const d = await traceRes.json()
          setTraces(d.traces)
        }
        if (msgRes.ok) {
          const d = await msgRes.json()
          setMessages(d.messages)
        }
      } catch { /* ignore */ } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const metrics = useMemo(() => {
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let compactTokens = 0
    let turnWallMs = 0
    let toolPhaseMs = 0
    let llmCalls = 0

    for (const trace of traces) {
      if (trace.actionType === 'llm_response') {
        const p = parsePayload(trace.payload)
        const u = (p?.usage as Record<string, number> | undefined) ?? {}
        inputTokens += u.input_tokens ?? 0
        outputTokens += u.output_tokens ?? 0
        cacheReadTokens += u.cache_read_input_tokens ?? 0
        cacheWriteTokens += u.cache_creation_input_tokens ?? 0
        llmCalls++
      }
      if (trace.actionType === 'loop_decision') {
        const p = parsePayload(trace.payload)
        if (!p) continue
        if (trace.title === 'Profiler Snapshot') {
          if (typeof p.totalDurationMs === 'number') turnWallMs += p.totalDurationMs
          if (typeof p.toolExecutionMs === 'number') toolPhaseMs += p.toolExecutionMs
        }
        if (trace.title === 'LLM Compact' && typeof p.tokensUsed === 'number') {
          compactTokens += p.tokensUsed
        }
      }
    }

    const billableTokensEnvelope =
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens + compactTokens

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      compactTokens,
      billableTokensEnvelope,
      turnWallMs,
      toolPhaseMs,
      llmCalls,
    }
  }, [traces])

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[var(--bg-root)] flex items-center justify-center">
        <p className="text-secondary/40 animate-breathe">{t('common.loading')}</p>
      </div>
    )
  }

  const dateStr =
    caseData?.createdAt
      ? new Date(caseData.createdAt).toLocaleDateString()
      : '—'
  const badge = caseIdBadge(id)

  return (
    <div className="relative min-h-[100dvh] flex flex-col">

      <header className="relative z-10 flex-shrink-0 border-b border-black/[0.05] bg-[var(--bg-sidebar)]/50 backdrop-blur-xl">
        <div className="relative mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-6 py-3">
          <div className="flex min-w-0 justify-start">
            <ConsoleBackButton
              label={t('caseDetail.backLabel')}
              ariaLabel={t('caseDetail.backAria')}
              onClick={() => router.push('/ops/cases')}
            />
          </div>

          <div className="min-w-0 max-w-[min(72vw,420px)] px-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">{t('caseDetail.caseEyebrow')}</p>
            <h1 className="mt-1 truncate font-semibold tracking-tight text-[var(--mist)]" title={badge.titleAttr}>
              <span className="inline-flex items-center rounded-xl border border-black/[0.06] bg-white/55 px-3 py-1 font-mono text-[13px] tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                {badge.short}
              </span>
            </h1>
            {caseData && (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-[var(--smoke)]">
                <span className="inline-flex items-center gap-1">
                  <Tag className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  <span>{caseData.type?.replace(/_/g, ' ') ?? '—'}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  <span className="max-w-[min(42vw,160px)] truncate" title={caseData.userId}>
                    {caseData.userId}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  <span>{dateStr}</span>
                </span>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
            <ConsoleToolbarButton icon={Brain} onClick={() => router.push(`/ops/cases/${id}/memory`)}>
              {t('caseDetail.memory')}
            </ConsoleToolbarButton>
            {caseData && (
              <ConsoleStatusPill status={caseData.status}>
                {translatedCaseStatus(t, caseData.status)}
              </ConsoleStatusPill>
            )}
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6 py-6 lg:max-w-4xl xl:max-w-5xl">

        {/* ── Stats Row ── */}
        {caseData && (
          <div className="flex gap-4 mb-4 text-[11px] font-sans text-secondary/40">
            <span>{t('caseDetail.statsMsgs', { n: caseData._count?.messages ?? 0 })}</span>
            <span>{t('caseDetail.statsTraces', { n: caseData._count?.traces ?? 0 })}</span>
            {caseData.blocker && <span className="text-amber/60">{t('caseDetail.blocker', { text: caseData.blocker })}</span>}
          </div>
        )}

        {/* ── Metrics Summary Bar ── */}
        {(metrics.llmCalls > 0 ||
          metrics.turnWallMs > 0 ||
          metrics.compactTokens > 0 ||
          metrics.billableTokensEnvelope > 0) && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="glass-card !rounded-xl px-4 py-3 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Zap className="w-4 h-4 text-indigo" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-sans tracking-[0.04em] uppercase text-secondary/40 mb-0.5">{t('caseDetail.totalTokens')}</p>
                <p className="text-[18px] font-semibold text-primary tracking-[-0.02em] tabular-nums">{fmtNum(metrics.billableTokensEnvelope)}</p>
                <p className="text-[10px] font-mono text-secondary/40 mt-0.5">
                  {t('caseDetail.tokensIn', { n: fmtNum(metrics.inputTokens) })} · {t('caseDetail.tokensOut', { n: fmtNum(metrics.outputTokens) })}
                </p>
                {(metrics.cacheReadTokens > 0 || metrics.cacheWriteTokens > 0) && (
                  <p className="text-[10px] font-mono text-secondary/35 mt-0.5">
                    {t('caseDetail.tokensCacheHint', {
                      read: fmtNum(metrics.cacheReadTokens),
                      write: fmtNum(metrics.cacheWriteTokens),
                    })}
                  </p>
                )}
                {metrics.compactTokens > 0 && (
                  <p className="text-[10px] font-mono text-secondary/35 mt-0.5">
                    {t('caseDetail.tokensCompactHint', { n: fmtNum(metrics.compactTokens) })}
                  </p>
                )}
                <p className="text-[9px] text-secondary/30 mt-1 leading-snug">{t('caseDetail.tokensBillableFootnote')}</p>
              </div>
            </div>

            <div className="glass-card !rounded-xl px-4 py-3 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Clock className="w-4 h-4 text-amber" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-sans tracking-[0.04em] uppercase text-secondary/40 mb-0.5">{t('caseDetail.turnWallTime')}</p>
                <p className="text-[18px] font-semibold text-primary tracking-[-0.02em] tabular-nums">{fmtLatency(metrics.turnWallMs)}</p>
                <p className="text-[10px] font-mono text-secondary/40 mt-0.5">{t('caseDetail.skillsPhase', { n: fmtLatency(metrics.toolPhaseMs) })}</p>
              </div>
            </div>

            <div className="glass-card !rounded-xl px-4 py-3 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-malachite/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Cpu className="w-4 h-4 text-malachite" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-sans tracking-[0.04em] uppercase text-secondary/40 mb-0.5">{t('caseDetail.llmCalls')}</p>
                <p className="text-[18px] font-semibold text-primary tracking-[-0.02em] tabular-nums">{metrics.llmCalls}</p>
                <p className="text-[10px] text-secondary/35 mt-0.5 leading-snug">{t('caseDetail.llmCallsHint')}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Trace timeline ── */}
        <section className="mb-10">
          <h2 className="mb-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">
            {t('caseDetail.timelineSection')}
          </h2>
          <CaseTraceTimeline traces={traces} t={t} />
        </section>

        {/* ── Conversation (persisted thread) ── */}
        <section className="rounded-2xl border border-black/[0.06] bg-gradient-to-b from-white/50 to-[var(--void)]/40 p-5 shadow-[var(--shadow-card)] backdrop-blur-sm">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">
            {t('caseDetail.conversation')}
          </h2>
          {messages.length > 0 ? (
            <div className="space-y-3">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[min(100%,420px)] rounded-2xl px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] ${
                      msg.role === 'user'
                        ? 'rounded-br-md border border-indigo/[0.14] bg-gradient-to-br from-indigo/[0.12] to-indigo/[0.03]'
                        : 'rounded-bl-md border border-black/[0.06] bg-white/55'
                    }`}
                  >
                    <p className="text-[13px] leading-relaxed text-[var(--mist)]/90 whitespace-pre-wrap">{msg.content}</p>
                    <p className="mt-2 text-[10px] text-[var(--smoke)]">
                      {translatedMsgRole(t, msg.role)} ·{' '}
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-[13px] text-[var(--smoke)]/60">{t('caseDetail.noMsgs')}</p>
          )}
        </section>
      </div>
    </div>
  )
}

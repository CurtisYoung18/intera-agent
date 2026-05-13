'use client'

import { useState, useEffect, use, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useConsoleLocale } from '@/components/locale-provider'
import { translatedCaseStatus, translatedMsgRole } from '@/lib/i18n/dictionaries'
import { ConsoleBackButton, ConsoleStatusPill, ConsoleToolbarButton } from '@/components/ui/console-chrome'
import { Zap, Clock, Cpu, Brain } from 'lucide-react'

interface TraceItem {
  id: string
  actionType: string
  title: string
  detail: string | null
  payload: string | null
  createdAt: string
}

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

const ACTION_COLORS: Record<string, string> = {
  user_message: 'text-secondary/70',
  case_created: 'text-secondary/60',
  fact_extracted: 'text-amber/70',
  policy_hit: 'text-vermillion/70',
  skill_called: 'text-amber/80',
  skill_result: 'text-malachite/70',
  human_task_created: 'text-amber',
  human_task_resolved: 'text-malachite',
  final_resolution: 'text-malachite',
  loop_decision: 'text-secondary/40',
  stream_event: 'text-secondary/30',
  llm_request_start: 'text-indigo/70',
  llm_response: 'text-indigo/80',
}

const ACTION_BADGE_COLORS: Record<string, string> = {
  user_message: 'bg-fog/10 border-fog/20',
  skill_called: 'bg-amber/10 border-amber/20',
  skill_result: 'bg-malachite/10 border-malachite/20',
  human_task_created: 'bg-amber/10 border-amber/30',
  final_resolution: 'bg-malachite/10 border-malachite/30',
  policy_hit: 'bg-vermillion/10 border-vermillion/20',
  llm_request_start: 'bg-indigo/10 border-indigo/20',
  llm_response: 'bg-indigo/10 border-indigo/20',
  loop_decision: 'bg-fog/5 border-fog/10',
}

function formatActionType(actionType: string): string {
  return actionType.replace(/_/g, ' ')
}

function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
  const [traces, setTraces] = useState<TraceItem[]>([])
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
    let totalLatency = 0
    let llmCalls = 0

    for (const trace of traces) {
      if (trace.actionType === 'llm_response') {
        const p = parsePayload(trace.payload)
        const u = p?.usage as Record<string, number> | undefined
        if (u) {
          inputTokens += u.input_tokens ?? 0
          outputTokens += u.output_tokens ?? 0
        }
        llmCalls++
      }
      if (trace.actionType === 'skill_result') {
        const p = parsePayload(trace.payload)
        if (p?.latencyMs != null) {
          totalLatency += p.latencyMs as number
        }
      }
    }

    return { inputTokens, outputTokens, totalLatency, llmCalls }
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
  const meta =
    caseData &&
    t('caseDetail.meta', {
      type: caseData.type?.replace(/_/g, ' ') ?? '—',
      user: caseData.userId,
      date: dateStr,
    })

  return (
    <div className="relative min-h-[100dvh] flex flex-col">

      <header className="relative z-10 flex-shrink-0 border-b border-black/[0.05] bg-[var(--bg-sidebar)]/50 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <ConsoleBackButton
              label={t('caseDetail.backLabel')}
              ariaLabel={t('caseDetail.backAria')}
              onClick={() => router.push('/ops/cases')}
            />
            <div className="min-w-0">
              <h1 className="text-[14px] font-medium tracking-[-0.01em] text-primary">
                {t('caseDetail.title', { id: id.slice(0, 12) })}
              </h1>
              <p className="text-[11px] text-secondary/40">{meta}</p>
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2 sm:gap-3">
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

      <div className="relative z-10 flex-1 max-w-4xl mx-auto w-full px-6 py-6 overflow-y-auto">

        {/* ── Stats Row ── */}
        {caseData && (
          <div className="flex gap-4 mb-4 text-[11px] font-sans text-secondary/40">
            <span>{t('caseDetail.statsMsgs', { n: caseData._count?.messages ?? 0 })}</span>
            <span>{t('caseDetail.statsTraces', { n: caseData._count?.traces ?? 0 })}</span>
            {caseData.blocker && <span className="text-amber/60">{t('caseDetail.blocker', { text: caseData.blocker })}</span>}
          </div>
        )}

        {/* ── Metrics Summary Bar ── */}
        {(metrics.llmCalls > 0 || metrics.totalLatency > 0) && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="glass-card !rounded-xl px-4 py-3 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Zap className="w-4 h-4 text-indigo" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-sans tracking-[0.04em] uppercase text-secondary/40 mb-0.5">{t('caseDetail.totalTokens')}</p>
                <p className="text-[18px] font-semibold text-primary tracking-[-0.02em] tabular-nums">{fmtNum(metrics.inputTokens + metrics.outputTokens)}</p>
                <p className="text-[10px] font-mono text-secondary/40 mt-0.5">
                  {t('caseDetail.tokensIn', { n: fmtNum(metrics.inputTokens) })} · {t('caseDetail.tokensOut', { n: fmtNum(metrics.outputTokens) })}
                </p>
              </div>
            </div>

            <div className="glass-card !rounded-xl px-4 py-3 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Clock className="w-4 h-4 text-amber" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-sans tracking-[0.04em] uppercase text-secondary/40 mb-0.5">{t('caseDetail.totalLatency')}</p>
                <p className="text-[18px] font-semibold text-primary tracking-[-0.02em] tabular-nums">{fmtLatency(metrics.totalLatency)}</p>
              </div>
            </div>

            <div className="glass-card !rounded-xl px-4 py-3 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-malachite/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Cpu className="w-4 h-4 text-malachite" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-sans tracking-[0.04em] uppercase text-secondary/40 mb-0.5">{t('caseDetail.llmCalls')}</p>
                <p className="text-[18px] font-semibold text-primary tracking-[-0.02em] tabular-nums">{metrics.llmCalls}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Trace Timeline ── */}
        <div className="space-y-0">
          {traces.length === 0 && (
            <p className="text-secondary/30 text-[13px] py-8 text-center">{t('caseDetail.noTraces')}</p>
          )}

          {traces.map((trace, i) => {
            const color = ACTION_COLORS[trace.actionType] || 'text-secondary/50'
            const badge = ACTION_BADGE_COLORS[trace.actionType] || 'bg-fog/5 border-fog/10'
            const payload = parsePayload(trace.payload)
            const isLlmResponse = trace.actionType === 'llm_response'
            const isSkillResult = trace.actionType === 'skill_result'
            const hasMetrics = isLlmResponse || (isSkillResult && payload?.latencyMs != null)

            return (
              <div key={trace.id} className="flex gap-3 py-2.5 px-3 rounded-lg hover:bg-[var(--surface)] transition-colors group">
                <div className="flex flex-col items-center flex-shrink-0 pt-1">
                  <div className={`w-2 h-2 rounded-full ${color.replace('text-', 'bg-')}`} />
                  {i < traces.length - 1 && (
                    <div className="w-px flex-1 bg-[var(--surface)] mt-1" />
                  )}
                </div>

                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-block px-1.5 py-0 rounded text-[9px] font-sans tracking-[0.04em] uppercase border ${badge} ${color}`}>
                      {formatActionType(trace.actionType)}
                    </span>
                    <span className="text-[10px] font-mono text-secondary/30">{formatTime(trace.createdAt)}</span>

                    {/* ── Inline Metrics Badges ── */}
                    {isLlmResponse && payload && (() => {
                      const u = payload.usage as Record<string, number> | undefined
                      if (!u) return null
                      return (
                        <>
                          {u.input_tokens != null && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo/8 border border-indigo/15 text-[10px] font-mono font-medium text-indigo/80">
                              <Zap className="w-2.5 h-2.5" />
                              {t('caseDetail.tokensIn', { n: fmtNum(u.input_tokens) })}
                            </span>
                          )}
                          {u.output_tokens != null && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo/8 border border-indigo/15 text-[10px] font-mono font-medium text-indigo/80">
                              <Zap className="w-2.5 h-2.5" />
                              {t('caseDetail.tokensOut', { n: fmtNum(u.output_tokens) })}
                            </span>
                          )}
                        </>
                      )
                    })()}

                    {isSkillResult && payload?.latencyMs != null && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber/8 border border-amber/15 text-[10px] font-mono font-medium text-amber/80">
                        <Clock className="w-2.5 h-2.5" />
                        {t('caseDetail.ms', { n: payload.latencyMs as number })}
                      </span>
                    )}
                  </div>

                  <p className="text-[13px] text-primary/80">{trace.title}</p>

                  {trace.detail && (
                    <p className="text-[12px] text-secondary/50 mt-0.5">{trace.detail}</p>
                  )}

                  {payload && !isLlmResponse && !isSkillResult && (
                    <details className="mt-1.5">
                      <summary className="text-[10px] text-secondary/30 cursor-pointer hover:text-secondary/50 transition-colors">
                        {t('caseDetail.payload')}
                      </summary>
                      <pre className="mt-1 text-[10px] font-mono text-secondary/40 bg-[var(--surface)] rounded p-2 overflow-x-auto max-h-32">
                        {JSON.stringify(payload, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Conversation ── */}
        {messages.length > 0 && (
          <section className="mt-10">
            <h2 className="text-[12px] font-sans tracking-[0.06em] uppercase text-secondary/30 mb-4">{t('caseDetail.conversation')}</h2>
            <div className="space-y-3">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-xl px-4 py-2.5 ${
                    msg.role === 'user'
                      ? 'bg-indigo/[0.06] border border-indigo/[0.10] rounded-br-sm'
                      : 'bg-[var(--surface)] border border-[var(--border-subtle)] rounded-bl-sm'
                  }`}>
                    <p className="text-[13px] text-primary/85 leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-[10px] text-secondary/30 mt-1">
                      {translatedMsgRole(t, msg.role)} · {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {messages.length === 0 && (
          <section className="mt-10">
            <h2 className="text-[12px] font-sans tracking-[0.06em] uppercase text-secondary/30 mb-4">{t('caseDetail.conversation')}</h2>
            <p className="text-[13px] text-secondary/30 py-4">{t('caseDetail.noMsgs')}</p>
          </section>
        )}
      </div>
    </div>
  )
}

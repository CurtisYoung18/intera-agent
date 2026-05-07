'use client'

// Case Detail — trace timeline + conversation history
// Shows every agent action: LLM calls, tool executions, policy hits, decisions

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import FluidBackground from '@intera/shared/ui/fluid-background'

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

// ── Color map for action types ──────────────────────────────────
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

function formatActionType(t: string): string {
  return t.replace(/_/g, ' ')
}

function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
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

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[var(--bg-root)] flex items-center justify-center">
        <p className="text-secondary/40 animate-breathe">Loading…</p>
      </div>
    )
  }

  return (
    <div className="relative min-h-[100dvh] bg-[var(--bg-root)] flex flex-col">
      <FluidBackground intensity="subtle" />

      {/* Header */}
      <header className="relative z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)]/40 backdrop-blur-xl flex-shrink-0">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/ops/cases')} className="text-[13px] text-secondary/50 hover:text-secondary transition-colors">
              ← Back
            </button>
            <div>
              <h1 className="text-[14px] font-medium text-primary tracking-[-0.01em]">
                Case {id.slice(0, 12)}…
              </h1>
              <p className="text-[11px] text-secondary/40">
                {caseData?.type?.replace(/_/g, ' ')} · User {caseData?.userId} · Created {caseData?.createdAt ? new Date(caseData.createdAt).toLocaleDateString() : '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => router.push(`/ops/cases/${id}/memory`)} className="text-[12px] text-secondary/50 hover:text-secondary transition-colors">
              Memory
            </button>
            {caseData && (
              <span className={`text-[11px] font-sans tracking-[0.04em] uppercase ${
                caseData.status === 'resolved' ? 'text-malachite' :
                caseData.status === 'waiting_human' ? 'text-amber' :
                'text-secondary/60'
              }`}>
                {caseData.status.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="relative z-10 flex-1 max-w-4xl mx-auto w-full px-6 py-6 overflow-y-auto">
        {/* Stats row */}
        {caseData && (
          <div className="flex gap-4 mb-6 text-[11px] font-sans text-secondary/40">
            <span>{caseData._count?.messages || 0} messages</span>
            <span>{caseData._count?.traces || 0} traces</span>
            {caseData.blocker && <span className="text-amber/60">Blocker: {caseData.blocker}</span>}
          </div>
        )}

        {/* Trace Timeline */}
        <div className="space-y-1">
          {traces.length === 0 && (
            <p className="text-secondary/30 text-[13px] py-8 text-center">No traces recorded for this case.</p>
          )}

          {traces.map((trace, i) => {
            const color = ACTION_COLORS[trace.actionType] || 'text-secondary/50'
            const badge = ACTION_BADGE_COLORS[trace.actionType] || 'bg-fog/5 border-fog/10'
            const payload = parsePayload(trace.payload)

            return (
              <div key={trace.id} className="flex gap-3 py-2 px-3 rounded-lg hover:bg-[var(--surface)] transition-colors group">
                {/* Timeline dot + line */}
                <div className="flex flex-col items-center flex-shrink-0 pt-1">
                  <div className={`w-2 h-2 rounded-full ${color.replace('text-', 'bg-')}`} />
                  {i < traces.length - 1 && (
                    <div className="w-px flex-1 bg-[var(--surface)] mt-1" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`inline-block px-1.5 py-0 rounded text-[9px] font-sans tracking-[0.04em] uppercase border ${badge} ${color}`}>
                      {formatActionType(trace.actionType)}
                    </span>
                    <span className="text-[10px] font-mono text-secondary/30">{formatTime(trace.createdAt)}</span>
                  </div>

                  <p className="text-[13px] text-primary/80">{trace.title}</p>

                  {trace.detail && (
                    <p className="text-[12px] text-secondary/50 mt-0.5">{trace.detail}</p>
                  )}

                  {/* LLM response: show token usage */}
                  {trace.actionType === 'llm_response' && payload && (() => {
                    const u = payload.usage as Record<string, number> | undefined
                    if (!u) return null
                    return (
                      <div className="mt-1 flex gap-3 text-[10px] font-mono text-secondary/40">
                        {u.input_tokens != null && <span>in: {u.input_tokens}</span>}
                        {u.output_tokens != null && <span>out: {u.output_tokens}</span>}
                      </div>
                    )
                  })()}

                  {/* Skill result: show latency */}
                  {trace.actionType === 'skill_result' && payload?.latencyMs != null && (
                    <span className="text-[10px] font-mono text-secondary/40">
                      {payload.latencyMs as number}ms
                    </span>
                  )}

                  {/* Expandable payload for debugging */}
                  {payload && trace.actionType !== 'llm_response' && trace.actionType !== 'skill_result' && (
                    <details className="mt-1">
                      <summary className="text-[10px] text-secondary/30 cursor-pointer hover:text-secondary/50 transition-colors">
                        payload
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

        {/* Conversation */}
        {messages.length > 0 && (
          <section className="mt-10">
            <h2 className="text-[12px] font-sans tracking-[0.06em] uppercase text-secondary/30 mb-4">Conversation</h2>
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
                      {msg.role} · {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {messages.length === 0 && (
          <section className="mt-10">
            <h2 className="text-[12px] font-sans tracking-[0.06em] uppercase text-secondary/30 mb-4">Conversation</h2>
            <p className="text-[13px] text-secondary/30 py-4">No messages yet. Messages are persisted after the agent responds.</p>
          </section>
        )}
      </div>
    </div>
  )
}

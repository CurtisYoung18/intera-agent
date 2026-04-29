'use client'

// Human Task Detail — case summary + structured response form
// Void + Fluid Glass design

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import FluidBackground from '@intera/shared/ui/fluid-background'

interface CaseMemory {
  confirmedFacts: string
  missingFacts: string
  skillsCalled: string
  skillResults: string
  keyEvents: string
  summary: string | null
}

interface TraceEntry {
  id: string
  actionType: string
  title: string
  detail: string | null
  createdAt: string
}

interface TaskDetail {
  id: string
  caseId: string
  queue: string
  status: string
  question: string
  verdict: string | null
  expectedEta: string | null
  notes: string | null
  createdAt: string
  case: {
    id: string
    type: string
    status: string
    userId: string
    goal: string | null
    memory: CaseMemory | null
    traces: TraceEntry[]
  }
}

const VERDICT_OPTIONS = [
  { value: '', label: 'Select a verdict…' },
  { value: 'confirmed_success', label: 'Confirmed — payment will arrive' },
  { value: 'delayed_batch', label: 'Delayed batch — wait for processing' },
  { value: 'needs_retry', label: 'Needs retry — resubmit payment' },
  { value: 'failed', label: 'Failed — escalate to provider' },
  { value: 'escalated', label: 'Escalate to senior support' },
]

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function HumanTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [verdict, setVerdict] = useState('')
  const [expectedEta, setExpectedEta] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/human-tasks/${id}`)
      .then((r) => r.json())
      .then((data) => { setTask(data.task); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  const handleResolve = useCallback(async () => {
    if (!verdict) return
    setSubmitting(true)
    try {
      await fetch(`/api/human-tasks/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict, expectedEta, notes }),
      })
      router.push('/ops/human-tasks')
      router.refresh()
    } catch { setSubmitting(false) }
  }, [id, verdict, expectedEta, notes, router])

  if (loading) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <p className="text-fog/40 animate-breathe">Loading…</p>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <div className="glass-admin p-16 text-center">
          <p className="text-mist text-[16px] font-medium">Task not found</p>
        </div>
      </div>
    )
  }

  const memory = task.case.memory
  const facts = parseJson(memory?.confirmedFacts, {}) as Record<string, unknown>
  const skills = parseJson(memory?.skillsCalled, [] as string[])
  const skillResults = parseJson(memory?.skillResults, {} as Record<string, unknown>)
  const keyEvents = parseJson(memory?.keyEvents, [] as Array<{ at: string; text: string }>)

  return (
    <div className="relative min-h-screen bg-void">
      <FluidBackground intensity="subtle" />

      {/* Header */}
      <header className="relative z-10 border-b border-white/[0.04] bg-abyss/40 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <button
              onClick={() => router.push('/ops/human-tasks')}
              className="text-[13px] text-fog/50 hover:text-fog transition-colors mb-1"
            >
              ← Back to queue
            </button>
            <h1 className="text-[16px] font-medium text-mist tracking-[-0.01em]">
              {task.queue.replace(/_/g, ' ')} — {task.case.type.replace(/_/g, ' ')}
            </h1>
          </div>
          <span className="text-[12px] font-mono text-fog/30 tabular-nums">
            {task.caseId.slice(0, 12)}…
          </span>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left column: Case context ── */}
        <div className="space-y-4">
          {/* Agent question */}
          <section className="glass-admin p-5">
            <h2 className="text-[11px] font-sans tracking-[0.06em] uppercase text-fog/50 mb-3">
              Agent Question
            </h2>
            <p className="text-[15px] text-mist leading-relaxed">{task.question}</p>
            {task.case.goal && (
              <p className="text-[13px] text-fog/60 mt-3 italic">
                Goal: {task.case.goal}
              </p>
            )}
          </section>

          {/* Confirmed facts */}
          {Object.keys(facts).length > 0 && (
            <section className="glass-admin p-5">
              <h2 className="text-[11px] font-sans tracking-[0.06em] uppercase text-fog/50 mb-3">
                Confirmed Facts
              </h2>
              <dl className="space-y-2">
                {Object.entries(facts).map(([k, v]) => (
                  <div key={k} className="flex gap-3 text-[14px]">
                    <dt className="text-fog/50 min-w-[140px]">{k}</dt>
                    <dd className="text-mist font-mono text-[13px]">
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* Skills executed */}
          {skills.length > 0 && (
            <section className="glass-admin p-5">
              <h2 className="text-[11px] font-sans tracking-[0.06em] uppercase text-fog/50 mb-3">
                Skills Executed
              </h2>
              <div className="space-y-3">
                {skills.map((skill: string) => (
                  <div key={skill} className="border-l border-white/[0.06] pl-3">
                    <p className="text-[13px] font-medium text-mist capitalize">
                      {skill.replace(/_/g, ' ')}
                    </p>
                    {skillResults[skill] != null && (
                      <pre className="text-[12px] font-mono text-fog/50 mt-1 whitespace-pre-wrap leading-relaxed">
                        {JSON.stringify(skillResults[skill] as unknown, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Key events */}
          {keyEvents.length > 0 && (
            <section className="glass-admin p-5">
              <h2 className="text-[11px] font-sans tracking-[0.06em] uppercase text-fog/50 mb-3">
                Key Events
              </h2>
              <div className="space-y-2">
                {keyEvents.map((evt, i) => (
                  <div key={i} className="flex gap-3 text-[13px] group">
                    <span className="text-fog/30 font-mono flex-shrink-0 w-[44px] tabular-nums">
                      {formatTime(evt.at)}
                    </span>
                    <span className="text-mist/80">{evt.text}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Action trace */}
          {task.case.traces.length > 0 && (
            <section className="glass-admin p-5">
              <h2 className="text-[11px] font-sans tracking-[0.06em] uppercase text-fog/50 mb-3">
                Action Trace
              </h2>
              <div className="space-y-1 max-h-48 overflow-y-auto scroll-thin">
                {task.case.traces.map((t) => (
                  <div key={t.id} className="flex gap-2 text-[12px] group">
                    <span className="text-fog/25 font-mono flex-shrink-0 w-[44px] tabular-nums">
                      {formatTime(t.createdAt)}
                    </span>
                    <span className="text-fog/40 capitalize w-[100px] flex-shrink-0">
                      {t.actionType.replace(/_/g, ' ')}
                    </span>
                    <span className="text-mist/60 truncate">{t.title}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── Right column: Response form ── */}
        <div>
          <section className="glass-admin p-6 sticky top-6">
            <h2 className="text-[11px] font-sans tracking-[0.06em] uppercase text-fog/50 mb-5">
              Your Response
            </h2>

            {/* Verdict */}
            <label className="block text-[13px] text-fog/70 mb-2">Verdict</label>
            <select
              value={verdict}
              onChange={(e) => setVerdict(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg text-[14px] text-mist py-2.5 px-3 mb-5 outline-none focus:border-vermillion/30 transition-all duration-200 appearance-none cursor-pointer hover:bg-white/[0.05]"
            >
              {VERDICT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-abyss text-mist">
                  {opt.label}
                </option>
              ))}
            </select>

            {/* Expected ETA */}
            <label className="block text-[13px] text-fog/70 mb-2">
              Expected ETA <span className="text-fog/30">(optional)</span>
            </label>
            <input
              type="text"
              value={expectedEta}
              onChange={(e) => setExpectedEta(e.target.value)}
              placeholder="e.g. 2 hours, tomorrow morning"
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg text-[14px] text-mist py-2.5 px-3 mb-5 outline-none focus:border-vermillion/30 transition-all duration-200 placeholder:text-fog/20 hover:bg-white/[0.05]"
            />

            {/* Notes */}
            <label className="block text-[13px] text-fog/70 mb-2">
              Notes <span className="text-fog/30">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional information for the agent…"
              rows={3}
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg text-[14px] text-mist py-2.5 px-3 mb-6 outline-none focus:border-vermillion/30 transition-all duration-200 placeholder:text-fog/20 hover:bg-white/[0.05] resize-none"
            />

            {/* Submit */}
            <button
              onClick={handleResolve}
              disabled={!verdict || submitting}
              className="w-full py-3 rounded-lg text-[14px] font-medium transition-all duration-300
                bg-vermillion/80 hover:bg-vermillion text-white
                disabled:bg-white/[0.03] disabled:text-fog/20 disabled:cursor-not-allowed
                shadow-[0_0_20px_rgba(230,69,57,0.1)] hover:shadow-[0_0_30px_rgba(230,69,57,0.2)]"
            >
              {submitting ? 'Submitting…' : 'Resolve & Resume Agent'}
            </button>

            <button
              onClick={() => router.push('/ops/human-tasks')}
              className="w-full mt-3 text-center text-[13px] text-fog/40 hover:text-fog transition-colors py-1"
            >
              Cancel
            </button>
          </section>
        </div>
      </main>
    </div>
  )
}

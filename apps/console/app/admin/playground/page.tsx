'use client'

import { useState, useCallback, useEffect } from 'react'

interface PlaygroundConfig {
  model: 'claude-sonnet' | 'minimax' | 'deepseek'
  persona: 'concise' | 'warm'
  memory: boolean
  knowledge: boolean
  debug: boolean
  guardrails: { pii: boolean; refundPolicy: boolean; profanity: boolean; escalation: boolean }
}

const QUICK_STARTS = [
  'Where is my order?',
  'I want a refund',
  'How much is the Pro plan?',
  'This is useless, I\'m furious',
]

const SPINNER_VERBS = ['Classifying intent', 'Checking guardrails', 'Searching knowledge', 'Calling tools', 'Generating reply']

export default function PlaygroundPage() {
  const [config, setConfig] = useState<PlaygroundConfig>({
    model: 'claude-sonnet',
    persona: 'concise',
    memory: true,
    knowledge: true,
    debug: false,
    guardrails: { pii: true, refundPolicy: true, profanity: true, escalation: true },
  })
  const [message, setMessage] = useState('')
  const [reply, setReply] = useState('')
  const [responding, setResponding] = useState(false)
  const [spinnerIdx, setSpinnerIdx] = useState(0)
  const [traces, setTraces] = useState<any[]>([])
  const [selectedTrace, setSelectedTrace] = useState<any>(null)
  const [error, setError] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('intera-agent-id')
      if (stored) setSelectedAgentId(stored)
    } catch { /* ignore */ }
  }, [])

  const runTurn = useCallback(async (msg: string) => {
    setReply('')
    setTraces([])
    setError('')
    setResponding(true)

    // Cycle spinner verbs
    let idx = 0
    const spinner = setInterval(() => { setSpinnerIdx((i) => (i + 1) % SPINNER_VERBS.length) }, 600)

    try {
      const res = await fetch('/api/admin/playground/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, config, configId: selectedAgentId }),
      })

      if (!res.ok) {
        setError(`HTTP ${res.status}: ${await res.text()}`)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) { setError('No response stream'); return }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'text_delta') {
              setReply((r) => r + event.data)
            } else if (event.type === 'error') {
              setError(String(event.data))
            } else if (event.type === 'trace') {
              setTraces(event.data.trace || [])
              setSelectedTrace(event.data)
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      clearInterval(spinner)
      setResponding(false)
    }
  }, [config, selectedAgentId])

  const toggleGuardrail = (key: keyof PlaygroundConfig['guardrails']) => {
    setConfig((c) => ({ ...c, guardrails: { ...c.guardrails, [key]: !c.guardrails[key] } }))
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '268px 1fr 360px', height: 'calc(100vh - 52px)', overflow: 'hidden' }}>
      {/* ── Left: ConfigPanel ── */}
      <div className="border-r border-black/[0.06] bg-white/40 backdrop-blur-xl p-4 space-y-5 overflow-y-auto">
        {selectedAgentId && (
          <div className="rounded-lg bg-indigo/[0.04] border border-indigo/10 px-3 py-2 text-[10px] text-[var(--fog)]">
            Using config: <span className="font-mono text-indigo">{selectedAgentId}</span>
          </div>
        )}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]/40 mb-2">Model</p>
          <div className="flex gap-1">
            {(['claude-sonnet', 'minimax', 'deepseek'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setConfig((c) => ({ ...c, model: m }))}
                className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  config.model === m
                    ? 'bg-indigo/10 text-indigo border border-indigo/20'
                    : 'bg-black/[0.02] text-[var(--fog)] border border-transparent hover:bg-black/[0.04]'
                }`}
              >
                {m === 'claude-sonnet' ? 'Claude' : m === 'minimax' ? 'MiniMax' : 'DeepSeek'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]/40 mb-2">Persona</p>
          <div className="flex gap-1">
            {(['concise', 'warm'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setConfig((c) => ({ ...c, persona: p }))}
                className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  config.persona === p
                    ? 'bg-indigo/10 text-indigo border border-indigo/20'
                    : 'bg-black/[0.02] text-[var(--fog)] border border-transparent hover:bg-black/[0.04]'
                }`}
              >
                {p === 'concise' ? 'Concise' : 'Warm'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center justify-between text-[12px] text-[var(--mist)]">
            Memory
            <button
              onClick={() => setConfig((c) => ({ ...c, memory: !c.memory }))}
              className={`w-10 h-5 rounded-full transition-colors relative ${config.memory ? 'bg-indigo' : 'bg-black/[0.12]'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${config.memory ? 'left-5' : 'left-0.5'}`} />
            </button>
          </label>
          <label className="flex items-center justify-between text-[12px] text-[var(--mist)]">
            Knowledge Base
            <button
              onClick={() => setConfig((c) => ({ ...c, knowledge: !c.knowledge }))}
              className={`w-10 h-5 rounded-full transition-colors relative ${config.knowledge ? 'bg-indigo' : 'bg-black/[0.12]'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${config.knowledge ? 'left-5' : 'left-0.5'}`} />
            </button>
          </label>
          <label className="flex items-center justify-between text-[12px] text-[var(--mist)]">
            Debug Mode
            <button
              onClick={() => setConfig((c) => ({ ...c, debug: !c.debug }))}
              className={`w-10 h-5 rounded-full transition-colors relative ${config.debug ? 'bg-indigo' : 'bg-black/[0.12]'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${config.debug ? 'left-5' : 'left-0.5'}`} />
            </button>
          </label>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]/40 mb-2">
            Guardrails
            <a href="/admin/guardrails" className="ml-2 text-[10px] text-indigo/60 hover:text-indigo font-normal normal-case tracking-normal">edit →</a>
          </p>
          <div className="flex flex-wrap gap-1">
            {(['pii', 'refundPolicy', 'profanity', 'escalation'] as const).map((g) => (
              <button
                key={g}
                onClick={() => toggleGuardrail(g)}
                className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                  config.guardrails[g]
                    ? 'bg-amber/10 text-amber border border-amber/20'
                    : 'bg-black/[0.02] text-[var(--fog)]/40 border border-transparent'
                }`}
              >
                {g === 'pii' ? 'PII' : g === 'refundPolicy' ? 'Refund' : g === 'profanity' ? 'Abuse' : 'Escalation'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Center: TestChat ── */}
      <div className="flex flex-col bg-white/20 backdrop-blur-sm">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!reply && !responding && !error && (
            <div className="flex flex-wrap gap-2 justify-center pt-8">
              {QUICK_STARTS.map((q) => (
                <button
                  key={q}
                  onClick={() => { setMessage(q); runTurn(q) }}
                  className="px-4 py-2 rounded-xl border border-black/[0.06] bg-white/60 backdrop-blur text-[13px] text-[var(--mist)] hover:bg-white hover:border-indigo/20 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red/10 text-[13px] text-red-600">
              {error}
            </div>
          )}

          {responding && !reply && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/60 backdrop-blur border border-black/[0.04] w-fit">
              <div className="w-4 h-4 border-2 border-indigo/30 border-t-indigo rounded-full animate-spin" />
              <span className="text-[12px] text-[var(--fog)]">{SPINNER_VERBS[spinnerIdx]}…</span>
            </div>
          )}

          {reply && (
            <div className="p-4 rounded-2xl bg-white/60 backdrop-blur border border-black/[0.04]">
              <p className="text-[13px] text-[var(--mist)] leading-relaxed whitespace-pre-wrap">{reply}</p>
              {selectedTrace && (
                <button
                  onClick={() => setSelectedTrace(selectedTrace)}
                  className="mt-2 text-[10px] text-indigo/60 hover:text-indigo"
                >
                  view trace →
                </button>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="p-3 border-t border-black/[0.04]">
          <div className="flex gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && message.trim()) runTurn(message.trim()) }}
              placeholder="Type a test message…"
              disabled={responding}
              className="flex-1 px-4 py-2 rounded-xl border border-black/[0.06] bg-white/60 backdrop-blur text-[13px] text-[var(--mist)] placeholder:text-[var(--fog)]/40 outline-none focus:border-indigo/30 disabled:opacity-40"
            />
            <button
              onClick={() => message.trim() && runTurn(message.trim())}
              disabled={responding || !message.trim()}
              className="px-4 py-2 rounded-xl bg-indigo text-white text-[13px] font-medium hover:bg-indigo/90 disabled:opacity-40 transition-all"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* ── Right: TraceInspector ── */}
      <div className="border-l border-black/[0.06] bg-white/30 backdrop-blur-xl p-4 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]/40 mb-3">Behavior Trace</p>

        {traces.length === 0 ? (
          <p className="text-[11px] text-[var(--fog)]/40 italic">Send a message to see the behavior trace.</p>
        ) : (
          <div className="space-y-2">
            {traces.map((step: any, i: number) => {
              const statusColors: Record<string, string> = {
                ok: 'bg-emerald-400', info: 'bg-blue-400', warn: 'bg-amber-400',
                block: 'bg-red-400', neutral: 'bg-black/10',
              }
              return (
                <div key={i} className="p-3 rounded-xl border border-black/[0.04] bg-white/60 backdrop-blur">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${statusColors[step.status] || 'bg-black/10'}`} />
                    <span className="text-[11px] font-medium text-[var(--mist)]">{step.stage}</span>
                    <span className="text-[10px] text-[var(--fog)]/40 ml-auto">{step.ms}ms</span>
                  </div>
                  <p className="text-[11px] text-[var(--fog)]">{step.summary}</p>
                  {step.detail?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {step.detail.slice(0, 5).map(([k, v]: [string, string], j: number) => (
                        <div key={j} className="flex gap-2 text-[10px]">
                          <span className="text-[var(--fog)]/40 font-mono">{k}</span>
                          <span className="text-[var(--fog)] truncate">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {step.source && (
                    <p className="text-[9px] text-[var(--fog)]/30 mt-2">
                      Driven by → {step.source === 'caseTypes' ? 'Case Types' : step.source === 'guardrails' ? 'Guardrails' : step.source === 'knowledge' ? 'Knowledge' : step.source === 'tools' ? 'Skills & Tools' : step.source === 'agent' ? 'Agent Config' : step.source}
                    </p>
                  )}
                  {step.json && config.debug && (
                    <details className="mt-2">
                      <summary className="text-[10px] text-indigo/60 cursor-pointer">Raw JSON</summary>
                      <pre className="mt-1 p-2 rounded-lg bg-black/[0.02] text-[10px] text-[var(--fog)] overflow-x-auto">
                        {JSON.stringify(step.json, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

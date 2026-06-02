'use client'

import { useState, useCallback, useEffect } from 'react'
import { X, FlaskConical, MessageSquare, BarChart3 } from 'lucide-react'

const STORAGE_KEY = 'intera-dock-open'

interface PlaygroundConfig {
  model: 'claude-sonnet' | 'minimax' | 'deepseek'
  persona: 'concise' | 'warm'
  memory: boolean; knowledge: boolean; debug: boolean
  guardrails: { pii: boolean; refundPolicy: boolean; profanity: boolean; escalation: boolean }
}

const QUICK_STARTS = ['Where is my order?', 'I want a refund', 'How much is the Pro plan?', 'This is useless, I\'m furious']

export default function DockedPreview() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'chat' | 'trace'>('chat')
  const [message, setMessage] = useState('')
  const [reply, setReply] = useState('')
  const [responding, setResponding] = useState(false)
  const [traces, setTraces] = useState<any[]>([])
  const [error, setError] = useState('')
  const [config, setConfig] = useState<PlaygroundConfig>({
    model: 'claude-sonnet', persona: 'concise', memory: true, knowledge: true, debug: false,
    guardrails: { pii: true, refundPolicy: true, profanity: true, escalation: true },
  })

  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY)
      if (s === '1') setOpen(true)
    } catch { /* ignore */ }
  }, [])

  const toggleOpen = () => {
    setOpen((o) => {
      const next = !o
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  const runTurn = useCallback(async (msg: string) => {
    setReply(''); setTraces([]); setError(''); setResponding(true); setTab('chat')
    try {
      const res = await fetch('/api/admin/playground/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, config }),
      })
      if (!res.ok) { setError(`HTTP ${res.status}`); return }
      const reader = res.body?.getReader()
      if (!reader) { setError('No response stream'); return }
      const decoder = new TextDecoder(); let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'text_delta') setReply((r) => r + event.data)
            else if (event.type === 'error') setError(String(event.data))
            else if (event.type === 'trace') setTraces(event.data.trace || [])
          } catch { /* skip */ }
        }
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error') }
    finally { setResponding(false) }
  }, [config])

  return (
    <>
      {/* Scrim */}
      {open && (
        <div
          className="dock-scrim"
          onClick={toggleOpen}
          style={{
            position: 'fixed', inset: 0, zIndex: 40,
            background: 'rgba(20,18,14,0.12)', backdropFilter: 'blur(1px)',
          }}
        />
      )}

      {/* Toggle button */}
      <button
        onClick={toggleOpen}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all
          bg-white/60 backdrop-blur border border-black/[0.06] text-[var(--mist)] hover:bg-white hover:border-indigo/20"
        style={{ position: 'fixed', top: 12, right: open ? 436 : 16, zIndex: 45 }}
        title="Test agent"
      >
        <FlaskConical className="w-3.5 h-3.5" /> Test agent
      </button>

      {/* Dock */}
      {open && (
        <div
          className="dock"
          style={{
            position: 'fixed', top: 0, right: 0, width: 420, height: '100vh', zIndex: 41,
            background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(24px)',
            borderLeft: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', flexDirection: 'column',
            boxShadow: '-4px 0 24px rgba(0,0,0,0.04)',
          }}
        >
          {/* Header */}
          <div className="dock-head flex items-center justify-between px-4 py-3 border-b border-black/[0.04]">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTab('chat')}
                className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${tab === 'chat' ? 'bg-indigo/10 text-indigo' : 'text-[var(--fog)] hover:bg-black/[0.04]'}`}
              >
                <MessageSquare className="w-3 h-3 inline mr-1" /> Chat
              </button>
              <button
                onClick={() => setTab('trace')}
                className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${tab === 'trace' ? 'bg-indigo/10 text-indigo' : 'text-[var(--fog)] hover:bg-black/[0.04]'}`}
              >
                <BarChart3 className="w-3 h-3 inline mr-1" /> Trace
              </button>
            </div>
            <button onClick={toggleOpen} className="p-1 rounded-lg hover:bg-black/[0.04]">
              <X className="w-4 h-4 text-[var(--fog)]" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {tab === 'chat' ? (
              <div className="flex-1 flex flex-col">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {!reply && !responding && !error && (
                    <div className="flex flex-wrap gap-2">
                      {QUICK_STARTS.map((q) => (
                        <button key={q} onClick={() => { setMessage(q); runTurn(q) }}
                          className="px-3 py-1.5 rounded-lg border border-black/[0.06] bg-white/60 text-[11px] text-[var(--mist)] hover:bg-white hover:border-indigo/20 transition-all"
                        >{q}</button>
                      ))}
                    </div>
                  )}
                  {error && <div className="p-3 rounded-xl bg-red-50 text-[12px] text-red-600">{error}</div>}
                  {responding && <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/60 border border-black/[0.04] w-fit"><div className="w-3 h-3 border-2 border-indigo/30 border-t-indigo rounded-full animate-spin" /><span className="text-[11px] text-[var(--fog)]">Responding…</span></div>}
                  {reply && <div className="p-3 rounded-xl bg-white/60 border border-black/[0.04]"><p className="text-[12px] text-[var(--mist)] leading-relaxed whitespace-pre-wrap">{reply}</p></div>}
                </div>
                <div className="p-3 border-t border-black/[0.04]">
                  <div className="flex gap-2">
                    <input type="text" value={message} onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && message.trim()) runTurn(message.trim()) }}
                      placeholder="Test a message…" disabled={responding}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-black/[0.06] bg-white/60 text-[12px] outline-none focus:border-indigo/30 disabled:opacity-40"
                    />
                    <button onClick={() => message.trim() && runTurn(message.trim())}
                      disabled={responding || !message.trim()}
                      className="px-3 py-1.5 rounded-lg bg-indigo text-white text-[11px] font-medium hover:bg-indigo/90 disabled:opacity-40"
                    >Send</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {traces.length === 0 ? (
                  <p className="text-[11px] text-[var(--fog)]/40 italic">Send a message to see the behavior trace.</p>
                ) : (
                  traces.map((step: any, i: number) => {
                    const statusColors: Record<string, string> = { ok: 'bg-emerald-400', info: 'bg-blue-400', warn: 'bg-amber-400', block: 'bg-red-400', neutral: 'bg-black/10' }
                    return (
                      <div key={i} className="p-2.5 rounded-xl border border-black/[0.04] bg-white/60">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${statusColors[step.status] || 'bg-black/10'}`} />
                          <span className="text-[10px] font-medium text-[var(--mist)]">{step.stage}</span>
                          <span className="text-[9px] text-[var(--fog)]/40 ml-auto">{step.ms}ms</span>
                        </div>
                        <p className="text-[10px] text-[var(--fog)]">{step.summary}</p>
                        {step.detail?.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {step.detail.slice(0, 3).map(([k, v]: [string, string], j: number) => (
                              <div key={j} className="flex gap-1.5 text-[9px]"><span className="text-[var(--fog)]/40 font-mono">{k}</span><span className="text-[var(--fog)] truncate">{v}</span></div>
                            ))}
                          </div>
                        )}
                        {step.source && <p className="text-[8px] text-[var(--fog)]/30 mt-1">Driven by → {step.source}</p>}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CSS animation */}
      <style jsx>{`
        .dock { animation: dockSlideIn 0.28s cubic-bezier(0.22, 1, 0.36, 1); }
        @keyframes dockSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .dock-scrim { animation: dockFadeIn 0.2s ease; }
        @keyframes dockFadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </>
  )
}

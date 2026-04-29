'use client'

// Human Task Detail — Chat interface: operator converses with Intera agent
// Agent is case owner; human operator assists with confirmation/information

import { useState, useEffect, useCallback, useRef, use } from 'react'
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

interface TaskDetail {
  id: string
  caseId: string
  queue: string
  status: string
  question: string
  verdict: string | null
  createdAt: string
  case: {
    id: string
    type: string
    status: string
    userId: string
    goal: string | null
    memory: CaseMemory | null
  }
}

interface ChatMsg {
  id: string
  role: 'operator' | 'agent'
  content: string
  timestamp: string
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

export default function HumanTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [consultationDone, setConsultationDone] = useState(false)
  const [showContext, setShowContext] = useState(true)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/human-tasks/${id}`)
      .then((r) => r.json())
      .then((data) => {
        const t = data.task as TaskDetail
        setTask(t)
        setConsultationDone(t?.status === 'resolved')
        // Seed agent's escalation question as first chat message
        if (t && t.question) {
          setChatMessages([{
            id: 'agent-question',
            role: 'agent',
            content: t.question,
            timestamp: t.createdAt,
          }])
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending || consultationDone) return
    const text = input.trim()
    setInput('')
    setSending(true)

    // Add operator message
    const opMsg: ChatMsg = { id: crypto.randomUUID(), role: 'operator', content: text, timestamp: new Date().toISOString() }
    setChatMessages((prev) => [...prev, opMsg])

    // Add placeholder for agent response
    const agentId = crypto.randomUUID()
    setChatMessages((prev) => [...prev, { id: agentId, role: 'agent', content: '', timestamp: new Date().toISOString() }])

    try {
      const response = await fetch('http://localhost:3000/api/human-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: id, message: text }),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6))

              switch (event.type) {
                case 'text_delta':
                  fullContent += event.data as string
                  setChatMessages((prev) =>
                    prev.map((m) => (m.id === agentId ? { ...m, content: fullContent } : m)),
                  )
                  break

                case 'consultation_complete': {
                  const cd = event.data as { summary: string; resolution: string }
                  setConsultationDone(true)
                  setChatMessages((prev) =>
                    prev.map((m) =>
                      m.id === agentId
                        ? { ...m, content: fullContent + `\n\n---\n✅ *Consultation complete — ${cd.resolution.replace(/_/g, ' ')}*\n> ${cd.summary}` }
                        : m,
                    ),
                  )
                  break
                }

                case 'message_stop':
                  // Finalize agent message
                  setChatMessages((prev) =>
                    prev.map((m) => (m.id === agentId && !m.content ? { ...m, content: fullContent || '(no response)' } : m)),
                  )
                  break

                case 'error':
                  console.error('Agent error:', event.data)
                  setChatMessages((prev) =>
                    prev.map((m) => (m.id === agentId && !m.content ? { ...m, content: `Error: ${event.data}` } : m)),
                  )
                  break
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (err) {
      console.error('Chat error:', err)
      setChatMessages((prev) =>
        prev.map((m) => (m.id === agentId ? { ...m, content: 'Connection error. Please try again.' } : m)),
      )
    } finally {
      setSending(false)
    }
  }, [input, sending, consultationDone, id])

  const handleReopen = useCallback(async () => {
    await fetch(`/api/human-tasks/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'reopened', notes: 'Consultation reopened by operator' }),
    })
    setConsultationDone(false)
  }, [id])

  const handleDelete = useCallback(async () => {
    if (!confirm('Delete this case and ALL related data? This cannot be undone.')) return
    await fetch(`/api/human-tasks/${id}/delete`, { method: 'DELETE' })
    router.push('/ops/human-tasks')
    router.refresh()
  }, [id, router])

  const handleCloseCase = useCallback(async () => {
    const reason = prompt('Reason for closing this case (required — will be sent to agent):')
    if (!reason || !reason.trim()) return
    await fetch(`/api/human-tasks/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'manually_closed', notes: reason.trim(), manualClose: true }),
    })
    setConsultationDone(true)
  }, [id])

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

  return (
    <div className="relative min-h-screen bg-void flex flex-col">
      <FluidBackground intensity="subtle" />

      {/* Header */}
      <header className="relative z-10 border-b border-white/[0.04] bg-abyss/40 backdrop-blur-xl flex-shrink-0">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/ops/human-tasks')} className="text-[13px] text-fog/50 hover:text-fog transition-colors">
              ← Back
            </button>
            <div>
              <h1 className="text-[14px] font-medium text-mist tracking-[-0.01em]">
                {task.queue.replace(/_/g, ' ')} · {task.case.type.replace(/_/g, ' ')}
              </h1>
              <p className="text-[11px] text-fog/40">Case {task.caseId.slice(0, 12)}… · User {task.case.userId}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowContext((p) => !p)} className="text-[12px] text-fog/50 hover:text-fog transition-colors">
              {showContext ? 'Hide Context' : 'Show Context'}
            </button>
            {consultationDone && (
              <button onClick={handleReopen} className="text-[12px] text-amber hover:text-amber/80 transition-colors">
                Reopen
              </button>
            )}
            <button onClick={handleCloseCase} className="text-[12px] text-fog/30 hover:text-vermillion transition-colors">
              Close Case
            </button>
            <button onClick={handleDelete} className="text-[12px] text-fog/20 hover:text-vermillion/60 transition-colors" title="Debug: delete all case data">
              🗑
            </button>
            <span className={`text-[11px] font-sans tracking-[0.04em] uppercase ${consultationDone ? 'text-malachite' : 'text-amber'}`}>
              {consultationDone ? 'Resolved' : 'Active'}
            </span>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex-1 flex max-w-6xl mx-auto w-full">
        {/* ── Left: Case context (collapsible) ── */}
        {showContext && (
          <aside className="w-72 flex-shrink-0 border-r border-white/[0.04] bg-abyss/20 overflow-y-auto p-4 space-y-3">
            {/* Agent's question */}
            <div>
              <h3 className="text-[10px] font-sans tracking-[0.06em] uppercase text-fog/40 mb-1">Agent Question</h3>
              <p className="text-[13px] text-mist/80 leading-snug">{task.question}</p>
            </div>

            {task.case.goal && (
              <div>
                <h3 className="text-[10px] font-sans tracking-[0.06em] uppercase text-fog/40 mb-1">Goal</h3>
                <p className="text-[12px] text-fog/60 italic">{task.case.goal}</p>
              </div>
            )}

            {Object.keys(facts).length > 0 && (
              <div>
                <h3 className="text-[10px] font-sans tracking-[0.06em] uppercase text-fog/40 mb-1">Facts</h3>
                <dl className="space-y-1">
                  {Object.entries(facts).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-[12px]">
                      <dt className="text-fog/50">{k}</dt>
                      <dd className="text-mist/70 font-mono text-[11px] truncate max-w-[120px]">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {skills.length > 0 && (
              <div>
                <h3 className="text-[10px] font-sans tracking-[0.06em] uppercase text-fog/40 mb-1">Agent Actions</h3>
                <div className="flex flex-wrap gap-1">
                  {skills.map((s) => (
                    <span key={s} className="text-[10px] font-mono text-fog/50 bg-white/[0.03] px-1.5 py-0.5 rounded">
                      {s.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}

        {/* ── Right: Chat ── */}
        <main className="flex-1 flex flex-col min-h-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4 scroll-thin">
            {chatMessages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-[14px] text-fog/40 font-serif italic">Consultation chat</p>
                  <p className="text-[12px] text-fog/20 mt-1">Intera will ask you questions about this case.</p>
                </div>
              </div>
            )}

            {chatMessages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'operator' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-xl px-4 py-2.5 ${
                  msg.role === 'operator'
                    ? 'bg-indigo/[0.08] border border-indigo/[0.12] rounded-br-sm'
                    : 'bg-white/[0.03] border border-white/[0.05] rounded-bl-sm'
                }`}>
                  <p className="text-[13px] text-mist/90 leading-relaxed whitespace-pre-wrap">
                    {msg.content || (
                      <span className="inline-flex items-center gap-1 text-fog/40 italic">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-fog/40 animate-breathe" />
                        Thinking…
                      </span>
                    )}
                  </p>
                  {msg.timestamp && msg.content && (
                    <p className="text-[10px] text-fog/30 mt-1">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-white/[0.04] bg-abyss/40 backdrop-blur-xl p-4 flex-shrink-0">
            {consultationDone ? (
              <div className="text-center py-2">
                <p className="text-[13px] text-malachite/70">Consultation complete. The agent is now updating the customer.</p>
                <p className="text-[11px] text-fog/30 mt-0.5">You can reopen if needed.</p>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  placeholder="Reply to Intera…"
                  disabled={sending}
                  className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-lg text-[14px] text-mist py-2.5 px-3 outline-none focus:border-indigo/30 transition-all duration-200 placeholder:text-fog/20 disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="px-5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200
                    bg-indigo/20 border border-indigo/30 text-indigo hover:bg-indigo/30
                    disabled:bg-white/[0.03] disabled:border-white/[0.06] disabled:text-fog/20 disabled:cursor-not-allowed"
                >
                  {sending ? '…' : 'Send'}
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  FlaskConical, Send,
  Sparkles, AlertCircle, CheckCircle2, Clock, XCircle,
  Shield, Brain, Search, Puzzle, ExternalLink, Wrench, Activity,
  ChevronDown,
} from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import AgentVersionPicker from '@/components/admin/agent-version-picker'

/* ── Types ── */

interface ModelInfo {
  id: string; name: string; provider: string; providerLabel: string
}

interface AgentListItem {
  id: string
  name: string
  version: number
  isActive: boolean
}

interface AgentSnapshot {
  name: string
  modelLabel: string
  systemPromptPreview: string
  memoryTierLabel: string
  guardrailCount: number
  temperature: number
}

/** Per-tool status — driven by real `tool_executing` / `skill_result` SSE events. */
interface LiveTool {
  name: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  finishedAt?: number
  result?: unknown
  renderHints?: { kind: string; [key: string]: unknown }
}

/* ── Constants ── */

const QUICK_STARTS = [
  { label: 'Where is my order?', hint: 'Order tracking test' },
  { label: 'I want a refund', hint: 'Refund policy test' },
  { label: 'How much is the Pro plan?', hint: 'Pricing inquiry' },
  { label: "This isn't working, I'm furious", hint: 'Escalation test' },
]

const TRACE_ICONS: Record<string, typeof AlertCircle> = {
  intent_classify: Brain,
  policy_hit: Shield,
  skill_called: Puzzle,
  skill_result: CheckCircle2,
  stage_eval: Clock,
  llm_request_start: Sparkles,
  llm_response: Sparkles,
}

const TRACE_COLORS: Record<string, string> = {
  ok: 'bg-emerald-400', info: 'bg-sky-400', warn: 'bg-amber-400',
  block: 'bg-red-400', neutral: 'bg-black/10',
}

const STATUS_RGB: Record<string, string> = {
  ok: '46,160,74', info: '91,184,247', warn: '212,145,46',
  block: '230,69,57', neutral: '0,0,0',
}

const STATUS_ICON_COLOR: Record<string, string> = {
  ok: 'var(--malachite)', info: 'var(--sky)', warn: 'var(--amber)',
  block: 'var(--vermillion)', neutral: 'var(--fog)',
}

/* ── Helpers ── */

function detectMemoryTier(ms: any): string {
  const t = ms?.autocompactThresholdTokens
  if (!t) return 'Balanced'
  if (t <= 20000) return 'Short-term'
  if (t <= 40000) return 'Balanced'
  return 'Long-term'
}

function countGuardrails(s: string): number {
  try { return Object.keys(JSON.parse(s)).length } catch { return 0 }
}

/* ── Page ── */

export default function PlaygroundPage() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [agentList, setAgentList] = useState<AgentListItem[]>([])
  const [pickerRefreshKey, setPickerRefreshKey] = useState(0)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null)
  const [debugMode, setDebugMode] = useState(false)

  const [message, setMessage] = useState('')
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'agent'; content: string }>>([])
  const [reply, setReply] = useState('')
  const [thinking, setThinking] = useState('')
  const [responding, setResponding] = useState(false)
  const [liveTools, setLiveTools] = useState<LiveTool[]>([])
  const [turnTraces, setTurnTraces] = useState<any[][]>([])
  const turnNumRef = useRef(0)
  const [collapsedTraces, setCollapsedTraces] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const composerRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  /* ── Data loading ── */

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/agent-configs').then(r => r.json()),
      fetch('/api/admin/models').then(r => r.json()),
    ]).then(([agentsData, modelsData]) => {
      const list: AgentListItem[] = agentsData.configs || []
      setAgentList(list)
      setModels(modelsData.models || [])

      const stored = (() => { try { return localStorage.getItem('intera-agent-id') } catch { return null } })()

      const resolveStored = (id: string): string | null => {
        const found = list.find(a => a.id === id)
        if (!found) return null
        // Backwards-compat: if the stored id exists but is a draft, snap to the
        // active version of the same name so the user always lands on a runnable
        // config. Old behavior was to just take any row, which now risks picking
        // a draft by accident.
        if (found.isActive) return found.id
        const activeSibling = list.find(a => a.name === found.name && a.isActive)
        return activeSibling ? activeSibling.id : found.id
      }

      if (stored) {
        const resolved = resolveStored(stored)
        if (resolved) {
          setSelectedAgentId(resolved)
          if (resolved !== stored) {
            try { localStorage.setItem('intera-agent-id', resolved) } catch { /* */ }
          }
        }
      }
      if (!selectedAgentId && list.length > 0) {
        // Prefer the active row of the first name, else first row
        const firstActive = list.find(a => a.isActive)
        setSelectedAgentId((firstActive ?? list[0]).id)
      }
    })
    // selectedAgentId intentionally not in deps — this is initial-load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedAgentId) return
    // Reset traces on agent change
    setTurnTraces([])
    turnNumRef.current = 0
    setCollapsedTraces(new Set())
    try { localStorage.setItem('intera-agent-id', selectedAgentId) } catch { /* */ }

    fetch(`/api/admin/agent?agentId=${selectedAgentId}`)
      .then(r => r.json())
      .then(data => {
        const raw = data.config || {}
        let memoryStrategy = {}
        let policyHooks = '{}'
        try { memoryStrategy = typeof raw.memoryStrategy === 'string' ? JSON.parse(raw.memoryStrategy || '{}') : raw.memoryStrategy || {} } catch { /* */ }
        try { policyHooks = typeof raw.policyHooks === 'string' ? raw.policyHooks : JSON.stringify(raw.policyHooks || {}, null, 2) } catch { policyHooks = '{}' }

        const modelId = raw.model || ''
        const modelInfo = models.find(m => m.id === modelId)
        const sp = raw.systemPrompt || ''

        setSnapshot({
          name: raw.name || 'Default',
          modelLabel: modelInfo ? modelInfo.name : (modelId || 'Unknown'),
          systemPromptPreview: sp.length > 120 ? sp.slice(0, 120) + '…' : sp,
          memoryTierLabel: detectMemoryTier(memoryStrategy),
          guardrailCount: countGuardrails(policyHooks),
          temperature: raw.temperature ?? 0.5,
        })
        setDebugMode(Boolean(raw.debugMode))
      })
      .catch(() => setSnapshot(null))
  }, [selectedAgentId, models])

  /* ── Auto-scroll ── */

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [reply, turnTraces])

  /* ── Run turn ── */

  const runTurn = useCallback(async (msg: string) => {
    setReply('')
    setThinking('')
    turnNumRef.current += 1
    setTurnTraces(prev => [...prev, []])
    setLiveTools([])
    setError('')
    setResponding(true)
    setChatMessages(prev => [...prev, { role: 'user' as const, content: msg }])

    try {
      const body: Record<string, unknown> = { message: msg }
      if (selectedAgentId) body.configId = selectedAgentId
      if (debugMode) body.config = { debug: true }

      const res = await fetch('/api/admin/playground/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) { setError(`HTTP ${res.status}: ${await res.text()}`); return }

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
            if (event.type === 'text_delta') setReply(r => r + event.data)
            else if (event.type === 'thinking_delta') setThinking(t => t + event.data)
            else if (event.type === 'error') setError(String(event.data))
            else if (event.type === 'tool_executing') {
              const d = event.data as any
              const name = d?.name || 'tool'
              setLiveTools(prev => [
                ...prev.filter(t => t.name !== name || t.status !== 'running'),
                { name, status: 'running', startedAt: Date.now() },
              ])
            }
            else if (event.type === 'skill_result') {
              const d = event.data as any
              const name = d?.name || 'tool'
              setLiveTools(prev => prev.map(t =>
                t.name === name && t.status === 'running'
                  ? { ...t, status: d?.ok === false ? 'error' : 'done', finishedAt: Date.now(), result: d?.result, renderHints: d?.renderHints }
                  : t
              ))
            }
            else if (event.type === 'trace') {
              const t = event.data.trace || []
              const turnKey = turnNumRef.current
              setTurnTraces(prev => {
                const next = [...prev]
                if (next.length > 0) next[next.length - 1] = t
                return next
              })
              // Auto-collapse items with no events (0ms, empty summary)
              const empty = new Set<string>()
              t.forEach((item: any, i: number) => {
                if (!item.ms && (!item.summary || item.summary === '(no events)')) empty.add(`${turnKey}-${i}`)
              })
              setCollapsedTraces(prev => {
                const merged = new Set(prev)
                for (const k of empty) merged.add(k)
                return merged
              })
            }
          } catch { /* */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setResponding(false)
      setReply(r => {
        if (r) setChatMessages(prev => [...prev, { role: 'agent' as const, content: r }])
        return ''
      })
    }
  }, [selectedAgentId, debugMode])

  /* ── Render ── */

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ═══════════════════════════════════════════
          Ambient background orbs
          ═══════════════════════════════════════════ */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        <div style={{
          position: 'absolute', width: 480, height: 480, top: '-8%', left: '-5%',
          borderRadius: '50%', filter: 'blur(100px)', opacity: 0.45,
          background: 'radial-gradient(circle, rgba(139,111,245,0.09), transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', width: 400, height: 400, bottom: '5%', right: '-3%',
          borderRadius: '50%', filter: 'blur(90px)', opacity: 0.35,
          background: 'radial-gradient(circle, rgba(91,184,247,0.07), transparent 70%)',
        }} />
      </div>

      {/* ═══════════════════════════════════════════
          Top bar — agent selector + config pills
          ═══════════════════════════════════════════ */}
      <header style={{
        position: 'relative', zIndex: 1, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(255,255,255,0.35)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}>
        {/* Agent selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(139,111,245,0.12), rgba(91,184,247,0.08))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FlaskConical size={16} color="var(--indigo)" />
          </div>
          <AgentVersionPicker
            key={pickerRefreshKey}
            agentId={selectedAgentId}
            onChange={(id) => setSelectedAgentId(id)}
            onAgentsChanged={() => setPickerRefreshKey(k => k + 1)}
          />
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--border-subtle)', flexShrink: 0 }} />

        {snapshot && (
          <>
            <ConfigPill icon={<Sparkles size={11} />} label={snapshot.modelLabel} />
            <ConfigPill icon={<span style={{ fontSize: 10, fontWeight: 600 }}>&#123;t&#125;</span>} label={`Temp ${snapshot.temperature}`} />
            <ConfigPill icon={<Clock size={11} />} label={snapshot.memoryTierLabel} />
            <ConfigPill icon={<Shield size={11} />} label={`${snapshot.guardrailCount} rule${snapshot.guardrailCount !== 1 ? 's' : ''}`} />

            <div style={{ flex: 1 }} />

            <Link
              href={`/admin/agent?agentId=${selectedAgentId}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontWeight: 500, color: 'var(--indigo)',
                textDecoration: 'none', opacity: 0.7,
                padding: '4px 10px', borderRadius: 8,
                transition: 'opacity 0.15s, background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(91,138,247,0.06)' }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.background = 'transparent' }}
            >
              Edit agent <ExternalLink size={10} />
            </Link>
          </>
        )}
      </header>

      {/* ═══════════════════════════════════════════
          Main row — chat (left) + sidebar (right)
          ═══════════════════════════════════════════ */}
      <div style={{
        position: 'relative', zIndex: 1, flex: 1,
        display: 'flex', overflow: 'hidden', minWidth: 0,
      }}>

        {/* ── Chat column ── */}
        <div style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          overflow: 'hidden',
        }}>
          <div style={{
            flex: 1, width: '100%', maxWidth: 680,
            padding: '32px 24px 0',
            overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* ── Empty state ── */}
            {chatMessages.length === 0 && !responding && !error && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                paddingTop: '12vh', gap: 20,
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: 'linear-gradient(135deg, rgba(139,111,245,0.1), rgba(91,184,247,0.06))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 0 1px rgba(139,111,245,0.08) inset',
                }}>
                  <FlaskConical size={24} color="var(--indigo)" />
                </div>
                <p style={{
                  fontSize: 13, color: 'var(--fog)', margin: 0,
                  textAlign: 'center', lineHeight: 1.6,
                }}>
                  {snapshot
                    ? `Testing "${snapshot.name}" · ${snapshot.modelLabel}`
                    : 'Select an agent and send a message to test its behaviour.'}
                </p>

                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
                  width: '100%', maxWidth: 440,
                }}>
                  {QUICK_STARTS.map(q => (
                    <button
                      key={q.label}
                      onClick={() => { runTurn(q.label); setMessage('') }}
                      style={{
                        textAlign: 'left', padding: '12px 16px',
                        borderRadius: 14,
                        border: '1px solid var(--border-subtle)',
                        background: 'rgba(255,255,255,0.55)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'var(--border-hover)'
                        e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)'
                        e.currentTarget.style.transform = 'translateY(-1px)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--border-subtle)'
                        e.currentTarget.style.boxShadow = 'none'
                        e.currentTarget.style.transform = 'translateY(0)'
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--mist)', marginBottom: 2 }}>
                        {q.label}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--smoke)' }}>
                        {q.hint}
                      </div>
                    </button>
                  ))}
                </div>

                {snapshot?.systemPromptPreview && (
                  <div style={{
                    width: '100%', maxWidth: 440, marginTop: 8,
                    padding: '12px 16px', borderRadius: 12,
                    background: 'rgba(139,111,245,0.03)',
                    border: '1px solid rgba(139,111,245,0.06)',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fog)', opacity: 0.5, marginBottom: 6 }}>
                      System Prompt
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--fog)', margin: 0, lineHeight: 1.55, fontStyle: 'italic' }}>
                      {snapshot.systemPromptPreview}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── Chat messages ── */}
            {chatMessages.map((m, i) => (
              <div
                key={i}
                style={{
                  padding: '12px 16px', borderRadius: 14,
                  marginBottom: 8,
                  background: m.role === 'user'
                    ? 'rgba(139,111,245,0.06)'
                    : 'rgba(255,255,255,0.55)',
                  backdropFilter: m.role === 'agent' ? 'blur(12px)' : undefined,
                  WebkitBackdropFilter: m.role === 'agent' ? 'blur(12px)' : undefined,
                  border: m.role === 'agent' ? '1px solid var(--border-subtle)' : '1px solid rgba(139,111,245,0.1)',
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                }}
              >
                <div style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--fog)',
                  marginBottom: 4, opacity: 0.5,
                }}>
                  {m.role === 'user' ? 'You' : snapshot?.name || 'Agent'}
                </div>
                <div style={{
                  fontSize: 13, color: 'var(--mist)', lineHeight: 1.7,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {m.content}
                </div>
              </div>
            ))}

            {/* ── Error ── */}
            {error && (
              <div style={{
                padding: '14px 18px', borderRadius: 14,
                background: 'rgba(230,69,57,0.06)', border: '1px solid rgba(230,69,57,0.12)',
                fontSize: 13, color: 'var(--vermillion)', lineHeight: 1.5,
                marginBottom: 16,
              }}>
                {error}
              </div>
            )}

            {/* ── Thinking pill ── */}
            {responding && !reply && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 18px', borderRadius: 16,
                background: 'rgba(255,255,255,0.55)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid var(--border-subtle)',
                alignSelf: 'flex-start',
                marginBottom: 16,
              }}>
                <OrganicLoader icon="spin" size={16} className="text-indigo" />
                <span style={{ fontSize: 12, color: 'var(--fog)' }}>
                  Thinking…
                </span>
              </div>
            )}

            {/* ── Thinking stream (collapsible, only when showThinking is on) ── */}
            {thinking && (
              <details style={{
                padding: '10px 14px', borderRadius: 12,
                marginBottom: 6,
                background: 'rgba(139,111,245,0.04)',
                border: '1px solid rgba(139,111,245,0.12)',
                alignSelf: 'flex-start',
                maxWidth: '85%',
                fontSize: 12,
              }} open>
                <summary style={{
                  fontWeight: 600, color: 'var(--lavender)',
                  cursor: 'pointer', marginBottom: 6,
                }}>
                  Thinking…
                </summary>
                <div style={{
                  color: 'var(--fog)', lineHeight: 1.7,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  fontFamily: 'var(--font-serif)', fontStyle: 'italic',
                }}>
                  {thinking}
                </div>
              </details>
            )}

            {/* ── Streaming agent reply ── */}
            {reply && (
              <div style={{
                padding: '12px 16px', borderRadius: 14,
                marginBottom: 8,
                background: 'rgba(255,255,255,0.55)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid var(--border-subtle)',
                alignSelf: 'flex-start',
                maxWidth: '85%',
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--fog)',
                  marginBottom: 4, opacity: 0.5,
                }}>
                  {snapshot?.name || 'Agent'}
                </div>
                <div style={{
                  fontSize: 13, color: 'var(--mist)', lineHeight: 1.7,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {reply}
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* ── Composer ── */}
          <div style={{
            position: 'relative', zIndex: 1, flexShrink: 0,
            width: '100%', maxWidth: 680, padding: '12px 24px 12px',
          }}>
            <div style={{
              display: 'flex', gap: 8,
              background: 'rgba(255,255,255,0.55)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              borderRadius: 18,
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-card)',
              padding: 6,
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocusCapture={() => {
              const el = composerRef.current?.parentElement
              if (el) { el.style.borderColor = 'var(--border-focus)'; el.style.boxShadow = 'var(--shadow-glow)' }
            }}
            onBlurCapture={() => {
              const el = composerRef.current?.parentElement
              if (el) { el.style.borderColor = 'var(--border-subtle)'; el.style.boxShadow = 'var(--shadow-card)' }
            }}
            >
              <input
                ref={composerRef}
                type="text"
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && message.trim() && !responding) { const msg = message.trim(); setMessage(''); runTurn(msg) } }}
                placeholder="Type a test message…"
                disabled={responding}
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  fontSize: 13, color: 'var(--mist)',
                  outline: 'none', fontFamily: 'inherit',
                  padding: '10px 8px 10px 14px',
                }}
              />
              <button
                onClick={() => { if (message.trim() && !responding) { const msg = message.trim(); setMessage(''); runTurn(msg) } }}
                disabled={responding || !message.trim()}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 36, height: 36, borderRadius: 12,
                  background: message.trim() && !responding
                    ? 'linear-gradient(135deg, #5b8af7, #8b6ff5)'
                    : 'rgba(0,0,0,0.06)',
                  border: 'none', cursor: message.trim() && !responding ? 'pointer' : 'default',
                  opacity: message.trim() && !responding ? 1 : 0.4,
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
              >
                <Send size={14} color="white" />
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 10, color: 'var(--fog)', opacity: 0.5,
                cursor: 'pointer', userSelect: 'none',
              }}>
                Show raw JSON
                <button
                  onClick={() => setDebugMode(!debugMode)}
                  style={{
                    width: 32, height: 18, borderRadius: 9,
                    border: 'none', cursor: 'pointer',
                    background: debugMode ? 'var(--indigo)' : 'rgba(0,0,0,0.1)',
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, width: 14, height: 14, borderRadius: '50%',
                    background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                    left: debugMode ? 16 : 2,
                    transition: 'left 0.2s ease',
                  }} />
                </button>
              </label>
            </div>
          </div>
        </div>

        {/* ── Sidebar (right) ── */}
        <aside style={{
          width: 340, flexShrink: 0,
          borderLeft: '1px solid var(--border-subtle)',
          background: 'rgba(255,255,255,0.4)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <SidebarSection
            title="Live activity"
            icon={<Wrench size={11} />}
            count={liveTools.length}
            maxHeight={260}
          >
            {liveTools.length === 0 ? (
              <SidebarEmpty>Tools called by the agent will appear here.</SidebarEmpty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {liveTools.map((t, i) => (
                  <div
                    key={`${t.name}-${i}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px', borderRadius: 10,
                      background: 'rgba(255,255,255,0.55)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {t.status === 'running' ? (
                      <OrganicLoader icon="spin" size={14} className="text-indigo" />
                    ) : t.status === 'error' ? (
                      <XCircle size={14} color="var(--vermillion)" />
                    ) : (
                      <CheckCircle2 size={14} color="var(--malachite)" />
                    )}
                    <span style={{
                      fontSize: 11, fontWeight: 500, color: 'var(--mist)', flex: 1,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {t.name}
                    </span>
                    <span style={{
                      fontSize: 9, color: 'var(--smoke)',
                      fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                    }}>
                      {t.status === 'running'
                        ? 'running…'
                        : t.finishedAt
                          ? `${t.finishedAt - t.startedAt}ms`
                          : ''}
                    </span>
                  </div>
                ))}
                {/* ── RenderHint display for completed tools ── */}
                {liveTools.filter(t => t.status === 'done' && t.renderHints).map((t, i) => {
                  const hint = t.renderHints!
                  const result = t.result as Record<string, unknown> | undefined
                  if (hint.kind === 'form') {
                    // Show form fields from request_user_input result
                    const fields = (result?.fields as Array<{ key: string; label: string; type: string; required?: boolean }>) ?? []
                    const title = (result?.title as string) || (hint.submitLabel as string) || 'Form'
                    if (!fields.length) return null
                    return (
                      <div key={`hint-${i}`} style={{
                        padding: '10px 12px', borderRadius: 10,
                        background: 'rgba(139,111,245,0.04)', border: '1px solid rgba(139,111,245,0.12)',
                        marginTop: 2,
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--lavender)', marginBottom: 6 }}>{title}</div>
                        {fields.map((f) => (
                          <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 10 }}>
                            <span style={{ color: 'var(--fog)', minWidth: 60 }}>{f.label}</span>
                            <span style={{ color: 'var(--smoke)', fontFamily: 'var(--font-mono)', fontSize: 9 }}>
                              {f.type}{f.required ? ' *' : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  }
                  if (hint.kind === 'card') {
                    return (
                      <div key={`hint-${i}`} style={{
                        padding: '10px 12px', borderRadius: 10,
                        background: 'rgba(91,138,247,0.05)', border: '1px solid rgba(91,138,247,0.12)',
                        marginTop: 2,
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--indigo)', marginBottom: 4 }}>
                          {String((result as any)?.[(hint.titleField as string)] ?? hint.titleOverride ?? 'Card')}
                        </div>
                        {(hint.subtitleField as string) && (
                          <div style={{ fontSize: 10, color: 'var(--fog)' }}>
                            {String((result as any)?.[(hint.subtitleField as string)] ?? '')}
                          </div>
                        )}
                      </div>
                    )
                  }
                  if (hint.kind === 'quick_replies') {
                    const options = (result?.[(hint.optionsField as string)] as Array<Record<string, unknown>>) ?? []
                    if (!options.length) return null
                    return (
                      <div key={`hint-${i}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                        {options.map((opt, j) => (
                          <span key={j} style={{
                            padding: '3px 8px', borderRadius: 999,
                            background: 'rgba(139,111,245,0.08)', border: '1px solid rgba(139,111,245,0.15)',
                            fontSize: 10, color: 'var(--lavender)',
                          }}>
                            {String(opt[(hint.optionLabelField as string)] ?? opt[(hint.optionIdField as string)] ?? '')}
                          </span>
                        ))}
                      </div>
                    )
                  }
                  return null
                })}
              </div>
            )}
          </SidebarSection>

          <SidebarSection
            title="Behavior trace"
            icon={<Activity size={11} />}
            count={turnTraces.reduce((sum, t) => sum + t.length, 0)}
            flex={1}
          >
            {turnTraces.length === 0 || turnTraces.every(t => t.length === 0) ? (
              <SidebarEmpty>Send a message to see the behavior trace.</SidebarEmpty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {turnTraces.map((steps, turnIdx) => {
                  if (steps.length === 0) return null
                  const turnKey = turnIdx + 1
                  return (
                    <div key={turnIdx}>
                      <div style={{
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.08em', color: 'var(--fog)', opacity: 0.45,
                        padding: '6px 10px 2px', borderTop: turnIdx > 0 ? '1px solid var(--border-subtle)' : undefined,
                        marginTop: turnIdx > 0 ? 6 : 0,
                      }}>
                        Turn {turnKey}
                      </div>
                      {steps.map((step: any, i: number) => {
                        const Icon = TRACE_ICONS[step.actionType] || Puzzle
                        const isEmpty = !step.ms && (!step.summary || step.summary === '(no events)')
                        const ck = `${turnKey}-${i}`
                        const collapsed = collapsedTraces.has(ck)
                        return (
                          <div key={ck}>
                            <div
                              style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: collapsed ? '4px 10px' : '6px 10px',
                                borderRadius: 8,
                                fontSize: 12,
                                cursor: 'pointer',
                                opacity: collapsed ? 0.45 : 1,
                                transition: 'all 0.15s',
                              }}
                              onClick={() => {
                                setCollapsedTraces(prev => {
                                  const next = new Set(prev)
                                  if (next.has(ck)) { next.delete(ck) } else { next.add(ck) }
                                  return next
                                })
                              }}
                              onMouseEnter={e => { if (collapsed) e.currentTarget.style.opacity = '0.7' }}
                              onMouseLeave={e => { if (collapsed) e.currentTarget.style.opacity = '0.45' }}
                            >
                              <div style={{
                                width: collapsed ? 16 : 22, height: collapsed ? 16 : 22, borderRadius: 6,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: `rgba(${STATUS_RGB[step.status] ?? '0,0,0'}, 0.08)`,
                                flexShrink: 0,
                                transition: 'all 0.15s',
                              }}>
                                {collapsed
                                  ? <ChevronDown size={9} color="var(--fog)" style={{ transform: 'rotate(-90deg)' }} />
                                  : <Icon size={11} color={STATUS_ICON_COLOR[step.status] ?? 'var(--fog)'} />
                                }
                              </div>
                              <span style={{ fontWeight: 500, color: 'var(--mist)', minWidth: 84, fontSize: 11, flexShrink: 0 }}>
                                {step.stage || step.actionType}
                              </span>
                              <span style={{
                                color: 'var(--fog)', flex: 1, fontSize: 11,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {collapsed ? (isEmpty ? '(no events)' : step.summary || step.title) : (step.summary || step.title)}
                              </span>
                              <span style={{ fontSize: 9, color: 'var(--smoke)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                                {step.ms}ms
                              </span>
                            </div>
                            {!collapsed && (
                              <div style={{ padding: '0 10px 4px 38px' }}>
                                {isEmpty ? (
                                  <span style={{ fontSize: 10, color: 'var(--fog)', opacity: 0.4 }}>(no events)</span>
                                ) : (
                                  <>
                                    {step.title && step.title !== step.summary && (
                                      <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 500 }}>{step.title}</div>
                                    )}
                                    {debugMode && step.json && (
                                      <details style={{ marginTop: 2 }}>
                                        <summary style={{ fontSize: 9, color: 'var(--indigo)', cursor: 'pointer', opacity: 0.6 }}>JSON</summary>
                                        <pre style={{
                                          maxWidth: 280, maxHeight: 160, overflow: 'auto',
                                          fontSize: 9, color: 'var(--fog)',
                                          background: 'rgba(255,255,255,0.95)', border: '1px solid var(--border-subtle)',
                                          borderRadius: 8, padding: '6px 10px',
                                        }}>
                                          {JSON.stringify(step.json, null, 2)}
                                        </pre>
                                      </details>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </SidebarSection>
        </aside>
      </div>
    </div>
  )
}

/* ── Tiny sub-components ── */

function ConfigPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 8,
      background: 'rgba(0,0,0,0.03)',
      fontSize: 11, color: 'var(--fog)', fontWeight: 500,
      flexShrink: 0,
    }}>
      {icon}
      {label}
    </div>
  )
}

function SidebarSection({
  title, icon, count, maxHeight, flex, children,
}: {
  title: string
  icon: React.ReactNode
  count?: number
  maxHeight?: number
  flex?: number
  children: React.ReactNode
}) {
  return (
    <section style={{
      display: 'flex', flexDirection: 'column',
      borderBottom: '1px solid var(--border-subtle)',
      maxHeight, flex, minHeight: 0, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '12px 16px 8px',
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--fog)', opacity: 0.55,
        flexShrink: 0,
      }}>
        {icon}
        <span>{title}</span>
        {typeof count === 'number' && count > 0 && (
          <span style={{
            marginLeft: 4, fontSize: 9, fontWeight: 600,
            color: 'var(--indigo)',
            background: 'rgba(91,138,247,0.08)',
            padding: '1px 6px', borderRadius: 6,
            textTransform: 'none', letterSpacing: 0, opacity: 1,
          }}>
            {count}
          </span>
        )}
      </div>
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        padding: '0 12px 12px',
      }}>
        {children}
      </div>
    </section>
  )
}

function SidebarEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 11, color: 'var(--fog)', opacity: 0.4,
      margin: 0, textAlign: 'center', padding: '12px 4px',
      lineHeight: 1.5,
    }}>
      {children}
    </p>
  )
}

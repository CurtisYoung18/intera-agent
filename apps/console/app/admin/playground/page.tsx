'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
  FlaskConical, Send,
  Sparkles, AlertCircle, CheckCircle2, Clock, XCircle,
  Shield, Brain, Search, Puzzle, ExternalLink, Activity,
  ChevronDown, ChevronLeft, ChevronRight, ImageIcon,
} from 'lucide-react'
import { useAgentContext } from '@/lib/agent/agent-context'
import type { LifecycleNotice } from '@intera/shared/types'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import AgentVersionPicker from '@/components/admin/agent-version-picker'
import { apiClient } from '@/lib/api/client'
import { resolveEffectiveModel } from '@/lib/agent/resolve-model'
import CopyButton from '@/components/ui/copy-button'
import MessageContent from '@/components/chat/message-content'
import RenderHintCard from '@/components/chat/render-hint-card'
import { StatusDot, statusColor } from '@/components/chat/status-accents'

/* ── Types ── */

interface ModelInfo {
  id: string; name: string; provider: string; providerLabel: string
  supportsVision?: boolean
}

interface AttachedImage {
  base64: string
  mimeType: string
  name: string
}

interface AgentListItem {
  id: string
  name: string
  version: number
  isActive: boolean
}

interface AgentSnapshot {
  name: string
  resolvedModel: string
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
  const { selectedAgentId, selectAgent } = useAgentContext()
  const [agentList, setAgentList] = useState<AgentListItem[]>([])
  const [selectedIsActive, setSelectedIsActive] = useState(true)
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [pickerRefreshKey, setPickerRefreshKey] = useState(0)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null)
  const [formRequest, setFormRequest] = useState<{ title: string; description?: string; fields: Array<{ key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] }>; skillCallId: string } | null>(null)
  const [debugMode, setDebugMode] = useState(false)

  const [message, setMessage] = useState('')
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'agent' | 'system'; content: string; thinking?: string; images?: AttachedImage[]; notice?: LifecycleNotice }>>([])
  const [reply, setReply] = useState('')
  const [showThinking, setShowThinking] = useState(false)
  const thinkingAccRef = useRef('')
  const [responding, setResponding] = useState(false)
  const [liveTools, setLiveTools] = useState<LiveTool[]>([])
  const [turnTraces, setTurnTraces] = useState<any[][]>([])
  const [turnTotalMs, setTurnTotalMs] = useState<number[]>([])
  const turnNumRef = useRef(0)
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set())
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [error, setError] = useState('')
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const [toastMessage, setToastMessage] = useState('')
  const [savingToChat, setSavingToChat] = useState(false)
  const [savedChatId, setSavedChatId] = useState<string | null>(null)
  const [chatId, setChatId] = useState<string | null>(null)

  const composerRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Refs that mirror mutable values read inside runTurn (stale-closure fix)
  const attachedImagesRef = useRef<AttachedImage[]>([])
  useEffect(() => { attachedImagesRef.current = attachedImages }, [attachedImages])
  const showThinkingRef = useRef(showThinking)
  useEffect(() => { showThinkingRef.current = showThinking }, [showThinking])
  const chatIdRef = useRef<string | null>(null)
  useEffect(() => { chatIdRef.current = chatId }, [chatId])

  // ── Message queue (allow typing while responding) ──
  const [queuedMessages, setQueuedMessages] = useState<Array<{ text: string; images: AttachedImage[] }>>([])
  const queuedMessagesRef = useRef<Array<{ text: string; images: AttachedImage[] }>>([])
  useEffect(() => { queuedMessagesRef.current = queuedMessages }, [queuedMessages])

  // Auto-send next queued message when current turn finishes
  const respondingRef = useRef(false)
  useEffect(() => {
    if (!responding && respondingRef.current && queuedMessagesRef.current.length > 0) {
      const next = queuedMessagesRef.current[0]
      setQueuedMessages(prev => prev.slice(1))
      runTurn(next.text, next.images)
    }
    respondingRef.current = responding
  }, [responding])

  // ── Restore session on mount + agent switch ──
  useEffect(() => {
    // Clear current session before restoring new agent's session
    setChatId(null)
    setChatMessages([])
    setTurnTraces([])
    setTurnTotalMs([])
    setReply('')
    setError('')
    setLiveTools([])
    setSavedChatId(null)

    const configId = selectedAgentId
    let cancelled = false
    async function restore() {
      try {
        const params = configId ? `?configId=${encodeURIComponent(configId)}` : ''
        const res = await fetch(`/api/admin/playground/sessions${params}`)
        if (!res.ok || cancelled) return
        const { data } = await res.json() as { data: { sessions: Array<{ chatId: string; firstMessage: string; createdAt: string }> } }
        const latestSession = data.sessions?.[0]
        if (!latestSession) return
        const detailRes = await fetch(`/api/admin/playground/sessions/${latestSession.chatId}`)
        if (!detailRes.ok || cancelled) return
        const { data: detailData } = await detailRes.json() as { data: { chatId: string; messages: Array<{ id: string; role: string; content: string; contentBlocks?: unknown; createdAt: string }> } }
        if (cancelled) return
        setChatId(detailData.chatId)
        setChatMessages(detailData.messages.map((m) => ({
          role: m.role === 'assistant' ? 'agent' as const : 'user' as const,
          content: m.content,
        })))
      } catch { /* session restore is best-effort */ }
    }
    restore()
    return () => { cancelled = true }
  }, [selectedAgentId])

  // Auto-expand latest turn; error tools default expanded
  useEffect(() => {
    if (turnTraces.length === 0) return
    setExpandedTurns(prev => {
      const next = new Set(prev)
      next.add(turnTraces.length - 1)
      return next
    })
    const latestSteps = turnTraces[turnTraces.length - 1] || []
    latestSteps.forEach((step: any, toolIdx: number) => {
      if (step.status === 'warn' || step.status === 'block') {
        setExpandedTools(prev => {
          const next = new Set(prev)
          next.add(`${turnTraces.length - 1}-${toolIdx}`)
          return next
        })
      }
    })
  }, [turnTraces])

  /* ── Data loading ── */

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/agent-configs').then(r => r.json()).then(d => d.data || d),
      fetch('/api/admin/models').then(r => r.json()).then(d => d.data || d),
    ]).then(([agentsData, modelsData]) => {
      setAgentList(agentsData.configs || [])
      setModels(modelsData.models || [])
    }).catch(() => { /* non-critical; picker will retry */ })
  }, [])

  useEffect(() => {
    if (!selectedAgentId) return
    // Track draft/active state
    const selected = agentList.find(a => a.id === selectedAgentId)
    setSelectedIsActive(selected?.isActive ?? false)
    setSelectedVersion(selected?.version ?? null)
    // Reset traces on agent change
    setTurnTraces([])
    setTurnTotalMs([])
    turnNumRef.current = 0
    setExpandedTurns(new Set())
    setExpandedTools(new Set())

    fetch(`/api/admin/agent?agentId=${selectedAgentId}`)
      .then(r => r.json())
      .then(data => {
        const raw = data.data?.config || data.config || {}
        let memoryStrategy = {}
        let policyHooks = '{}'
        try { memoryStrategy = typeof raw.memoryStrategy === 'string' ? JSON.parse(raw.memoryStrategy || '{}') : raw.memoryStrategy || {} } catch { /* */ }
        try { policyHooks = typeof raw.policyHooks === 'string' ? raw.policyHooks : JSON.stringify(raw.policyHooks || {}, null, 2) } catch { policyHooks = '{}' }

        const sp = raw.systemPrompt || ''

        // Resolved model: prefer the API-resolved name, fall back to modelInfo lookup, then raw model id
        const resolvedModel: string = data.data?.resolvedModel || data.resolvedModel || data.data?.config?.resolvedModel || data.config?.resolvedModel ||
          (models.find(m => m.id === raw.model)?.name || raw.model || resolveEffectiveModel({ model: raw.model }))

        setSnapshot({
          name: raw.name || 'Default',
          resolvedModel,
          systemPromptPreview: sp.length > 120 ? sp.slice(0, 120) + '…' : sp,
          memoryTierLabel: detectMemoryTier(memoryStrategy),
          guardrailCount: countGuardrails(policyHooks),
          temperature: raw.temperature ?? 0.5,
        })
        setDebugMode(Boolean(raw.debugMode))
        if (raw.showThinking !== undefined) setShowThinking(Boolean(raw.showThinking))
      })
      .catch(() => setSnapshot(null))
  }, [selectedAgentId, models, agentList])

  /* ── Auto-scroll ── */

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [reply, turnTraces])

  /* ── Vision gate ── */

  const supportsVision = (() => {
    if (!snapshot) return false
    // Find the resolved model in the models list
    const model = models.find(m => m.name === snapshot.resolvedModel || m.id === snapshot.resolvedModel)
    return model?.supportsVision ?? false
  })()

  /* ── Image helpers ── */

  const handleImageAttach = useCallback(async (files: FileList | File[]) => {
    if (!supportsVision) {
      setToastMessage(`${snapshot?.resolvedModel || 'This model'} doesn't support images — switch to a vision model, e.g. GPT-4o / Gemini`)
      setTimeout(() => setToastMessage(''), 4000)
      return
    }
    const limit = 5 * 1024 * 1024 // 5MB
    const newImages: AttachedImage[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > limit) { setToastMessage(`"${file.name}" exceeds 5MB limit`); setTimeout(() => setToastMessage(''), 3000); continue }
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      newImages.push({ base64, mimeType: file.type, name: file.name })
    }
    setAttachedImages(prev => [...prev, ...newImages])
  }, [supportsVision, snapshot?.resolvedModel])

  const removeImage = useCallback((idx: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== idx))
  }, [])

  /* ── Save to Chat ── */

  const handleSaveToChat = useCallback(async () => {
    if (chatMessages.length === 0) return
    setSavingToChat(true)
    try {
      const res = await fetch('/api/admin/playground/save-to-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedAgentId,
          messages: chatMessages.map(m => ({
            role: m.role,
            content: m.content,
            thinking: m.thinking,
          })),
          traces: turnTraces,
        }),
      })
      if (!res.ok) { setToastMessage(`Save failed: HTTP ${res.status}`); setTimeout(() => setToastMessage(''), 4000); return }
      const data = await res.json(); const p = data.data || data
      setSavedChatId(p.chatId)
      setToastMessage('Saved to Chat!')
      setTimeout(() => setToastMessage(''), 4000)
    } catch (err) {
      setToastMessage('Save failed: network error')
      setTimeout(() => setToastMessage(''), 4000)
    } finally {
      setSavingToChat(false)
    }
  }, [chatMessages, turnTraces, selectedAgentId])

  /* ── Run turn ── */

  const runTurn = useCallback(async (msg: string, queuedImages?: AttachedImage[]) => {
    setReply('')
    thinkingAccRef.current = ''
    turnNumRef.current += 1
    setTurnTraces(prev => [...prev, []])
    setTurnTotalMs(prev => [...prev, 0])
    setLiveTools([])
    setFormRequest(null)
    setError('')
    setResponding(true)
    setSidebarCollapsed(false)
    const currentImages = queuedImages ?? attachedImagesRef.current
    setAttachedImages([])
    setChatMessages(prev => [...prev, { role: 'user' as const, content: msg, images: currentImages.length > 0 ? currentImages : undefined }])

    try {
      const body: Record<string, unknown> = { message: msg }
      if (selectedAgentId) body.configId = selectedAgentId
      body.config = { debug: debugMode, showThinking: showThinkingRef.current }
      if (chatIdRef.current) body.chatId = chatIdRef.current
      if (currentImages.length > 0) {
        body.contentBlocks = currentImages.map(img => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
        }))
      }

      const pushNotice = (notice: LifecycleNotice) => {
        setChatMessages(prev => [...prev, { role: 'system' as const, content: '', notice }])
      }

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
            else if (event.type === 'thinking_delta') {
              thinkingAccRef.current += event.data
            }
            else if (event.type === 'session_init') {
              const d = event.data as { chatId: string; caseId: string }
              if (d?.chatId && !chatIdRef.current) {
                setChatId(d.chatId)
              }
            }
            else if (event.type === 'error') {
              const errData = event.data
              if (typeof errData === 'string') setError(errData)
              else if (errData && typeof errData === 'object') setError((errData as any)?.message ?? 'Unknown error')
              else setError(String(errData))
            }
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
            else if (event.type === 'form_request') {
              const d = event.data as any
              setFormRequest({
                title: d?.title || 'Information Needed',
                description: d?.description,
                fields: d?.fields || [],
                skillCallId: d?.skillCallId || '',
              })
            }
            else if (event.type === 'trace') {
              const t = event.data.trace || []
              setTurnTraces(prev => {
                const next = [...prev]
                if (next.length > 0) next[next.length - 1] = t
                return next
              })
              setTurnTotalMs(prev => {
                const next = [...prev]
                if (next.length > 0) next[next.length - 1] = (event.data as any).totalMs ?? 0
                return next
              })
            }
            else if (event.type === 'escalated') pushNotice({ kind: 'escalated', label: 'Agent escalated to a human', detail: (event.data as any)?.reason })
            else if (event.type === 'case_created') pushNotice({ kind: 'case_created', label: `Case created: ${(event.data as any)?.displayName ?? (event.data as any)?.caseType ?? ''}` })
            else if (event.type === 'sub_agent_start') pushNotice({ kind: 'sub_agent', label: `Sub-agent dispatched: ${(event.data as any)?.agentName ?? ''}` })
            else if (event.type === 'human_task_created') pushNotice({ kind: 'human_task', label: 'Human task created' })
            else if (event.type === 'retry_pending') pushNotice({ kind: 'retry', label: `Retrying (${(event.data as any)?.errorClass ?? 'transient'})…` })
          } catch { /* */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setResponding(false)
      const archivedThinking = thinkingAccRef.current
      setReply(r => {
        if (r) setChatMessages(prev => [...prev, { role: 'agent' as const, content: r, thinking: archivedThinking || undefined }])
        return ''
      })
    }
  }, [selectedAgentId, debugMode])

  // ── Session metrics ──
  const sessionMetrics = useMemo(() => {
    let totalInput = 0, totalOutput = 0, totalTools = 0, llmCalls = 0
    for (const steps of turnTraces) {
      for (const step of steps) {
        if (step.usage) { totalInput += step.usage.inputTokens || 0; totalOutput += step.usage.outputTokens || 0; llmCalls++ }
        if (step.stage === 'Skills & tools' || step.stage === 'Knowledge retrieval') totalTools += step.detail?.length || 0
      }
    }
    const totalMs = turnTotalMs.reduce((a, b) => a + b, 0)
    return { totalInput, totalOutput, totalTools, llmCalls, totalMs }
  }, [turnTraces, turnTotalMs])

  const tb = (key: string) => {
    const labels: Record<string, string> = {
      'trace.sessionTokens': 'tokens', 'trace.sessionWall': 'wall',
      'trace.sessionLlm': 'llm', 'trace.sessionTools': 'tools',
      'trace.breakdownInput': 'input', 'trace.breakdownOutput': 'output',
      'trace.breakdownCache': 'cache hit', 'trace.breakdownLlm': 'llm',
      'trace.breakdownTools': 'tools', 'trace.breakdownTokPerS': 'tok/s',
      'trace.inputLabel': 'Input', 'trace.outputLabel': 'Output',
      'trace.outputError': 'error', 'trace.modelResponse': 'Model response',
      'trace.running': 'running...', 'trace.failed': 'failed',
    }
    return labels[key] || key.split('.').pop() || key
  }

  /* ── Render ── */

  return (
    <>
    <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
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
            onChange={(id) => selectAgent(id)}
            onAgentsChanged={() => setPickerRefreshKey(k => k + 1)}
          />
          {!selectedIsActive && selectedVersion && (
            <span style={{
              fontSize: 10, fontWeight: 600, color: 'var(--amber)',
              padding: '2px 8px', borderRadius: 6,
              background: 'rgba(212,145,46,0.10)', border: '1px solid rgba(212,145,46,0.20)',
              flexShrink: 0,
            }}>
              测试草稿 v{selectedVersion}（未上线）
            </span>
          )}
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--border-subtle)', flexShrink: 0 }} />

        {snapshot && (
          <>
            <ConfigPill icon={<Sparkles size={11} />} label={snapshot.resolvedModel} />
            <ConfigPill icon={<span style={{ fontSize: 10, fontWeight: 600 }}>&#123;t&#125;</span>} label={`Temp ${snapshot.temperature}`} />
            <ConfigPill icon={<Clock size={11} />} label={snapshot.memoryTierLabel} />
            <ConfigPill icon={<Shield size={11} />} label={`${snapshot.guardrailCount} rule${snapshot.guardrailCount !== 1 ? 's' : ''}`} />

            <div style={{ flex: 1 }} />

            <button
              onClick={() => setShowThinking(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 500, color: showThinking ? 'var(--lavender)' : 'var(--fog)',
                background: showThinking ? 'rgba(139,111,245,0.08)' : 'transparent',
                border: showThinking ? '1px solid rgba(139,111,245,0.15)' : '1px solid transparent',
                padding: '3px 8px', borderRadius: 8,
                cursor: 'pointer', transition: 'all 0.15s',
                flexShrink: 0,
              }}
            >
              <Brain size={11} /> Thinking
            </button>

            <button
              onClick={async () => {
                if (!chatId) return
                try {
                  await fetch(`/api/admin/playground/sessions/${chatId}`, { method: 'DELETE' })
                } catch { /* best-effort */ }
                setChatId(null)
                setChatMessages([])
                setTurnTraces([])
                setTurnTotalMs([])
                setReply('')
                setError('')
                setLiveTools([])
                setSavedChatId(null)
              }}
              disabled={!chatId}
              title="Reset session"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 500, color: chatId ? 'var(--coral)' : 'var(--fog)',
                background: 'transparent',
                border: '1px solid transparent',
                padding: '3px 8px', borderRadius: 8,
                cursor: chatId ? 'pointer' : 'default',
                transition: 'all 0.15s',
                flexShrink: 0,
                opacity: chatId ? 1 : 0.35,
              }}
            >
              <XCircle size={11} /> Reset
            </button>

            <button
              onClick={handleSaveToChat}
              disabled={chatMessages.length === 0 || savingToChat}
              title={savedChatId ? `Saved — open chat /ops/chats/${savedChatId}` : chatMessages.length === 0 ? 'Send a message first' : 'Save transcript to Chat'}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 500, color: savedChatId ? 'var(--malachite)' : 'var(--fog)',
                background: savedChatId ? 'rgba(46,160,74,0.08)' : 'transparent',
                border: savedChatId ? '1px solid rgba(46,160,74,0.15)' : '1px solid transparent',
                padding: '3px 8px', borderRadius: 8,
                cursor: chatMessages.length === 0 ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                flexShrink: 0,
                opacity: chatMessages.length === 0 ? 0.35 : 1,
              }}
            >
              {savingToChat ? 'Saving…' : savedChatId ? (
                <Link
                  href={`/ops/chats/${savedChatId}`}
                  target="_blank"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'inherit', textDecoration: 'none' }}
                  onClick={e => e.stopPropagation()}
                >
                  <ExternalLink size={10} /> View Chat
                </Link>
              ) : 'Save to Chat'}
            </button>

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
          <div className="pg-chat-scroll" style={{
            flex: 1, width: '100%',
            maxWidth: 680,
            padding: '32px 0 0 24px',
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
                    ? `Testing "${snapshot.name}" · ${snapshot.resolvedModel}`
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
              <div key={i} style={{ alignSelf: m.role === 'system' ? 'center' : m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: m.role === 'system' ? '100%' : '85%' }}>
                {m.role === 'system' && m.notice && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', borderRadius: 20,
                      background: 'rgba(139,111,245,0.06)',
                      border: '1px solid rgba(139,111,245,0.1)',
                      fontSize: 11, color: 'var(--fog)',
                    }}>
                      {m.notice.kind === 'escalated' && <AlertCircle size={12} color="var(--amber)" />}
                      {m.notice.kind === 'case_created' && <CheckCircle2 size={12} color="var(--malachite)" />}
                      {m.notice.kind === 'sub_agent' && <Activity size={12} color="var(--indigo)" />}
                      {m.notice.kind === 'human_task' && <Clock size={12} color="var(--amber)" />}
                      {m.notice.kind === 'retry' && <XCircle size={12} color="var(--vermillion)" />}
                      <span>{m.notice.label}</span>
                      {m.notice.detail && <span style={{ opacity: 0.5 }}>— {m.notice.detail}</span>}
                    </div>
                  </div>
                )}
                {/* Per-message thinking (above agent bubble, collapsed, survives turns) */}
                {m.role !== 'system' && (
                  <>
                {showThinking && m.role === 'agent' && m.thinking && (
                  <details style={{
                    padding: '10px 14px', borderRadius: 12,
                    marginBottom: 6,
                    background: 'rgba(139,111,245,0.04)',
                    border: '1px solid rgba(139,111,245,0.1)',
                    fontSize: 12,
                  }}>
                    <summary style={{
                      fontWeight: 600, color: 'var(--lavender)',
                      cursor: 'pointer', marginBottom: 6,
                    }}>
                      Thinking
                    </summary>
                    <div style={{
                      color: 'var(--mist)', lineHeight: 1.7,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      fontFamily: 'var(--font-serif), serif', fontStyle: 'italic',
                      fontSize: 12,
                    }}>
                      {m.thinking}
                    </div>
                  </details>
                )}
                <div
                  style={{
                    padding: '12px 16px', borderRadius: 14,
                    marginBottom: 8,
                    background: m.role === 'user'
                      ? 'rgba(139,111,245,0.06)'
                      : 'rgba(255,255,255,0.55)',
                    backdropFilter: m.role === 'agent' ? 'blur(12px)' : undefined,
                    WebkitBackdropFilter: m.role === 'agent' ? 'blur(12px)' : undefined,
                    border: m.role === 'agent' ? '1px solid var(--border-subtle)' : '1px solid rgba(139,111,245,0.1)',
                  }}
                >
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--fog)',
                    marginBottom: 4, opacity: 0.5,
                  }}>
                    {m.role === 'user' ? 'You' : snapshot?.name || 'Agent'}
                  </div>
                  {m.role === 'agent' ? (
                    <MessageContent content={m.content} />
                  ) : (
                    <>
                      {m.images && m.images.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                          {m.images.map((img, idx) => (
                            <img
                              key={idx}
                              src={`data:${img.mimeType};base64,${img.base64}`}
                              alt={img.name}
                              title={img.name}
                              style={{
                                maxWidth: 120, maxHeight: 80,
                                borderRadius: 8, objectFit: 'cover',
                                border: '1px solid rgba(139,111,245,0.12)',
                              }}
                            />
                          ))}
                        </div>
                      )}
                      <div style={{
                        fontSize: 13, color: 'var(--mist)', lineHeight: 1.7,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {m.content}
                      </div>
                    </>
                  )}
                </div>
                  </>
                )}
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
                <MessageContent content={reply} />
              </div>
            )}

            {/* ── Form request (request_user_input) ── */}
            {formRequest && (
              <div style={{
                padding: '16px 20px', borderRadius: 14,
                marginBottom: 8,
                background: 'rgba(255,255,255,0.7)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(139,111,245,0.2)',
                boxShadow: '0 4px 16px rgba(139,111,245,0.08)',
                alignSelf: 'flex-start',
                maxWidth: '420px',
                width: '100%',
              }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--mist)', margin: '0 0 2px' }}>{formRequest.title}</p>
                {formRequest.description && (
                  <p style={{ fontSize: 11, color: 'var(--fog)', margin: '0 0 12px', opacity: 0.7 }}>{formRequest.description}</p>
                )}
                <form onSubmit={e => {
                  e.preventDefault()
                  const formData = new FormData(e.currentTarget)
                  const answers: Record<string, string> = {}
                  formData.forEach((v, k) => { answers[k] = String(v) })
                  const answerText = Object.entries(answers)
                    .filter(([, v]) => v.trim())
                    .map(([k, v]) => `${k}: ${v}`)
                    .join('\n')
                  setFormRequest(null)
                  if (answerText) runTurn(`[Form submission]\n${answerText}`)
                }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {formRequest.fields.map(f => (
                    <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--mist)' }}>
                        {f.label}{f.required ? ' *' : ''}
                      </label>
                      {f.type === 'select' ? (
                        <select name={f.key} required={f.required}
                          style={{ padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '1px solid var(--border-subtle)', background: '#fff', outline: 'none' }}>
                          <option value="">--</option>
                          {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : f.type === 'textarea' ? (
                        <textarea name={f.key} required={f.required} placeholder={f.placeholder}
                          rows={2} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '1px solid var(--border-subtle)', resize: 'vertical', outline: 'none' }} />
                      ) : (
                        <input name={f.key} type={f.type === 'number' ? 'number' : 'text'} required={f.required} placeholder={f.placeholder}
                          style={{ padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '1px solid var(--border-subtle)', outline: 'none' }} />
                      )}
                    </div>
                  ))}
                  <button type="submit"
                    style={{
                      marginTop: 4, padding: '8px 16px', fontSize: 12, fontWeight: 600,
                      borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: 'var(--indigo)', color: '#fff',
                    }}>
                    Submit
                  </button>
                </form>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* ── Composer ── */}
          <div style={{
            position: 'relative', zIndex: 1, flexShrink: 0,
            width: '100%', maxWidth: 680, padding: '12px 24px 12px',
          }}>
            {/* ── Attached image previews ── */}
            {attachedImages.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {attachedImages.map((img, idx) => (
                  <div key={idx} style={{ position: 'relative' }}>
                    <img
                      src={`data:${img.mimeType};base64,${img.base64}`}
                      alt={img.name}
                      title={img.name}
                      style={{
                        width: 56, height: 56, borderRadius: 8,
                        objectFit: 'cover', border: '1px solid var(--border-subtle)',
                      }}
                    />
                    <button
                      onClick={() => removeImage(idx)}
                      style={{
                        position: 'absolute', top: -4, right: -4,
                        width: 16, height: 16, borderRadius: '50%',
                        background: 'var(--vermillion)', color: 'white',
                        border: 'none', cursor: 'pointer', fontSize: 9,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        lineHeight: 1,
                      }}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}

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
              {/* ── Attach button ── */}
              <label
                title={supportsVision ? 'Attach image' : `${snapshot?.resolvedModel || 'This model'} doesn't support images — switch to a vision model, e.g. GPT-4o / Gemini`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 36, height: 36, borderRadius: 12,
                  background: supportsVision ? 'rgba(139,111,245,0.06)' : 'rgba(0,0,0,0.03)',
                  border: supportsVision ? '1px solid rgba(139,111,245,0.12)' : '1px solid rgba(0,0,0,0.06)',
                  cursor: supportsVision ? 'pointer' : 'not-allowed',
                  opacity: supportsVision ? 1 : 0.35,
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
              >
                <ImageIcon size={14} color={supportsVision ? 'var(--lavender)' : 'var(--fog)'} />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={!supportsVision}
                  onChange={e => { if (e.target.files) { handleImageAttach(e.target.files); e.target.value = '' } }}
                  style={{ display: 'none' }}
                />
              </label>

              <input
                ref={composerRef}
                type="text"
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && message.trim()) { const msg = message.trim(); const imgs = attachedImagesRef.current; setMessage(''); setAttachedImages([]); if (responding) { setQueuedMessages(prev => [...prev, { text: msg, images: imgs }]) } else { runTurn(msg) } } }}
                onPaste={e => {
                  const items = e.clipboardData?.items
                  if (!items) return
                  const imageFiles: File[] = []
                  for (const item of Array.from(items)) {
                    if (item.type.startsWith('image/')) {
                      const file = item.getAsFile()
                      if (file) imageFiles.push(file)
                    }
                  }
                  if (imageFiles.length > 0) {
                    e.preventDefault()
                    if (!supportsVision) {
                      setToastMessage(`${snapshot?.resolvedModel || 'This model'} doesn't support images — switch to a vision model, e.g. GPT-4o / Gemini`)
                      setTimeout(() => setToastMessage(''), 4000)
                      return
                    }
                    handleImageAttach(imageFiles)
                  }
                }}
                placeholder={responding ? 'Type to queue next message…' : 'Type a test message…'}
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  fontSize: 13, color: 'var(--mist)',
                  outline: 'none', fontFamily: 'inherit',
                  padding: '10px 8px 10px 14px',
                }}
              />
              <button
                onClick={() => { if (message.trim()) { const msg = message.trim(); const imgs = attachedImagesRef.current; setMessage(''); setAttachedImages([]); if (responding) { setQueuedMessages(prev => [...prev, { text: msg, images: imgs }]) } else { runTurn(msg) } } }}
                disabled={!message.trim()}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 36, height: 36, borderRadius: 12,
                  background: message.trim()
                    ? responding
                      ? 'linear-gradient(135deg, #8b6ff5, #d491e6)'
                      : 'linear-gradient(135deg, #5b8af7, #8b6ff5)'
                    : 'rgba(0,0,0,0.06)',
                  border: 'none', cursor: message.trim() ? 'pointer' : 'default',
                  opacity: message.trim() ? 1 : 0.4,
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
              >
                <Send size={14} color="white" />
              </button>
            </div>

            {/* ── Queue indicator ── */}
            {queuedMessages.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '4px 0', fontSize: 11, color: 'var(--lavender)',
                fontWeight: 500, gap: 4,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--lavender)', opacity: 0.6,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
                {queuedMessages.length} message{queuedMessages.length > 1 ? 's' : ''} queued
              </div>
            )}

            {/* ── Toast ── */}
            {toastMessage && (
              <div style={{
                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                padding: '8px 16px', borderRadius: 10,
                background: savedChatId ? 'var(--malachite)' : toastMessage.includes('failed') || toastMessage.includes('exceeds') ? 'var(--vermillion)' : 'var(--malachite)',
                color: 'white',
                fontSize: 11, fontWeight: 500,
                whiteSpace: 'nowrap', boxShadow: savedChatId ? '0 4px 12px rgba(46,160,74,0.3)' : '0 4px 12px rgba(230,69,57,0.3)',
                marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                {toastMessage}
                {savedChatId && toastMessage === 'Saved to Chat!' && (
                  <Link href={`/ops/chats/${savedChatId}`} target="_blank" style={{ color: 'white', fontWeight: 600, textDecoration: 'underline', fontSize: 11 }}>
                    View Chat
                  </Link>
                )}
              </div>
            )}

          </div>
        </div>

        {/* ── Sidebar (right) ── */}
        {!sidebarCollapsed && (
        <aside style={{
          width: 340, flexShrink: 0,
          borderLeft: '1px solid var(--border-subtle)',
          background: '#fff',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={11} style={{ color: 'var(--fog)' }} />
              <span style={{ fontSize: 11, fontWeight: 650, color: 'var(--mist)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Trace</span>
              {(liveTools.length + turnTraces.reduce((sum, t) => sum + t.length, 0)) > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 600, color: 'var(--fog)',
                  background: 'rgba(59,108,244,0.06)', padding: '0 5px', borderRadius: 3,
                  lineHeight: '18px', minWidth: 18, textAlign: 'center',
                }}>
                  {liveTools.length + turnTraces.reduce((sum, t) => sum + t.length, 0)}
                </span>
              )}
            </div>
            <button onClick={() => setSidebarCollapsed(true)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 2, color: 'var(--fog)', opacity: 0.5,
            }}>
              <ChevronRight size={14} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {/* Empty state */}
            {turnTraces.length === 0 && liveTools.length === 0 ? (
              <div style={{
                padding: '24px 20px', textAlign: 'center',
                fontSize: 12, color: 'var(--smoke)', lineHeight: 1.6,
              }}>
                Send a message to see the trace.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {/* ── Session metrics ── */}
                {sessionMetrics.totalInput > 0 && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6,
                    padding: '0 12px 12px', borderBottom: '1px solid var(--border-subtle)',
                    marginBottom: 8,
                  }}>
                    <div style={metricStyle}>
                      <div style={metricValStyle}>{sessionMetrics.totalInput + sessionMetrics.totalOutput >= 1000 ? ((sessionMetrics.totalInput + sessionMetrics.totalOutput) / 1000).toFixed(1) + 'K' : String(sessionMetrics.totalInput + sessionMetrics.totalOutput)}</div>
                      <div style={metricLblStyle}>{tb('trace.sessionTokens')}</div>
                    </div>
                    <div style={metricStyle}>
                      <div style={metricValStyle}>{sessionMetrics.totalMs >= 1000 ? (sessionMetrics.totalMs / 1000).toFixed(1) + 's' : sessionMetrics.totalMs + 'ms'}</div>
                      <div style={metricLblStyle}>{tb('trace.sessionWall')}</div>
                    </div>
                    <div style={metricStyle}>
                      <div style={metricValStyle}>{sessionMetrics.llmCalls}</div>
                      <div style={metricLblStyle}>{tb('trace.sessionLlm')}</div>
                    </div>
                    <div style={metricStyle}>
                      <div style={metricValStyle}>{sessionMetrics.totalTools}</div>
                      <div style={metricLblStyle}>{tb('trace.sessionTools')}</div>
                    </div>
                  </div>
                )}

                {/* ── Completed turns ── */}
                {turnTraces.map((steps, turnIdx) => {
                  const isExpanded = expandedTurns.has(turnIdx)
                  const isLatest = turnIdx === turnTraces.length - 1
                  const turnMs = turnTotalMs[turnIdx] || 0
                  let turnInput = 0, turnOutput = 0, cacheRead = 0
                  const modelStep = steps.find((s: any) => s.stage === 'Model generation')
                  if (modelStep?.usage) {
                    turnInput = modelStep.usage.inputTokens || 0
                    turnOutput = modelStep.usage.outputTokens || 0
                    cacheRead = modelStep.usage.cacheReadTokens || 0
                  }
                  const cachePct = (turnInput + cacheRead) > 0 ? Math.round(cacheRead / (turnInput + cacheRead) * 100) : 0
                  const toolSteps = steps.filter((s: any) => s.stage === 'Skills & tools' || s.stage === 'Knowledge retrieval')
                  const toolCount = toolSteps.reduce((sum: number, s: any) => sum + (s.detail?.length || 0), 0)

                  return (
                    <div key={turnIdx}>
                      <div
                        onClick={() => setExpandedTurns(prev => {
                          const next = new Set(prev)
                          if (next.has(turnIdx)) next.delete(turnIdx); else next.add(turnIdx)
                          return next
                        })}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '8px 12px', cursor: 'pointer',
                          borderBottom: isExpanded ? 'none' : '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{
                          width: 3, height: 22, borderRadius: 2, flexShrink: 0,
                          background: isLatest ? '#3b6cf4' : '#d0d0d8',
                        }} />
                        <span style={{
                          fontSize: 12, fontWeight: 650,
                          color: isExpanded ? 'var(--mist)' : 'var(--fog)',
                        }}>
                          {`Turn ${turnIdx + 1}`}
                        </span>
                        {isLatest && (
                          <div style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: '#3b6cf4',
                            animation: 'pulse 2s ease infinite',
                          }} />
                        )}
                        {cacheRead > 0 && (
                          <span style={{
                            fontSize: 10, padding: '1px 5px', borderRadius: 3,
                            background: '#eef3f0', color: '#1d8c4e',
                            fontFamily: 'monospace',
                          }}>
                            {cachePct}% cache
                          </span>
                        )}
                        <span style={{
                          fontSize: 10, color: 'var(--smoke)',
                          whiteSpace: 'nowrap', marginLeft: 'auto',
                        }}>
                          {turnMs >= 1000 ? (turnMs / 1000).toFixed(1) + 's' : turnMs + 'ms'}{toolCount > 0 ? ` / ${toolCount} tool${toolCount !== 1 ? 's' : ''}` : ''}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--smoke)', opacity: 0.4 }}>
                          {isExpanded ? '▲' : '▶'}
                        </span>
                      </div>

                      {isExpanded && (
                        <div style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          paddingBottom: 8,
                        }}>
                          {modelStep && (
                            <div style={{
                              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                              gap: 4, padding: '4px 12px 8px 24px',
                            }}>
                              <BreakdownCell label={tb('trace.breakdownInput')} value={String(turnInput)} />
                              <BreakdownCell label={tb('trace.breakdownOutput')} value={String(turnOutput)} />
                              <BreakdownCell label={tb('trace.breakdownCache')} value={`${cachePct}%`} />
                              <BreakdownCell label={tb('trace.breakdownLlm')} value={modelStep.ms >= 1000 ? (modelStep.ms / 1000).toFixed(1) + 's' : modelStep.ms + 'ms'} />
                              <BreakdownCell label={tb('trace.breakdownTools')} value={turnMs >= modelStep.ms && turnMs - modelStep.ms >= 0 ? ((turnMs - modelStep.ms) >= 1000 ? ((turnMs - modelStep.ms) / 1000).toFixed(1) + 's' : (turnMs - modelStep.ms) + 'ms') : '-'} />
                              <BreakdownCell label={tb('trace.breakdownTokPerS')} value={modelStep.ms > 0 ? String(Math.round(turnOutput / (modelStep.ms / 1000))) : '-'} />
                            </div>
                          )}

                          {steps.filter((s: any) => s.fired !== false).map((step: any, i: number) => {
                            const isModelGen = step.stage === 'Model generation'
                            const isSkill = step.stage === 'Skills & tools' || step.stage === 'Knowledge retrieval'

                            if (isSkill && step.detail?.length > 0) {
                              return step.detail.map(([actionType, detailText]: [string, string], di: number) => {
                                const toolKey = `${turnIdx}-${i}-${di}`
                                const isToolExpanded = expandedTools.has(toolKey)
                                const isError = detailText.includes('ok:false') || detailText.includes('"ok":false') || detailText.includes('error')
                                const toolName = step.summary?.split(' → ')?.[di] || actionType.replace('skill_', '')
                                const lines = detailText.split('\n')
                                const inputLines: string[] = []
                                const outputLines: string[] = []
                                let inOutput = false
                                for (const line of lines) {
                                  if (line.startsWith('input: ')) { inputLines.push(line.slice(7)); inOutput = false }
                                  else if (line.startsWith('output: ')) { outputLines.push(line.slice(8)); inOutput = true }
                                  else if (inOutput) { outputLines.push(line) }
                                  else if (line.length > 0) { inputLines.push(line) }
                                }

                                return (
                                  <div key={toolKey}>
                                    <div
                                      onClick={() => setExpandedTools(prev => {
                                        const next = new Set(prev)
                                        if (next.has(toolKey)) next.delete(toolKey); else next.add(toolKey)
                                        return next
                                      })}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: 7,
                                        padding: '6px 12px 6px 24px', cursor: 'pointer',
                                        background: isToolExpanded ? 'var(--surface-raised, #f9f9fb)' : undefined,
                                      }}
                                    >
                                      <div style={{
                                        width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                                        background: isError ? '#d63031' : '#1d8c4e',
                                      }} />
                                      <span style={{
                                        fontSize: 11, fontWeight: 550,
                                        color: isError ? '#d63031' : 'var(--mist)',
                                        fontFamily: 'monospace',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                      }}>
                                        {toolName}
                                      </span>
                                      <span style={{
                                        fontSize: 10, color: isError ? '#d63031' : 'var(--smoke)',
                                        marginLeft: 'auto', fontFamily: 'monospace', flexShrink: 0,
                                      }}>
                                        {isError ? tb('trace.failed') : ''}
                                      </span>
                                    </div>

                                    {isToolExpanded && (
                                      <div style={{ padding: '0 12px 0 24px' }}>
                                        {inputLines.length > 0 && inputLines[0] && (
                                          <>
                                            <div style={{
                                              fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                                              textTransform: 'uppercase', color: '#3b6cf4',
                                              marginBottom: 2, marginTop: 2,
                                            }}>
                                              {tb('trace.inputLabel')}
                                            </div>
                                            <div style={{
                                              padding: '6px 8px', borderRadius: 6,
                                              background: '#f4f6fe', border: '1px solid #e2e8f8',
                                              fontSize: 10.5, fontFamily: 'monospace',
                                              color: 'var(--mist)', lineHeight: 1.55,
                                              maxHeight: 90, overflowY: 'auto',
                                              marginBottom: 5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                            }}>
                                              {inputLines.join('\n')}
                                            </div>
                                          </>
                                        )}
                                        {outputLines.length > 0 && outputLines[0] && (
                                          <>
                                            <div style={{
                                              fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                                              textTransform: 'uppercase',
                                              color: isError ? '#d63031' : '#1d8c4e',
                                              marginBottom: 2,
                                            }}>
                                              {tb('trace.outputLabel')}{isError ? ` · ${tb('trace.outputError')}` : ''}
                                            </div>
                                            <div style={{
                                              padding: '6px 8px', borderRadius: 6,
                                              background: isError ? '#fef5f5' : '#f3f9f5',
                                              border: isError ? '1px solid #f8d7d7' : '1px solid #dcece2',
                                              fontSize: 10.5, fontFamily: 'monospace',
                                              color: isError ? '#d63031' : 'var(--mist)', lineHeight: 1.55,
                                              maxHeight: 90, overflowY: 'auto',
                                              marginBottom: 5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                            }}>
                                              {outputLines.join('\n')}
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })
                            }

                            if (isModelGen) {
                              return (
                                <div key={`${turnIdx}-${i}`}>
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: 7,
                                    padding: '6px 12px 6px 24px',
                                    borderTop: '1px solid var(--border-subtle)',
                                  }}>
                                    <div style={{
                                      width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                                      background: '#3b6cf4',
                                    }} />
                                    <span style={{ fontSize: 11, fontWeight: 550, color: 'var(--mist)', fontFamily: 'monospace' }}>
                                      {tb('trace.modelResponse')}
                                    </span>
                                    {step.usage && (
                                      <span style={{
                                        fontSize: 10, color: 'var(--smoke)',
                                        marginLeft: 'auto', fontFamily: 'monospace',
                                      }}>
                                        &uarr;{step.usage.inputTokens || 0} &darr;{step.usage.outputTokens || 0} tok
                                      </span>
                                    )}
                                  </div>
                                  {isExpanded && step.summary && step.summary !== '(no summary)' && (
                                    <div style={{
                                      margin: '0 12px 8px 24px', padding: '7px 9px',
                                      background: 'var(--surface-raised, #f9f9fb)',
                                      borderRadius: 6, border: '1px solid var(--border-subtle)',
                                      fontSize: 11, color: 'var(--mist)', lineHeight: 1.5,
                                      maxHeight: 80, overflowY: 'auto',
                                    }}>
                                      {step.summary}
                                    </div>
                                  )}
                                </div>
                              )
                            }

                            return null
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Current turn in progress (during streaming) */}
                {responding && liveTools.length > 0 && (
                  <div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      <div style={{
                        width: 3, height: 22, borderRadius: 2, flexShrink: 0,
                        background: '#3b6cf4',
                      }} />
                      <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--mist)' }}>
                        {`Turn ${turnTraces.length + 1}`}
                      </span>
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#3b6cf4',
                        animation: 'pulse 2s ease infinite',
                      }} />
                      <span style={{ fontSize: 10, color: '#3b6cf4', marginLeft: 'auto' }}>
                        {tb('trace.running')}
                      </span>
                    </div>
                    {liveTools.map((t, i) => (
                      <div key={`live-${i}`} style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '6px 12px 6px 24px',
                      }}>
                        <div style={{
                          width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                          background: t.status === 'running' ? '#c27a0a' : t.status === 'error' ? '#d63031' : '#1d8c4e',
                          ...(t.status === 'running' ? { animation: 'pulse 1.2s ease infinite' } : {}),
                        }} />
                        <span style={{
                          fontSize: 11, fontWeight: 550,
                          color: t.status === 'error' ? '#d63031' : 'var(--mist)',
                          fontFamily: 'monospace',
                        }}>
                          {t.name}
                        </span>
                        <span style={{
                          fontSize: 10, color: t.status === 'running' ? '#c27a0a' : t.status === 'error' ? '#d63031' : 'var(--smoke)',
                          marginLeft: 'auto', fontFamily: 'monospace',
                        }}>
                          {t.status === 'running' ? 'running' : t.status === 'error' ? tb('trace.failed') : t.finishedAt && t.startedAt ? `${t.finishedAt - t.startedAt}ms` : 'done'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── RenderHint display for completed tools ── */}
                {liveTools.filter(t => t.status === 'done' && t.renderHints).map((t, i) => {
                  const hint = (t.renderHints as any)?.playground || (t.renderHints as any)?.["web-chat"] || null
                  if (!hint) return null
                  return (
                    <RenderHintCard
                      key={`hint-${i}`}
                      hint={hint}
                      result={t.result}
                      onSubmit={(values) => {
                        const msg = JSON.stringify(values, null, 2)
                        runTurn(msg)
                      }}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </aside>
        )}
        {sidebarCollapsed && (
          <div style={{
            width: 32, flexShrink: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'flex-start', paddingTop: 12,
            borderLeft: '1px solid var(--border-subtle)',
            background: 'rgba(255,255,255,0.4)', cursor: 'pointer',
          }}
            onClick={() => setSidebarCollapsed(false)}
          >
            <ChevronLeft size={14} style={{ color: 'var(--fog)', opacity: 0.5 }} />
            {(liveTools.length + turnTraces.reduce((sum, t) => sum + t.length, 0)) > 0 && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: '#3b6cf4',
                marginTop: 6, writingMode: 'vertical-rl',
              }}>
                {liveTools.length + turnTraces.reduce((sum, t) => sum + t.length, 0)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  )
}

/* ── Trace sidebar helpers ── */

const metricStyle: React.CSSProperties = {
  textAlign: 'center', padding: '6px 4px',
  background: 'var(--surface-raised, #f9f9fb)',
  borderRadius: 6, border: '1px solid var(--border-subtle)',
}

const metricValStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 650, color: 'var(--mist)',
  fontFamily: 'monospace', letterSpacing: '-0.02em',
}

const metricLblStyle: React.CSSProperties = {
  fontSize: 8.5, color: 'var(--smoke)', marginTop: 2,
  textTransform: 'uppercase', letterSpacing: '0.04em',
}

function BreakdownCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '5px 3px',
      background: 'var(--surface-raised, #f9f9fb)',
      borderRadius: 5, border: '1px solid var(--border-subtle)',
    }}>
      <div style={{
        fontSize: 11.5, fontWeight: 650, color: 'var(--mist)',
        fontFamily: 'monospace',
      }}>{value}</div>
      <div style={{
        fontSize: 8, color: 'var(--smoke)',
        textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 1,
      }}>{label}</div>
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
  title, icon, count, maxHeight, flex, onCollapse, collapsed, children,
}: {
  title: string
  icon: React.ReactNode
  count?: number
  maxHeight?: number
  flex?: number
  onCollapse?: () => void
  collapsed?: boolean
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
        {onCollapse && (
          <button
            onClick={onCollapse}
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 20, borderRadius: 6,
              border: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.6)',
              cursor: 'pointer', padding: 0, flexShrink: 0,
            }}
            title={collapsed ? 'Expand trace panel' : 'Collapse trace panel'}
          >
            {collapsed ? <ChevronLeft size={10} color="var(--fog)" /> : <ChevronRight size={10} color="var(--fog)" />}
          </button>
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

function PromptViewer({ systemPrompt, messages }: { systemPrompt: string; messages: unknown[] }) {
  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {systemPrompt && (
        <details style={{ fontSize: 10 }}>
          <summary style={{
            fontWeight: 600, color: 'var(--lavender)',
            cursor: 'pointer', opacity: 0.8,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            System prompt ({systemPrompt.length.toLocaleString()} chars)
            <CopyButton text={systemPrompt} label="Copy system prompt" />
          </summary>
          <pre style={{
            maxWidth: 280, maxHeight: 160, overflow: 'auto',
            fontSize: 9, color: 'var(--fog)',
            background: 'rgba(255,255,255,0.95)', border: '1px solid var(--border-subtle)',
            borderRadius: 8, padding: '6px 10px', marginTop: 4,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {systemPrompt}
          </pre>
        </details>
      )}
      {messages.length > 0 && (
        <details style={{ fontSize: 10 }}>
          <summary style={{
            fontWeight: 600, color: 'var(--lavender)',
            cursor: 'pointer', opacity: 0.8,
          }}>
            Messages ({messages.length})
          </summary>
          <div style={{
            maxWidth: 280, maxHeight: 200, overflow: 'auto',
            display: 'flex', flexDirection: 'column', gap: 4,
            background: 'rgba(255,255,255,0.95)', border: '1px solid var(--border-subtle)',
            borderRadius: 8, padding: '6px 8px', marginTop: 4,
          }}>
            {messages.map((m: any, idx: number) => (
              <div key={idx} style={{
                padding: '3px 6px', borderRadius: 6,
                background: m.role === 'user' ? 'rgba(139,111,245,0.06)' : 'rgba(0,0,0,0.03)',
                fontSize: 9,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <span style={{
                    fontWeight: 600, color: 'var(--fog)',
                    textTransform: 'uppercase', fontSize: 8,
                    opacity: 0.5,
                  }}>
                    {typeof m.role === 'string' ? m.role : 'unknown'}
                  </span>
                  <CopyButton text={typeof m.content === 'string' ? m.content : JSON.stringify(m.content)} label={`Copy ${typeof m.role === 'string' ? m.role : 'unknown'} message`} />
                </div>
                <span style={{ color: 'var(--mist)' }}>
                  {(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 160)}
                  {(typeof m.content === 'string' && m.content.length > 160) ? '...' : ''}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

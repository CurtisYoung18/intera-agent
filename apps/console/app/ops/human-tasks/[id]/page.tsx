'use client'

import { useState, useEffect, useCallback, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  MessageSquare,
  Sparkles,
  Target,
  Trash2,
  User,
  Zap,
  X,
  Bot,
} from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import GlassCard from '@intera/shared/ui/glass-card'
import GlassInput from '@intera/shared/ui/glass-input'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useConsoleLocale } from '@/components/locale-provider'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMemoryData {
  confirmedFacts: string
  missingFacts: string
  skillsCalled: string
  skillResults: string
  keyEvents: string
  summary: string | null
}

interface TaskField {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'textarea'
  required?: boolean
  placeholder?: string
  options?: string[]
}

interface TaskDetail {
  id: string
  caseId: string
  queue: string
  status: string
  question: string
  fields: string | null
  answers: string | null
  verdict: string | null
  chatLog: string | null
  customerMessage: string | null
  createdAt: string
  case: {
    id: string
    type: string
    status: string
    userId: string
    orgId: string
    goal: string | null
    memory: ChatMemoryData | null
  }
}

interface ToolCallEntry {
  name: string
  status: 'executing' | 'completed' | 'error'
  result?: unknown
}

interface ChatMsg {
  id: string
  role: 'operator' | 'agent'
  content: string
  thinking?: string
  toolCalls?: ToolCallEntry[]
  timestamp: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJson<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch { return '' }
}

// ── Markdown components (same as chat app) ─────────────────────────────────

const MD: any = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-[14px] leading-relaxed text-[var(--mist)]">{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-medium text-[var(--mist)]">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic text-[var(--mist)]/90">{children}</em>
  ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isInline = !className
    if (isInline) return <code className="font-mono text-[12px] px-1.5 py-0.5 rounded bg-black/[0.04] text-indigo">{children}</code>
    return <code className="block font-mono text-[12px] leading-relaxed p-3 rounded-md bg-black/[0.03] border border-black/[0.06] overflow-x-auto whitespace-pre-wrap">{children}</code>
  },
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="my-2">{children}</pre>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc list-inside space-y-1 my-2 text-[14px] leading-relaxed text-[var(--mist)]/90">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal list-inside space-y-1 my-2 text-[14px] leading-relaxed text-[var(--mist)]/90">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="text-[var(--mist)]/90">{children}</li>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo underline underline-offset-2 hover:opacity-80 transition-opacity">{children}</a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-indigo/20 pl-4 my-2 italic text-[var(--fog)]">{children}</blockquote>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-[16px] font-semibold text-[var(--mist)] mt-3 mb-2">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-[15px] font-semibold text-[var(--mist)] mt-2 mb-1">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-[14px] font-semibold text-[var(--mist)] mt-2 mb-1">{children}</h3>,
}

// ── CC-style tool call row (dot + name + expandable result) ───────────────

function ToolCallRow({ tc }: { tc: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false)
  const hasResult = tc.status === 'completed' && tc.result !== undefined
  return (
    <div>
      <div
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/40 border border-black/[0.06] ${hasResult ? 'cursor-pointer hover:bg-white/60' : ''} transition-colors`}
        onClick={hasResult ? () => setExpanded((v) => !v) : undefined}
        role={hasResult ? 'button' : undefined}
        tabIndex={hasResult ? 0 : undefined}
        onKeyDown={hasResult ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v) } } : undefined}
      >
        {tc.status === 'executing' && (
          <span className="inline-block h-2 w-2 shrink-0 rounded-full border border-indigo/60 border-l-transparent animate-spin" />
        )}
        {tc.status === 'completed' && (
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-malachite" />
        )}
        {tc.status === 'error' && (
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-vermillion" />
        )}
        <span className="font-mono text-[12px] text-[var(--fog)]/70">{tc.name.replace(/_/g, ' ')}</span>
        {hasResult && <span className="text-[10px] text-[var(--fog)]/40">{expanded ? '▾' : '▸'}</span>}
      </div>
      {expanded && hasResult && (
        <div className="mt-1 ml-4 px-3 py-2 rounded-lg bg-white/40 border border-black/[0.06] max-w-[400px]">
          <pre className="text-[11px] font-mono text-[var(--fog)]/70 whitespace-pre-wrap break-all leading-relaxed">
            {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────

function MsgBubble({ msg, isTyping }: { msg: ChatMsg; isTyping: boolean }) {
  const isAgent = msg.role === 'agent'

  return (
    <div className={`flex items-end gap-2.5 ${isAgent ? 'justify-start' : 'justify-end'}`}>
      {isAgent && (
        <div className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white/60">
          <Bot className="h-3.5 w-3.5 text-indigo/60" />
        </div>
      )}

      <div className={`flex min-w-0 max-w-[78%] flex-col gap-0.5 ${isAgent ? 'items-start' : 'items-end'}`}>
        <GlassCard variant={isAgent ? 'chat-assistant' : 'chat-user'} className="px-4 py-3">
          {isTyping && isAgent && !msg.content ? (
            <div className="flex items-center gap-2 py-0.5">
              <OrganicLoader icon="dots" size={16} className="text-indigo/50" />
              <span className="text-[12px] text-[var(--fog)]/60">思考中…</span>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Thinking block */}
              {msg.thinking && (
                <details className="group">
                  <summary className="cursor-pointer select-none text-[11px] text-[var(--fog)]/50 hover:text-[var(--fog)]/70 transition-colors">
                    思考过程
                  </summary>
                  <div className="mt-1 border-l-2 border-indigo/15 pl-3 text-[11px] leading-relaxed text-[var(--fog)]/55 whitespace-pre-wrap">
                    {msg.thinking}
                  </div>
                </details>
              )}
              {/* Tool call rows */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="flex flex-col gap-1">
                  {msg.toolCalls.map((tc, i) => <ToolCallRow key={`${tc.name}-${i}`} tc={tc} />)}
                </div>
              )}
              {/* Text content */}
              {msg.content ? (
                isAgent ? (
                  <div className="prose-sm text-[14px] leading-relaxed text-[var(--fog)]/80 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-[14px] leading-relaxed text-[var(--mist)]/90 whitespace-pre-wrap">{msg.content}</p>
                )
              ) : !msg.thinking && !msg.toolCalls?.length ? (
                <span className="text-[12px] text-[var(--fog)]/50">—</span>
              ) : null}
            </div>
          )}
        </GlassCard>
        {msg.content && !isTyping && (
          <span className="px-1 text-[10px] tabular-nums text-[var(--fog)]/35">
            {formatTime(msg.timestamp)}
          </span>
        )}
      </div>

      {!isAgent && (
        <div className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo/80 text-white">
          <User className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  )
}

// ── Resolution form ────────────────────────────────────────────────────────

function ResolutionForm({
  onSubmit,
  onCancel,
  submitting,
}: {
  onSubmit: (customerMessage: string, internalNotes: string, verdict: string) => void
  onCancel: () => void
  submitting: boolean
}) {
  const [customerMsg, setCustomerMsg] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [verdict, setVerdict] = useState('resolved')

  return (
    <div className="mx-2 mb-3 rounded-2xl border border-malachite/20 bg-gradient-to-br from-malachite/[0.06] to-white/60 p-4 shadow-[var(--shadow-card)] backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] font-semibold text-[var(--mist)]">结案 — 填写处理结果</p>
        <button type="button" onClick={onCancel} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--fog)]/50 hover:bg-black/[0.05] hover:text-[var(--mist)]">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-2.5">
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-[var(--mist)]/80">告知顾客的结果 <span className="text-vermillion">*</span></span>
          <span className="block text-[10px] text-[var(--fog)]/70">此内容将由 AI 翻译成顾客语言后发送，请清晰描述实际发生了什么</span>
          <textarea
            value={customerMsg}
            onChange={(e) => setCustomerMsg(e.target.value)}
            rows={3}
            placeholder="例如：已确认为系统延迟故障，充值已到账，请刷新余额页面查看。"
            className="w-full resize-y rounded-xl border border-black/[0.08] bg-white/85 px-3.5 py-2.5 text-[13px] text-[var(--mist)] shadow-[var(--shadow-input)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--fog)]/40 focus:border-indigo/25 focus:ring-[3px] focus:ring-indigo/[0.1]"
          />
        </label>
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-[var(--mist)]/80">结案类型</span>
            <select
              value={verdict}
              onChange={(e) => setVerdict(e.target.value)}
              className="rounded-xl border border-black/[0.08] bg-white/85 px-3 py-2.5 text-[12px] text-[var(--mist)] outline-none focus:border-indigo/25 focus:ring-2 focus:ring-indigo/[0.1]"
            >
              <option value="resolved">已解决</option>
              <option value="escalated">升级处理</option>
              <option value="no_action">无需处理</option>
              <option value="pending_follow_up">待跟进</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-[var(--mist)]/80">内部备注（可选）</span>
            <input
              type="text"
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="内部说明，不会发给顾客"
              className="w-full rounded-xl border border-black/[0.08] bg-white/85 px-3 py-2.5 text-[12px] text-[var(--mist)] outline-none focus:border-indigo/25 focus:ring-2 focus:ring-indigo/[0.1]"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-0.5">
          <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-[12px] font-medium text-[var(--fog)] hover:bg-black/[0.04] hover:text-[var(--mist)]">取消</button>
          <button
            type="button"
            disabled={!customerMsg.trim() || submitting}
            onClick={() => onSubmit(customerMsg.trim(), internalNotes.trim(), verdict)}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-malachite/[0.22] to-malachite/[0.12] px-5 py-2 text-[12px] font-semibold text-malachite shadow-sm ring-1 ring-malachite/20 transition-all hover:brightness-105 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
          >
            {submitting ? <OrganicLoader icon="dots" size={14} className="text-malachite" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            提交结案
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Composer-assist hook ───────────────────────────────────────────────────

function useComposerAssist(orgId: string | undefined) {
  const [suggestion, setSuggestion] = useState('')
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const request = useCallback((draft: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    abortRef.current?.abort()
    if (!orgId || draft.trim().length < 4) { setSuggestion(''); return }

    const ac = new AbortController()
    abortRef.current = ac
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/composer-assist/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft, orgId }),
          signal: ac.signal,
        })
        if (!res.ok || ac.signal.aborted) { if (!ac.signal.aborted) setSuggestion(''); return }
        const data = await res.json() as { continuation?: string }
        if (!ac.signal.aborted) setSuggestion(data.continuation || '')
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setSuggestion('')
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }, 520)
  }, [orgId])

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    abortRef.current?.abort()
    setSuggestion('')
  }, [])

  return { suggestion, loading, request, dismiss }
}

// ── Send icon (matches VoiceInputBar) ─────────────────────────────────────

function SendIcon({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-9z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HumanTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { t } = useConsoleLocale()

  const [task, setTask] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [consultationDone, setConsultationDone] = useState(false)
  const [showContext, setShowContext] = useState(true)
  const [copiedSkill, setCopiedSkill] = useState<string | null>(null)
  const [formAnswers, setFormAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [showResolutionForm, setShowResolutionForm] = useState(false)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const copyTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const { suggestion, loading: assistLoading, request: requestSuggestion, dismiss: dismissSuggestion } = useComposerAssist(task?.case.orgId)

  // Load task data
  useEffect(() => {
    fetch(`/api/human-tasks/${id}`)
      .then((r) => r.json())
      .then((data) => {
        const tk = data.task as TaskDetail
        setTask(tk)
        setConsultationDone(tk?.status === 'resolved')
        const persisted = parseJson<ChatMsg[]>(tk?.chatLog, [])
        if (persisted.length > 0) {
          const initialMsg: ChatMsg = { id: 'agent-question', role: 'agent', content: tk.question, timestamp: tk.createdAt }
          const firstIsQuestion = persisted[0]?.content === tk.question
          setChatMessages(firstIsQuestion ? persisted : [initialMsg, ...persisted])
        } else if (tk?.question) {
          setChatMessages([{ id: 'agent-question', role: 'agent', content: tk.question, timestamp: tk.createdAt }])
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => () => { Object.values(copyTimers.current).forEach((x) => clearTimeout(x)) }, [])

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending || consultationDone) return
    const text = input.trim()
    setInput('')
    dismissSuggestion()
    setSending(true)

    const opMsg: ChatMsg = { id: crypto.randomUUID(), role: 'operator', content: text, timestamp: new Date().toISOString() }
    setChatMessages((prev) => [...prev, opMsg])
    const agentId = crypto.randomUUID()
    setChatMessages((prev) => [...prev, { id: agentId, role: 'agent', content: '', timestamp: new Date().toISOString() }])

    try {
      const response = await fetch('/api/human-chat', {
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
          const lines = decoder.decode(value).split('\n')
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6))
              switch (event.type) {
                case 'text_delta':
                  fullContent += event.data as string
                  setChatMessages((prev) => prev.map((m) => m.id === agentId ? { ...m, content: fullContent } : m))
                  break
                case 'thinking_delta':
                  setChatMessages((prev) => prev.map((m) => m.id === agentId ? { ...m, thinking: (m.thinking || '') + (event.data as string) } : m))
                  break
                case 'tool_executing': {
                  const td = event.data as { name?: string; status?: string }
                  const toolCall: ToolCallEntry = { name: td.name || 'tool', status: 'executing' }
                  setChatMessages((prev) => prev.map((m) => m.id === agentId ? { ...m, toolCalls: [...(m.toolCalls || []), toolCall] } : m))
                  break
                }
                case 'skill_result': {
                  const sd = event.data as { name?: string; result?: unknown }
                  const toolName = sd.name || 'tool'
                  setChatMessages((prev) => prev.map((m) =>
                    m.id === agentId
                      ? { ...m, toolCalls: (m.toolCalls || []).map((tc) => tc.name === toolName && tc.status === 'executing' ? { ...tc, status: 'completed' as const, result: sd.result } : tc) }
                      : m,
                  ))
                  break
                }
                case 'consultation_complete': {
                  const cd = event.data as { summary: string; resolution: string }
                  setConsultationDone(true)
                  const resolution = cd.resolution.replace(/_/g, ' ')
                  const suffix = t('humanTaskDetail.consultStreamAppend', { resolution, summary: cd.summary })
                  setChatMessages((prev) => prev.map((m) => m.id === agentId ? { ...m, content: fullContent + suffix } : m))
                  break
                }
                case 'message_stop':
                  setChatMessages((prev) => prev.map((m) => m.id === agentId && !m.content ? { ...m, content: fullContent || t('humanTaskDetail.noResponse') } : m))
                  break
                case 'error':
                  console.error('Agent error:', event.data)
                  setChatMessages((prev) => prev.map((m) => m.id === agentId && !m.content ? { ...m, content: t('humanTaskDetail.agentError', { msg: String(event.data) }) } : m))
                  break
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (err) {
      console.error('Chat error:', err)
      setChatMessages((prev) => prev.map((m) => m.id === agentId ? { ...m, content: t('humanTaskDetail.connErr') } : m))
    } finally {
      setSending(false)
    }
  }, [input, sending, consultationDone, id, t, dismissSuggestion])

  const handleReopen = useCallback(async () => {
    await fetch(`/api/human-tasks/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'reopened', notes: 'Consultation reopened by operator' }),
    })
    setConsultationDone(false)
    setShowResolutionForm(false)
  }, [id])

  const handleDelete = useCallback(async () => {
    if (!confirm(t('humanTaskDetail.deleteWarn'))) return
    await fetch(`/api/human-tasks/${id}/delete`, { method: 'DELETE' })
    router.push('/ops/human-tasks')
    router.refresh()
  }, [id, router, t])

  const handleResolveWithAnswers = useCallback(async () => {
    if (!task || submitting) return
    const parsedFields = parseJson(task.fields, [] as TaskField[])
    setSubmitting(true)
    const answers: Record<string, string> = {}
    for (const f of parsedFields) {
      const val = formAnswers[f.key]?.trim()
      if (val) answers[f.key] = val
    }
    await fetch(`/api/human-tasks/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'reviewed', notes: 'Structured answers submitted', answers }),
    })
    setConsultationDone(true)
    setSubmitting(false)
  }, [id, task, formAnswers, submitting])

  const handleCloseCase = useCallback(async (customerMessage: string, internalNotes: string, verdict: string) => {
    setSubmitting(true)
    try {
      await fetch(`/api/human-tasks/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict, notes: internalNotes || undefined, customerMessage, manualClose: true }),
      })
      setConsultationDone(true)
      setShowResolutionForm(false)
    } finally {
      setSubmitting(false)
    }
  }, [id])

  const copySkillName = useCallback(async (raw: string) => {
    try { await navigator.clipboard.writeText(raw) } catch { return }
    const prev = copyTimers.current[raw]
    if (prev) clearTimeout(prev)
    setCopiedSkill(raw)
    copyTimers.current[raw] = setTimeout(() => {
      setCopiedSkill((c) => (c === raw ? null : c))
      delete copyTimers.current[raw]
    }, 2000)
  }, [])

  // Composer keydown: Tab = accept suggestion, Enter = send, Shift+Enter = newline
  const handleComposerKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && suggestion) { e.preventDefault(); setInput((p) => p + suggestion); dismissSuggestion(); return }
    if (e.key === 'Escape' && suggestion) { e.preventDefault(); dismissSuggestion(); return }
  }, [suggestion, dismissSuggestion])

  if (loading) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center px-6">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-black/[0.06] bg-[var(--surface)] px-10 py-12 shadow-[var(--shadow-card)]">
          <OrganicLoader icon="spin" size={32} className="text-indigo/50" />
          <p className="text-[13px] text-[var(--fog)]">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="flex h-[100dvh] items-center justify-center px-6">
        <div className="glass-admin max-w-md rounded-2xl p-14 text-center shadow-[var(--shadow-card)]">
          <p className="text-[16px] font-medium text-[var(--mist)]">{t('humanTaskDetail.taskNotFound')}</p>
        </div>
      </div>
    )
  }

  const memory = task.case.memory
  const facts = parseJson(memory?.confirmedFacts, {}) as Record<string, unknown>
  const skills = parseJson(memory?.skillsCalled, [] as string[])
  const taskFields: TaskField[] = parseJson(task.fields, [] as TaskField[])
  const caseLine = t('humanTaskDetail.caseLine', { cid: task.caseId.slice(0, 12), sep: ' · ', uid: task.case.userId })

  // The last message id — used to detect the "typing" placeholder
  const lastMsgId = chatMessages[chatMessages.length - 1]?.id

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      {/* ── Sticky toolbar ──────────────────────────────────────────────────── */}
      <header className="z-30 flex flex-shrink-0 flex-wrap items-start justify-between gap-3 border-b border-black/[0.06] bg-white/70 px-4 py-3 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl sm:items-center sm:px-6">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <button type="button" onClick={() => router.push('/ops/human-tasks')} className="console-btn-icon-square" aria-label={t('humanTasks.backAria')}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--mist)]">
                <span className="font-mono text-[13px] text-indigo">{task.queue.replace(/_/g, ' ')}</span>
                <span className="mx-2 opacity-40">·</span>
                <span>{task.case.type.replace(/_/g, ' ')}</span>
              </h1>
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--fog)]/80">{caseLine}</p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <span className={`order-first inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] ring-1 sm:order-none ${consultationDone ? 'bg-malachite/[0.08] text-malachite ring-malachite/15' : 'bg-amber/[0.1] text-amber ring-amber/18'}`}>
            {consultationDone ? t('humanTaskDetail.resolved') : t('humanTaskDetail.active')}
          </span>
          <button type="button" onClick={() => setShowContext((p) => !p)} className="rounded-xl px-3 py-2 text-[12px] font-medium text-[var(--fog)] transition-colors hover:bg-black/[0.04] hover:text-[var(--mist)]">
            {showContext ? t('humanTaskDetail.hideCtx') : t('humanTaskDetail.showCtx')}
          </button>
          {consultationDone && (
            <button type="button" onClick={handleReopen} className="rounded-xl px-3 py-2 text-[12px] font-medium text-amber transition-colors hover:bg-amber/[0.08]">
              {t('humanTaskDetail.reopen')}
            </button>
          )}
          {!consultationDone && (
            <button type="button" onClick={() => setShowResolutionForm((p) => !p)} className="rounded-xl px-3 py-2 text-[12px] font-medium text-[var(--fog)]/90 transition-colors hover:bg-malachite/[0.06] hover:text-malachite">
              {t('humanTaskDetail.closeCase')}
            </button>
          )}
          <button type="button" onClick={handleDelete} className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.05] bg-white/50 text-[var(--fog)]/50 transition-all hover:border-vermillion/20 hover:bg-vermillion/[0.04] hover:text-vermillion active:scale-95" title={t('humanTaskDetail.deleteTitle')}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className={`flex flex-1 min-h-0 gap-5 px-4 py-4 sm:px-6 ${showContext ? 'lg:grid lg:grid-cols-[minmax(270px,320px)_minmax(0,1fr)]' : ''}`}>

        {/* Context column — scrollable independently */}
        {showContext && (
          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pb-2 scroll-thin hidden lg:flex">
            <section className="glass-card rounded-2xl p-4 shadow-[var(--shadow-card)] flex-shrink-0">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo/[0.1] ring-1 ring-indigo/[0.12]">
                  <Sparkles className="h-3.5 w-3.5 text-indigo" />
                </div>
                <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fog)]">{t('humanTaskDetail.agentQuestion')}</h2>
              </div>
              <p className="text-[13px] leading-relaxed text-[var(--mist)]/92">{task.question}</p>
            </section>

            {/* Structured form */}
            {taskFields.length > 0 && !consultationDone && (
              <section className="glass-card flex-shrink-0 rounded-2xl p-4 shadow-[var(--shadow-card)] ring-1 ring-indigo/10">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-malachite/[0.08] ring-1 ring-malachite/[0.15]">
                    <ClipboardList className="h-3.5 w-3.5 text-malachite" />
                  </div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fog)]">{t('humanTaskDetail.structuredFields') || 'Structured Answers'}</h2>
                </div>
                <div className="space-y-3">
                  {taskFields.map((f) => (
                    <div key={f.key}>
                      <label className="mb-1 block text-[11px] font-medium text-[var(--mist)]/80">{f.label}{f.required ? ' *' : ''}</label>
                      {f.type === 'select' && f.options?.length ? (
                        <select value={formAnswers[f.key] || ''} onChange={(e) => setFormAnswers((p) => ({ ...p, [f.key]: e.target.value }))} className="w-full rounded-lg border border-black/[0.08] bg-white/80 px-3 py-2 text-[12px] text-[var(--mist)] outline-none focus:border-indigo/25 focus:ring-2 focus:ring-indigo/[0.1]">
                          <option value="">—</option>
                          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : f.type === 'textarea' ? (
                        <textarea value={formAnswers[f.key] || ''} onChange={(e) => setFormAnswers((p) => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} rows={2} className="w-full resize-y rounded-lg border border-black/[0.08] bg-white/80 px-3 py-2 text-[12px] text-[var(--mist)] outline-none focus:border-indigo/25 focus:ring-2 focus:ring-indigo/[0.1]" />
                      ) : (
                        <input type={f.type === 'number' ? 'number' : 'text'} value={formAnswers[f.key] || ''} onChange={(e) => setFormAnswers((p) => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full rounded-lg border border-black/[0.08] bg-white/80 px-3 py-2 text-[12px] text-[var(--mist)] outline-none focus:border-indigo/25 focus:ring-2 focus:ring-indigo/[0.1]" />
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={handleResolveWithAnswers} disabled={submitting} className="mt-2 w-full rounded-xl bg-gradient-to-b from-indigo/[0.22] to-indigo/[0.12] px-4 py-2.5 text-[12px] font-semibold text-indigo shadow-sm ring-1 ring-indigo/20 transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-40">
                    {submitting ? (t('common.submitting') || 'Submitting…') : (t('humanTaskDetail.submitAnswers') || 'Submit Answers & Resolve')}
                  </button>
                </div>
              </section>
            )}

            {/* Submitted answers */}
            {taskFields.length > 0 && consultationDone && Object.keys(parseJson(task.answers, {} as Record<string, string>)).length > 0 && (
              <section className="glass-card flex-shrink-0 rounded-2xl p-4 shadow-[var(--shadow-card)]">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-malachite/[0.08] ring-1 ring-malachite/[0.15]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-malachite" />
                  </div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fog)]">{t('humanTaskDetail.answersSubmitted') || 'Answers Submitted'}</h2>
                </div>
                <dl className="divide-y divide-black/[0.04]">
                  {Object.entries(parseJson(task.answers, {} as Record<string, string>)).map(([k, v]) => (
                    <div key={k} className="flex gap-3 py-2 first:pt-0 last:pb-0">
                      <dt className="w-[42%] flex-shrink-0 text-[11px] font-medium text-[var(--fog)]">{k}</dt>
                      <dd className="truncate text-right font-mono text-[11px] text-[var(--mist)]/85" title={String(v)}>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {task.case.goal && (
              <section className="glass-card flex-shrink-0 rounded-2xl p-4 shadow-[var(--shadow-card)]">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky/[0.08] ring-1 ring-sky/[0.15]">
                    <Target className="h-3.5 w-3.5 text-sky" />
                  </div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fog)]">{t('humanTaskDetail.goal')}</h2>
                </div>
                <p className="text-[12px] italic leading-relaxed text-[var(--fog)]">{task.case.goal}</p>
              </section>
            )}

            {Object.keys(facts).length > 0 && (
              <section className="glass-card flex-shrink-0 rounded-2xl p-4 shadow-[var(--shadow-card)]">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-lavender/[0.06] ring-1 ring-lavender/12">
                    <ClipboardList className="h-3.5 w-3.5 text-lavender" />
                  </div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fog)]">{t('humanTaskDetail.facts')}</h2>
                </div>
                <dl className="divide-y divide-black/[0.04]">
                  {Object.entries(facts).map(([k, v]) => (
                    <div key={k} className="flex gap-3 py-2 first:pt-0 last:pb-0">
                      <dt className="w-[42%] flex-shrink-0 text-[11px] font-medium text-[var(--fog)]">{k}</dt>
                      <dd className="truncate text-right font-mono text-[11px] text-[var(--mist)]/85" title={String(v)}>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {skills.length > 0 && (
              <section className="glass-card flex-shrink-0 rounded-2xl p-4 pb-10 shadow-[var(--shadow-card)]">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber/[0.08] ring-1 ring-amber/[0.15]">
                    <Zap className="h-3.5 w-3.5 text-amber" />
                  </div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fog)]">{t('humanTaskDetail.agentActions')}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {skills.map((s) => {
                    const isCopied = copiedSkill === s
                    return (
                      <button key={s} type="button" onClick={() => void copySkillName(s)} title={t('humanTaskDetail.copySkillHint')} className="group/chip relative flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-gradient-to-br from-white/80 to-white/40 px-3 py-1.5 text-left shadow-sm ring-1 ring-white/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo/18 hover:shadow-[0_6px_20px_-10px_rgba(91,138,247,0.35)] hover:ring-indigo/10 active:translate-y-0 active:scale-[0.98]">
                        <span className="max-w-[180px] truncate font-mono text-[11px] font-medium text-[var(--mist)]/90">{s.replace(/_/g, ' ')}</span>
                        {isCopied && (
                          <span className="absolute bottom-[calc(100%+8px)] left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--mist)] px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--void)] shadow-lg">
                            {t('humanTaskDetail.copied')}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </section>
            )}
          </aside>
        )}

        {/* ── Chat column — fills remaining height, input pinned to bottom ── */}
        <main className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-black/[0.07] bg-gradient-to-br from-white/70 via-white/45 to-[var(--void)]/90 shadow-[var(--shadow-card)] backdrop-blur-xl ${!showContext ? 'mx-auto w-full max-w-3xl' : ''}`}>
          {/* Chat header */}
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-black/[0.05] px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo/[0.08] ring-1 ring-indigo/[0.1]">
              <MessageSquare className="h-4 w-4 text-indigo" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-[var(--mist)]">{t('humanTaskDetail.chatRoomTitle')}</p>
              <p className="text-[11px] text-[var(--fog)]">{t('humanTaskDetail.consultHint')}</p>
            </div>
          </div>

          {/* Messages — flex-1 + min-h-0 so it scrolls without pushing input out */}
          <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-4 py-5">
            {chatMessages.length === 0 && (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center px-6 text-center">
                <Bot className="mb-4 h-12 w-12 text-[var(--fog)]/[0.2]" strokeWidth={1} />
                <p className="text-[14px] font-medium text-[var(--fog)]">{t('humanTaskDetail.consultChat')}</p>
                <p className="mt-2 max-w-sm text-[12px] text-[var(--fog)]/[0.7]">{t('humanTaskDetail.consultHint')}</p>
              </div>
            )}
            <div className="flex flex-col gap-4">
              {chatMessages.map((msg, idx) => (
                <MsgBubble
                  key={msg.id ?? `msg-${idx}`}
                  msg={msg}
                  isTyping={sending && msg.id === lastMsgId && msg.role === 'agent'}
                />
              ))}
            </div>
            <div ref={chatEndRef} className="h-2 w-full flex-shrink-0" />
          </div>

          {/* Input footer — always pinned at bottom */}
          <div className="flex-shrink-0 border-t border-black/[0.05] bg-white/30 backdrop-blur-md">
            {/* Resolution form (slides in above input) */}
            {showResolutionForm && !consultationDone && (
              <div className="border-b border-black/[0.05] pt-3">
                <ResolutionForm onSubmit={handleCloseCase} onCancel={() => setShowResolutionForm(false)} submitting={submitting} />
              </div>
            )}

            {consultationDone ? (
              <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-6 py-5 text-center">
                <CheckCircle2 className="h-9 w-9 text-malachite/80" />
                <p className="text-[13px] font-medium text-[var(--mist)]">{t('humanTaskDetail.consultDone')}</p>
                <button type="button" onClick={handleReopen} className="text-[12px] font-semibold text-amber underline-offset-4 transition-colors hover:underline hover:text-amber/80">
                  {t('humanTaskDetail.reopenConsult')}
                </button>
              </div>
            ) : (
              /* VoiceInputBar-style composer */
              <div className="px-4 pt-3 pb-4" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
                <div className="glass-input-composer">
                  <GlassInput
                    variant="composerInner"
                    value={input}
                    onChange={setInput}
                    placeholder={t('humanTaskDetail.replyPh')}
                    disabled={sending}
                    onSubmit={handleSend}
                    onKeyDown={handleComposerKeyDown}
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!input.trim() || sending}
                    aria-label="Send"
                    className="group/send mb-px flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo/[0.14] text-indigo/[0.92] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] outline-none ring-1 ring-black/[0.04] transition-[transform,opacity,background-color] duration-150 hover:enabled:bg-indigo/[0.22] hover:enabled:text-indigo active:enabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-[0.28]"
                  >
                    {sending
                      ? <OrganicLoader icon="dots" size={16} className="text-indigo" />
                      : <SendIcon className="translate-x-[0.5px] transition-transform duration-150 group-hover/send:translate-x-px group-hover/send:-translate-y-px" />
                    }
                  </button>
                </div>

                {/* Suggestion strip — below the input pill, same as VoiceInputBar */}
                {(assistLoading || suggestion) && (
                  <div className="mt-2 pl-2 pr-14 text-[12px] leading-relaxed text-[var(--fog)]/65 min-h-[1.3rem]" aria-live="polite">
                    {assistLoading && !suggestion
                      ? <span className="animate-pulse italic text-[var(--fog)]/50">正在准备续写建议…</span>
                      : suggestion
                        ? <span>
                            <span className="font-medium text-indigo/[0.78]">续写建议</span>
                            {' · '}
                            <span className="text-[var(--mist)]/75">{suggestion}</span>
                            {' '}
                            <span className="text-[var(--fog)]/45">Tab 采纳 · Esc 取消</span>
                          </span>
                        : null
                    }
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

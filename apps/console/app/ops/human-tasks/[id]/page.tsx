'use client'

import { useState, useEffect, useCallback, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ClipboardList,
  MessageSquare,
  Sparkles,
  Target,
  Trash2,
  User,
  Wrench,
  Zap,
  Send,
  X,
} from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useConsoleLocale } from '@/components/locale-provider'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CaseMemory {
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
    customerId: string
    goal: string | null
    memory: CaseMemory | null
  }
}

interface ToolCallEntry {
  name: string
  status: 'executing' | 'completed' | 'error'
  detail?: string
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

// ── Resolution form (replaces prompt()) ──────────────────────────────────────

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
    <div className="mx-auto max-w-3xl rounded-2xl border border-malachite/20 bg-gradient-to-br from-malachite/[0.06] to-white/60 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-[var(--mist)]">结案 — 填写处理结果</p>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--fog)]/50 hover:bg-black/[0.05] hover:text-[var(--mist)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3">
        {/* Customer message — main field */}
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-[var(--mist)]/80">
            告知顾客的结果 <span className="text-vermillion">*</span>
          </span>
          <span className="block text-[10px] text-[var(--fog)]/70">
            此内容将由 AI 翻译成顾客的语言后发送给顾客，请清晰描述实际发生了什么
          </span>
          <textarea
            value={customerMsg}
            onChange={(e) => setCustomerMsg(e.target.value)}
            rows={3}
            placeholder="例如：已确认为系统延迟故障，充值已到账，请刷新余额页面查看。"
            className="w-full resize-y rounded-xl border border-black/[0.08] bg-white/85 px-3.5 py-2.5 text-[13px] text-[var(--mist)] shadow-[var(--shadow-input)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--fog)]/40 focus:border-indigo/25 focus:ring-[3px] focus:ring-indigo/[0.1]"
          />
        </label>

        {/* Verdict + internal notes in a row */}
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

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-[12px] font-medium text-[var(--fog)] hover:bg-black/[0.04] hover:text-[var(--mist)]"
          >
            取消
          </button>
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

// ── Composer-assist hook ───────────────────────────────────────────────────────

function useComposerAssist(customerId: string | undefined) {
  const [suggestion, setSuggestion] = useState('')
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const request = useCallback(
    (draft: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (!customerId || draft.trim().length < 4) {
        setSuggestion('')
        return
      }
      timerRef.current = setTimeout(async () => {
        setLoading(true)
        try {
          const res = await fetch('/api/composer-assist/suggest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ draft, customerId }),
          })
          if (!res.ok) { setSuggestion(''); return }
          const data = await res.json() as { continuation?: string }
          setSuggestion(data.continuation || '')
        } catch {
          setSuggestion('')
        } finally {
          setLoading(false)
        }
      }, 500)
    },
    [customerId],
  )

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSuggestion('')
  }, [])

  return { suggestion, loading, request, dismiss }
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
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { suggestion, loading: assistLoading, request: requestSuggestion, dismiss: dismissSuggestion } = useComposerAssist(task?.case.customerId)

  useEffect(() => {
    fetch(`/api/human-tasks/${id}`)
      .then((r) => r.json())
      .then((data) => {
        const tk = data.task as TaskDetail
        setTask(tk)
        setConsultationDone(tk?.status === 'resolved')

        // Build initial messages: persisted chatLog first, else just the agent question
        const persisted = parseJson<ChatMsg[]>(tk?.chatLog, [])
        if (persisted.length > 0) {
          // Prepend the agent's initial question if not already the first message
          const initialMsg: ChatMsg = {
            id: 'agent-question',
            role: 'agent',
            content: tk.question,
            timestamp: tk.createdAt,
          }
          // chatLog already contains exchange messages; check if initial question is there
          const firstIsQuestion = persisted[0]?.content === tk.question
          setChatMessages(firstIsQuestion ? persisted : [initialMsg, ...persisted])
        } else if (tk?.question) {
          setChatMessages([{
            id: 'agent-question',
            role: 'agent',
            content: tk.question,
            timestamp: tk.createdAt,
          }])
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => () => {
    Object.values(copyTimers.current).forEach((x) => clearTimeout(x))
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending || consultationDone) return
    const text = input.trim()
    setInput('')
    dismissSuggestion()
    setSending(true)

    const opMsg: ChatMsg = {
      id: crypto.randomUUID(),
      role: 'operator',
      content: text,
      timestamp: new Date().toISOString(),
    }
    setChatMessages((prev) => [...prev, opMsg])

    const agentId = crypto.randomUUID()
    setChatMessages((prev) =>
      [...prev, { id: agentId, role: 'agent', content: '', timestamp: new Date().toISOString() }],
    )

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

                case 'thinking_delta':
                  setChatMessages((prev) =>
                    prev.map((m) => (m.id === agentId ? { ...m, thinking: (m.thinking || '') + (event.data as string) } : m)),
                  )
                  break

                case 'tool_executing': {
                  const td = event.data as { name?: string; status?: string; detail?: string }
                  const toolCall: ToolCallEntry = { name: td.name || 'tool', status: 'executing', detail: td.detail }
                  setChatMessages((prev) =>
                    prev.map((m) =>
                      m.id === agentId
                        ? { ...m, toolCalls: [...(m.toolCalls || []), toolCall] }
                        : m,
                    ),
                  )
                  break
                }

                case 'skill_result': {
                  const sd = event.data as { skillName?: string; output?: unknown }
                  const toolName = sd.skillName || 'tool'
                  setChatMessages((prev) =>
                    prev.map((m) =>
                      m.id === agentId
                        ? {
                            ...m,
                            toolCalls: (m.toolCalls || []).map((tc) =>
                              tc.name === toolName && tc.status === 'executing'
                                ? { ...tc, status: 'completed' as const }
                                : tc,
                            ),
                          }
                        : m,
                    ),
                  )
                  break
                }

                case 'consultation_complete': {
                  const cd = event.data as { summary: string; resolution: string }
                  setConsultationDone(true)
                  const resolution = cd.resolution.replace(/_/g, ' ')
                  const suffix = t('humanTaskDetail.consultStreamAppend', {
                    resolution,
                    summary: cd.summary,
                  })
                  setChatMessages((prev) =>
                    prev.map((m) =>
                      m.id === agentId ? { ...m, content: fullContent + suffix } : m),
                  )
                  break
                }

                case 'message_stop':
                  setChatMessages((prev) =>
                    prev.map((m) =>
                      m.id === agentId && !m.content ? { ...m, content: fullContent || t('humanTaskDetail.noResponse') } : m,
                    ),
                  )
                  break

                case 'error':
                  console.error('Agent error:', event.data)
                  setChatMessages((prev) =>
                    prev.map((m) =>
                      m.id === agentId && !m.content
                        ? { ...m, content: t('humanTaskDetail.agentError', { msg: String(event.data) }) }
                        : m,
                    ),
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
        prev.map((m) => (m.id === agentId ? { ...m, content: t('humanTaskDetail.connErr') } : m)),
      )
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
        body: JSON.stringify({
          verdict,
          notes: internalNotes || undefined,
          customerMessage,
          manualClose: true,
        }),
      })
      setConsultationDone(true)
      setShowResolutionForm(false)
    } finally {
      setSubmitting(false)
    }
  }, [id])

  const copySkillName = useCallback(
    async (raw: string) => {
      try {
        await navigator.clipboard.writeText(raw)
      } catch {
        return
      }
      const prevTimer = copyTimers.current[raw]
      if (prevTimer) clearTimeout(prevTimer)
      setCopiedSkill(raw)
      copyTimers.current[raw] = setTimeout(() => {
        setCopiedSkill((c) => (c === raw ? null : c))
        delete copyTimers.current[raw]
      }, 2000)
    },
    [],
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    requestSuggestion(e.target.value)
  }, [requestSuggestion])

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && suggestion) {
      e.preventDefault()
      setInput((prev) => prev + suggestion)
      dismissSuggestion()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }, [suggestion, dismissSuggestion, handleSend])

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-black/[0.06] bg-[var(--surface)] px-10 py-12 shadow-[var(--shadow-card)]">
          <OrganicLoader icon="spin" size={32} className="text-indigo/50" />
          <p className="text-[13px] text-[var(--fog)]">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-6">
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
  const caseLine = t('humanTaskDetail.caseLine', {
    cid: task.caseId.slice(0, 12),
    sep: ' · ',
    uid: task.case.userId,
  })

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[1200px] flex-col px-4 py-4 sm:px-6 lg:px-8">
      {/* Sticky toolbar */}
      <header className="sticky top-0 z-30 mb-4 flex flex-shrink-0 flex-wrap items-start justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white/55 px-4 py-3 shadow-[var(--shadow-card)] backdrop-blur-xl sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <button
            type="button"
            onClick={() => router.push('/ops/human-tasks')}
            className="console-btn-icon-square"
            aria-label={t('humanTasks.backAria')}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--mist)] sm:text-[16px]">
                <span className="font-mono text-[13px] text-indigo">{task.queue.replace(/_/g, ' ')}</span>
                <span className="mx-2 text-[var(--smoke)] opacity-60">·</span>
                <span>{task.case.type.replace(/_/g, ' ')}</span>
              </h1>
            </div>
            <p className="mt-1 text-[11px] text-[var(--fog)]/80">{caseLine}</p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <span
            className={`order-first inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] ring-1 sm:order-none ${
              consultationDone
                ? 'bg-malachite/[0.08] text-malachite ring-malachite/15'
                : 'bg-amber/[0.1] text-amber ring-amber/18'
            }`}
          >
            {consultationDone ? t('humanTaskDetail.resolved') : t('humanTaskDetail.active')}
          </span>
          <button
            type="button"
            onClick={() => setShowContext((p) => !p)}
            className="rounded-xl px-3 py-2 text-[12px] font-medium text-[var(--fog)] transition-colors hover:bg-black/[0.04] hover:text-[var(--mist)]"
          >
            {showContext ? t('humanTaskDetail.hideCtx') : t('humanTaskDetail.showCtx')}
          </button>
          {consultationDone && (
            <button
              type="button"
              onClick={handleReopen}
              className="rounded-xl px-3 py-2 text-[12px] font-medium text-amber transition-colors hover:bg-amber/[0.08]"
            >
              {t('humanTaskDetail.reopen')}
            </button>
          )}
          {!consultationDone && (
            <button
              type="button"
              onClick={() => setShowResolutionForm((p) => !p)}
              className="rounded-xl px-3 py-2 text-[12px] font-medium text-[var(--fog)]/90 transition-colors hover:bg-malachite/[0.06] hover:text-malachite"
            >
              {t('humanTaskDetail.closeCase')}
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.05] bg-white/50 text-[var(--fog)]/50 transition-all hover:border-vermillion/20 hover:bg-vermillion/[0.04] hover:text-vermillion active:scale-95"
            title={t('humanTaskDetail.deleteTitle')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div
        className={`grid flex-1 min-h-0 gap-5 pb-6 ${
          showContext ? 'lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]' : 'lg:grid-cols-1'
        }`}
      >
        {/* Context column */}
        {showContext && (
          <aside className="flex min-h-[42vh] flex-col gap-3 overflow-y-auto pb-2 lg:min-h-[min(70vh,640px)] scroll-thin">
            <section className="glass-card group rounded-2xl p-5 shadow-[var(--shadow-card)] transition-shadow duration-300 hover:shadow-[var(--shadow-card-hover)]">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo/[0.1] ring-1 ring-indigo/[0.12]">
                  <Sparkles className="h-4 w-4 text-indigo" />
                </div>
                <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
                  {t('humanTaskDetail.agentQuestion')}
                </h2>
              </div>
              <p className="text-[13px] leading-relaxed text-[var(--mist)]/92">{task.question}</p>
            </section>

            {/* Structured form for operator answers */}
            {taskFields.length > 0 && !consultationDone && (
              <section className="glass-card rounded-2xl p-5 shadow-[var(--shadow-card)] ring-1 ring-indigo/10">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-malachite/[0.08] ring-1 ring-malachite/[0.15]">
                    <ClipboardList className="h-4 w-4 text-malachite" />
                  </div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
                    {t('humanTaskDetail.structuredFields') || 'Structured Answers'}
                  </h2>
                </div>
                <div className="space-y-3">
                  {taskFields.map((f) => (
                    <div key={f.key}>
                      <label className="mb-1 block text-[11px] font-medium text-[var(--mist)]/80">
                        {f.label}{f.required ? ' *' : ''}
                      </label>
                      {f.type === 'select' && f.options?.length ? (
                        <select
                          value={formAnswers[f.key] || ''}
                          onChange={(e) => setFormAnswers((prev) => ({ ...prev, [f.key]: e.target.value }))}
                          className="w-full rounded-lg border border-black/[0.08] bg-white/80 px-3 py-2 text-[12px] text-[var(--mist)] outline-none focus:border-indigo/25 focus:ring-2 focus:ring-indigo/[0.1]"
                        >
                          <option value="">—</option>
                          {f.options.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : f.type === 'textarea' ? (
                        <textarea
                          value={formAnswers[f.key] || ''}
                          onChange={(e) => setFormAnswers((prev) => ({ ...prev, [f.key]: e.target.value }))}
                          placeholder={f.placeholder}
                          rows={2}
                          className="w-full rounded-lg border border-black/[0.08] bg-white/80 px-3 py-2 text-[12px] text-[var(--mist)] outline-none focus:border-indigo/25 focus:ring-2 focus:ring-indigo/[0.1] resize-y"
                        />
                      ) : (
                        <input
                          type={f.type === 'number' ? 'number' : 'text'}
                          value={formAnswers[f.key] || ''}
                          onChange={(e) => setFormAnswers((prev) => ({ ...prev, [f.key]: e.target.value }))}
                          placeholder={f.placeholder}
                          className="w-full rounded-lg border border-black/[0.08] bg-white/80 px-3 py-2 text-[12px] text-[var(--mist)] outline-none focus:border-indigo/25 focus:ring-2 focus:ring-indigo/[0.1]"
                        />
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleResolveWithAnswers}
                    disabled={submitting}
                    className="w-full mt-2 rounded-xl bg-gradient-to-b from-indigo/[0.22] to-indigo/[0.12] px-4 py-2.5 text-[12px] font-semibold text-indigo shadow-sm ring-1 ring-indigo/20 transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-40"
                  >
                    {submitting
                      ? (t('common.submitting') || 'Submitting…')
                      : (t('humanTaskDetail.submitAnswers') || 'Submit Answers & Resolve')}
                  </button>
                </div>
              </section>
            )}

            {/* Show submitted answers after resolution */}
            {taskFields.length > 0 && consultationDone && parseJson(task.answers, {} as Record<string, string>) && Object.keys(parseJson(task.answers, {} as Record<string, string>)).length > 0 && (
              <section className="glass-card rounded-2xl p-5 shadow-[var(--shadow-card)]">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-malachite/[0.08] ring-1 ring-malachite/[0.15]">
                    <CheckCircle2 className="h-4 w-4 text-malachite" />
                  </div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
                    {t('humanTaskDetail.answersSubmitted') || 'Answers Submitted'}
                  </h2>
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
              <section className="glass-card rounded-2xl p-5 shadow-[var(--shadow-card)] transition-shadow duration-300 hover:shadow-[var(--shadow-card-hover)]">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky/[0.08] ring-1 ring-sky/[0.15]">
                    <Target className="h-4 w-4 text-sky" />
                  </div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fog)]">{t('humanTaskDetail.goal')}</h2>
                </div>
                <p className="text-[12px] italic leading-relaxed text-[var(--fog)]">{task.case.goal}</p>
              </section>
            )}

            {Object.keys(facts).length > 0 && (
              <section className="glass-card rounded-2xl p-5 shadow-[var(--shadow-card)]">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-lavender/[0.06] ring-1 ring-lavender/12">
                    <ClipboardList className="h-4 w-4 text-lavender" />
                  </div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fog)]">{t('humanTaskDetail.facts')}</h2>
                </div>
                <dl className="divide-y divide-black/[0.04]">
                  {Object.entries(facts).map(([k, v]) => (
                    <div key={k} className="flex gap-3 py-2 first:pt-0 last:pb-0">
                      <dt className="w-[42%] flex-shrink-0 text-[11px] font-medium text-[var(--fog)]">{k}</dt>
                      <dd className="truncate text-right font-mono text-[11px] text-[var(--mist)]/85" title={String(v)}>
                        {String(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {skills.length > 0 && (
              <section className="glass-card relative z-10 rounded-2xl p-5 pb-10 shadow-[var(--shadow-card)]">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber/[0.08] ring-1 ring-amber/[0.15]">
                    <Zap className="h-4 w-4 text-amber" />
                  </div>
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
                    {t('humanTaskDetail.agentActions')}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {skills.map((s) => {
                    const readable = s.replace(/_/g, ' ')
                    const isCopied = copiedSkill === s
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void copySkillName(s)}
                        title={t('humanTaskDetail.copySkillHint')}
                        className="group/chip relative flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-gradient-to-br from-white/80 to-white/40 px-3.5 py-2 text-left text-[11px] font-medium text-[var(--mist)]/90 shadow-sm ring-1 ring-white/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo/18 hover:shadow-[0_6px_20px_-10px_rgba(91,138,247,0.35)] hover:ring-indigo/10 active:translate-y-0 active:scale-[0.98]"
                      >
                        <span className="relative z-10 max-w-[200px] truncate font-mono text-[11px]">{readable}</span>
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

        {/* Chat column */}
        <main
          className={`flex min-h-[min(70vh,640px)] flex-col overflow-hidden rounded-2xl border border-black/[0.07] bg-gradient-to-br from-white/70 via-white/45 to-[var(--void)]/90 shadow-[var(--shadow-card)] backdrop-blur-xl ${
            !showContext ? 'max-w-3xl lg:justify-self-center' : ''
          }`}
        >
          {/* Chat header */}
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-black/[0.05] px-4 py-3 sm:px-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo/[0.08] ring-1 ring-indigo/[0.1]">
              <MessageSquare className="h-5 w-5 text-indigo" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[var(--mist)]">{t('humanTaskDetail.chatRoomTitle')}</p>
              <p className="text-[11px] text-[var(--fog)]">{t('humanTaskDetail.consultHint')}</p>
            </div>
          </div>

          {/* Messages */}
          <div className="min-h-[220px] flex-1 overflow-y-auto scroll-thin px-3 py-5 sm:px-5">
            {chatMessages.length === 0 && (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center px-6 text-center">
                <Bot className="mb-4 h-12 w-12 text-[var(--fog)]/[0.2]" strokeWidth={1} />
                <p className="text-[14px] font-medium text-[var(--fog)]">{t('humanTaskDetail.consultChat')}</p>
                <p className="mt-2 max-w-sm text-[12px] text-[var(--fog)]/[0.7]">{t('humanTaskDetail.consultHint')}</p>
              </div>
            )}

            <div className="flex flex-col gap-4">
              {chatMessages.map((msg) => {
                const isAgent = msg.role === 'agent'
                const typing = isAgent && !msg.content && sending

                return (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${isAgent ? 'justify-start' : 'justify-end'}`}
                  >
                    {/* Agent avatar — left side only */}
                    {isAgent && (
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] border border-black/[0.06]">
                        <Bot className="h-3.5 w-3.5 text-indigo/60" />
                      </div>
                    )}

                    <div className={`min-w-0 flex flex-col gap-1 ${isAgent ? 'items-start' : 'items-end'} max-w-[72%]`}>
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                          isAgent
                            ? 'glass-chat-assistant rounded-tl-sm'
                            : 'bg-indigo/[0.12] text-[var(--mist)] rounded-tr-sm'
                        }`}
                      >
                        {typing ? (
                          <div className="flex items-center gap-2 py-0.5">
                            <OrganicLoader icon="dots" size={18} className="text-indigo/50" />
                            <span className="text-[12px] text-[var(--fog)]/60">{t('humanTaskDetail.thinking')}</span>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {/* Thinking block */}
                            {msg.thinking && (
                              <details className="text-[11px] text-[var(--fog)]/60">
                                <summary className="cursor-pointer hover:text-[var(--fog)]/80 select-none">
                                  {t('humanTaskDetail.thinking')}
                                </summary>
                                <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed pl-2 border-l-2 border-indigo/15">
                                  {msg.thinking}
                                </p>
                              </details>
                            )}
                            {/* Tool call chips */}
                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {msg.toolCalls.map((tc, i) => (
                                  <span
                                    key={`${tc.name}-${i}`}
                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                      tc.status === 'executing'
                                        ? 'bg-amber/[0.12] text-amber animate-pulse'
                                        : tc.status === 'completed'
                                          ? 'bg-malachite/[0.1] text-malachite'
                                          : 'bg-vermillion/[0.1] text-vermillion'
                                    }`}
                                  >
                                    <Wrench className="h-3 w-3" />
                                    {tc.name.replace(/_/g, ' ')}
                                  </span>
                                ))}
                              </div>
                            )}
                            {/* Content */}
                            {msg.content ? (
                              isAgent ? (
                                <div className="prose prose-sm max-w-none text-[13px] leading-relaxed text-fog/80 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_code]:text-[11px] [&_code]:bg-black/[0.04] [&_code]:px-1 [&_code]:rounded [&_strong]:text-[var(--mist)] [&_h1]:text-[15px] [&_h2]:text-[14px] [&_h3]:text-[13px]">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {msg.content}
                                  </ReactMarkdown>
                                </div>
                              ) : (
                                <p className="text-[13px] leading-relaxed text-[var(--mist)]/90 whitespace-pre-wrap">{msg.content}</p>
                              )
                            ) : !msg.thinking && !msg.toolCalls?.length ? (
                              <span className="text-[var(--fog)]/60 text-[12px]">{t('humanTaskDetail.noResponse')}</span>
                            ) : null}
                          </div>
                        )}
                      </div>
                      {msg.timestamp && msg.content && !typing && (
                        <p className={`px-1 text-[10px] tabular-nums text-[var(--fog)]/40 ${isAgent ? 'text-left' : 'text-right'}`}>
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>

                    {/* Operator avatar — right side */}
                    {!isAgent && (
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo/80 text-white">
                        <User className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div ref={chatEndRef} className="h-px w-full flex-shrink-0" />
          </div>

          {/* Input area */}
          <div className="flex-shrink-0 border-t border-black/[0.06] bg-white/40 p-3 backdrop-blur-md sm:p-4 space-y-3">
            {/* Resolution form */}
            {showResolutionForm && !consultationDone && (
              <ResolutionForm
                onSubmit={handleCloseCase}
                onCancel={() => setShowResolutionForm(false)}
                submitting={submitting}
              />
            )}

            {consultationDone ? (
              <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 rounded-xl border border-malachite/15 bg-malachite/[0.06] px-6 py-5 text-center">
                <CheckCircle2 className="h-10 w-10 text-malachite/80" />
                <div>
                  <p className="text-[13px] font-medium text-[var(--mist)]">{t('humanTaskDetail.consultDone')}</p>
                  <button
                    type="button"
                    onClick={handleReopen}
                    className="mt-3 text-[12px] font-semibold text-amber underline-offset-4 transition-colors hover:underline hover:text-amber/80"
                  >
                    {t('humanTaskDetail.reopenConsult')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-3xl gap-3 items-end">
                {/* Composer textarea with ghost-text suggestion */}
                <div className="relative flex-1">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleInputKeyDown}
                    placeholder={t('humanTaskDetail.replyPh')}
                    disabled={sending}
                    rows={1}
                    style={{ resize: 'none', minHeight: '48px', maxHeight: '160px', overflow: 'auto' }}
                    className="w-full rounded-xl border border-black/[0.08] bg-white/85 px-4 py-3 text-[14px] text-[var(--mist)] shadow-[var(--shadow-input)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--fog)]/[0.35] focus:border-indigo/25 focus:ring-[3px] focus:ring-indigo/[0.12] disabled:opacity-50"
                    onInput={(e) => {
                      const el = e.currentTarget
                      el.style.height = 'auto'
                      el.style.height = `${Math.min(el.scrollHeight, 160)}px`
                    }}
                  />
                  {/* Ghost suggestion */}
                  {suggestion && !sending && (
                    <div className="pointer-events-none absolute inset-0 flex items-center overflow-hidden rounded-xl px-4 py-3">
                      <span className="whitespace-pre text-[14px] text-transparent">{input}</span>
                      <span className="text-[14px] text-[var(--fog)]/35">{suggestion}</span>
                    </div>
                  )}
                  {suggestion && (
                    <span className="absolute bottom-1.5 right-2 rounded bg-black/[0.04] px-1 py-0.5 text-[9px] font-medium text-[var(--fog)]/40">
                      Tab 采纳
                    </span>
                  )}
                  {assistLoading && !suggestion && (
                    <span className="absolute bottom-2 right-2">
                      <OrganicLoader icon="pulse" size={12} className="text-indigo/30" />
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="flex h-[48px] min-w-[48px] items-center justify-center rounded-xl bg-gradient-to-b from-indigo/[0.25] to-indigo/[0.14] px-4 text-[13px] font-semibold text-indigo shadow-sm ring-1 ring-indigo/20 transition-[transform,filter,opacity] hover:brightness-105 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 disabled:brightness-95"
                >
                  {sending
                    ? <OrganicLoader icon="dots" size={18} className="text-indigo" />
                    : <Send className="h-4 w-4" />
                  }
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

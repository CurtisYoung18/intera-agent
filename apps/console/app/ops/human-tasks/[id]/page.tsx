'use client'

import { useState, useEffect, useCallback, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageSquare,
  Sparkles,
  Target,
  Trash2,
  User,
  Zap,
} from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'

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
  const { t } = useConsoleLocale()
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [consultationDone, setConsultationDone] = useState(false)
  const [showContext, setShowContext] = useState(true)
  const [copiedSkill, setCopiedSkill] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const copyTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    fetch(`/api/human-tasks/${id}`)
      .then((r) => r.json())
      .then((data) => {
        const tk = data.task as TaskDetail
        setTask(tk)
        setConsultationDone(tk?.status === 'resolved')
        if (tk?.question) {
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
  }, [input, sending, consultationDone, id, t])

  const handleReopen = useCallback(async () => {
    await fetch(`/api/human-tasks/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'reopened', notes: 'Consultation reopened by operator' }),
    })
    setConsultationDone(false)
  }, [id])

  const handleDelete = useCallback(async () => {
    if (!confirm(t('humanTaskDetail.deleteWarn'))) return
    await fetch(`/api/human-tasks/${id}/delete`, { method: 'DELETE' })
    router.push('/ops/human-tasks')
    router.refresh()
  }, [id, router, t])

  const handleCloseCase = useCallback(async () => {
    const reason = prompt(t('humanTaskDetail.closePrompt'))
    if (!reason || !reason.trim()) return
    await fetch(`/api/human-tasks/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict: 'manually_closed', notes: reason.trim(), manualClose: true }),
    })
    setConsultationDone(true)
  }, [id, t])

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

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-black/[0.06] bg-[var(--surface)] px-10 py-12 shadow-[var(--shadow-card)]">
          <Loader2 className="h-7 w-7 animate-spin text-indigo/50" aria-hidden />
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
          <button
            type="button"
            onClick={handleCloseCase}
            className="rounded-xl px-3 py-2 text-[12px] font-medium text-[var(--fog)]/90 transition-colors hover:bg-vermillion/[0.06] hover:text-vermillion"
          >
            {t('humanTaskDetail.closeCase')}
          </button>
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

        {/* Chat */}
        <main
          className={`flex min-h-[min(70vh,640px)] flex-col overflow-hidden rounded-2xl border border-black/[0.07] bg-gradient-to-br from-white/70 via-white/45 to-[var(--void)]/90 shadow-[var(--shadow-card)] backdrop-blur-xl ${
            !showContext ? 'max-w-3xl lg:justify-self-center' : ''
          }`}
        >
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-black/[0.05] px-4 py-3 sm:px-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo/[0.08] ring-1 ring-indigo/[0.1]">
              <MessageSquare className="h-5 w-5 text-indigo" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[var(--mist)]">{t('humanTaskDetail.chatRoomTitle')}</p>
              <p className="text-[11px] text-[var(--fog)]">{t('humanTaskDetail.consultHint')}</p>
            </div>
          </div>

          <div className="min-h-[220px] flex-1 overflow-y-auto scroll-thin px-3 py-5 sm:px-6">
            {chatMessages.length === 0 && (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center px-6 text-center">
                <Bot className="mb-4 h-12 w-12 text-[var(--fog)]/[0.2]" strokeWidth={1} />
                <p className="text-[14px] font-medium text-[var(--fog)]">{t('humanTaskDetail.consultChat')}</p>
                <p className="mt-2 max-w-sm text-[12px] text-[var(--fog)]/[0.7]">{t('humanTaskDetail.consultHint')}</p>
              </div>
            )}

            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              {chatMessages.map((msg) => {
                const isAgent = msg.role === 'agent'
                const typing = isAgent && !msg.content && sending

                return (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${isAgent ? 'flex-row' : 'flex-row-reverse'}`}
                  >
                    <div
                      className={`relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl ring-2 ring-white/70 shadow-sm ${
                        isAgent
                          ? 'bg-gradient-to-br from-indigo/[0.2] to-lavender/[0.14]'
                          : 'bg-gradient-to-br from-[var(--basalt)] to-[var(--obsidian)]/80'
                      }`}
                    >
                      {isAgent
                        ? <Bot className="h-5 w-5 text-indigo" />
                        : <User className="h-5 w-5 text-[var(--mist)]/[0.75]" />}
                    </div>

                    <div className={`min-w-0 max-w-[min(100%,26rem)] ${isAgent ? 'text-left' : 'text-right'}`}>
                      <div className={`mb-1 flex items-center gap-2 px-1 ${isAgent ? 'justify-start' : 'justify-end'}`}>
                        <span className="text-[11px] font-semibold tracking-tight text-[var(--mist)]/[0.75]">
                          {isAgent ? t('humanTaskDetail.senderIntera') : t('humanTaskDetail.senderYou')}
                        </span>
                      </div>
                      <div
                        className={`relative rounded-[1.15rem] px-4 py-3 shadow-sm transition-[box-shadow,transform] duration-200 ${
                          isAgent
                            ? 'rounded-tl-md border border-black/[0.05] bg-white/[0.85]'
                            : 'rounded-tr-md border border-indigo/[0.12] bg-gradient-to-br from-indigo/[0.07] to-indigo/[0.03]'
                        }`}
                      >
                        {typing ? (
                          <span className="inline-flex flex-wrap items-center gap-2 text-[13px] text-[var(--fog)]">
                            <span className="inline-flex gap-1">
                              {[0, 1, 2].map((i) => (
                                <span
                                  key={i}
                                  className="inline-block h-2 w-2 rounded-full bg-indigo/[0.45] animate-bounce"
                                  style={{ animationDelay: `${i * 140}ms` }}
                                />
                              ))}
                            </span>
                            <span>{t('humanTaskDetail.thinking')}</span>
                          </span>
                        ) : (
                          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--mist)]/[0.92]">
                            {msg.content || (
                              <span className="text-[var(--fog)]/60">{t('humanTaskDetail.noResponse')}</span>
                            )}
                          </p>
                        )}
                      </div>
                      {msg.timestamp && msg.content && !typing && (
                        <p className={`mt-1.5 px-1 text-[10px] tabular-nums text-[var(--fog)]/45 ${isAgent ? 'text-left' : 'text-right'}`}>
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <div ref={chatEndRef} className="h-px w-full flex-shrink-0" />
          </div>

          <div className="flex-shrink-0 border-t border-black/[0.06] bg-[var(--abyss)]/40 p-3 backdrop-blur-md sm:p-4">
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
              <div className="mx-auto flex max-w-3xl gap-3">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  placeholder={t('humanTaskDetail.replyPh')}
                  disabled={sending}
                  className="min-h-[48px] flex-1 rounded-xl border border-black/[0.08] bg-white/85 px-4 text-[14px] text-[var(--mist)] shadow-[var(--shadow-input)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--fog)]/[0.35] focus:border-indigo/25 focus:ring-[3px] focus:ring-indigo/[0.12] disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="flex h-[48px] min-w-[104px] items-center justify-center rounded-xl bg-gradient-to-b from-indigo/[0.25] to-indigo/[0.14] px-5 text-[13px] font-semibold text-indigo shadow-sm ring-1 ring-indigo/20 transition-[transform,filter,opacity] hover:brightness-105 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 disabled:brightness-95"
                >
                  {sending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : t('common.send')}
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

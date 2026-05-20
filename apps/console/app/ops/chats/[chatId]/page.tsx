'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  MessageSquare,
  User,
  Bot,
  AlertCircle,
  CheckCircle2,
  Clock,
  Tag,
} from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import ExportButton from '@/components/ui/export-button'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useConsoleLocale } from '@/components/locale-provider'

interface MsgItem {
  id: string
  role: string
  content: string
  createdAt: string
  caseId: string
  caseType?: string
  caseStatus?: string
}

interface CaseSummary {
  id: string
  type: string
  status: string
  goal: string | null
  createdAt: string
  updatedAt: string
  _count?: { messages: number }
}

interface ChatSession {
  chatId: string
  userId: string
  cases: CaseSummary[]
  messageCount: number
  lastActivity: string
  hasHumanTask: boolean
}

const STATUS_COLOR: Record<string, string> = {
  created: '#a09888',
  collecting: '#5b8af7',
  investigating: '#6366f1',
  waiting_human: '#d4912e',
  resolved: '#2ea04a',
  escalated: '#e64539',
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function CasePill({ caseItem }: { caseItem: CaseSummary }) {
  const color = STATUS_COLOR[caseItem.status] ?? '#a09888'
  return (
    <Link
      href={`/ops/cases/${caseItem.id}`}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold hover:brightness-105 transition-[filter]"
      style={{ borderColor: `${color}44`, color, background: `${color}0f` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {caseItem.type.replace(/_/g, ' ')}
      <span className="opacity-60">#{caseItem.id.slice(0, 8)}</span>
    </Link>
  )
}

function MessageRow({ msg, cases }: { msg: MsgItem; cases: CaseSummary[] }) {
  const isUser = msg.role === 'user'
  const isAssistant = msg.role === 'assistant'

  // Detect if this message is from a tool result (starts with "Tool ")
  const isToolResult = msg.content.startsWith('Tool ') && msg.role === 'assistant'

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ${
          isUser ? 'bg-indigo/80' : 'bg-[var(--surface)] border border-black/[0.06]'
        }`}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-indigo/60" />
        )}
      </div>

      {/* Bubble */}
      <div className={`min-w-0 max-w-[72%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
            isUser
              ? 'bg-indigo/[0.12] text-[var(--mist)] rounded-tr-sm'
              : isToolResult
              ? 'bg-black/[0.04] font-mono text-[11px] text-[var(--fog)] rounded-tl-sm border border-black/[0.05]'
              : 'bg-white/80 text-[var(--mist)] shadow-[var(--shadow-card)] rounded-tl-sm border border-black/[0.06]'
          }`}
        >
          {isToolResult ? (
            <pre className="whitespace-pre-wrap break-words">{msg.content}</pre>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
          )}
        </div>
        <span className="text-[10px] text-[var(--fog)]/60">{fmtTime(msg.createdAt)}</span>
      </div>
    </div>
  )
}

export default function ChatDetailPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = use(params)
  const decodedChatId = decodeURIComponent(chatId)
  const router = useRouter()
  const { t } = useConsoleLocale()

  const [session, setSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<MsgItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        // Fetch session info via cases API — filter by chatId
        const [sessRes] = await Promise.all([
          fetch(`/api/chats?limit=200`),
        ])
        const sessData = (await sessRes.json()) as { sessions: ChatSession[] }
        const found = sessData.sessions.find((s) => s.chatId === decodedChatId)
        if (!found) { setLoading(false); return }
        setSession(found)

        // Fetch messages for all cases in this session, interleave by time
        const msgArrays = await Promise.all(
          found.cases.map(async (c) => {
            const r = await fetch(`/api/cases/${c.id}/messages?limit=200`)
            if (!r.ok) return []
            const d = (await r.json()) as { messages: { id: string; role: string; content: string; createdAt: string }[] }
            return d.messages.map((m) => ({
              ...m,
              caseId: c.id,
              caseType: c.type,
              caseStatus: c.status,
            }))
          }),
        )
        const merged = msgArrays.flat().sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        )
        setMessages(merged)
      } catch (e) {
        console.error('Chat load failed:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [decodedChatId])

  // Group messages, injecting a case-divider when caseId changes
  type Row = { type: 'msg'; msg: MsgItem } | { type: 'case_banner'; c: CaseSummary }
  const rows: Row[] = []
  let lastCaseId = ''
  for (const msg of messages) {
    if (msg.caseId !== lastCaseId) {
      const c = session?.cases.find((x) => x.id === msg.caseId)
      if (c) rows.push({ type: 'case_banner', c })
      lastCaseId = msg.caseId
    }
    rows.push({ type: 'msg', msg })
  }

  const headerTitle = session
    ? `Chat · ${session.userId}`
    : `Chat · ${decodedChatId.slice(0, 16)}…`

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[900px] flex-col px-4 py-4 sm:px-6">
      {/* Toolbar */}
      <header className="sticky top-0 z-30 mb-4 flex flex-shrink-0 items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white/55 px-4 py-3 shadow-[var(--shadow-card)] backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/ops/chats')}
            className="console-btn-icon-square"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-semibold tracking-tight text-[var(--mist)]">
              {headerTitle}
            </h1>
            {session && (
              <p className="mt-0.5 text-[11px] text-[var(--fog)]/70">
                {session.cases.length} case{session.cases.length !== 1 ? 's' : ''} ·{' '}
                {session.messageCount} messages
              </p>
            )}
          </div>
        </div>

        {/* Case pills + export */}
        <div className="flex shrink-0 items-center gap-2">
          {session && (
            <div className="hidden flex-wrap items-center gap-1.5 sm:flex">
              {session.cases.map((c) => (
                <CasePill key={c.id} caseItem={c} />
              ))}
            </div>
          )}
          {!loading && session && (
            <ExportButton
              filename={`chat-${decodedChatId.slice(0, 8)}`}
              label="Export chat as JSON"
              getData={() => ({
                _version: 'intera_console_chat_export_v1',
                exportedAt: new Date().toISOString(),
                session: {
                  chatId: session.chatId,
                  userId: session.userId,
                  messageCount: session.messageCount,
                  caseCount: session.cases.length,
                  lastActivity: session.lastActivity,
                  hasHumanTask: session.hasHumanTask,
                },
                cases: session.cases,
                messages,
              })}
            />
          )}
        </div>
      </header>

      {/* Transcript */}
      <main className="flex-1 overflow-y-auto rounded-2xl border border-black/[0.06] bg-gradient-to-br from-white/60 to-white/30 p-4 shadow-[var(--shadow-card)] backdrop-blur-xl">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <OrganicLoader icon="spin" size={28} className="text-indigo/60" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-[var(--fog)]">
            <MessageSquare className="mb-2 h-8 w-8 opacity-20" strokeWidth={1} />
            <p className="text-[13px]">No messages in this session</p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((row, i) => {
              if (row.type === 'case_banner') {
                const color = STATUS_COLOR[row.c.status] ?? '#a09888'
                return (
                  <div key={`banner-${row.c.id}`} className="flex items-center gap-3 py-2">
                    <div className="h-px flex-1 bg-black/[0.06]" />
                    <CasePill caseItem={row.c} />
                    <div className="h-px flex-1 bg-black/[0.06]" />
                  </div>
                )
              }
              return (
                <MessageRow
                  key={row.msg.id}
                  msg={row.msg}
                  cases={session?.cases ?? []}
                />
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

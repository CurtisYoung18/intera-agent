'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  MessageSquare,
  Search,
  User,
  AlertCircle,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ExportButton from '@/components/ui/export-button'
import { useConsoleLocale } from '@/components/locale-provider'

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

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? '#a09888'
  const pulse = status === 'waiting_human' || status === 'investigating'
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${pulse ? 'animate-pulse' : ''}`}
      style={{ backgroundColor: color }}
    />
  )
}

function ChatCard({ session, search }: { session: ChatSession; search: string }) {
  const activeCases = session.cases.filter(
    (c) => c.status !== 'resolved' && c.status !== 'escalated',
  )
  const hasActive = activeCases.length > 0
  const latestStatus = session.cases[0]?.status ?? 'created'

  return (
    <Link
      href={`/ops/chats/${encodeURIComponent(session.chatId)}`}
      className="group/card block rounded-2xl border border-black/[0.06] bg-gradient-to-br from-white/70 via-white/45 to-white/25 p-4 shadow-[var(--shadow-card)] backdrop-blur-xl transition-[transform,box-shadow] duration-200 hover:-translate-y-[1px] hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.16)]"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo/[0.08]">
            <User className="h-3.5 w-3.5 text-indigo/70" />
          </div>
          <span className="truncate font-mono text-[11px] text-[var(--mist)] opacity-80">
            {session.userId}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {session.hasHumanTask && (
            <AlertCircle className="h-3.5 w-3.5 text-amber" />
          )}
          <StatusDot status={latestStatus} />
        </div>
      </div>

      {/* Cases chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {session.cases.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1 rounded-full border border-black/[0.05] bg-white/80 px-2 py-0.5 text-[10px] font-medium"
            style={{ color: STATUS_COLOR[c.status] ?? '#a09888' }}
          >
            <StatusDot status={c.status} />
            {c.type.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--fog)]">
        <span className="flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {session.messageCount} msgs · {session.cases.length} case{session.cases.length !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {fmtRelative(session.lastActivity)}
        </span>
      </div>
    </Link>
  )
}

export default function ChatsPage() {
  const { t } = useConsoleLocale()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/chats?limit=200')
      if (!res.ok) throw new Error('Failed')
      const data = (await res.json()) as { sessions: ChatSession[]; total: number }
      setSessions(data.sessions)
      setTotal(data.total)
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [load])

  const filtered = sessions.filter((s) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      s.userId.toLowerCase().includes(q) ||
      s.chatId.toLowerCase().includes(q) ||
      s.cases.some((c) => c.type.includes(q) || c.id.includes(q))
    )
  })

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo/[0.08]">
              <MessageSquare className="h-4 w-4 text-indigo" />
            </div>
            <h1 className="text-[clamp(1.25rem,2vw,1.5rem)] font-bold tracking-tight text-[var(--mist)]">
              Chats
            </h1>
          </div>
          <p className="mt-1.5 text-[13px] text-[var(--fog)]">
            {total} session{total !== 1 ? 's' : ''} · {filtered.length} shown
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--smoke)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by user, case type…"
              className="glass-input-console w-full rounded-xl border-black/[0.06] bg-white/65 pl-11 text-[13px] shadow-[var(--shadow-input)] placeholder:text-[var(--fog)]/50"
            />
          </div>
          {sessions.length > 0 && (
            <ExportButton
              filename="chats-list"
              label="Export visible sessions as JSON"
              getData={() => ({
                _version: 'intera_console_chats_export_v1',
                exportedAt: new Date().toISOString(),
                filter: search || null,
                total,
                shown: filtered.length,
                sessions: filtered,
              })}
            />
          )}
        </div>
      </header>

      {loading ? (
        <ListSkeleton count={6} />
      ) : filtered.length === 0 ? (
        <div className="mx-auto max-w-md py-16">
          <EmptyState
            icon={MessageSquare}
            title="No chat sessions"
            description={search ? 'No sessions match your search.' : 'No conversations yet. Start a chat from the chat interface.'}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((s) => (
            <ChatCard key={s.chatId} session={s} search={search} />
          ))}
        </div>
      )}
    </div>
  )
}

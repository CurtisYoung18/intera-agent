'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  MessageSquare,
  Search,
  User,
  AlertCircle,
  Clock,
  Trash2,
} from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ExportButton from '@/components/ui/export-button'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient } from '@/lib/api/client'
import type { ChatsListResponse, ChatDeleteResponse } from '@intera/shared/contracts/chats'

interface CaseSummary {
  id: string
  type: string
  status: string
  source: string
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

function ChatCard({
  session,
  search,
  onDelete,
  deleting,
}: {
  session: ChatSession
  search: string
  onDelete: (chatId: string) => void
  deleting: boolean
}) {
  const latestStatus = session.cases[0]?.status ?? 'created'

  return (
    <div className="group/card relative">
      <Link
        href={`/ops/chats/${encodeURIComponent(session.chatId)}`}
        className="block rounded-2xl border border-black/[0.06] bg-gradient-to-br from-white/70 via-white/45 to-white/25 p-4 shadow-[var(--shadow-card)] backdrop-blur-xl transition-[transform,box-shadow] duration-200 hover:-translate-y-[1px] hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.16)]"
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

        {/* ProcedureRun chips */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {session.cases.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1 rounded-full border border-black/[0.05] bg-white/80 px-2 py-0.5 text-[10px] font-medium"
                style={{ color: STATUS_COLOR[c.status] ?? '#a09888' }}
              >
                <StatusDot status={c.status} />
                {c.type.replace(/_/g, ' ')}
              </span>
              {c.source === 'playground' && (
                <span
                  className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                  style={{
                    background: '#d4912e22',
                    color: '#d4912e',
                    border: '1px solid #d4912e44',
                  }}
                >
                  test
                </span>
              )}
            </span>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--fog)]">
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {session.messageCount} msgs · {session.cases.length} ProcedureRun{session.cases.length !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {fmtRelative(session.lastActivity)}
          </span>
        </div>
      </Link>

      {/* Delete button — appears on card hover */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDelete(session.chatId)
        }}
        disabled={deleting}
        className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-[var(--vermillion)]/40 opacity-0 shadow-sm backdrop-blur-sm transition-[opacity,color,background,border-color,transform] duration-200 hover:scale-[1.03] hover:border-[var(--vermillion)]/20 hover:bg-[var(--vermillion)]/[0.08] hover:text-[var(--vermillion)] group-hover/card:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vermillion)]/25 disabled:pointer-events-none disabled:opacity-40"
        aria-label="Delete chat session"
        title="Delete chat session"
      >
        {deleting
          ? <OrganicLoader icon="spin" size={14} className="text-[var(--vermillion)]" />
          : <Trash2 className="h-3.5 w-3.5" />
        }
      </button>
    </div>
  )
}

export default function ChatsPage() {
  const { t } = useConsoleLocale()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const result = await apiClient<ChatsListResponse>('/api/chats?limit=200')
      setSessions(result.data.sessions)
      setTotal(result.data.total)
    } catch {
      if (showLoading) setSessions([])
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(true) // show loading only on initial fetch
    const id = setInterval(() => load(false), 15_000) // silent background poll
    return () => clearInterval(id)
  }, [load])

  const handleDelete = useCallback(async (chatId: string) => {
    const label = chatId.slice(0, 16) + '…'
    if (!confirm(`Delete chat session ${label} and all linked ProcedureRuns?\nThis cannot be undone.`)) return
    setDeletingId(chatId)
    try {
      await apiClient<ChatDeleteResponse>(`/api/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' })
      setSessions((prev) => prev.filter((s) => s.chatId !== chatId))
      setTotal((prev) => prev - 1)
    } catch {
      alert('Failed to delete — network error')
    } finally {
      setDeletingId(null)
    }
  }, [])

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
              placeholder="Search by user, Procedure type…"
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
            <ChatCard
              key={s.chatId}
              session={s}
              search={search}
              onDelete={handleDelete}
              deleting={deletingId === s.chatId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

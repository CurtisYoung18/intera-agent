'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users2, User, ChevronRight } from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import { apiClient } from '@/lib/api/client'

interface UserRow {
  userId: string
  label: string
  kind: 'member' | 'anonymous' | 'unknown'
  totalChats: number
  totalCases: number
  resolvedCases: number
  escalatedCases: number
  lastCaseType: string | null
  hasProfile: boolean
  lastSeenAt: string
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

export default function UsersListPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiClient<{ users: UserRow[]; total: number }>('/api/users')
      .then((r) => setUsers(r.data.users ?? []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-5 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-lavender/[0.1]">
          <Users2 className="h-4 w-4 text-lavender" />
        </div>
        <div>
          <h1 className="text-[clamp(1.25rem,2vw,1.5rem)] font-bold tracking-tight text-[var(--mist)]">Users</h1>
          <p className="text-[11px] text-[var(--fog)]/70">
            Accumulated user profiles (cross-chat memory, preferences, history)
          </p>
        </div>
      </header>

      {loading ? (
        <ListSkeleton count={6} />
      ) : users.length === 0 ? (
        <div className="mx-auto max-w-md py-16">
          <EmptyState
            icon={Users2}
            title="No user profiles yet"
            description="Profiles are built as conversations get compacted (auto, on Procedure finalization, or via Compact in a chat's Memory panel)."
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {users.map((u) => (
            <Link
              key={u.userId}
              href={`/ops/users/${encodeURIComponent(u.userId)}`}
              className="group/card relative rounded-2xl border border-black/[0.06] bg-white/70 p-4 transition-colors hover:border-lavender/30 hover:bg-white"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lavender/[0.1]">
                    <User className="h-3.5 w-3.5 text-lavender" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-[var(--mist)]">{u.label}</p>
                    <p className="text-[10px] text-[var(--fog)]/70">
                      {u.kind === 'member' ? 'Member' : u.kind === 'anonymous' ? 'Anonymous (chat-scoped)' : 'Unknown'}
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--fog)]/30 group-hover/card:text-lavender" />
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
                <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[var(--fog)]">{u.totalCases} ProcedureRuns</span>
                <span className="rounded-md bg-emerald-500/[0.08] px-1.5 py-0.5 text-emerald-600">{u.resolvedCases} resolved</span>
                {u.escalatedCases > 0 && (
                  <span className="rounded-md bg-vermillion/[0.08] px-1.5 py-0.5 text-vermillion">{u.escalatedCases} escalated</span>
                )}
                {u.hasProfile && (
                  <span className="rounded-md bg-lavender/[0.1] px-1.5 py-0.5 text-lavender">📝 profile</span>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--fog)]">
                <span>{u.lastCaseType ?? '—'}</span>
                <span>{fmtRelative(u.lastSeenAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

'use client'

// Cases — list all cases across the system with status filter and pagination

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { FolderOpen, Search } from 'lucide-react'
import GlassCard from '@/components/ui/glass-card'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'

interface CaseItem {
  id: string; type: string; status: string; userId: string
  goal: string | null; blocker: string | null
  createdAt: string; updatedAt: string
  memory?: { confirmedFacts: string; skillsCalled: string } | null
  _count?: { messages: number; traces: number }
}

const STATUS_COLORS: Record<string, string> = {
  created: 'text-muted/50', collecting: 'text-indigo/70',
  investigating: 'text-indigo', verifying: 'text-indigo/70',
  waiting_human: 'text-amber', escalated: 'text-vermillion',
  resolved: 'text-malachite',
}

const STATUS_OPTIONS = ['all', 'created', 'collecting', 'investigating', 'waiting_human', 'resolved', 'escalated']
const PAGE_SIZE = 20

export default function CasesPage() {
  const [cases, setCases] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  const load = useCallback(async (status: string, newOffset: number, append: boolean) => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(newOffset))
    if (status !== 'all') params.set('status', status)
    try {
      const res = await fetch(`/api/cases?${params}`)
      const d = await res.json()
      const items = d.cases || []
      setCases(prev => append ? [...prev, ...items] : items)
      setHasMore(items.length === PAGE_SIZE)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { setOffset(0); load(statusFilter, 0, false) }, [statusFilter, load])

  const handleLoadMore = () => {
    const next = offset + PAGE_SIZE
    setOffset(next)
    load(statusFilter, next, true)
  }

  const filtered = search
    ? cases.filter(c => c.id.includes(search) || c.userId.includes(search))
    : cases

  return (
    <div className="max-w-4xl mx-auto px-8 py-8 animate-fade-up">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[18px] font-semibold text-primary tracking-[-0.01em]">Cases</h1>
          <p className="text-[13px] text-secondary mt-1">All customer cases across the platform</p>
        </div>
        {!loading && (
          <span className="glass-pill text-[12px] font-mono text-secondary tabular-nums">
            {cases.length} cases
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted/40" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search ID or user…" className="glass-input-console text-[12px] pl-8 pr-3 py-2 w-48" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_OPTIONS.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${
                statusFilter === s
                  ? 'border-indigo/30 bg-indigo/[0.06] text-indigo font-medium'
                  : 'border-[var(--border-subtle)] text-muted/50 hover:text-muted'
              }`}>
              {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {loading && cases.length === 0 && <ListSkeleton count={5} />}

      {!loading && cases.length === 0 && (
        <EmptyState icon={FolderOpen} title="No cases yet"
          description="Cases are created when customers start conversations with the agent." />
      )}

      {!loading && cases.length > 0 && filtered.length === 0 && search && (
        <p className="text-[13px] text-muted text-center py-8">No cases matching "{search}"</p>
      )}

      <div className="space-y-3">
        {filtered.map(c => (
          <Link key={c.id} href={`/ops/cases/${c.id}`}>
            <GlassCard className="p-5 group">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className="text-[14px] font-semibold text-primary font-mono">
                      {c.id.slice(0, 12)}…
                    </span>
                    <span className="text-[11px] text-secondary">{c.type.replace(/_/g, ' ')}</span>
                    <span className={`text-[10px] font-sans uppercase tracking-[0.05em] ${STATUS_COLORS[c.status] || 'text-muted'}`}>
                      {c.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {c.goal && <p className="text-[12px] text-secondary truncate mb-1">{c.goal}</p>}
                  <div className="flex items-center gap-3 text-[10px] font-mono text-muted">
                    <span>User: {c.userId}</span>
                    {c._count && <span>{c._count.messages} msgs</span>}
                    {c._count && <span>{c._count.traces} traces</span>}
                    <span>{new Date(c.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <span className="text-muted/20 text-lg flex-shrink-0 group-hover:text-indigo group-hover:translate-x-0.5 transition-all duration-300">
                  →
                </span>
              </div>
            </GlassCard>
          </Link>
        ))}
      </div>

      {hasMore && (
        <button onClick={handleLoadMore} disabled={loading}
          className="mt-4 w-full py-2.5 rounded-xl text-[13px] text-secondary hover:text-primary border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all">
          {loading ? 'Loading…' : 'Load More'}
        </button>
      )}
    </div>
  )
}

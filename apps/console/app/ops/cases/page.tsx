'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { FolderOpen, Search, Clock, MessageSquare, Activity } from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'

interface CaseItem {
  id: string; type: string; status: string; userId: string
  goal: string | null; blocker: string | null
  createdAt: string; updatedAt: string
  memory?: { confirmedFacts: string; skillsCalled: string } | null
  _count?: { messages: number; traces: number }
}

const STATUSES = ['created', 'collecting', 'investigating', 'waiting_human', 'resolved', 'escalated'] as const

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  created: { label: 'New', color: '#a09888', bg: 'rgba(160,152,136,0.06)' },
  collecting: { label: 'Collecting', color: '#5b8af7', bg: 'rgba(91,138,247,0.06)' },
  investigating: { label: 'Investigating', color: '#5b8af7', bg: 'rgba(91,138,247,0.08)' },
  verifying: { label: 'Verifying', color: '#5b8af7', bg: 'rgba(91,138,247,0.06)' },
  waiting_human: { label: 'Waiting', color: '#d4912e', bg: 'rgba(212,145,46,0.06)' },
  resolved: { label: 'Resolved', color: '#2ea04a', bg: 'rgba(46,160,74,0.06)' },
  escalated: { label: 'Escalated', color: '#e64539', bg: 'rgba(230,69,57,0.06)' },
}

export default function CasesPage() {
  const [cases, setCases] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(new Set(STATUSES))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cases?limit=200')
      const d = await res.json()
      setCases(d.cases || [])
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleStatus = (s: string) => {
    setActiveStatuses(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s); else next.add(s)
      return next
    })
  }

  const filtered = cases.filter(c => {
    if (!activeStatuses.has(c.status)) return false
    if (search && !c.id.includes(search) && !c.userId.includes(search) && !(c.goal || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Group by status for kanban
  const kanbanColumns = STATUSES.map(status => ({
    status,
    meta: STATUS_META[status] || { label: status, color: '#a09888', bg: 'rgba(0,0,0,0.03)' },
    items: filtered.filter(c => c.status === status),
  }))

  if (loading) return <div className="p-8"><ListSkeleton /></div>

  return (
    <div className="px-6 py-6 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--mist)]">Cases</h1>
          <p className="text-[13px] text-[var(--fog)] mt-0.5">{cases.length} total · {filtered.length} visible</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--smoke)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cases…" className="glass-input-console text-[13px] pl-10 w-64" />
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {STATUSES.map(s => {
          const meta = STATUS_META[s] || { label: s, color: '#a09888' }
          const active = activeStatuses.has(s)
          return (
            <button key={s} onClick={() => toggleStatus(s)}
              className="text-[11px] px-3 py-1.5 rounded-full border transition-all font-medium"
              style={{
                borderColor: active ? meta.color : 'rgba(0,0,0,0.06)',
                backgroundColor: active ? meta.bg : 'transparent',
                color: active ? meta.color : 'var(--smoke)',
                opacity: active ? 1 : 0.6,
              }}>
              {meta.label}
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No cases" description={search ? 'No matches' : 'No cases in selected statuses'} />
      ) : (
        /* Kanban board */
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 overflow-x-auto">
          {kanbanColumns.map(col => (
            <div key={col.status} className="flex flex-col min-w-[180px]">
              {/* Column header */}
              <div className="flex items-center gap-2 mb-3 px-2">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: col.meta.color }} />
                <span className="text-[12px] font-medium text-[var(--mist)]">{col.meta.label}</span>
                <span className="text-[11px] text-[var(--smoke)] ml-auto">{col.items.length}</span>
              </div>

              {/* Cards */}
              <div className="space-y-2 flex-1">
                {col.items.map(c => (
                  <Link key={c.id} href={`/ops/cases/${c.id}`}>
                    <div className="bg-white/70 backdrop-blur-xl border border-black/5 rounded-lg p-3 cursor-pointer
                      transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-black/10 group">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-mono font-medium text-[var(--mist)] truncate">{c.id}</span>
                        <span className="text-[10px] text-[var(--fog)] font-mono flex-shrink-0 ml-2">{new Date(c.updatedAt).toLocaleDateString()}</span>
                      </div>
                      <p className="text-[11px] text-[var(--fog)] line-clamp-2 mb-2">{c.goal || c.type}</p>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[var(--smoke)]">{c.userId}</span>
                        <div className="flex items-center gap-2 text-[var(--smoke)]">
                          {c._count && <span className="flex items-center gap-0.5"><MessageSquare className="w-3 h-3" />{c._count.messages}</span>}
                          {c._count && <span className="flex items-center gap-0.5"><Activity className="w-3 h-3" />{c._count.traces}</span>}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
                {col.items.length === 0 && (
                  <div className="text-[11px] text-[var(--smoke)]/25 text-center py-6 border border-dashed border-black/5 rounded-lg">No cases</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

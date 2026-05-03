'use client'

// Cases — list all cases across the system

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { FolderOpen, Search } from 'lucide-react'
import GlassCard from '@/components/ui/glass-card'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'

interface CaseItem {
  id: string
  type: string
  status: string
  userId: string
  goal: string | null
  blocker: string | null
  createdAt: string
  updatedAt: string
  memory?: { confirmedFacts: string; skillsCalled: string } | null
  _count?: { messages: number; traces: number }
}

const STATUS_COLORS: Record<string, string> = {
  created: 'text-muted/50',
  collecting: 'text-indigo/70',
  investigating: 'text-indigo',
  verifying: 'text-indigo/70',
  waiting_human: 'text-amber',
  escalated: 'text-vermillion',
  resolved: 'text-malachite',
}

export default function CasesPage() {
  const [cases, setCases] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/cases?limit=100')
      .then(r => r.json())
      .then(d => setCases(d.cases || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

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

      {loading && <ListSkeleton count={5} />}

      {!loading && cases.length === 0 && (
        <EmptyState icon={FolderOpen} title="No cases yet"
          description="Cases are created when customers start conversations with the agent." />
      )}

      <div className="space-y-3">
        {cases.map(c => (
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
    </div>
  )
}

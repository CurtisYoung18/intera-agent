'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot, ArrowLeft } from 'lucide-react'

interface SubAgentRow {
  id: string
  name: string
  description: string
  model: string
  maxIterations: number
}

export default function SubAgentsPage() {
  const [subAgents, setSubAgents] = useState<SubAgentRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/sub-agents')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setSubAgents((d.subAgents || []) as SubAgentRow[]))
      .catch(() => setSubAgents([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="px-8 py-8 animate-fade-up max-w-3xl">
      <Link
        href="/admin/case-types"
        className="inline-flex items-center gap-1.5 text-[12px] text-[var(--fog)] hover:text-[var(--mist)] mb-6 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Case Types
      </Link>

      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-[var(--mist)]">Sub-Agent Registry</h1>
        <p className="text-[13px] text-[var(--fog)] mt-0.5">
          Define reusable sub-agent templates for cc-mode case types.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 border-[var(--border-subtle)] border-t-indigo rounded-full animate-spin" />
        </div>
      ) : subAgents.length > 0 ? (
        <div className="space-y-3">
          {subAgents.map((sa) => (
            <div
              key={sa.id}
              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white/30"
            >
              <div className="flex items-center gap-2 mb-2">
                <Bot className="w-4 h-4 text-gold" />
                <span className="text-[13px] font-semibold text-[var(--mist)]">{sa.name}</span>
              </div>
              {sa.description && (
                <p className="text-[12px] text-[var(--fog)] mb-2">{sa.description}</p>
              )}
              <div className="flex gap-3 text-[11px] text-[var(--smoke)]">
                <span>Model: {sa.model}</span>
                <span>Max iterations: {sa.maxIterations}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-white/20 p-12 text-center">
          <Bot className="w-10 h-10 text-[var(--smoke)]/30 mx-auto mb-4" />
          <p className="text-[14px] text-[var(--fog)] mb-2">
            Coming soon
          </p>
          <p className="text-[12px] text-[var(--fog)]/70">
            Coming soon — edit sub-agents in Case Types for now.
          </p>
          <Link
            href="/admin/case-types"
            className="inline-flex items-center gap-1.5 mt-4 text-[12px] font-medium text-indigo hover:underline"
          >
            Go to Case Types
          </Link>
        </div>
      )}
    </div>
  )
}

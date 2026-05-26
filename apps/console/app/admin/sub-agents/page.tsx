'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot, Layers, ArrowLeft, Wrench } from 'lucide-react'

interface SubAgentInfo {
  name: string
  model: string
  maxIterations?: number
  parallel: boolean
  skills: string[]
  /** Which case type + stage this comes from. */
  source: { caseType: string; stage: string }
}

export default function SubAgentsPage() {
  const [subAgents, setSubAgents] = useState<SubAgentInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/case-types')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        const all: SubAgentInfo[] = []
        const types = (d.caseTypes || []) as Array<{
          type: string; displayName: string; executionMode?: string
          stageConfigs?: string
        }>
        for (const ct of types) {
          let stageConfigs: Record<string, { subAgents?: Array<{
            name: string; model: string; maxIterations?: number; parallel: boolean; skills: string[]
          }> }> = {}
          try { stageConfigs = JSON.parse(ct.stageConfigs || '{}') } catch { /* skip */ }

          for (const [stage, cfg] of Object.entries(stageConfigs)) {
            for (const sa of (cfg.subAgents || [])) {
              all.push({
                ...sa,
                source: { caseType: ct.type, stage },
              })
            }
          }
        }
        setSubAgents(all)
      })
      .catch(() => setSubAgents([]))
      .finally(() => setLoading(false))
  }, [])

  // Group by case type
  const grouped = new Map<string, SubAgentInfo[]>()
  for (const sa of subAgents) {
    const key = sa.source.caseType
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(sa)
  }

  return (
    <div className="px-8 py-8 animate-fade-up max-w-4xl">
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
          All sub-agents across case types. Edit each in its Case Type detail page.
          {subAgents.length > 0 && ` — ${subAgents.length} total`}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 border-[var(--border-subtle)] border-t-indigo rounded-full animate-spin" />
        </div>
      ) : subAgents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-white/20 p-12 text-center">
          <Bot className="w-10 h-10 text-[var(--smoke)]/30 mx-auto mb-4" />
          <p className="text-[14px] text-[var(--fog)] mb-2">No sub-agents configured yet</p>
          <p className="text-[12px] text-[var(--fog)]/70 mb-4">
            Add sub-agents in a Case Type detail page under a stage.
          </p>
          <Link
            href="/admin/case-types"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo hover:underline"
          >
            Go to Case Types
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([caseType, agents]) => (
            <div key={caseType}>
              <Link
                href={`/admin/case-types/${encodeURIComponent(caseType)}`}
                className="inline-flex items-center gap-2 text-[13px] font-semibold text-indigo hover:underline mb-2"
              >
                <Layers className="w-3.5 h-3.5" />
                {caseType}
              </Link>
              <div className="space-y-2">
                {agents.map((sa) => (
                  <div
                    key={`${caseType}-${sa.source.stage}-${sa.name}`}
                    className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border-subtle)] bg-white/30"
                  >
                    <Bot className="w-4 h-4 text-gold mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[12px] font-semibold text-[var(--mist)]">{sa.name}</span>
                        <span className="text-[10px] text-[var(--smoke)] px-1.5 py-0.5 rounded bg-black/[0.04]">
                          stage: {sa.source.stage}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] text-[var(--fog)]">
                        <span>model: {sa.model}</span>
                        {sa.maxIterations && <span>· {sa.maxIterations} turns</span>}
                        <span>· {sa.parallel ? 'parallel' : 'serial'}</span>
                        {sa.skills.length > 0 && (
                          <span>· skills: {sa.skills.join(', ')}</span>
                        )}
                      </div>
                    </div>
                    <Link
                      href={`/admin/case-types/${encodeURIComponent(caseType)}`}
                      className="text-[10px] text-indigo hover:underline flex-shrink-0 flex items-center gap-1 mt-0.5"
                    >
                      <Wrench className="w-3 h-3" /> Edit
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

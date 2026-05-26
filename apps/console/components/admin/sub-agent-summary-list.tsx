'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'

interface CaseTypeRow {
  type: string
  displayName: string
  enabled: boolean
  stageConfigs: string | null
}

interface SubAgent {
  name: string
  model?: string
  skills?: string[]
  maxIterations?: number
  parallel?: boolean
  systemPrompt?: string
  taskTemplate?: string
}

export default function SubAgentSummaryList() {
  const { t } = useConsoleLocale()
  const [caseTypes, setCaseTypes] = useState<CaseTypeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/case-types')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setCaseTypes((d.types || []) as CaseTypeRow[]))
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <p className="text-[11px] text-[var(--fog)]/60">Loading case types…</p>
  }

  if (error) {
    return <p className="text-[11px] text-vermillion">Could not load: {error}</p>
  }

  // Extract sub-agents from stage configs
  const typeEntries = caseTypes
    .filter((ct) => ct.enabled)
    .map((ct) => {
      let subAgents: SubAgent[] = []
      if (ct.stageConfigs) {
        try {
          const configs = JSON.parse(ct.stageConfigs)
          for (const stageName of Object.keys(configs || {})) {
            const stage = configs[stageName]
            if (stage && Array.isArray(stage.subAgents)) {
              for (const sa of stage.subAgents) {
                if (sa && typeof sa.name === 'string') {
                  subAgents.push(sa as SubAgent)
                }
              }
            }
          }
        } catch { /* ignore parse errors */ }
      }
      return { displayName: ct.displayName || ct.type, subAgents }
    })
    .filter((e) => e.subAgents.length > 0)

  if (typeEntries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <p className="text-[13px] text-[var(--fog)]/70">
          No sub-agents configured.
        </p>
        <Link
          href="/admin/case-types"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo hover:underline"
        >
          {t('agent.subAgents.editLink')}
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {typeEntries.map((entry) => (
          <div
            key={entry.displayName}
            className="rounded-xl border border-black/[0.08] bg-white/[0.45] overflow-hidden shadow-[0_1px_12px_rgba(0,0,0,0.04)]"
          >
            <div className="px-3 py-2 border-b border-black/[0.05] bg-black/[0.02]">
              <span className="text-[13px] font-semibold text-[var(--mist)]">{entry.displayName}</span>
              <span className="ml-2 text-[10px] text-[var(--fog)]/60">
                {entry.subAgents.length} sub-agent{entry.subAgents.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="p-3 space-y-2">
              {entry.subAgents.map((sa, idx) => (
                <div
                  key={`${sa.name}-${idx}`}
                  className="flex items-start gap-3 rounded-lg border border-black/[0.05] bg-white/50 px-3 py-2.5"
                >
                  <span className="text-[10px] text-[var(--fog)]/40 mt-0.5 font-mono">&lfloor;</span>
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-[12px] font-medium text-[var(--mist)]">{sa.name}</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--fog)]/70">
                      {sa.model && <span>model: {sa.model}</span>}
                      {sa.skills && sa.skills.length > 0 && (
                        <span>skills: {sa.skills.length}</span>
                      )}
                      {sa.maxIterations != null && <span>max: {sa.maxIterations} turns</span>}
                      {sa.parallel && <span className="text-malachite">parallel</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Link
        href="/admin/case-types"
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo hover:underline"
      >
        {t('agent.subAgents.editLink')}
        <ExternalLink className="w-3 h-3" />
      </Link>
    </div>
  )
}

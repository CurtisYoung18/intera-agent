'use client'

import { useState, useEffect } from 'react'
import { apiClient } from '@/lib/api/client'

interface Props {
  agentId: string | null
}

export default function AgentBlueprint({ agentId }: Props) {
  const [stats, setStats] = useState<{ tools: number; policies: number; caseTypes: number } | null>(null)

  useEffect(() => {
    if (!agentId) { setStats(null); return }
    Promise.all([
      apiClient<{ tools?: unknown[] }>(`/api/admin/tools?agentConfigId=${agentId}`),
      apiClient<{ policies?: unknown[] }>(`/api/admin/policies?agentConfigId=${agentId}`),
      apiClient<{ types?: unknown[] }>(`/api/admin/case-types?agentConfigId=${agentId}`),
    ]).then(([toolsRes, policiesRes, caseTypesRes]) => {
      setStats({
        tools: (toolsRes.data.tools || []).length,
        policies: (policiesRes.data.policies || []).length,
        caseTypes: (caseTypesRes.data.types || []).length,
      })
    }).catch(() => setStats(null))
  }, [agentId])

  if (!agentId) return null

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded-xl border border-black/[0.06] bg-white/60 p-4">
        <p className="text-[11px] text-[var(--fog)]">Tools</p>
        <p className="text-[20px] font-semibold text-[var(--mist)]">{stats?.tools ?? '—'}</p>
      </div>
      <div className="rounded-xl border border-black/[0.06] bg-white/60 p-4">
        <p className="text-[11px] text-[var(--fog)]">Guardrails</p>
        <p className="text-[20px] font-semibold text-[var(--mist)]">{stats?.policies ?? '—'}</p>
      </div>
      <div className="rounded-xl border border-black/[0.06] bg-white/60 p-4">
        <p className="text-[11px] text-[var(--fog)]">Case Types</p>
        <p className="text-[20px] font-semibold text-[var(--mist)]">{stats?.caseTypes ?? '—'}</p>
      </div>
    </div>
  )
}

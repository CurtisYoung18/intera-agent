'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import type { PolicyRule } from '@intera/shared/types'
import { useConsoleLocale } from '@/components/locale-provider'
import { useSelectedAgentId } from '@/components/admin/version-context-bar'

interface PolicyRow {
  id: string
  name: string
  description: string | null
  hook: string
  enabled: boolean
  rule: string | PolicyRule
}

function parseRule(raw: string | PolicyRule): PolicyRule | null {
  if (!raw) return null
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw as PolicyRule
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as PolicyRule
    } catch { /* ignore */ }
  }
  return null
}

export default function GuardrailSummaryList() {
  const { t } = useConsoleLocale()
  const agentConfigId = useSelectedAgentId()
  const [catalog, setCatalog] = useState<PolicyRow[]>([])
  const [loadErr, setLoadErr] = useState(false)

  useEffect(() => {
    fetch(`/api/admin/policies?agentConfigId=${encodeURIComponent(agentConfigId ?? '')}`).then(r => r.ok ? r.json().then(d => d.data || d) : Promise.reject(new Error()))
      .then((d) => setCatalog((d.policies || []) as PolicyRow[]))
      .catch(() => setLoadErr(true))
  }, [agentConfigId])

  const byName = useMemo(() => {
    const m = new Map<string, PolicyRow>()
    for (const p of catalog) m.set(p.name, p)
    return m
  }, [catalog])

  const activeNames = useMemo(() => catalog.filter(p => p.enabled).map(p => p.name), [catalog])

  const chips = useMemo(() => {
    const result: Array<{ policyName: string; label: string; chipColor: 'amber' | 'malachite' | 'lavender' }> = []
    for (const name of activeNames) {
      const policy = byName.get(name)
      if (!policy || !policy.enabled) continue
      const rule = parseRule(policy.rule)
      if (!rule) continue

      if (rule.deny_tools && rule.deny_tools.length > 0) {
        result.push({
          policyName: name,
          label: `Never allow: ${rule.deny_tools.join(', ')}`,
          chipColor: 'amber' as const,
        })
      }

      if (rule.require_tools_any && rule.require_tools_any.length > 0) {
        const hookCtx = rule.hook_tools && rule.hook_tools.length > 0
          ? ` (triggered by: ${rule.hook_tools.join(', ')})`
          : ''
        result.push({
          policyName: name,
          label: `Must call at least one of: ${rule.require_tools_any.join(', ')}${hookCtx}`,
          chipColor: 'malachite' as const,
        })
      }

      if (rule.require_tools && rule.require_tools.length > 0) {
        result.push({
          policyName: name,
          label: `Must call all: ${rule.require_tools.join(', ')}`,
          chipColor: 'malachite' as const,
        })
      }

      if (rule.evaluationPrompt && rule.enableLlm !== false) {
        const truncated = rule.evaluationPrompt.length > 80
          ? rule.evaluationPrompt.slice(0, 80) + '…'
          : rule.evaluationPrompt
        result.push({
          policyName: name,
          label: `AI evaluation: "${truncated}"`,
          chipColor: 'lavender' as const,
        })
      }
    }
    return result
  }, [activeNames, byName])

  if (loadErr) {
    return (
      <p className="text-[11px] text-vermillion">Could not load policies catalog.</p>
    )
  }

  if (activeNames.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <p className="text-[13px] text-[var(--fog)]/70">
          No guardrails configured.
        </p>
        <Link
          href="/admin/guardrails"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo hover:underline"
        >
          {t('agent.guardrails.editLink')}
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {chips.length === 0 ? (
          <p className="text-[11px] text-[var(--fog)]/55 italic">No active rules with recognized patterns.</p>
        ) : (
          chips.map((chip, idx) => (
            <div
              key={`${chip.policyName}-${idx}`}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed"
              style={{
                borderColor: `var(--${chip.chipColor}, #888)`,
                backgroundColor: `color-mix(in srgb, var(--${chip.chipColor}, #888) 12%, transparent)`,
                color: 'var(--mist)',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: `var(--${chip.chipColor})` }}
              />
              <span>{chip.label}</span>
            </div>
          ))
        )}
      </div>

      <Link
        href="/admin/guardrails"
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo hover:underline"
      >
        {t('agent.guardrails.editLink')}
        <ExternalLink className="w-3 h-3" />
      </Link>
    </div>
  )
}

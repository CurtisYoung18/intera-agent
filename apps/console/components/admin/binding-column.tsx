'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, Check, Plus } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'

interface VersionInfo {
  id: string
  name: string
  version: number
  isActive: boolean
}

interface BindingsStats {
  boundCount: number
  driftCount: number
  isBound: boolean
  isDrift: boolean
  otherVersionsBound: number
}

/**
 * Fetches and caches the selected version's capabilityBindings.
 * Returns bindings, loading state, and a mutate function.
 */
export function useCapabilityBindings(agentId: string | null) {
  const [bindings, setBindings] = useState<string>('{}')
  const [loading, setLoading] = useState(true)
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)

  const fetchConfig = useCallback(async () => {
    if (!agentId) { setLoading(false); return }
    setLoading(true)
    try {
      const r = await fetch(`/api/admin/agent?agentId=${agentId}`)
      const resp = await r.json(); const d = resp.data || resp
      if (d.config) {
        const raw = d.config.capabilityBindings
        if (typeof raw === 'string') {
          setBindings(raw)
        } else if (raw) {
          setBindings(JSON.stringify(raw))
        } else {
          setBindings('{}')
        }
        setVersionInfo({
          id: d.config.id,
          name: d.config.name,
          version: d.config.version,
          isActive: d.config.isActive,
        })
      }
    } catch {
      // quiet
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const saveBindings = useCallback(async (newBindings: string) => {
    if (!agentId) return
    setBindings(newBindings)
    try {
      await fetch(`/api/admin/agent?agentId=${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilityBindings: newBindings }),
      })
    } catch {
      // revert on error? For now, optimistic.
    }
  }, [agentId])

  return { bindings, loading, versionInfo, saveBindings, refresh: fetchConfig }
}

/**
 * Hook: fetches all agent configs to compute cross-version binding stats.
 */
export function useAllVersionBindings(agentId: string | null) {
  const [allBindings, setAllBindings] = useState<Map<string, { guardrails: Set<string>; tools: Set<string>; caseTypes: Set<string>; knowledge: Set<string> }>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!agentId) { setLoading(false); return }
    fetch('/api/admin/agent-configs').then(r => r.json()).then(d => d.data || d)
      .then(d => {
        const map = new Map<string, { guardrails: Set<string>; tools: Set<string>; caseTypes: Set<string>; knowledge: Set<string> }>()
        if (d.configs?.length) {
          for (const c of d.configs) {
            if (c.id === agentId) continue // skip current
            try {
              const raw = c.capabilityBindings
              const cb = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
              const gSet = new Set<string>()
              for (const hook of ['preTool', 'postTool', 'preFinalize'] as const) {
                for (const n of (cb.guardrails?.[hook] || [])) gSet.add(n)
              }
              map.set(c.id, {
                guardrails: gSet,
                tools: new Set(cb.tools || []),
                caseTypes: new Set(cb.caseTypes || []),
                knowledge: new Set(cb.knowledge || []),
              })
            } catch { /* */ }
          }
        }
        setAllBindings(map)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [agentId])

  return { allBindings, loading }
}

/**
 * Check if an item is bound to the current version.
 */
export function checkItemBinding(
  currentBindings: string,
  category: 'guardrails' | 'tools' | 'caseTypes' | 'knowledge',
  itemName: string,
  hook?: 'preTool' | 'postTool' | 'preFinalize',
  allBindings?: Map<string, { guardrails: Set<string>; tools: Set<string>; caseTypes: Set<string>; knowledge: Set<string> }>,
): BindingsStats {
  let isBound = false
  let isDrift = false
  let otherVersionsBound = 0

  try {
    const cb = JSON.parse(currentBindings || '{}')
    if (category === 'guardrails' && hook) {
      const arr = cb.guardrails?.[hook] || []
      isBound = arr.includes(itemName)
    } else if (category === 'guardrails') {
      const allG = [
        ...(cb.guardrails?.preTool || []),
        ...(cb.guardrails?.postTool || []),
        ...(cb.guardrails?.preFinalize || []),
      ]
      isBound = allG.includes(itemName)
    } else {
      const arr = cb[category] || []
      isBound = arr.includes(itemName)
    }
  } catch { /* */ }

  if (allBindings) {
    for (const [, b] of allBindings) {
      if (category === 'guardrails') {
        if (b.guardrails.has(itemName)) otherVersionsBound++
      } else {
        const set = b[category] as Set<string>
        if (set.has(itemName)) otherVersionsBound++
      }
    }
  }

  return { boundCount: isBound ? 1 : 0, driftCount: isDrift ? 1 : 0, isBound, isDrift, otherVersionsBound }
}

/**
 * Toggle binding for an item.
 */
export function toggleItemBinding(
  currentBindings: string,
  category: 'guardrails' | 'tools' | 'caseTypes' | 'knowledge',
  itemName: string,
  hook?: 'preTool' | 'postTool' | 'preFinalize',
): string {
  try {
    const cb = JSON.parse(currentBindings || '{}')
    // Ensure structure exists
    if (category === 'guardrails') {
      cb.guardrails = cb.guardrails || { preTool: [], postTool: [], preFinalize: [] }
      if (hook) {
        const arr: string[] = cb.guardrails[hook] || []
        const idx = arr.indexOf(itemName)
        if (idx >= 0) {
          arr.splice(idx, 1)
        } else {
          arr.push(itemName)
        }
        cb.guardrails[hook] = arr
      }
    } else {
      const arr: string[] = cb[category] || []
      const idx = arr.indexOf(itemName)
      if (idx >= 0) {
        arr.splice(idx, 1)
      } else {
        arr.push(itemName)
      }
      cb[category] = arr
    }
    return JSON.stringify(cb)
  } catch {
    // Return new bindings
    const cb: Record<string, unknown> = { guardrails: { preTool: [], postTool: [], preFinalize: [] }, tools: [], caseTypes: [], knowledge: [] }
    if (category === 'guardrails' && hook) {
      (cb.guardrails as Record<string, string[]>)[hook] = [itemName]
    } else if (category !== 'guardrails') {
      cb[category] = [itemName]
    }
    return JSON.stringify(cb)
  }
}

/**
 * Compact binding indicator button for use in library page cards.
 */
export function BindingIndicator({
  isBound,
  isDrift,
  otherVersionsBound,
  onToggle,
  disabled,
}: {
  isBound: boolean
  isDrift: boolean
  otherVersionsBound: number
  onToggle: () => void
  disabled?: boolean
}) {
  const { t } = useConsoleLocale()

  if (isDrift) {
    return (
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-md border border-amber/20 bg-amber/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-amber hover:bg-amber/[0.12] transition-colors disabled:opacity-50"
        title={t('binding.driftTitle', { n: otherVersionsBound })}
      >
        <AlertTriangle className="w-3 h-3" />
        <span>{t('binding.drift')}</span>
      </button>
    )
  }

  if (isBound) {
    return (
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-md border border-malachite/20 bg-malachite/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-malachite hover:bg-malachite/[0.12] transition-colors disabled:opacity-50"
        title={t('binding.boundTitle')}
      >
        <Check className="w-3 h-3" />
        <span>{t('binding.bound')}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border border-black/[0.06] bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-[var(--fog)] hover:bg-indigo/[0.06] hover:border-indigo/20 hover:text-indigo transition-colors disabled:opacity-50"
      title={t('binding.unboundTitle')}
    >
      <Plus className="w-3 h-3" />
      <span>{t('binding.unbound')}</span>
    </button>
  )
}

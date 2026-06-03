'use client'

import { useState, useEffect, useCallback } from 'react'
import { GitBranch, Loader2, AlertCircle } from 'lucide-react'
import AgentVersionPicker from '@/components/admin/agent-version-picker'
import { useConsoleLocale } from '@/components/locale-provider'

interface VersionInfo {
  id: string
  name: string
  version: number
  isActive: boolean
}

interface VersionContextBarProps {
  /** Called when a new version is selected from the picker. */
  onVersionChange?: (agentId: string) => void
}

/**
 * Narrow version context bar showing "正在编排：客服Agent · v3（草稿）"
 * Reads the selected agent ID from localStorage, fetches version info,
 * and allows switching via AgentVersionPicker click.
 */
export default function VersionContextBar({ onVersionChange }: VersionContextBarProps) {
  const { t } = useConsoleLocale()
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickerRefreshKey, setPickerRefreshKey] = useState(0)

  const fetchVersionInfo = useCallback(async (agentId: string) => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/agent-configs')
      const d = await r.json()
      if (d.configs?.length) {
        const found = d.configs.find((c: VersionInfo) => c.id === agentId)
        if (found) {
          setVersionInfo(found)
        } else {
          // Fall back to active version
          const active = d.configs.find((c: VersionInfo) => c.isActive)
          if (active) setVersionInfo(active)
        }
      }
    } catch {
      // quiet
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const stored = (() => { try { return localStorage.getItem('intera-agent-id') } catch { return null } })()
    if (stored) {
      fetchVersionInfo(stored)
    } else {
      // Fetch active
      fetch('/api/admin/agent-configs')
        .then(r => r.json())
        .then(d => {
          if (d.configs?.length) {
            const active = d.configs.find((c: VersionInfo) => c.isActive) ?? d.configs[0]
            setVersionInfo(active)
            try { localStorage.setItem('intera-agent-id', active.id) } catch { /* */ }
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
  }, [fetchVersionInfo])

  const handleVersionChange = (id: string) => {
    try { localStorage.setItem('intera-agent-id', id) } catch { /* */ }
    fetchVersionInfo(id)
    setPickerRefreshKey(k => k + 1)
    onVersionChange?.(id)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-[11px] text-[var(--fog)] bg-white/40 border-b border-black/[0.04]">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>{t('common.loading')}</span>
      </div>
    )
  }

  if (!versionInfo) return null

  const isActive = versionInfo.isActive

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 bg-white/40 border-b border-black/[0.04] text-[12px]">
      <span className="text-[var(--fog)] font-medium">
        {t('binding.editingVersion')}
      </span>
      <AgentVersionPicker
        key={pickerRefreshKey}
        agentId={versionInfo.id}
        onChange={handleVersionChange}
        onAgentsChanged={() => setPickerRefreshKey(k => k + 1)}
      />
      {isActive && (
        <span className="flex items-center gap-1 rounded-full bg-vermillion/[0.08] border border-vermillion/15 px-2 py-0.5 text-[10px] font-semibold text-vermillion">
          <AlertCircle className="w-3 h-3" />
          {t('binding.liveWarning')}
        </span>
      )}
    </div>
  )
}

/**
 * Hook: returns the currently selected agent ID from localStorage.
 */
export function useSelectedAgentId(): string | null {
  const [agentId, setAgentId] = useState<string | null>(null)

  useEffect(() => {
    const stored = (() => { try { return localStorage.getItem('intera-agent-id') } catch { return null } })()
    if (stored) setAgentId(stored)
  }, [])

  return agentId
}

/**
 * Returns whether the currently selected version is the live/active version.
 * Used to guard against editing live versions.
 */
export function useIsActiveVersion(agentId: string | null): boolean {
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    if (!agentId) return
    fetch('/api/admin/agent-configs')
      .then(r => r.json())
      .then(d => {
        if (d.configs?.length) {
          const found = d.configs.find((c: VersionInfo) => c.id === agentId)
          setIsActive(found?.isActive ?? false)
        }
      })
      .catch(() => {})
  }, [agentId])

  return isActive
}

/**
 * Hook: returns full version info for the given agentId.
 */
export function useVersionInfo(agentId: string | null): VersionInfo | null {
  const [info, setInfo] = useState<VersionInfo | null>(null)

  useEffect(() => {
    if (!agentId) return
    fetch('/api/admin/agent-configs')
      .then(r => r.json())
      .then(d => {
        if (d.configs?.length) {
          const found = d.configs.find((c: VersionInfo) => c.id === agentId)
          if (found) setInfo(found)
        }
      })
      .catch(() => {})
  }, [agentId])

  return info
}

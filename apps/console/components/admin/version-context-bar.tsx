'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import AgentVersionPicker from '@/components/admin/agent-version-picker'
import { useConsoleLocale } from '@/components/locale-provider'
import { useAgentContext } from '@/lib/agent/agent-context'

interface VersionInfo {
  id: string
  name: string
  version: number
  isActive: boolean
}

interface VersionContextBarProps {
  /** @deprecated No longer needed — context propagates reactively. Kept for backward compat. */
  onVersionChange?: (agentId: string) => void
}

/**
 * Narrow version context bar showing "正在编排：客服Agent · v3（草稿）".
 * Reads the selected agent ID from AgentContext (reactive, no localStorage).
 */
export default function VersionContextBar({ onVersionChange }: VersionContextBarProps) {
  const { t } = useConsoleLocale()
  const { selectedAgentId, selectAgent, agentConfigs } = useAgentContext()
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickerRefreshKey, setPickerRefreshKey] = useState(0)

  const fetchVersionInfo = useCallback(async (agentId: string) => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/agent-configs')
      const d = await r.json()
      const configs = d.data?.configs ?? d.configs
      if (configs?.length) {
        const found = configs.find((c: VersionInfo) => c.id === agentId)
        if (found) {
          setVersionInfo(found)
        } else {
          const active = configs.find((c: VersionInfo) => c.isActive)
          if (active) setVersionInfo(active)
        }
      }
    } catch {
      // quiet
    } finally {
      setLoading(false)
    }
  }, [])

  // Sync versionInfo from context — reactive, no localStorage polling
  useEffect(() => {
    if (selectedAgentId) {
      // Try local configs first (instant), then fetch from API
      const local = agentConfigs.find((c) => c.id === selectedAgentId) as VersionInfo | undefined
      if (local) {
        setVersionInfo(local)
        setLoading(false)
      } else {
        fetchVersionInfo(selectedAgentId)
      }
    } else if (agentConfigs.length > 0) {
      const active = agentConfigs.find((c) => c.isActive) ?? agentConfigs[0]
      setVersionInfo(active as VersionInfo)
      setLoading(false)
    }
  }, [selectedAgentId, agentConfigs, fetchVersionInfo])

  const handleVersionChange = (id: string) => {
    selectAgent(id)
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
    </div>
  )
}

/**
 * Hook: returns the currently selected agent ID — now reads from AgentContext (reactive).
 */
export function useSelectedAgentId(): string | null {
  const { selectedAgentId } = useAgentContext()
  return selectedAgentId
}

/**
 * Returns whether the currently selected version is the live/active version.
 */
export function useIsActiveVersion(agentId: string | null): boolean {
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    if (!agentId) return
    fetch('/api/admin/agent-configs')
      .then(r => r.json())
      .then(d => {
        const configs = d.data?.configs ?? d.configs
        if (configs?.length) {
          const found = configs.find((c: VersionInfo) => c.id === agentId)
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
        const configs = d.data?.configs ?? d.configs
        if (configs?.length) {
          const found = configs.find((c: VersionInfo) => c.id === agentId)
          if (found) setInfo(found)
        }
      })
      .catch(() => {})
  }, [agentId])

  return info
}

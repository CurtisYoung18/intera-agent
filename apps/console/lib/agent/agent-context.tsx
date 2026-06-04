'use client'

// Reactive agent selection context — single source of truth replacing
// scattered localStorage reads/writes and window.location.reload() hacks.
//
// Every admin component reads selectedAgentId from this context. When any
// component calls selectAgent(id), all subscribers re-render immediately.

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

interface AgentInfo {
  id: string
  name: string
  version: number
  isActive: boolean
}

interface AgentContextValue {
  /** Currently selected agent config ID. null during initial load. */
  selectedAgentId: string | null
  /** All agent configs for the current org. */
  agentConfigs: AgentInfo[]
  /** True during initial fetch. */
  loading: boolean
  /** Non-null when the initial load or a refresh fails. */
  loadError: string | null
  /** Select an agent — updates context state AND persists to localStorage. */
  selectAgent: (id: string) => void
  /** Re-fetch agent configs list (after fork/activate/delete). */
  refreshConfigs: () => Promise<void>
  /** Clear loadError and re-fetch. */
  retryLoad: () => void
}

const AgentContext = createContext<AgentContextValue | null>(null)

const LS_KEY = 'intera-agent-id'

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agentConfigs, setAgentConfigs] = useState<AgentInfo[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const fetchConfigs = useCallback(async () => {
    const r = await fetch('/api/admin/agent-configs')
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      throw new Error(
        (typeof d.error === 'string' ? d.error : d.error?.message) || 'Failed to load agent configs',
      )
    }
    const d = await r.json()
    return (d.data?.configs ?? d.configs ?? []) as AgentInfo[]
  }, [])

  const doLoad = useCallback(async () => {
    const configs = await fetchConfigs()
    setAgentConfigs(configs)
    setLoadError(null)
    const stored = (() => { try { return localStorage.getItem(LS_KEY) } catch { return null } })()
    if (configs.length > 0) {
      if (stored && configs.find((c) => c.id === stored)) {
        setSelectedAgentId(stored)
      } else {
        const active = configs.find((c) => c.isActive) ?? configs[0]
        setSelectedAgentId(active.id)
      }
    }
  }, [fetchConfigs])

  // Initial load: fetch configs + resolve selected from localStorage
  useEffect(() => {
    let cancelled = false
    doLoad()
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Network error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [doLoad])

  const selectAgent = useCallback((id: string) => {
    try { localStorage.setItem(LS_KEY, id) } catch { /* ignore */ }
    setSelectedAgentId(id)
  }, [])

  const refreshConfigs = useCallback(async () => {
    try {
      const configs = await fetchConfigs()
      setAgentConfigs(configs)
      setLoadError(null)
      setSelectedAgentId((prev) => {
        if (prev && configs.find((c) => c.id === prev)) return prev
        const active = configs.find((c) => c.isActive) ?? configs[0]
        if (active) {
          try { localStorage.setItem(LS_KEY, active.id) } catch { /* */ }
          return active.id
        }
        return prev
      })
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to refresh agent configs')
    }
  }, [fetchConfigs])

  const retryLoad = useCallback(() => {
    setLoadError(null)
    setLoading(true)
    doLoad()
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Network error')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [doLoad])

  return (
    <AgentContext.Provider value={{ selectedAgentId, agentConfigs, loading, loadError, selectAgent, refreshConfigs, retryLoad }}>
      {children}
    </AgentContext.Provider>
  )
}

export function useAgentContext(): AgentContextValue {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error('useAgentContext must be used within AgentProvider')
  return ctx
}

/** Drop-in replacement for the old localStorage-based useSelectedAgentId. */
export function useSelectedAgentId(): string | null {
  const { selectedAgentId } = useAgentContext()
  return selectedAgentId
}

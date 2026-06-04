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
  /** Select an agent — updates context state AND persists to localStorage. */
  selectAgent: (id: string) => void
  /** Re-fetch agent configs list (after fork/activate/delete). */
  refreshConfigs: () => Promise<void>
}

const AgentContext = createContext<AgentContextValue | null>(null)

const LS_KEY = 'intera-agent-id'

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agentConfigs, setAgentConfigs] = useState<AgentInfo[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchConfigs = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/agent-configs')
      const d = await r.json()
      if (d.configs?.length) {
        setAgentConfigs(d.configs)
        return d.configs as AgentInfo[]
      }
    } catch { /* ignore */ }
    return null
  }, [])

  // Initial load: fetch configs + resolve selected from localStorage
  useEffect(() => {
    let cancelled = false
    fetchConfigs().then((configs) => {
      if (cancelled || !configs) return
      const stored = (() => { try { return localStorage.getItem(LS_KEY) } catch { return null } })()
      if (stored && configs.find((c) => c.id === stored)) {
        setSelectedAgentId(stored)
      } else if (configs.length > 0) {
        // Fall back to active, then first
        const active = configs.find((c) => c.isActive) ?? configs[0]
        setSelectedAgentId(active.id)
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [fetchConfigs])

  const selectAgent = useCallback((id: string) => {
    try { localStorage.setItem(LS_KEY, id) } catch { /* ignore */ }
    setSelectedAgentId(id)
  }, [])

  const refreshConfigs = useCallback(async () => {
    const configs = await fetchConfigs()
    if (configs) {
      // If the current selection is no longer in the list, fall back
      setSelectedAgentId((prev) => {
        if (prev && configs.find((c) => c.id === prev)) return prev
        const active = configs.find((c) => c.isActive) ?? configs[0]
        if (active) {
          try { localStorage.setItem(LS_KEY, active.id) } catch { /* */ }
          return active.id
        }
        return prev
      })
    }
  }, [fetchConfigs])

  return (
    <AgentContext.Provider value={{ selectedAgentId, agentConfigs, loading, selectAgent, refreshConfigs }}>
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

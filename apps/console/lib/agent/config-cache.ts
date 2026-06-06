// AgentConfig + CaseType cache — per-agentConfigId, TTL-based
// Used by messages/route.ts to avoid DB hammering.
// Invalidated by POST /api/admin/config-changed when admin saves config.

import type { AgentConfigData } from '@intera/shared/types'

const TTL_MS = 30_000

const cache = new Map<string, { config: AgentConfigData; timestamp: number }>()

function cacheKey(agentId?: string): string {
  return agentId || '__default__'
}

export function getCachedConfig(agentId?: string): AgentConfigData | null {
  const key = cacheKey(agentId)
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry.config
}

export function setCachedConfig(agentId: string | undefined, config: AgentConfigData): void {
  const key = cacheKey(agentId)
  cache.set(key, { config, timestamp: Date.now() })
}

export function clearConfigCache(agentConfigId?: string): void {
  if (agentConfigId) {
    cache.delete(cacheKey(agentConfigId))
    clearCaseTypeCache(agentConfigId)
  } else {
    cache.clear()
    clearCaseTypeCache()
  }
}

// ── Case Type list cache (used by intent classifier) ──

export interface CachedCaseType {
  type: string
  displayName: string
  description: string | null
  icon: string
  requiredFacts: string[]
  defaultGoal: string
}

const caseTypeCache = new Map<string, { types: CachedCaseType[]; timestamp: number }>()

export function getCachedCaseTypes(agentConfigId: string): CachedCaseType[] | null {
  const entry = caseTypeCache.get(agentConfigId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > TTL_MS) {
    caseTypeCache.delete(agentConfigId)
    return null
  }
  return entry.types
}

export function setCachedCaseTypes(agentConfigId: string, types: CachedCaseType[]): void {
  caseTypeCache.set(agentConfigId, { types, timestamp: Date.now() })
}

export function clearCaseTypeCache(agentConfigId?: string): void {
  if (agentConfigId) {
    caseTypeCache.delete(agentConfigId)
  } else {
    caseTypeCache.clear()
  }
}

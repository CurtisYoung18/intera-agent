// AgentConfig + CaseType cache — per-customer, TTL-based
// Used by messages/route.ts and human-chat/route.ts to avoid DB hammering.
// Invalidated by POST /api/admin/config-changed when admin saves config.

import type { AgentConfigData } from '@intera/shared/types'

const TTL_MS = 30_000

const cache = new Map<string, { config: AgentConfigData; timestamp: number }>()

function cacheKey(orgId: string, agentId?: string): string {
  return agentId ? `${orgId}::${agentId}` : orgId
}

export function getCachedConfig(orgId: string, agentId?: string): AgentConfigData | null {
  const key = cacheKey(orgId, agentId)
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry.config
}

export function setCachedConfig(orgId: string, config: AgentConfigData, agentId?: string): void {
  const key = cacheKey(orgId, agentId)
  cache.set(key, { config, timestamp: Date.now() })
}

export function clearConfigCache(orgId?: string, agentId?: string): void {
  if (orgId) {
    const key = cacheKey(orgId, agentId)
    cache.delete(key)
    clearCaseTypeCache(orgId)
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

export function getCachedCaseTypes(orgId: string): CachedCaseType[] | null {
  const entry = caseTypeCache.get(orgId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > TTL_MS) {
    caseTypeCache.delete(orgId)
    return null
  }
  return entry.types
}

export function setCachedCaseTypes(orgId: string, types: CachedCaseType[]): void {
  caseTypeCache.set(orgId, { types, timestamp: Date.now() })
}

export function clearCaseTypeCache(orgId?: string): void {
  if (orgId) {
    caseTypeCache.delete(orgId)
  } else {
    caseTypeCache.clear()
  }
}

// AgentConfig + CaseType cache — per-customer, TTL-based
// Used by messages/route.ts and human-chat/route.ts to avoid DB hammering.
// Invalidated by POST /api/admin/config-changed when admin saves config.

import type { AgentConfigData } from '@intera/shared/types'

const TTL_MS = 30_000

const cache = new Map<string, { config: AgentConfigData; timestamp: number }>()

export function getCachedConfig(customerId: string): AgentConfigData | null {
  const entry = cache.get(customerId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(customerId)
    return null
  }
  return entry.config
}

export function setCachedConfig(customerId: string, config: AgentConfigData): void {
  cache.set(customerId, { config, timestamp: Date.now() })
}

export function clearConfigCache(customerId?: string): void {
  if (customerId) {
    cache.delete(customerId)
    clearCaseTypeCache(customerId)
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

export function getCachedCaseTypes(customerId: string): CachedCaseType[] | null {
  const entry = caseTypeCache.get(customerId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > TTL_MS) {
    caseTypeCache.delete(customerId)
    return null
  }
  return entry.types
}

export function setCachedCaseTypes(customerId: string, types: CachedCaseType[]): void {
  caseTypeCache.set(customerId, { types, timestamp: Date.now() })
}

export function clearCaseTypeCache(customerId?: string): void {
  if (customerId) {
    caseTypeCache.delete(customerId)
  } else {
    caseTypeCache.clear()
  }
}

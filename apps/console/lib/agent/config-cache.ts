// AgentConfig + CaseType cache — per-customer, TTL-based
// Used by messages/route.ts and human-chat/route.ts to avoid DB hammering.
// Invalidated by POST /api/admin/config-changed when admin saves config.

import type { AgentConfigData } from '@intera/shared/types'

const TTL_MS = 30_000

const cache = new Map<string, { config: AgentConfigData; timestamp: number }>()

export function getCachedConfig(orgId: string): AgentConfigData | null {
  const entry = cache.get(orgId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(orgId)
    return null
  }
  return entry.config
}

export function setCachedConfig(orgId: string, config: AgentConfigData): void {
  cache.set(orgId, { config, timestamp: Date.now() })
}

export function clearConfigCache(orgId?: string): void {
  if (orgId) {
    cache.delete(orgId)
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

// AgentConfig + CaseType cache — per-customer, TTL-based
// Used by messages/route.ts and human-chat/route.ts to avoid DB hammering.
// Invalidated by POST /api/admin/config-changed when admin saves config.

import type { AgentConfigData } from '@intera/shared/types'

const TTL_MS = 30_000

const cache = new Map<string, { config: AgentConfigData; timestamp: number }>()

export function getCachedConfig(vendorId: string): AgentConfigData | null {
  const entry = cache.get(vendorId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(vendorId)
    return null
  }
  return entry.config
}

export function setCachedConfig(vendorId: string, config: AgentConfigData): void {
  cache.set(vendorId, { config, timestamp: Date.now() })
}

export function clearConfigCache(vendorId?: string): void {
  if (vendorId) {
    cache.delete(vendorId)
    clearCaseTypeCache(vendorId)
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

export function getCachedCaseTypes(vendorId: string): CachedCaseType[] | null {
  const entry = caseTypeCache.get(vendorId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > TTL_MS) {
    caseTypeCache.delete(vendorId)
    return null
  }
  return entry.types
}

export function setCachedCaseTypes(vendorId: string, types: CachedCaseType[]): void {
  caseTypeCache.set(vendorId, { types, timestamp: Date.now() })
}

export function clearCaseTypeCache(vendorId?: string): void {
  if (vendorId) {
    caseTypeCache.delete(vendorId)
  } else {
    caseTypeCache.clear()
  }
}

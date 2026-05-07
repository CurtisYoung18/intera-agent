// Session Memory Compact — reuse persisted CaseMemory summary instead of
// calling LLM for compaction.
// Based on Claude Code's services/compact/sessionMemoryCompact.ts:
//   - Does NOT call the model — reads existing summary from disk (DB in our case)
//   - Falls back to traditional compact if summary is missing or stale
//   - Free operation — skips the LLM API call entirely

import type { MemoryStrategy } from '@intera/shared/types'

export interface SessionMemoryCompactResult {
  used: boolean
  reason?: string
}

/**
 * Check whether we can reuse an existing persisted summary instead of
 * triggering a new compaction cycle. The summary must be:
 *   1. Non-empty
 *   2. Generated within maxAgeMs (default 30 minutes)
 *
 * If conditions are met, the caller skips message trimming and LLM summary
 * generation — the existing summary is already in CaseMemoryManager and
 * will be prepended by buildApiMessages().
 */
export function trySessionMemoryCompact(
  existingSummary: string | null | undefined,
  lastCompactedAt: Date | null | undefined,
  maxAgeMs: number = 1800000,
): SessionMemoryCompactResult {
  if (!existingSummary || existingSummary.length === 0) {
    return { used: false, reason: 'no_existing_summary' }
  }

  if (lastCompactedAt) {
    const ageMs = Date.now() - lastCompactedAt.getTime()
    if (ageMs > maxAgeMs) {
      return { used: false, reason: 'summary_stale' }
    }
  }

  return { used: true }
}

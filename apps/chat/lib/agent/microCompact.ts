// MicroCompact — local tool result cleanup before LLM compaction
// Based on Claude Code's services/compact/microCompact.ts patterns:
//   Path 1 (Time-based): clear old tool results when user was away (cache expired)
//   Path 2 (Count-based): clear tool results when compaction triggers
// Zero API cost — pure local message manipulation.

import type { Message, MemoryStrategy } from '@intera/shared/types'

export const CLEARED_MESSAGE = '[Old tool result content cleared]'

export interface MicroCompactResult {
  messages: Message[]
  tokensSaved: number
  clearedCount: number
}

/**
 * Scan messages for tool results from compactable tools (from strategy.compactableTools)
 * and replace their content with a placeholder. Does NOT mutate original messages.
 *
 * Token saving estimate uses strategy.toolResultTokenRatio (default 3:1 chars/token).
 *
 * @param minAgeMs - Skip messages younger than this (default 60000 = 1 minute).
 *   Prevents clearing tool results that are still in the prompt cache (5-min TTL).
 *   Set higher for consultation mode where context continuity is critical.
 */
export function microCompact(
  messages: Message[],
  compactableTools: string[],
  tokenRatio: number,
  minAgeMs: number = 60000,
): MicroCompactResult {
  if (compactableTools.length === 0) {
    return { messages, tokensSaved: 0, clearedCount: 0 }
  }

  const pattern = new RegExp(`^Tool (${compactableTools.join('|')}) result:`)
  const now = Date.now()
  let tokensSaved = 0
  let clearedCount = 0

  const newMessages = messages.map((msg) => {
    if (msg.role !== 'assistant') return msg
    if (typeof msg.content !== 'string') return msg

    if (pattern.test(msg.content)) {
      // Guard: don't clear tool results that are still fresh (prompt cache may still be warm)
      const msgAge = msg.createdAt ? now - new Date(msg.createdAt).getTime() : Infinity
      if (msgAge < minAgeMs) return msg

      clearedCount++
      tokensSaved += Math.ceil(msg.content.length / tokenRatio)
      return { ...msg, content: CLEARED_MESSAGE }
    }

    return msg
  })

  return { messages: newMessages, tokensSaved, clearedCount }
}

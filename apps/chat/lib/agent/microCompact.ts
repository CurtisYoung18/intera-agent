// MicroCompact — local tool result cleanup before LLM compaction
// Based on Claude Code's services/compact/microCompact.ts patterns:
//   Path 1 (Time-based): clear old tool results when user was away (cache expired)
//   Path 2 (Count-based): clear tool results when compaction triggers
// Zero API cost — pure local message manipulation.

import type { Message } from '@intera/shared/types'

// Tools whose results can be safely cleared without losing case state.
// Non-compactable tools (request_user_input, create_human_task, finalize_case,
// finalize_consultation) are excluded — their results are critical for the agent.
export const COMPACTABLE_TOOLS = new Set([
  'query_order_status',
  'query_payment_channel_status',
  'search_delay_notice',
  'read_case_history',
  'kb_hybrid_retrieve',
  'ocr_receipt',
])

export const CLEARED_MESSAGE = '[Old tool result content cleared]'

// Build a regex that matches any compactable tool name
const TOOL_RESULT_PATTERN = new RegExp(
  `^Tool (${[...COMPACTABLE_TOOLS].join('|')}) result:`,
)

export interface MicroCompactResult {
  messages: Message[]
  tokensSaved: number
  clearedCount: number
}

/**
 * Scan messages for tool results from compactable tools and replace their
 * content with a placeholder. Does NOT mutate original messages — returns a
 * new array.
 *
 * Token saving estimate: 3 chars ≈ 1 token (Latin), 1.2 chars ≈ 1 token (CJK).
 * We use a conservative 3:1 ratio since tool results are mostly JSON/Latin.
 */
export function microCompact(messages: Message[]): MicroCompactResult {
  let tokensSaved = 0
  let clearedCount = 0

  const newMessages = messages.map((msg) => {
    if (msg.role !== 'assistant') return msg
    if (typeof msg.content !== 'string') return msg

    // Match "Tool <name> result: <json>"
    if (TOOL_RESULT_PATTERN.test(msg.content)) {
      clearedCount++
      const originalLength = msg.content.length
      tokensSaved += Math.ceil(originalLength / 3)
      return { ...msg, content: CLEARED_MESSAGE }
    }

    return msg
  })

  return { messages: newMessages, tokensSaved, clearedCount }
}

// S1 — Tool-Result Invariant
//
// Guarantees: for every tool_use block the model emits, exactly one tool_result
// block with the same tool_use_id is present in the next user message sent to
// the LLM API.
//
// If we cannot produce a real result, we synthesize one. We never call the API
// with an unmatched tool_use.
//
// Based on Claude Code's yieldMissingToolResultBlocks + createSyntheticErrorMessage.

import type { ToolUse } from '@intera/shared/types'

// ── Synthesis reason ────────────────────────────────────────────────────

export type SynthesisReason =
  | 'policy_blocked'
  | 'policy_escalated'
  | 'incomplete_tool_use'
  | 'stream_aborted'
  | 'loop_terminated'
  | 'sibling_error'

const ERROR_MESSAGES: Record<SynthesisReason, string> = {
  policy_blocked:
    'Tool blocked by policy. See the follow-up message for details.',
  policy_escalated:
    'Tool escalated by guardrail policy. A human task has been created.',
  incomplete_tool_use:
    '<tool_use_error>Tool input was truncated by a connection error. Please re-invoke with complete input.</tool_use_error>',
  stream_aborted:
    '<tool_use_error>The stream ended before this tool could execute. The conversation will continue.</tool_use_error>',
  loop_terminated:
    '<tool_use_error>The agent loop terminated before this tool completed.</tool_use_error>',
  sibling_error:
    '<tool_use_error>Cancelled: a sibling tool call errored.</tool_use_error>',
}

// ── Tool result block shape ─────────────────────────────────────────────

export interface ToolResultBlock {
  tool_use_id: string
  type: 'tool_result'
  content?: string
  is_error?: boolean
}

// ── Input to synthesis ──────────────────────────────────────────────────

export interface SynthesisInput {
  toolUses: ToolUse[]
  completedResults: Array<{ toolUseId: string; output: unknown; isError: boolean }>
  missingReasons: Map<string, SynthesisReason>
}

// ── synthesizeMissingToolResults ────────────────────────────────────────

export function synthesizeMissingToolResults(input: SynthesisInput): ToolResultBlock[] {
  const completed = new Map(
    input.completedResults.map((r) => [r.toolUseId, r]),
  )

  return input.toolUses.map((tu) => {
    const result = completed.get(tu.id)
    if (result) {
      return {
        tool_use_id: tu.id,
        type: 'tool_result' as const,
        content: typeof result.output === 'string'
          ? result.output
          : JSON.stringify(result.output),
        is_error: result.isError,
      }
    }

    const reason = input.missingReasons.get(tu.id)
    if (!reason) {
      throw new Error(
        `[Invariant] tool_use_id "${tu.id}" (${tu.name}) has neither a completed result nor a missing reason. ` +
        'This is a programmer error — every tool_use must produce or synthesize a result.',
      )
    }

    return {
      tool_use_id: tu.id,
      type: 'tool_result' as const,
      content: ERROR_MESSAGES[reason],
      is_error: true,
    }
  })
}

// ── assertToolResultInvariant ───────────────────────────────────────────

interface MessageLike {
  role: string
  content: unknown
  toolUses?: ToolUse[]
}

/**
 * Walks the message list and checks that every tool_use in every assistant
 * message has a matching tool_result in the messages that follow.
 * Throws with the unmatched tool_use_id if invariant is broken.
 */
export function assertToolResultInvariant(messages: MessageLike[]): void {
  // Collect all tool_use_ids from assistant messages
  const pending = new Map<string, string>() // tool_use_id → tool name

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolUses) {
      for (const tu of msg.toolUses) {
        pending.set(tu.id, tu.name)
      }
    }

    if (msg.role === 'user') {
      // Check if this user message contains tool_result blocks
      const content = msg.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && 'tool_use_id' in block) {
            pending.delete(String(block.tool_use_id))
          }
        }
      }
    }
  }

  if (pending.size > 0) {
    const ids = [...pending.entries()].map(([id, name]) => `${id} (${name})`).join(', ')
    throw new Error(`[Invariant] unmatched tool_use blocks: ${ids}`)
  }
}

// ── Feature gate ────────────────────────────────────────────────────────

export function isInvariantCheckEnabled(): boolean {
  if (typeof process === 'undefined') return false
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') return true
  return process.env.INTERA_INVARIANT_CHECK === '1'
}

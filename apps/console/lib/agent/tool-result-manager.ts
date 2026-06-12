// Tool Result Manager — unified message format for tool results.
//
// Guarantees every tool result is delivered to the LLM as a user message
// with structured `tool_result` content blocks (Anthropic API format),
// regardless of whether the tool succeeded, failed, or was held by a Hook.
//
// This replaces the legacy `addToolResultMessages` (assistant text format)
// which caused the model to terminate prematurely on tool errors.

import type { Message, ToolUse } from '@intera/shared/types'
import { unwrapToolExecutionPayload, type ToolExecutionResult } from './streaming-tool-executor'
import type { ToolResultBlock } from './tool-result-invariant'
import { makeProviderMeta, toolResultProviderContent } from './provider-transcript'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build Anthropic API-format user messages for all tool results.
 *
 * Each result becomes a user message containing a `tool_result` content block.
 * The model sees structured error/success data instead of raw JSON strings,
 * enabling better reasoning about failures and retries.
 */
export function buildToolResultMessages(results: ToolExecutionResult[]): Message[] {
  if (results.length === 0) return []

  const blocks: ToolResultBlock[] = results.map((r) => ({
    tool_use_id: r.toolUse?.id ?? r.name,
    type: 'tool_result' as const,
    content: typeof unwrapToolExecutionPayload(r.output) === 'string'
      ? unwrapToolExecutionPayload(r.output) as string
      : JSON.stringify(unwrapToolExecutionPayload(r.output)),
    is_error: (r.output as { ok?: boolean })?.ok === false,
  }))

  return [wrapAsUserMessage(blocks)]
}

/**
 * Build a user message from S1 synthesis output.
 * Used when missingReasons exist — wraps synthesizeMissingToolResults output.
 */
export function buildToolResultMessageFromSynthesis(synthesisBlocks: ToolResultBlock[]): Message {
  return wrapAsUserMessage(synthesisBlocks)
}

/**
 * Wrap a Hook feedback string as a user message.
 */
export function buildHookFeedbackMessage(feedback: string): Message {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: '',
    providerContent: [{ type: 'text', text: feedback }],
    providerMeta: makeProviderMeta({
      providerFamily: 'anthropic',
      visibility: 'internal',
      transcriptKind: 'hook_feedback',
    }),
    createdAt: new Date(),
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function wrapAsUserMessage(blocks: ToolResultBlock[]): Message {
  const toolUseIds = blocks.map((block) => block.tool_use_id)
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: '',
    providerContent: toolResultProviderContent(blocks),
    providerMeta: makeProviderMeta({
      providerFamily: 'anthropic',
      visibility: 'internal',
      transcriptKind: 'tool_result',
      toolUseIds,
    }),
    createdAt: new Date(),
  } as Message
}

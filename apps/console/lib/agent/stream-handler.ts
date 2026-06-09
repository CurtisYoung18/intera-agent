// Intera Harness - Stream Handler
// Shared SSE event parsing extracted from AgentLoop.run().
// Single source of truth for processing a streaming Anthropic API response:
// reads content blocks, handles text/tool_use/thinking, returns accumulated data.
//
// Business logic (Hook checks, tool enqueuing, trace writing) stays in the
// caller via callbacks — this module only parses events and accumulates state.

import Anthropic from '@anthropic-ai/sdk'
import type { AssistantMessage, SSEEvent, ToolUse } from '@intera/shared/types'

export function normalizeSSEEvent(event: SSEEvent): SSEEvent {
  return event
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamContentBlock {
  index: number
  type: 'text' | 'tool_use' | 'thinking'
  id: string
  name: string
  content: string
  completed: boolean
}

export interface StreamConsumeCallbacks {
  /** Emit an SSE event to the frontend (text_delta, thinking_delta, etc.). */
  sendEvent(event: SSEEvent): void

  /** Feed a text chunk through the text sanitizer; returns the clean portion. */
  sanitizeChunk(text: string): string

  /** Flush any remaining text held in the sanitizer's lookahead buffer. */
  flushSanitizer(): string

  /** Record the first token for profiling. */
  recordFirstToken(): void

  /** Whether to emit thinking_delta events to the frontend. */
  emitThinking: boolean

  /**
   * Called when a tool_use block completes (content_block_stop).
   * The callback is responsible for Hook checks, tool enqueuing,
   * and any related side effects (trace, missing reasons, events).
   *
   * @param toolUse The parsed tool_use block.
   * @param assistantMessage The assistant message accumulated so far during
   *   this stream iteration (may be null before message_start).
   */
  onToolUseCompleted(toolUse: ToolUse, assistantMessage: AssistantMessage | null): Promise<void>
}

export interface StreamConsumeOutput {
  assistantMessage: AssistantMessage | null
  fullText: string
  stopReason: string | null
  usage: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// Tool-input parsing (shared, guarded)
// ---------------------------------------------------------------------------

/**
 * Safely parse a tool_use block's accumulated input JSON.
 *
 * Tool input arrives as streamed `input_json_delta` fragments accumulated into
 * `block.content`. That string can be incomplete or malformed in normal
 * operation: `stop_reason:'max_tokens'` truncates a tool_use mid-stream, or a
 * non-Anthropic provider (MiniMax/DeepSeek) streams divergent partial_json.
 * Never throw on a bad payload — fall back to `{}` so the turn can synthesize an
 * error tool_result instead of crashing the whole turn (L6).
 */
export function parseToolInput(content: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(content || '{}')
  } catch {
    // Malformed/truncated JSON — caller runs the tool / synthesizes a result with empty input.
    return {}
  }
}

/**
 * Build the `ToolUse[]` used by the loop's post-stream S1 synthesis from the
 * accumulated content blocks. The stream handler does not populate
 * `assistantMessage.toolUses`, so the loop re-derives them from the blocks map.
 * Each input is parsed via the guarded {@link parseToolInput} — never throws.
 */
export function buildToolUsesFromBlocks(blocks: StreamContentBlock[]): ToolUse[] {
  return blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: parseToolInput(b.content) }))
}

// ---------------------------------------------------------------------------
// consumeStream
// ---------------------------------------------------------------------------

/**
 * Consume a streaming Anthropic response, parsing all SSE events into
 * accumulated state. Does NOT handle stream-level errors (abort, 413, etc.)
 * — those are caught by the caller's try/catch around this call.
 *
 * Mutates `blocks` in place so the caller can inspect parsed content blocks
 * after the stream completes (e.g. for S1 tool-result synthesis).
 */
export async function consumeStream(
  stream: ReturnType<Anthropic.Messages['stream']>,
  blocks: Map<number, StreamContentBlock>,
  cbs: StreamConsumeCallbacks,
): Promise<StreamConsumeOutput> {
  let assistantMessage: AssistantMessage | null = null
  let fullText = ''
  let stopReason: string | null = null
  let usage: Record<string, unknown> | null = null

  for await (const event of stream) {
    switch (event.type) {
      // ── message start ──────────────────────────────────────
      case 'message_start':
        assistantMessage = {
          id: event.message.id,
          role: 'assistant',
          content: '',
          createdAt: new Date(),
          isStreaming: true,
        }
        break

      // ── content block start ────────────────────────────────
      case 'content_block_start': {
        const b = event.content_block
        if (b.type === 'tool_use') {
          // Some Anthropic-compatible providers (MiniMax, DeepSeek) send the
          // complete tool input in content_block_start.input instead of
          // streaming it via input_json_delta events. Seed content from
          // b.input so those providers don't silently drop the input.
          const seedContent =
            b.input && typeof b.input === 'object' && Object.keys(b.input as Record<string, unknown>).length > 0
              ? JSON.stringify(b.input)
              : ''
          blocks.set(event.index, {
            index: event.index,
            type: 'tool_use',
            id: b.id,
            name: b.name,
            content: seedContent,
            completed: false,
          })
        } else if (b.type === 'text') {
          blocks.set(event.index, {
            index: event.index,
            type: 'text',
            id: '',
            name: '',
            content: '',
            completed: false,
          })
        } else if (b.type === 'thinking') {
          blocks.set(event.index, {
            index: event.index,
            type: 'thinking',
            id: '',
            name: '',
            content: '',
            completed: false,
          })
        }
        break
      }

      // ── content block delta ────────────────────────────────
      case 'content_block_delta': {
        const d = event.delta
        const cb = blocks.get(event.index)
        if (!cb) break

        if (d.type === 'text_delta') {
          if (!fullText) cbs.recordFirstToken()
          cb.content += d.text
          fullText += d.text
          const cleanChunk = cbs.sanitizeChunk(d.text)
          if (cleanChunk) {
            cbs.sendEvent({
              type: 'text_delta',
              data: cleanChunk,
              timestamp: new Date().toISOString(),
            })
          }
        } else if (d.type === 'input_json_delta') {
          cb.content += d.partial_json
        } else if (d.type === 'thinking_delta') {
          cb.content += d.thinking
          if (cbs.emitThinking) {
            cbs.sendEvent({
              type: 'thinking_delta',
              data: d.thinking,
              timestamp: new Date().toISOString(),
            })
          }
        }
        break
      }

      // ── content block stop ─────────────────────────────────
      case 'content_block_stop': {
        const stoppedBlock = blocks.get(event.index)
        if (!stoppedBlock) break
        stoppedBlock.completed = true

        if (stoppedBlock.type === 'tool_use') {
          const toolUse: ToolUse = {
            id: stoppedBlock.id,
            name: stoppedBlock.name,
            input: parseToolInput(stoppedBlock.content),
          }

          // Delegate all business logic to the caller
          await cbs.onToolUseCompleted(toolUse, assistantMessage)
        }
        break
      }

      // ── message delta (usage + stop_reason) ────────────────
      case 'message_delta': {
        const msgDelta = event as unknown as {
          type: 'message_delta'
          delta: { stop_reason?: string | null; usage?: Record<string, unknown> }
          usage?: Record<string, unknown>
        }
        const delta = msgDelta.delta
        if (delta?.stop_reason != null) {
          stopReason = delta.stop_reason
        }
        const mergedUsage = msgDelta.usage ?? delta?.usage
        if (mergedUsage) {
          usage = mergedUsage
        }
        break
      }

      // ── message stop ──────────────────────────────────────
      case 'message_stop': {
        const tail = cbs.flushSanitizer()
        if (tail) {
          cbs.sendEvent({ type: 'text_delta', data: tail, timestamp: new Date().toISOString() })
        }
        break
      }
    }
  }

  return { assistantMessage, fullText, stopReason, usage }
}

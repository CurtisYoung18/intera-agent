// Message construction utilities — extracted from AgentLoop.

import type { Message, ContentBlock, MemoryStrategy } from '@intera/shared/types'
import { unwrapToolExecutionPayload, type ToolExecutionResult } from './streaming-tool-executor'
import type { ChatMemoryManager } from './memory'

/** Build a user Message with random id and current timestamp. */
export function makeUserMessage(
  content: string,
  contentBlocks?: ContentBlock[],
): Message {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    contentBlocks,
    createdAt: new Date(),
  } as Message
}

/** Append tool result Messages to the messages array (in place). */
export function addToolResultMessages(
  messages: Message[],
  results: ToolExecutionResult[],
): void {
  for (const result of results) {
    const payload = unwrapToolExecutionPayload(result.output)
    messages.push({
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      content: `Tool ${result.name} result: ${JSON.stringify(payload)}`,
      createdAt: new Date(),
    } as Message)
  }
}

/** Build Anthropic-format messages array from recent conversation history. */
export function buildApiMessages(
  messages: Message[],
  chatMemory: ChatMemoryManager,
  memoryStrategy: MemoryStrategy,
): any {
  const limit = memoryStrategy.l1MaxMessages * 2
  const recentMessages = messages.slice(-limit)

  const toAnthropic = (msg: Message): { role: string; content: unknown } => {
    if (msg.contentBlocks?.length) {
      const blocks = []
      const hasTextBlock = msg.contentBlocks.some((b) => b.type === 'text' && b.text.trim())
      if (!hasTextBlock && typeof msg.content === 'string' && msg.content.trim()) {
        blocks.push({ type: 'text' as const, text: msg.content })
      }
      blocks.push(...msg.contentBlocks.map((b) => {
        if (b.type === 'text') return { type: 'text' as const, text: b.text }
        if (b.type === 'image') return { type: 'image' as const, source: { type: b.source.type, media_type: b.source.media_type, data: b.source.data } }
        return { type: 'text' as const, text: '' }
      }))
      return { role: msg.role, content: blocks }
    }
    // If this is an assistant message with tool_use blocks, build content
    // as an array of text + tool_use blocks (Anthropic API format).
    const toolUses = (msg as any).toolUses as Array<{ id: string; name: string; input: Record<string, unknown> }> | undefined
    if (toolUses?.length) {
      const blocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> = []
      if (msg.content) {
        blocks.push({ type: 'text', text: msg.content as string })
      }
      for (const tu of toolUses) {
        blocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
      }
      return { role: msg.role, content: blocks }
    }
    return { role: msg.role, content: msg.content }
  }

  if (chatMemory.hasSummary()) {
    const maxSummaryChars = memoryStrategy.l2SummaryMaxTokens * 3
    let summaryText = chatMemory.getSummary().summary || ''
    if (summaryText.length > maxSummaryChars) {
      summaryText = summaryText.slice(0, maxSummaryChars) + '...'
    }
    const summaryMsg = makeUserMessage(`[Case context from previous turns — use this to stay oriented]\n${summaryText}`)
    const apiSummary = toAnthropic(summaryMsg)
    return [apiSummary, ...recentMessages.map(toAnthropic)] as any
  }

  return recentMessages.map(toAnthropic) as any
}

// Message construction utilities — extracted from AgentLoop.

import type { Message, ContentBlock, MemoryStrategy } from '@intera/shared/types'
import { unwrapToolExecutionPayload, type ToolExecutionResult } from './streaming-tool-executor'
import type { ChatMemoryManager } from './memory'

function normalizeImageData(data: unknown): string | null {
  if (typeof data !== 'string') return null
  const trimmed = data.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^data:([^;,]+);base64,(.+)$/)
  return match ? match[2] : trimmed
}

function normalizeMediaType(mediaType: unknown): string | null {
  if (typeof mediaType !== 'string') return null
  const trimmed = mediaType.trim()
  if (!/^image\/[a-zA-Z0-9.+-]+$/.test(trimmed)) return null
  return trimmed
}

function flattenContentBlocks(input: unknown): unknown[] {
  if (!Array.isArray(input)) return []
  const out: unknown[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    out.push(value)
  }
  visit(input)
  return out
}

export function normalizeContentBlocks(input: unknown): ContentBlock[] | undefined {
  const blocks: ContentBlock[] = []
  for (const value of flattenContentBlocks(input)) {
    const block = value as any
    if (!block || typeof block !== 'object') continue

    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      blocks.push({ type: 'text', text: block.text })
      continue
    }

    if (block.type === 'image') {
      const source = block.source ?? {}
      const mediaType = normalizeMediaType(source.media_type)
      const data = normalizeImageData(source.data)
      if (source.type === 'base64' && mediaType && data) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data },
        })
      }
      continue
    }

    if (block.type === 'image_url') {
      const url = typeof block.image_url?.url === 'string' ? block.image_url.url : ''
      const match = url.match(/^data:([^;,]+);base64,(.+)$/)
      const mediaType = normalizeMediaType(match?.[1])
      const data = normalizeImageData(match?.[2])
      if (mediaType && data) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data },
        })
      }
    }
  }

  return blocks.length > 0 ? blocks : undefined
}

/** Build a user Message with random id and current timestamp. */
export function makeUserMessage(
  content: string,
  contentBlocks?: ContentBlock[],
): Message {
  const normalizedContentBlocks = normalizeContentBlocks(contentBlocks)
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    contentBlocks: normalizedContentBlocks,
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
    const contentBlocks = normalizeContentBlocks(msg.contentBlocks)
    if (contentBlocks?.length) {
      const blocks = []
      const hasTextBlock = contentBlocks.some((b) => b.type === 'text' && b.text.trim())
      if (!hasTextBlock && typeof msg.content === 'string' && msg.content.trim()) {
        blocks.push({ type: 'text' as const, text: msg.content })
      }
      blocks.push(...contentBlocks.map((b) => {
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

import type {
  Message,
  ProviderContentBlock,
  ProviderMeta,
  ProviderRepairReason,
  ProviderTranscriptKind,
  ProviderVisibility,
  ToolUse,
} from '@intera/shared/types'
import { persistableMessageText } from './persistable-message'

export interface TranscriptHealthMetrics {
  providerTranscriptPersisted: boolean
  toolPairsChecked: number
  toolPairsRepaired: number
  orphanToolResultsDropped: number
  legacyRowsSkipped: number
  compactPairsSummarized: number
  details: TranscriptHealthDetail[]
}

export interface TranscriptHealthDetail {
  event:
    | 'synthetic_repair'
    | 'orphan_drop'
    | 'duplicate_drop'
    | 'legacy_skip'
    | 'compact_pair_summary'
  toolUseId?: string
  toolName?: string
  messageId?: string
  repairReason?: ProviderRepairReason
  summary?: string
}

export interface MessagePersistenceRecord {
  id: string
  caseId: string
  role: string
  content: string
  contentBlocks?: unknown
  providerContent?: ProviderContentBlock[]
  providerMeta?: ProviderMeta
  isStreaming: boolean
}

export interface ProviderTranscriptPersistenceReceipt {
  providerTranscriptPersisted: boolean
  providerTranscriptMessageCount: number
  providerTranscriptBlockCount: number
}

export interface PersistableDbMessage {
  id: string
  role: string
  content: string | null
  contentBlocks?: unknown
  providerContent?: unknown
  providerMeta?: unknown
  createdAt: Date
}

const VISIBILITIES: ProviderVisibility[] = ['customer', 'operator', 'internal']
const TRANSCRIPT_KINDS: ProviderTranscriptKind[] = [
  'natural_message',
  'assistant_response',
  'tool_result',
  'hook_feedback',
  'synthetic_repair',
]
const REPAIR_REASONS: ProviderRepairReason[] = [
  'missing_tool_result',
  'orphan_tool_result',
  'legacy_row',
  'compact_boundary',
  'budget_replacement',
]

export function emptyTranscriptHealthMetrics(): TranscriptHealthMetrics {
  return {
    providerTranscriptPersisted: false,
    toolPairsChecked: 0,
    toolPairsRepaired: 0,
    orphanToolResultsDropped: 0,
    legacyRowsSkipped: 0,
    compactPairsSummarized: 0,
    details: [],
  }
}

export function mergeTranscriptHealthMetrics(
  ...items: TranscriptHealthMetrics[]
): TranscriptHealthMetrics {
  const merged = emptyTranscriptHealthMetrics()
  for (const item of items) {
    merged.providerTranscriptPersisted ||= item.providerTranscriptPersisted
    merged.toolPairsChecked += item.toolPairsChecked
    merged.toolPairsRepaired += item.toolPairsRepaired
    merged.orphanToolResultsDropped += item.orphanToolResultsDropped
    merged.legacyRowsSkipped += item.legacyRowsSkipped
    merged.compactPairsSummarized += item.compactPairsSummarized
    merged.details.push(...item.details)
  }
  return merged
}

export function normalizeProviderContent(input: unknown): ProviderContentBlock[] | undefined {
  if (!Array.isArray(input)) return undefined
  const blocks: ProviderContentBlock[] = []
  for (const value of input) {
    const block = value as Record<string, unknown> | null
    if (!isRecord(block) || typeof block.type !== 'string') continue

    if (block.type === 'text' && typeof block.text === 'string') {
      blocks.push({ type: 'text', text: block.text })
      continue
    }

    if (block.type === 'image' && isRecord(block.source)) {
      const source = block.source
      if (
        source.type === 'base64' &&
        typeof source.media_type === 'string' &&
        typeof source.data === 'string'
      ) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: source.media_type,
            data: source.data,
          },
        })
      }
      continue
    }

    if (
      block.type === 'tool_use' &&
      typeof block.id === 'string' &&
      typeof block.name === 'string'
    ) {
      blocks.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: isRecord(block.input) ? block.input : {},
      })
      continue
    }

    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      blocks.push({
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: stringifyOptional(block.content),
        is_error: typeof block.is_error === 'boolean' ? block.is_error : undefined,
      })
    }
  }
  return blocks.length > 0 ? blocks : undefined
}

export function normalizeProviderMeta(input: unknown): ProviderMeta | undefined {
  if (!isRecord(input)) return undefined
  const meta: ProviderMeta = { protocolVersion: 1 }
  if (input.providerFamily === 'anthropic' || input.providerFamily === 'openai' || input.providerFamily === 'deepseek' || input.providerFamily === 'unknown') {
    meta.providerFamily = input.providerFamily
  }
  if (typeof input.visibility === 'string' && VISIBILITIES.includes(input.visibility as ProviderVisibility)) {
    meta.visibility = input.visibility as ProviderVisibility
  }
  if (typeof input.transcriptKind === 'string' && TRANSCRIPT_KINDS.includes(input.transcriptKind as ProviderTranscriptKind)) {
    meta.transcriptKind = input.transcriptKind as ProviderTranscriptKind
  }
  if (typeof input.sourceAssistantMessageId === 'string') {
    meta.sourceAssistantMessageId = input.sourceAssistantMessageId
  }
  if (Array.isArray(input.toolUseIds)) {
    meta.toolUseIds = input.toolUseIds.filter((id): id is string => typeof id === 'string')
  }
  if (typeof input.repairReason === 'string' && REPAIR_REASONS.includes(input.repairReason as ProviderRepairReason)) {
    meta.repairReason = input.repairReason as ProviderRepairReason
  }
  return meta
}

export function makeProviderMeta(input: Omit<ProviderMeta, 'protocolVersion'> = {}): ProviderMeta {
  return { protocolVersion: 1, ...input }
}

export function hydrateMessageFromDb(row: PersistableDbMessage): Message {
  const providerContent = normalizeProviderContent(row.providerContent)
  const providerMeta = normalizeProviderMeta(row.providerMeta)
  const msg: Message = {
    id: row.id,
    role: normalizeRole(row.role),
    content: typeof row.content === 'string' ? row.content : '',
    contentBlocks: normalizeDisplayContentBlocks(row.contentBlocks),
    createdAt: row.createdAt,
  } as Message

  if (providerContent) {
    msg.providerContent = providerContent
  }
  if (providerMeta) {
    msg.providerMeta = providerMeta
  }

  if (msg.role === 'assistant') {
    const toolUses = extractToolUses(providerContent)
    if (toolUses.length > 0) {
      ;(msg as Message & { toolUses?: ToolUse[] }).toolUses = toolUses
    }
  }

  return msg
}

export function serializeMessageForPersistence(
  message: Message,
  caseId: string,
): MessagePersistenceRecord {
  return {
    id: message.id,
    caseId,
    role: message.role,
    content: persistableMessageText(message.content),
    contentBlocks: message.contentBlocks ?? undefined,
    providerContent: normalizeProviderContent(message.providerContent ?? legacyProviderContent(message)),
    providerMeta: normalizeProviderMeta(message.providerMeta),
    isStreaming: false,
  }
}

export function providerTranscriptPersistenceReceipt(
  messages: Array<{ providerContent?: unknown }>,
): ProviderTranscriptPersistenceReceipt {
  let providerTranscriptMessageCount = 0
  let providerTranscriptBlockCount = 0
  for (const message of messages) {
    const providerContent = normalizeProviderContent(message.providerContent)
    if (!providerContent?.length) continue
    providerTranscriptMessageCount++
    providerTranscriptBlockCount += providerContent.length
  }
  return {
    providerTranscriptPersisted: providerTranscriptMessageCount > 0,
    providerTranscriptMessageCount,
    providerTranscriptBlockCount,
  }
}

export function hasProviderTranscript(message: Pick<Message, 'providerContent'>): boolean {
  return !!normalizeProviderContent(message.providerContent)?.length
}

export function hasProviderOrDisplayContent(message: {
  role: string
  content?: unknown
  contentBlocks?: unknown
  providerContent?: unknown
}): boolean {
  if (normalizeProviderContent(message.providerContent)?.length) return true
  if (typeof message.content === 'string' && message.content.trim().length > 0) return true
  if (message.role === 'user') return true
  return Array.isArray(message.contentBlocks) && message.contentBlocks.length > 0
}

export function isInternalProviderMessage(message: Pick<Message, 'role' | 'providerContent' | 'providerMeta'>): boolean {
  const meta = normalizeProviderMeta(message.providerMeta)
  if (meta?.visibility === 'internal') return true
  const providerContent = normalizeProviderContent(message.providerContent)
  return message.role === 'user' && !!providerContent?.some((block) => block.type === 'tool_result')
}

export function isCustomerVisibleMessage(message: Message): boolean {
  if (isInternalProviderMessage(message)) return false
  if (typeof message.content === 'string' && message.content.trim().length > 0) return true
  return Array.isArray(message.contentBlocks) && message.contentBlocks.length > 0
}

export function providerTranscriptCompactText(message: Message): string | null {
  const providerContent = normalizeProviderContent(message.providerContent ?? legacyProviderContent(message))
  if (providerContent?.length) {
    const parts = providerContent.flatMap((block) => {
      if (block.type === 'text') {
        const text = block.text.trim()
        return text ? [text] : []
      }
      if (block.type === 'image') {
        return [`[image input: ${block.source.media_type}]`]
      }
      if (block.type === 'tool_use') {
        return [`[assistant tool_use id=${block.id} name=${block.name} input=${truncateCompactText(safeJson(block.input ?? {}), 1200)}]`]
      }
      const content = block.content?.trim() || '<empty tool result>'
      const suffix = block.is_error ? ' error=true' : ''
      return [`[user tool_result tool_use_id=${block.tool_use_id}${suffix} content=${truncateCompactText(content, 4000)}]`]
    })
    const compactText = parts.join('\n').trim()
    if (compactText) return compactText
  }

  if (typeof message.content === 'string') {
    const text = message.content.trim()
    if (text) return text
  }

  const displayBlocks = normalizeDisplayContentBlocks(message.contentBlocks)
  if (displayBlocks?.length) {
    const compactText = displayBlocks.flatMap((block) => {
      if (block.type === 'text') return block.text.trim() ? [block.text.trim()] : []
      return [`[image input: ${block.source.media_type}]`]
    }).join('\n').trim()
    return compactText || null
  }

  return null
}

export function assistantProviderContent(
  text: string,
  toolUses: ToolUse[] = [],
): ProviderContentBlock[] | undefined {
  const blocks: ProviderContentBlock[] = []
  if (text.trim()) {
    blocks.push({ type: 'text', text })
  }
  for (const toolUse of toolUses) {
    blocks.push({
      type: 'tool_use',
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input ?? {},
    })
  }
  return blocks.length > 0 ? blocks : undefined
}

export function toolResultProviderContent(
  blocks: Array<{ type: 'tool_result'; tool_use_id: string; content?: string; is_error?: boolean }>,
): ProviderContentBlock[] {
  return blocks.map((block) => ({
    type: 'tool_result' as const,
    tool_use_id: block.tool_use_id,
    content: block.content,
    is_error: block.is_error,
  }))
}

export function providerContentToToolUses(input: unknown): ToolUse[] {
  return extractToolUses(normalizeProviderContent(input))
}

export function providerContentToToolResultIds(input: unknown): string[] {
  return (normalizeProviderContent(input) ?? [])
    .filter((block): block is Extract<ProviderContentBlock, { type: 'tool_result' }> => block.type === 'tool_result')
    .map((block) => block.tool_use_id)
}

export function normalizeProviderTranscriptMessages(messages: Message[]): {
  messages: Message[]
  metrics: TranscriptHealthMetrics
} {
  const metrics = emptyTranscriptHealthMetrics()
  metrics.providerTranscriptPersisted = messages.some((message) => hasProviderTranscript(message))

  const out: Message[] = []
  const pending = new Map<string, { name: string; assistantMessageId: string }>()
  const seenResults = new Set<string>()

  const flushRepairs = () => {
    if (pending.size === 0) return
    const repairs = [...pending.entries()].map(([toolUseId, info]) => {
      metrics.toolPairsRepaired++
      metrics.details.push({
        event: 'synthetic_repair',
        toolUseId,
        toolName: info.name,
        messageId: info.assistantMessageId,
        repairReason: 'missing_tool_result',
      })
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseId,
        content: '<tool_use_error>Tool result was missing from the durable transcript. Treat this as an interrupted or unavailable tool result, not successful evidence.</tool_use_error>',
        is_error: true,
      }
    })
    out.push(createSyntheticRepairMessage(repairs, [...pending.keys()], [...pending.values()][0]?.assistantMessageId))
    pending.clear()
  }

  for (const original of messages) {
    const providerContent = normalizeProviderContent(original.providerContent ?? legacyProviderContent(original))
    const toolUses = extractToolUses(providerContent)
    const toolResults = extractToolResults(providerContent)
    const isToolResultMessage = original.role === 'user' && toolResults.length > 0

    if (pending.size > 0 && !isToolResultMessage) {
      flushRepairs()
    }

    if (original.role === 'assistant' && toolUses.length > 0) {
      const message = withProviderContent(original, providerContent)
      out.push(message)
      for (const toolUse of toolUses) {
        pending.set(toolUse.id, { name: toolUse.name, assistantMessageId: original.id })
        metrics.toolPairsChecked++
      }
      continue
    }

    if (isToolResultMessage) {
      const validResults: Extract<ProviderContentBlock, { type: 'tool_result' }>[] = []
      for (const result of toolResults) {
        const pendingTool = pending.get(result.tool_use_id)
        if (!pendingTool) {
          metrics.orphanToolResultsDropped++
          metrics.details.push({
            event: seenResults.has(result.tool_use_id) ? 'duplicate_drop' : 'orphan_drop',
            toolUseId: result.tool_use_id,
            messageId: original.id,
            repairReason: 'orphan_tool_result',
          })
          continue
        }
        if (seenResults.has(result.tool_use_id)) {
          metrics.orphanToolResultsDropped++
          metrics.details.push({
            event: 'duplicate_drop',
            toolUseId: result.tool_use_id,
            messageId: original.id,
            repairReason: 'orphan_tool_result',
          })
          continue
        }
        seenResults.add(result.tool_use_id)
        pending.delete(result.tool_use_id)
        validResults.push(result)
      }
      if (validResults.length > 0) {
        out.push({
          ...original,
          providerContent: validResults,
          providerMeta: normalizeProviderMeta(original.providerMeta) ?? makeProviderMeta({
            providerFamily: 'anthropic',
            visibility: 'internal',
            transcriptKind: 'tool_result',
            toolUseIds: validResults.map((result) => result.tool_use_id),
          }),
        } as Message)
      }
      continue
    }

    if (isLegacyEmptyDisplayRow(original)) {
      metrics.legacyRowsSkipped++
      metrics.details.push({
        event: 'legacy_skip',
        messageId: original.id,
        repairReason: 'legacy_row',
      })
      continue
    }

    out.push(providerContent ? withProviderContent(original, providerContent) : original)
  }

  flushRepairs()

  return { messages: out, metrics }
}

export function selectProviderMessageWindow(messages: Message[], limit: number): Message[] {
  return selectProviderMessageWindowWithMetrics(messages, limit).messages
}

export function selectProviderMessageWindowWithMetrics(messages: Message[], limit: number): {
  messages: Message[]
  metrics: TranscriptHealthMetrics
} {
  const metrics = emptyTranscriptHealthMetrics()
  if (messages.length <= limit) return { messages, metrics }
  const selected = messages.slice(-limit)
  const selectedToolUseIds = new Set(
    selected.flatMap((message) => extractToolUses(normalizeProviderContent(message.providerContent ?? legacyProviderContent(message))).map((toolUse) => toolUse.id)),
  )
  const orphanResultIds = new Set(
    selected.flatMap((message) => extractToolResults(normalizeProviderContent(message.providerContent ?? legacyProviderContent(message))).map((result) => result.tool_use_id))
      .filter((toolUseId) => !selectedToolUseIds.has(toolUseId)),
  )
  if (orphanResultIds.size === 0) return { messages: selected, metrics }

  const prefix: Message[] = []
  const selectedIds = new Set(selected.map((message) => message.id))
  for (let index = messages.length - limit - 1; index >= 0; index--) {
    const message = messages[index]
    const toolUses = extractToolUses(normalizeProviderContent(message.providerContent ?? legacyProviderContent(message)))
    if (toolUses.some((toolUse) => orphanResultIds.has(toolUse.id))) {
      prefix.unshift(message)
      selectedIds.add(message.id)
      for (const toolUse of toolUses) {
        if (!orphanResultIds.has(toolUse.id)) continue
        orphanResultIds.delete(toolUse.id)
        metrics.compactPairsSummarized++
        metrics.details.push({
          event: 'compact_pair_summary',
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          messageId: message.id,
          repairReason: 'compact_boundary',
        })
      }
      if (orphanResultIds.size === 0) break
    }
  }
  return {
    messages: [...prefix, ...selected.filter((message) => !selectedIds.has(message.id) || !prefix.some((item) => item.id === message.id))],
    metrics,
  }
}

function withProviderContent(message: Message, providerContent: ProviderContentBlock[] | undefined): Message {
  if (!providerContent?.length) return message
  return { ...message, providerContent }
}

function createSyntheticRepairMessage(
  blocks: Extract<ProviderContentBlock, { type: 'tool_result' }>[],
  toolUseIds: string[],
  sourceAssistantMessageId?: string,
): Message {
  return {
    id: `provider_repair_${toolUseIds.join('_')}_${Date.now()}`,
    role: 'user',
    content: '',
    providerContent: blocks,
    providerMeta: makeProviderMeta({
      providerFamily: 'anthropic',
      visibility: 'internal',
      transcriptKind: 'synthetic_repair',
      sourceAssistantMessageId,
      toolUseIds,
      repairReason: 'missing_tool_result',
    }),
    createdAt: new Date(),
  } as Message
}

function legacyProviderContent(message: Message): ProviderContentBlock[] | undefined {
  const fromContent = normalizeProviderContent(message.content as unknown)
  if (fromContent) return fromContent
  if (message.role !== 'assistant') return undefined
  const toolUses = (message as Message & { toolUses?: ToolUse[] }).toolUses
  if (!toolUses?.length) return undefined
  return assistantProviderContent(typeof message.content === 'string' ? message.content : '', toolUses)
}

function extractToolUses(content: ProviderContentBlock[] | undefined): ToolUse[] {
  return (content ?? [])
    .filter((block): block is Extract<ProviderContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
    .map((block) => ({ id: block.id, name: block.name, input: block.input ?? {} }))
}

function extractToolResults(content: ProviderContentBlock[] | undefined): Extract<ProviderContentBlock, { type: 'tool_result' }>[] {
  return (content ?? [])
    .filter((block): block is Extract<ProviderContentBlock, { type: 'tool_result' }> => block.type === 'tool_result')
}

function isLegacyEmptyDisplayRow(message: Message): boolean {
  return !message.providerContent?.length &&
    !message.contentBlocks?.length &&
    typeof message.content === 'string' &&
    message.content.trim() === '' &&
    message.role === 'user'
}

function normalizeDisplayContentBlocks(input: unknown): Message['contentBlocks'] {
  if (!Array.isArray(input)) return undefined
  const blocks = input.filter((block): block is NonNullable<Message['contentBlocks']>[number] => {
    if (!isRecord(block) || typeof block.type !== 'string') return false
    if (block.type === 'text') return typeof block.text === 'string'
    if (block.type === 'image' && isRecord(block.source)) {
      return block.source.type === 'base64' &&
        typeof block.source.media_type === 'string' &&
        typeof block.source.data === 'string'
    }
    return false
  })
  return blocks.length > 0 ? blocks : undefined
}

function normalizeRole(role: string): Message['role'] {
  return role === 'assistant' || role === 'system' ? role : 'user'
}

function stringifyOptional(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function truncateCompactText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...[truncated ${value.length - maxChars} chars]`
}

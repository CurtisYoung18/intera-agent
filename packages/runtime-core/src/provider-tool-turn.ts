import type { AssistantMessage, Message, ToolUse } from '@intera/shared/types'
import {
  assistantProviderContent,
  makeProviderMeta,
  toolResultProviderContent,
} from './provider-transcript'
import {
  assertToolResultInvariant,
  synthesizeMissingToolResults,
  type SynthesisReason,
  type ToolResultBlock,
} from './tool-result-invariant'

export type { SynthesisReason }

export interface ProviderToolUseBlock {
  type: string
  id: string
  name: string
  content?: string
}

export interface CompletedProviderToolResult {
  toolUseId: string
  output: unknown
  isError: boolean
}

export interface FinalizeProviderToolTurnInput {
  assistantMessage: AssistantMessage
  providerText?: string
  toolUseBlocks: ProviderToolUseBlock[]
  completedResults: CompletedProviderToolResult[]
  missingReasons: Map<string, SynthesisReason>
  pendingHookFeedback: string[]
  createId: () => string
  createdAt: Date
}

export interface FinalizedProviderToolTurn {
  assistantMessage: AssistantMessage
  toolUses: ToolUse[]
  messagesToAppend: Message[]
}

export function finalizeProviderToolTurn(input: FinalizeProviderToolTurnInput): FinalizedProviderToolTurn {
  const toolUses = buildProviderToolUses(input.toolUseBlocks)
  const messagesToAppend: Message[] = []
  const providerText = input.providerText ?? input.assistantMessage.content

  input.assistantMessage.toolUses = toolUses.length > 0 ? toolUses : undefined
  input.assistantMessage.providerContent = assistantProviderContent(providerText, toolUses)
  if (input.assistantMessage.providerContent?.length) {
    input.assistantMessage.providerMeta = makeProviderMeta({
      providerFamily: 'anthropic',
      visibility: input.assistantMessage.content.trim() ? 'customer' : 'internal',
      transcriptKind: 'assistant_response',
      toolUseIds: toolUses.map((toolUse) => toolUse.id),
    })
  }

  if (toolUses.length > 0) {
    const completedToolUseIds = new Set(input.completedResults.map((result) => result.toolUseId))
    for (const toolUse of toolUses) {
      if (!completedToolUseIds.has(toolUse.id) && !input.missingReasons.has(toolUse.id)) {
        input.missingReasons.set(toolUse.id, 'stream_aborted')
      }
    }

    const synthesisBlocks = synthesizeMissingToolResults({
      toolUses,
      completedResults: input.completedResults,
      missingReasons: input.missingReasons,
    })
    messagesToAppend.push(buildProviderToolResultMessage(synthesisBlocks, input.createId, input.createdAt))
  }

  for (const feedback of input.pendingHookFeedback) {
    messagesToAppend.push(buildProviderHookFeedbackMessage(feedback, input.createId, input.createdAt))
  }

  return {
    assistantMessage: input.assistantMessage,
    toolUses,
    messagesToAppend,
  }
}

export function buildProviderToolUses(blocks: ProviderToolUseBlock[]): ToolUse[] {
  return blocks
    .filter((block) => block.type === 'tool_use')
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: parseProviderToolInput(block.content),
    }))
}

export function assertProviderToolTurnInvariant(messages: Array<{
  role: string
  content: unknown
  toolUses?: ToolUse[]
  providerContent?: unknown
}>): void {
  assertToolResultInvariant(messages)
}

function buildProviderToolResultMessage(
  blocks: ToolResultBlock[],
  createId: () => string,
  createdAt: Date,
): Message {
  return {
    id: createId(),
    role: 'user',
    content: '',
    providerContent: toolResultProviderContent(blocks),
    providerMeta: makeProviderMeta({
      providerFamily: 'anthropic',
      visibility: 'internal',
      transcriptKind: 'tool_result',
      toolUseIds: blocks.map((block) => block.tool_use_id),
    }),
    createdAt,
  } as Message
}

function buildProviderHookFeedbackMessage(
  feedback: string,
  createId: () => string,
  createdAt: Date,
): Message {
  return {
    id: createId(),
    role: 'user',
    content: '',
    providerContent: [{ type: 'text', text: feedback }],
    providerMeta: makeProviderMeta({
      providerFamily: 'anthropic',
      visibility: 'internal',
      transcriptKind: 'hook_feedback',
    }),
    createdAt,
  }
}

function parseProviderToolInput(content: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(content || '{}')
  } catch {
    return {}
  }
}

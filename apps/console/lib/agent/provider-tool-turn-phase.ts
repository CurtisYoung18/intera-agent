import type { AssistantMessage, Message, ToolUse } from '@intera/shared/types'
import {
  assertProviderToolTurnInvariant,
  finalizeProviderToolTurn,
  type SynthesisReason,
} from '@intera/runtime-core/provider-tool-turn'
import type { StreamContentBlock } from './stream-handler'
import type { ToolExecutionResult } from './streaming-tool-executor'

export interface ProviderToolTurnPhaseInput {
  messages: Message[]
  assistantMessage: AssistantMessage
  blocks: Map<number, StreamContentBlock>
  toolResults: ToolExecutionResult[]
  missingReasons: Map<string, SynthesisReason>
  pendingHookFeedback: string[]
  invariantCheckEnabled: boolean
}

export function finalizeStreamingProviderToolTurn(input: ProviderToolTurnPhaseInput): void {
  const providerToolTurn = finalizeProviderToolTurn({
    assistantMessage: input.assistantMessage,
    toolUseBlocks: [...input.blocks.values()],
    completedResults: input.toolResults.map((result) => ({
      toolUseId: result.toolUse?.id ?? result.name,
      output: result.output,
      isError: (result.output as { ok?: boolean })?.ok === false,
    })),
    missingReasons: input.missingReasons,
    pendingHookFeedback: input.pendingHookFeedback,
    createId: () => crypto.randomUUID(),
    createdAt: new Date(),
  })

  input.messages.push(...providerToolTurn.messagesToAppend)
  input.pendingHookFeedback.length = 0
  input.missingReasons.clear()

  if (!input.invariantCheckEnabled) return
  try {
    assertProviderToolTurnInvariant(
      input.messages.filter((message) => 'role' in message) as Array<{
        role: string
        content: unknown
        toolUses?: ToolUse[]
      }>,
    )
  } catch (err) {
    console.error('[Invariant]', (err as Error).message)
  }
}

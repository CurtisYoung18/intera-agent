import type { AssistantMessage, Message, SSEEvent } from '@intera/shared/types'

export interface RuntimeCustomerReplyInput {
  customerVisibleText: string
  runtimeText: string
  addMessage: (message: Message) => void
  sendEvent: (event: SSEEvent) => void
  createId?: () => string
  now?: () => Date
}

export function ensureRuntimeCustomerReply(input: RuntimeCustomerReplyInput): void {
  const runtimeText = input.runtimeText.trim()
  if (input.customerVisibleText.trim() || !runtimeText) return

  const createdAt = input.now?.() ?? new Date()
  const message: AssistantMessage = {
    id: input.createId?.() ?? crypto.randomUUID(),
    role: 'assistant',
    content: runtimeText,
    createdAt,
    isStreaming: false,
  }
  input.addMessage(message)
  input.sendEvent({
    type: 'text_delta',
    data: runtimeText,
    timestamp: createdAt.toISOString(),
  })
}

// apps/chat/lib/livechat/webhook-filter.ts
// Presence & self-author filtering for LiveChat webhook events.
// Used by both general and per-customer webhook routes.

export interface FilterInput {
  agentAccountId?: string
  authorId: string
  presentIds: string[]
}

export interface FilterResult {
  skip: boolean
  reason?: 'self_authored' | 'not_my_chat'
}

export function shouldSkipEvent(input: FilterInput): FilterResult {
  if (input.agentAccountId && input.authorId === input.agentAccountId) {
    return { skip: true, reason: 'self_authored' }
  }
  if (input.agentAccountId && input.presentIds.length > 0 && !input.presentIds.includes(input.agentAccountId)) {
    return { skip: true, reason: 'not_my_chat' }
  }
  return { skip: false }
}

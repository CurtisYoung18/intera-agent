export function hasPersistableMessageContent(message: {
  role: string
  content?: unknown
  contentBlocks?: unknown
}): boolean {
  if (typeof message.content === 'string' && message.content.trim().length > 0) return true
  if (message.role === 'user') return true
  return Array.isArray(message.contentBlocks) && message.contentBlocks.length > 0
}

export function persistableMessageText(content: unknown): string {
  return typeof content === 'string' ? content : ''
}

import { describe, expect, it } from 'vitest'

import { hasPersistableMessageContent, persistableMessageText } from '../persistable-message'

describe('persistable-message helpers', () => {
  it('keeps non-empty string messages', () => {
    expect(hasPersistableMessageContent({ role: 'assistant', content: 'hello' })).toBe(true)
    expect(persistableMessageText('hello')).toBe('hello')
  })

  it('does not call trim semantics on object content', () => {
    const content = [{ type: 'text', text: 'hello' }]
    expect(hasPersistableMessageContent({ role: 'assistant', content })).toBe(false)
    expect(persistableMessageText(content)).toBe('')
  })

  it('keeps user messages and content blocks even when string content is empty', () => {
    expect(hasPersistableMessageContent({ role: 'user', content: '' })).toBe(true)
    expect(hasPersistableMessageContent({ role: 'assistant', content: '', contentBlocks: [{ type: 'image' }] })).toBe(true)
  })
})

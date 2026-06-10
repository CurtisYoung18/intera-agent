import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/lib/agent/api/provider-config')
vi.unmock('../../api/provider-config')

describe('provider vision adapter', () => {
  it('preserves Anthropic image blocks for OpenRouter Anthropic messages', async () => {
    const { normalizeOpenRouterAnthropicBody } = await import('../../api/provider-config')
    const body = JSON.stringify({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      }],
    })

    const converted = JSON.parse(normalizeOpenRouterAnthropicBody(body))

    expect(converted.messages[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
    })
  })

  it('normalizes legacy image_url blocks back to Anthropic image blocks', async () => {
    const { normalizeOpenRouterAnthropicBody } = await import('../../api/provider-config')
    const body = JSON.stringify({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,def456' } },
        ],
      }],
    })

    const converted = JSON.parse(normalizeOpenRouterAnthropicBody(body))

    expect(converted.messages[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'def456' },
    })
  })
})

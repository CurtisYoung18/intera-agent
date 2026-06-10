import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/lib/agent/api/provider-config')
vi.unmock('../../api/provider-config')

describe('provider vision adapter', () => {
  it('converts Anthropic image blocks to OpenRouter image_url blocks', async () => {
    const { convertAnthropicImagesForOpenRouterBody } = await import('../../api/provider-config')
    const body = JSON.stringify({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      }],
    })

    const converted = JSON.parse(convertAnthropicImagesForOpenRouterBody(body))

    expect(converted.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc123' },
    })
  })
})

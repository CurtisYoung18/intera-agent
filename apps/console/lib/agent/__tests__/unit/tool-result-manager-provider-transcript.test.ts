import { describe, expect, it } from 'vitest'
import { buildHookFeedbackMessage, buildToolResultMessageFromSynthesis } from '../../tool-result-manager'

describe('tool-result-manager provider transcript messages', () => {
  it('builds internal providerContent tool_result messages', () => {
    const message = buildToolResultMessageFromSynthesis([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}', is_error: false },
    ])

    expect(message.content).toBe('')
    expect(message.providerContent).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}', is_error: false },
    ])
    expect(message.providerMeta).toMatchObject({
      visibility: 'internal',
      transcriptKind: 'tool_result',
      toolUseIds: ['toolu_1'],
    })
  })

  it('builds internal providerContent hook feedback messages', () => {
    const message = buildHookFeedbackMessage('Use the prior tool result before replying.')

    expect(message.content).toBe('')
    expect(message.providerContent).toEqual([
      { type: 'text', text: 'Use the prior tool result before replying.' },
    ])
    expect(message.providerMeta).toMatchObject({
      visibility: 'internal',
      transcriptKind: 'hook_feedback',
    })
  })
})

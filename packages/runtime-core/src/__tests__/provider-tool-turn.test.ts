import { describe, expect, it } from 'vitest'
import {
  assertProviderToolTurnInvariant,
  buildProviderToolUses,
  finalizeProviderToolTurn,
  type SynthesisReason,
} from '../provider-tool-turn'
import type { AssistantMessage } from '@intera/shared/types'

const CREATED_AT = new Date('2026-06-12T11:00:00.000Z')

function assistant(content = 'I will check.'): AssistantMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content,
    createdAt: CREATED_AT,
    isStreaming: false,
  }
}

describe('provider-tool-turn', () => {
  it('finalizes assistant provider content and matching tool_result message', () => {
    const assistantMessage = assistant()
    const turn = finalizeProviderToolTurn({
      assistantMessage,
      toolUseBlocks: [
        { type: 'tool_use', id: 'toolu_1', name: 'get_order', content: '{"orderId":"A-1"}' },
      ],
      completedResults: [
        { toolUseId: 'toolu_1', output: { ok: true, orderId: 'A-1' }, isError: false },
      ],
      missingReasons: new Map(),
      pendingHookFeedback: [],
      createId: () => 'msg-tool-result',
      createdAt: CREATED_AT,
    })

    expect(turn.toolUses).toEqual([
      { id: 'toolu_1', name: 'get_order', input: { orderId: 'A-1' } },
    ])
    expect(turn.assistantMessage.providerContent).toEqual([
      { type: 'text', text: 'I will check.' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_order', input: { orderId: 'A-1' } },
    ])
    expect(turn.assistantMessage.providerMeta).toMatchObject({
      transcriptKind: 'assistant_response',
      visibility: 'customer',
      toolUseIds: ['toolu_1'],
    })
    expect(turn.messagesToAppend).toHaveLength(1)
    expect(turn.messagesToAppend[0]).toMatchObject({
      id: 'msg-tool-result',
      role: 'user',
      content: '',
      providerMeta: {
        transcriptKind: 'tool_result',
        visibility: 'internal',
        toolUseIds: ['toolu_1'],
      },
      providerContent: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: '{"ok":true,"orderId":"A-1"}',
          is_error: false,
        },
      ],
    })

    expect(() => assertProviderToolTurnInvariant([
      turn.assistantMessage,
      ...turn.messagesToAppend,
    ])).not.toThrow()
  })

  it('synthesizes missing tool results before hook feedback messages', () => {
    const missingReasons = new Map<string, SynthesisReason>([['toolu_blocked', 'hook_blocked']])
    const turn = finalizeProviderToolTurn({
      assistantMessage: assistant(''),
      toolUseBlocks: [
        { type: 'tool_use', id: 'toolu_blocked', name: 'dangerous_tool', content: '{}' },
      ],
      completedResults: [],
      missingReasons,
      pendingHookFeedback: ['Use a safer explanation instead.'],
      createId: (() => {
        let next = 0
        return () => `msg-${++next}`
      })(),
      createdAt: CREATED_AT,
    })

    expect(turn.messagesToAppend).toHaveLength(2)
    expect(turn.messagesToAppend[0].providerMeta).toMatchObject({ transcriptKind: 'tool_result' })
    expect(turn.messagesToAppend[0].providerContent).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_blocked',
        content: 'Tool held by a Hook. See the follow-up message for details.',
        is_error: true,
      },
    ])
    expect(turn.messagesToAppend[1].providerMeta).toMatchObject({ transcriptKind: 'hook_feedback' })
    expect(turn.messagesToAppend[1].providerContent).toEqual([
      { type: 'text', text: 'Use a safer explanation instead.' },
    ])
  })

  it('guards malformed provider tool input without throwing', () => {
    expect(buildProviderToolUses([
      { type: 'tool_use', id: 'toolu_bad', name: 'bad_json_tool', content: '{"unterminated"' },
    ])).toEqual([
      { id: 'toolu_bad', name: 'bad_json_tool', input: {} },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { AgentLoop } from '../../loop'
import { makeAgentLoopDeps } from '../factories/agent-loop'
import { createMemoryPersistence } from '../../persistence-port'
import { assistantProviderContent, toolResultProviderContent } from '../../provider-transcript'
import type { Message } from '@intera/shared/types'

describe('AgentLoop provider transcript reload', () => {
  it('builds provider messages from hydrated providerContent after loadMessages', () => {
    const memoryPersistence = createMemoryPersistence()
    const loop = new AgentLoop(makeAgentLoopDeps({ persistence: memoryPersistence.port }))
    const prior: Message[] = [
      {
        id: 'assistant-tool',
        role: 'assistant',
        content: 'Checking.',
        providerContent: assistantProviderContent('Checking.', [
          { id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } },
        ]),
        providerMeta: {
          protocolVersion: 1,
          providerFamily: 'anthropic',
          visibility: 'customer',
          transcriptKind: 'assistant_response',
          toolUseIds: ['toolu_1'],
        },
        createdAt: new Date(),
      } as Message,
      {
        id: 'tool-result',
        role: 'user',
        content: '',
        providerContent: toolResultProviderContent([
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' },
        ]),
        providerMeta: {
          protocolVersion: 1,
          providerFamily: 'anthropic',
          visibility: 'internal',
          transcriptKind: 'tool_result',
          toolUseIds: ['toolu_1'],
        },
        createdAt: new Date(),
      } as Message,
    ]

    loop.loadMessages(prior)

    const result = (loop as unknown as { buildApiMessages: () => { messages: any[]; metrics: any } }).buildApiMessages()

    expect(result.messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}', is_error: undefined },
        ],
      },
    ])
    expect(result.metrics).toMatchObject({
      providerTranscriptPersisted: true,
      toolPairsChecked: 1,
      toolPairsRepaired: 0,
      orphanToolResultsDropped: 0,
    })
  })
})

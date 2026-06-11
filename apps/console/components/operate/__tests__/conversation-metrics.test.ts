import { describe, expect, it } from 'vitest'
import { computeConversationMetrics } from '@/components/operate/conversation-metrics'

describe('computeConversationMetrics', () => {
  it('prefers iteration snapshot wall/tool timing over collapsed export timestamps', () => {
    const traces = [
      {
        actionType: 'llm_response',
        title: 'LLM response: tool_use',
        createdAt: '2026-06-11T12:00:00.000Z',
        payload: JSON.stringify({
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 40,
          },
        }),
      },
      {
        actionType: 'tool_result',
        title: 'Tool: get_latest_deposit',
        createdAt: '2026-06-11T12:00:00.010Z',
        payload: JSON.stringify({
          toolName: 'get_latest_deposit',
          latencyMs: 1,
        }),
      },
      {
        actionType: 'loop_decision',
        title: 'Iteration Snapshot',
        createdAt: '2026-06-11T12:00:00.020Z',
        payload: JSON.stringify({
          iteration: 1,
          wallMs: 2151,
          llmWallMs: 2150,
          toolsWallMs: 1,
        }),
      },
      {
        actionType: 'loop_decision',
        title: 'Iteration Snapshot',
        createdAt: '2026-06-11T12:00:00.030Z',
        payload: JSON.stringify({
          iteration: 2,
          wallMs: 3389,
          llmWallMs: 3388,
          toolsWallMs: 1,
        }),
      },
    ]

    const metrics = computeConversationMetrics(traces)

    expect(metrics.llmCalls).toBe(1)
    expect(metrics.inputTokens).toBe(100)
    expect(metrics.outputTokens).toBe(20)
    expect(metrics.cacheReadTokens).toBe(40)
    expect(metrics.turnWallMs).toBe(5540)
    expect(metrics.toolPhaseMs).toBe(3)
  })
})

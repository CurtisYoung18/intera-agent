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
    expect(metrics.inputTokens).toBe(140)
    expect(metrics.outputTokens).toBe(20)
    expect(metrics.cacheReadTokens).toBe(40)
    expect(metrics.totalTokens).toBe(160)
    expect(metrics.turnWallMs).toBe(5540)
    expect(metrics.toolPhaseMs).toBe(3)
  })

  it('reads OpenRouter prompt cache accounting when usage uses prompt_tokens_details', () => {
    const traces = [
      {
        actionType: 'llm_response',
        title: 'LLM response: end_turn',
        createdAt: '2026-06-11T12:00:00.000Z',
        payload: JSON.stringify({
          usage: {
            prompt_tokens: 5482,
            completion_tokens: 71,
            prompt_tokens_details: {
              cached_tokens: 3200,
              cache_write_tokens: 1280,
            },
          },
        }),
      },
    ]

    const metrics = computeConversationMetrics(traces)

    expect(metrics.llmCalls).toBe(1)
    expect(metrics.inputTokens).toBe(5482)
    expect(metrics.outputTokens).toBe(71)
    expect(metrics.cacheReadTokens).toBe(3200)
    expect(metrics.cacheWriteTokens).toBe(1280)
    expect(metrics.totalTokens).toBe(5553)
  })

  it('does not double-count cache details when input_tokens already includes cached prompt tokens', () => {
    const metrics = computeConversationMetrics([
      {
        actionType: 'llm_response',
        title: 'LLM response: end_turn',
        createdAt: '2026-06-11T12:00:00.000Z',
        payload: JSON.stringify({
          usage: {
            input_tokens: 5482,
            output_tokens: 71,
            input_tokens_details: {
              cached_tokens: 3200,
              cache_write_tokens: 1280,
            },
          },
        }),
      },
    ])

    expect(metrics.inputTokens).toBe(5482)
    expect(metrics.outputTokens).toBe(71)
    expect(metrics.cacheReadTokens).toBe(3200)
    expect(metrics.cacheWriteTokens).toBe(1280)
    expect(metrics.totalTokens).toBe(5553)
  })
})

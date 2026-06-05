import { describe, it, expect } from 'vitest'
import { aggregateTraces } from '../trace-aggregator'
import type { TraceRecord } from '../persistence-port'

describe('aggregateTraces', () => {
  it('emits only applicable stages with fired/skipped', () => {
    const traces: TraceRecord[] = [
      { caseId: 'test', actionType: 'policy_hit', title: 'Policy: block-all', detail: 'block', createdAt: '2026-01-01T00:00:00Z' },
      { caseId: 'test', actionType: 'llm_request_start', title: 'LLM request: claude', createdAt: '2026-01-01T00:00:01Z' },
      { caseId: 'test', actionType: 'llm_response', title: 'LLM response', createdAt: '2026-01-01T00:00:02Z' },
    ]
    const applicableStages = ['Guardrails', 'Knowledge retrieval', 'Model generation'] as any[]

    const result = aggregateTraces(traces, Date.now(), false, applicableStages)

    // Only 3 stages emitted (not all 6)
    expect(result).toHaveLength(3)

    const guardrails = result.find(s => s.stage === 'Guardrails')!
    expect(guardrails.fired).toBe(true)
    expect(guardrails.status).not.toBe('skipped')

    const knowledge = result.find(s => s.stage === 'Knowledge retrieval')!
    expect(knowledge.fired).toBe(false)
    expect(knowledge.status).toBe('skipped')

    const modelGen = result.find(s => s.stage === 'Model generation')!
    expect(modelGen.fired).toBe(true)

    // Does NOT contain Intent classification or Stage SOP
    expect(result.find(s => s.stage === 'Intent classification')).toBeUndefined()
    expect(result.find(s => s.stage === 'Stage SOP')).toBeUndefined()
  })

  it('attaches usage from llm_response to Model generation step', () => {
    const traces: TraceRecord[] = [
      { caseId: 'test', actionType: 'llm_request_start', title: 'LLM request', createdAt: '2026-01-01T00:00:00Z' },
      { caseId: 'test', actionType: 'llm_response', title: 'LLM response', detail: JSON.stringify({ usage: { input_tokens: 120, output_tokens: 40 } }), createdAt: '2026-01-01T00:00:01Z' },
    ]
    const applicableStages = ['Model generation'] as any[]

    const result = aggregateTraces(traces, Date.now(), false, applicableStages)

    expect(result).toHaveLength(1)
    expect(result[0].usage).toEqual({ inputTokens: 120, outputTokens: 40, totalTokens: 160 })
  })
})

import { describe, it, expect } from 'vitest'
import { aggregateTraces } from '../trace-aggregator'
import type { TraceRecord } from '../persistence-port'

describe('aggregateTraces', () => {
  it('emits only applicable stages with fired/skipped', () => {
    const traces: TraceRecord[] = [
      { caseId: 'test', actionType: 'hook_hit', title: 'Hook: block-all', detail: 'block', createdAt: '2026-01-01T00:00:00Z' },
      { caseId: 'test', actionType: 'llm_request_start', title: 'LLM request: claude', createdAt: '2026-01-01T00:00:01Z' },
      { caseId: 'test', actionType: 'llm_response', title: 'LLM response', createdAt: '2026-01-01T00:00:02Z' },
    ]
    const applicableStages = ['Hooks', 'Knowledge retrieval', 'Model generation'] as any[]

    const result = aggregateTraces(traces, Date.now(), false, applicableStages)

    // Only 3 stages emitted (not all 6)
    expect(result).toHaveLength(3)

    const hooks = result.find(s => s.stage === 'Hooks')!
    expect(hooks.fired).toBe(true)
    expect(hooks.status).not.toBe('skipped')

    const knowledge = result.find(s => s.stage === 'Knowledge retrieval')!
    expect(knowledge.fired).toBe(false)
    expect(knowledge.status).toBe('skipped')

    const modelGen = result.find(s => s.stage === 'Model generation')!
    expect(modelGen.fired).toBe(true)

    // Does NOT contain old classifier/procedure labels
    expect(result.find(s => s.stage === 'Intent classification')).toBeUndefined()
    expect(result.find(s => s.stage === 'Procedure')).toBeUndefined()
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

  it('surfaces hook loop_decision records in the Hooks stage', () => {
    const traces: TraceRecord[] = [
      {
        caseId: 'test',
        actionType: 'loop_decision',
        title: 'Hook blocked Tool: create_human_task',
        payload: JSON.stringify({
          checkpoint: 'PreToolUse',
          summary: 'block',
          results: [{ hookName: 'qa_live_pretool_block_transfer', action: 'block', reason: 'PreTool block regression test' }],
        }),
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        caseId: 'test',
        actionType: 'llm_request_start',
        title: 'LLM request',
        createdAt: '2026-01-01T00:00:01Z',
      },
    ]

    const result = aggregateTraces(traces, Date.now(), false, ['Hooks', 'Model generation'] as any[])

    const hooks = result.find((step) => step.stage === 'Hooks')
    expect(hooks).toBeDefined()
    expect(hooks?.fired).toBe(true)
    expect(hooks?.status).toBe('block')
    expect(hooks?.summary).toContain('Hook blocked Tool: create_human_task')
  })

  it('maps Stop Hook fallback loop decisions into the Hooks stage as warn evidence', () => {
    const traces: TraceRecord[] = [
      {
        caseId: 'test',
        actionType: 'loop_decision',
        title: 'Stop Hook fallback',
        detail: 'Hook checkpoint Stop: escalate -> Stop Hook fallback',
        payload: JSON.stringify({
          checkpoint: 'Stop',
          summary: 'escalate',
          results: [{ hookName: 'stop_requires_human', action: 'escalate', reason: 'Needs human review before sending.' }],
        }),
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]

    const result = aggregateTraces(traces, Date.now(), false, ['Hooks'] as any[])

    expect(result).toHaveLength(1)
    expect(result[0].stage).toBe('Hooks')
    expect(result[0].status).toBe('warn')
    expect(result[0].summary).toContain('Stop Hook fallback')
    expect(result[0].events?.[0]?.label).toContain('Stop Hook fallback')
  })
})

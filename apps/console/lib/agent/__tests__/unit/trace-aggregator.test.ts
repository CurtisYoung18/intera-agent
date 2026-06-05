import { describe, it, expect } from 'vitest'
import { aggregateTraces } from '../../trace-aggregator'

describe('aggregateTraces', () => {
  const t0 = Date.now()

  it('never hides a stage that fired, even if not in applicableStages', () => {
    const recs = [
      { caseId: 'c', actionType: 'skill_result', title: 'Skill: kb_search', detail: 'ok', createdAt: new Date(t0 + 10).toISOString() },
    ]
    const out = aggregateTraces(recs as any, t0, false, ['Guardrails', 'Model generation'])
    const tools = out.find(s => s.stage === 'Skills & tools')
    expect(tools?.fired).toBe(true)
  })

  it('includes unfired applicable stages as skipped', () => {
    const out = aggregateTraces([], t0, false, ['Guardrails', 'Model generation'])
    const guards = out.find(s => s.stage === 'Guardrails')
    expect(guards?.fired).toBe(false)
    expect(guards?.status).toBe('skipped')
  })

  it('computes ms as span between first and last record, not start-offset', () => {
    const recs = [
      { caseId: 'c', actionType: 'skill_result', title: 'Tool A', detail: 'ok', createdAt: new Date(t0 + 100).toISOString() },
      { caseId: 'c', actionType: 'skill_result', title: 'Tool B', detail: 'ok', createdAt: new Date(t0 + 600).toISOString() },
    ]
    const out = aggregateTraces(recs as any, t0, false, ['Skills & tools'])
    const tools = out.find(s => s.stage === 'Skills & tools')
    expect(tools?.ms).toBe(500)
  })

  it('ms is always >= 0 (single record stage)', () => {
    const recs = [
      { caseId: 'c', actionType: 'llm_response', title: 'LLM response', detail: '{}', createdAt: new Date(t0 + 50).toISOString() },
    ]
    const out = aggregateTraces(recs as any, t0, false, ['Model generation'])
    const model = out.find(s => s.stage === 'Model generation')
    expect(model?.ms).toBeGreaterThanOrEqual(0)
  })

  it('preserves existing behavior: includes all 5 stages when no applicableStages', () => {
    const out = aggregateTraces([], t0, false)
    expect(out).toHaveLength(5)
    expect(out.every(s => s.fired === false)).toBe(true)
  })
})

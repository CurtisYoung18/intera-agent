import { describe, expect, it } from 'vitest'
import { AgentOpsMetricsQuerySchema, DEFAULT_AGENTOPS_METRICS } from '../agentops/metrics'

describe('AgentOpsMetricsQuerySchema', () => {
  it('applies read-only metrics defaults', () => {
    const parsed = AgentOpsMetricsQuerySchema.parse({})

    expect(parsed).toEqual({
      window: '20m',
      timezone: 'UTC',
      metrics: DEFAULT_AGENTOPS_METRICS,
      includeSynthetic: false,
    })
  })

  it('parses comma-separated metrics and boolean query values', () => {
    const parsed = AgentOpsMetricsQuerySchema.parse({
      window: '1h',
      timezone: 'Asia/Shanghai',
      metrics: 'handoff_rate,cost',
      includeSynthetic: 'true',
    })

    expect(parsed.metrics).toEqual(['handoff_rate', 'cost'])
    expect(parsed.includeSynthetic).toBe(true)
  })

  it('rejects unsupported windows and timezones', () => {
    expect(() => AgentOpsMetricsQuerySchema.parse({ window: '30m' })).toThrow()
    expect(() => AgentOpsMetricsQuerySchema.parse({ timezone: 'Moon/Base' })).toThrow()
  })

  it('rejects inverted explicit date ranges', () => {
    expect(() => AgentOpsMetricsQuerySchema.parse({
      from: '2026-06-26T01:00:00.000Z',
      to: '2026-06-26T00:00:00.000Z',
    })).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import {
  AgentOpsReplayAssertionPathSchema,
  AgentOpsReplayRequestSchema,
} from '../agentops/replay'

const baseRequest = {
  mode: 'local_dry_run',
  draftAgentConfigId: 'agent_default_v2',
  source: {
    type: 'observed',
    scenario: {
      name: 'deposit_gmt_check',
      turns: [{ role: 'user', content: 'Check my deposit.' }],
      expected: {},
    },
  },
  observed: {
    toolCalls: [{
      name: 'get_latest_deposit',
      input: { gmt: '+5' },
      executionMode: 'mocked',
    }],
  },
  assertions: [{
    type: 'tool_input_equals',
    toolName: 'get_latest_deposit',
    path: 'gmt',
    expected: '+5',
  }],
} as const

describe('AgentOpsReplayRequestSchema', () => {
  it('accepts local dry-run replay requests', () => {
    const parsed = AgentOpsReplayRequestSchema.parse(baseRequest)

    expect(parsed.mode).toBe('local_dry_run')
    expect(parsed.assertions[0]).toMatchObject({
      type: 'tool_input_equals',
      callIndex: 0,
    })
  })

  it('rejects non-local_dry_run modes', () => {
    expect(() => AgentOpsReplayRequestSchema.parse({
      ...baseRequest,
      mode: 'agentRuntime',
    })).toThrow()
  })

  it('rejects empty assertions', () => {
    expect(() => AgentOpsReplayRequestSchema.parse({
      ...baseRequest,
      assertions: [],
    })).toThrow()
  })

  it('rejects malformed or unsafe assertion paths', () => {
    expect(() => AgentOpsReplayAssertionPathSchema.parse('account..id')).toThrow()
    expect(() => AgentOpsReplayAssertionPathSchema.parse('$.account.id')).toThrow()
    expect(() => AgentOpsReplayAssertionPathSchema.parse('__proto__.polluted')).toThrow()
  })

  it('requires observed evidence for observed sources', () => {
    const { observed: _observed, ...withoutObserved } = baseRequest

    expect(() => AgentOpsReplayRequestSchema.parse(withoutObserved)).toThrow()
  })
})

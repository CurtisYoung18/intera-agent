import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GuardrailHook } from '@intera/shared/types'

const h = vi.hoisted(() => ({
  policyRows: [] as Array<{
    name: string
    guardrailConfig: string | null
    enabled: boolean
    agentConfigId: string
  }>,
  findMany: vi.fn(),
  auditCreate: vi.fn(),
}))

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    policy: {
      findMany: h.findMany,
    },
    auditLog: {
      create: h.auditCreate,
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { PolicyEngine } from '@/lib/agent/policy'

function hook(name: string, overrides: Partial<GuardrailHook>): {
  name: string
  guardrailConfig: string
  enabled: boolean
  agentConfigId: string
} {
  const base: GuardrailHook = {
    when: 'preTool',
    match: { tools: [] },
    check: { kind: 'rule' },
    onViolation: { action: 'block' },
    onUnavailable: { action: 'closed' },
    ...overrides,
  }
  return {
    name,
    guardrailConfig: JSON.stringify(base),
    enabled: true,
    agentConfigId: 'agent_default_v1',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.policyRows = [
    hook('no_high_risk_account_change', {
      when: 'preTool',
      match: { tools: ['refund_money'] },
      check: { kind: 'rule', denyTools: ['refund_money'] },
      onViolation: { action: 'block', guidance: 'No refunds from the agent.' },
    }),
    hook('investigate_before_escalation', {
      when: 'preTool',
      match: { tools: ['create_human_task'] },
      check: { kind: 'rule', requireToolsAny: ['get_latest_deposit'] },
      onViolation: { action: 'block', guidance: 'Investigate first.' },
    }),
    hook('inactive_escalation_guard', {
      when: 'preTool',
      match: { tools: ['create_human_task'] },
      check: { kind: 'rule', denyTools: ['create_human_task'] },
      onViolation: { action: 'block', guidance: 'Would block if loaded.' },
    }),
  ]
  h.findMany.mockImplementation(async (args: any) => {
    const where = args?.where ?? {}
    return h.policyRows.filter((p) => p.agentConfigId === where.agentConfigId && p.enabled === where.enabled)
  })
  h.auditCreate.mockResolvedValue({})
})

describe('PolicyEngine case-type activation', () => {
  it('loads only safety-floor guardrails plus active case guardrails', async () => {
    const engine = await PolicyEngine.create('agent_default_v1', ['investigate_before_escalation'])

    expect(engine.getPolicyNames()).toEqual([
      'no_high_risk_account_change',
      'investigate_before_escalation',
    ])
  })

  it('does not fire a DB guardrail that is not activated by the case type', async () => {
    const engine = await PolicyEngine.create('agent_default_v1', [])

    const result = await engine.evaluate('preTool', {
      toolName: 'create_human_task',
      toolsCalled: [],
      skillInput: { queue: 'support' },
    })

    expect(engine.getPolicyNames()).toEqual(['no_high_risk_account_change'])
    expect(result.summary).toBe('pass')
  })

  it('fires an activated case guardrail and stops firing once its prerequisite is met', async () => {
    const engine = await PolicyEngine.create('agent_default_v1', ['investigate_before_escalation'])

    const blocked = await engine.evaluate('preTool', {
      toolName: 'create_human_task',
      toolsCalled: [],
      skillInput: { queue: 'support' },
    })
    const passed = await engine.evaluate('preTool', {
      toolName: 'create_human_task',
      toolsCalled: ['get_latest_deposit'],
      skillInput: { queue: 'support' },
    })

    expect(blocked.summary).toBe('blocked')
    expect(blocked.results.map((r) => r.policyName)).toContain('investigate_before_escalation')
    expect(passed.summary).toBe('pass')
  })

  it('still fires the safety floor when the active case list is empty', async () => {
    const engine = await PolicyEngine.create('agent_default_v1', [])

    const result = await engine.evaluate('preTool', {
      toolName: 'refund_money',
      toolsCalled: [],
      skillInput: { amount: 100 },
    })

    expect(result.summary).toBe('blocked')
    expect(result.results.map((r) => r.policyName)).toContain('no_high_risk_account_change')
  })

  it('provides a built-in human review guardrail when activated without a DB row', async () => {
    h.policyRows = h.policyRows.filter((p) => p.name !== 'human_review_before_finalize')
    const engine = await PolicyEngine.create('agent_default_v1', ['human_review_before_finalize'])

    const blocked = await engine.evaluate('preFinalize', {
      toolName: 'finalize_case',
      toolsCalled: ['get_latest_deposit'],
    })
    const passed = await engine.evaluate('preFinalize', {
      toolName: 'finalize_case',
      toolsCalled: ['create_human_task'],
    })

    expect(engine.getPolicyNames()).toEqual([
      'no_high_risk_account_change',
      'human_review_before_finalize',
    ])
    expect(blocked.summary).toBe('blocked')
    expect(passed.summary).toBe('pass')
  })
})

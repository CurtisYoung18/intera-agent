import { describe, expect, it } from 'vitest'
import type { SavedScenario } from '@intera/shared/contracts/scenarios'
import { evaluateScenario, runScenarioHarness } from '../runner'

const baseScenario: SavedScenario = {
  id: 'scenario-1',
  agentConfigId: 'agent_default_v1',
  name: 'deposit_missing_evidence',
  displayName: 'Deposit missing evidence',
  description: 'Escalates when provider evidence is unclear',
  locale: 'en-US',
  tags: ['deposit'],
  enabled: true,
  turns: [
    { role: 'user', content: 'My deposit has not arrived.' },
    { role: 'assistant', content: 'I will transfer this to a human specialist.' },
  ],
  expected: {
    caseType: 'deposit_issue',
    toolsCalled: ['get_latest_deposit'],
    hooks: [{ hookName: 'conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate' }],
    humanTransfer: true,
    finalStatus: 'waiting_human',
    forbiddenPhrases: ['guaranteed compensation'],
  },
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z',
}

describe('Scenario runner harness', () => {
  it('generates a passing receipt with Tool, Hook, Knowledge, and handoff evidence', () => {
    const receipt = runScenarioHarness(baseScenario, {
      knowledgeHits: [{ source: 'gptbots', title: 'Deposit FAQ' }],
    })

    expect(receipt.status).toBe('passed')
    expect(receipt.evidence.toolsCalled).toContain('get_latest_deposit')
    expect(receipt.evidence.hookDecisions[0]).toMatchObject({
      hookName: 'conflict_requires_human',
      checkpoint: 'PostToolUse',
      decision: 'escalate',
    })
    expect(receipt.evidence.knowledgeHits[0]).toMatchObject({ source: 'gptbots' })
    expect(receipt.evidence.humanTransfer).toBe(true)
    expect(receipt.evidence.handoff[0]).toMatchObject({ required: true })
    expect(receipt.checks.every((check) => check.passed)).toBe(true)
  })

  it('fails when observed evidence violates expectations', () => {
    const receipt = runScenarioHarness(baseScenario, {
      toolsCalled: [],
      hookDecisions: [],
      humanTransfer: false,
      finalStatus: 'completed',
      finalResponse: 'Your guaranteed compensation is ready.',
    })

    expect(receipt.status).toBe('failed')
    expect(receipt.checks.some((check) => check.name === 'tool:get_latest_deposit' && !check.passed)).toBe(true)
    expect(receipt.checks.some((check) => check.name === 'human_transfer' && !check.passed)).toBe(true)
    expect(receipt.checks.some((check) => check.name === 'forbidden_phrase:guaranteed compensation' && !check.passed)).toBe(true)
  })

  it('supports explicit Tool call count ranges', () => {
    const checks = evaluateScenario(
      { toolCalls: [{ name: 'get_latest_deposit', minCalls: 1, maxCalls: 1 }] },
      {
        toolsCalled: ['get_latest_deposit', 'get_latest_deposit'],
        hookDecisions: [],
        knowledgeHits: [],
        humanTransfer: false,
        handoff: [],
      },
    )

    expect(checks).toHaveLength(1)
    expect(checks[0].passed).toBe(false)
    expect(checks[0].detail).toContain('saw 2')
  })
})

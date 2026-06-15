import { describe, expect, it } from 'vitest'
import type { SavedScenario } from '@intera/shared/contracts/scenarios'
import { buildScenarioReceipt, evaluateScenario, runScenarioHarness } from '../runner'

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
    procedureStatus: 'completed',
    procedureOutcome: 'handed_off',
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

    expect(receipt.status).toBe('pass')
    expect(receipt.executionMode).toBe('fixture')
    expect(receipt.toolExecutionMode).toBe('mocked')
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

    expect(receipt.status).toBe('fail')
    expect(receipt.checks.some((check) => check.name === 'tool:get_latest_deposit' && !check.passed)).toBe(true)
    expect(receipt.checks.some((check) => check.name === 'human_transfer' && !check.passed)).toBe(true)
    expect(receipt.checks.some((check) => check.name === 'forbidden_phrase:guaranteed compensation' && !check.passed)).toBe(true)
    expect(receipt.failureReasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      'required_tool_missing',
      'forbidden_phrase_present',
    ]))
  })

  it('builds runtime-backed receipts from observed runtime evidence', () => {
    const receipt = buildScenarioReceipt(baseScenario, {
      caseType: 'deposit_issue',
      toolsCalled: ['get_latest_deposit'],
      toolCalls: [{ name: 'get_latest_deposit', input: { id: 'D123' }, executionMode: 'mocked' }],
      toolResults: [{ name: 'get_latest_deposit', output: { _dryRun: true, status: 'needs_review' }, executionMode: 'mocked' }],
      hookDecisions: [{ hookName: 'conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate', reason: 'Provider proof mismatch' }],
      humanTransfer: true,
      handoff: [{ required: true, reason: 'create_human_task observed', target: 'human' }],
      finalResponse: 'I will transfer this to a human specialist.',
      finalStatus: 'waiting_human',
      procedureStatus: 'completed',
      procedureOutcome: 'handed_off',
    }, {
      executionMode: 'agentRuntime',
      toolExecutionMode: 'mocked',
    })

    expect(receipt.status).toBe('pass')
    expect(receipt.executionMode).toBe('agentRuntime')
    expect(receipt.evidence.toolCalls[0]).toMatchObject({ name: 'get_latest_deposit', executionMode: 'mocked' })
    expect(receipt.evidence.toolResults[0]).toMatchObject({ name: 'get_latest_deposit', executionMode: 'mocked' })
    expect(receipt.evidence.hookDecisions[0]).toMatchObject({ hookName: 'conflict_requires_human', decision: 'escalate' })
  })

  it('backfills Procedure status and outcome from runtime procedureRuns when top-level evidence fields are missing', () => {
    const receipt = buildScenarioReceipt(baseScenario, {
      caseType: 'deposit_issue',
      toolsCalled: ['get_latest_deposit'],
      toolCalls: [{ name: 'get_latest_deposit', executionMode: 'runtime' }],
      toolResults: [{ name: 'get_latest_deposit', output: { status: 'needs_review' }, executionMode: 'runtime' }],
      hookDecisions: [{ hookName: 'conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate' }],
      humanTransfer: true,
      handoff: [{ required: true, target: 'human' }],
      finalResponse: 'I will transfer this to a human specialist.',
      finalStatus: 'waiting_human',
      runtime: {
        procedureRuns: [{
          runId: 'run-1',
          procedureId: 'deposit_issue',
          displayName: 'Deposit',
          status: 'completed',
          outcome: 'handed_off',
          version: 'v2',
          updatedAt: '2026-06-15T10:00:00.000Z',
          currentStepId: null,
          blockers: [],
          inputs: [],
          branches: [],
          evaluations: [],
          evidence: [],
        }],
      },
    }, {
      executionMode: 'agentRuntime',
      toolExecutionMode: 'runtime',
    })

    expect(receipt.evidence.procedureStatus).toBe('completed')
    expect(receipt.evidence.procedureOutcome).toBe('handed_off')
    expect(receipt.checks.find((check) => check.name === 'procedure_status')?.passed).toBe(true)
    expect(receipt.checks.find((check) => check.name === 'procedure_outcome')?.passed).toBe(true)
  })

  it('supports explicit Tool call count ranges', () => {
    const checks = evaluateScenario(
      { toolCalls: [{ name: 'get_latest_deposit', minCalls: 1, maxCalls: 1 }] },
      {
        toolsCalled: ['get_latest_deposit', 'get_latest_deposit'],
        toolCalls: [],
        toolResults: [],
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

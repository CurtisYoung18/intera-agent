import { describe, expect, it } from 'vitest'
import { AgentOpsReplayRequestSchema } from '@intera/shared/contracts/agentops/replay'
import type { SavedScenario } from '@intera/shared/contracts/scenarios'
import { buildAgentOpsReplayReceipt } from '..'

const scenario: SavedScenario = {
  id: 'scenario-1',
  agentConfigId: 'agent-default-v2',
  name: 'deposit_gmt_check',
  displayName: 'Deposit GMT check',
  description: 'Verifies the deposit Tool timezone argument.',
  locale: 'en-US',
  tags: ['deposit'],
  enabled: true,
  turns: [{ role: 'user', content: 'Check my latest deposit.' }],
  expected: {
    toolCalls: [{ name: 'get_latest_deposit', minCalls: 1 }],
    hooks: [{ hookName: 'deposit_before_tool', checkpoint: 'PreToolUse', decision: 'allow' }],
  },
  createdAt: '2026-06-26T00:00:00.000Z',
  updatedAt: '2026-06-26T00:00:00.000Z',
}

function buildRequest(overrides: Record<string, unknown> = {}) {
  return AgentOpsReplayRequestSchema.parse({
    mode: 'local_dry_run',
    draftAgentConfigId: 'agent-default-v2',
    source: {
      type: 'observed',
      scenario: {
        name: 'deposit_gmt_check',
        turns: [{ role: 'user', content: 'Check my latest deposit.' }],
        expected: {},
      },
    },
    observed: {
      toolCalls: [{
        name: 'get_latest_deposit',
        input: { payload: { gmt: '+5' } },
        executionMode: 'mocked',
      }],
      hookDecisions: [{
        hookName: 'deposit_before_tool',
        checkpoint: 'PreToolUse',
        toolName: 'get_latest_deposit',
        decision: 'allow',
      }],
    },
    assertions: [
      {
        type: 'tool_input_equals',
        toolName: 'get_latest_deposit',
        path: 'payload.gmt',
        expected: '+5',
      },
      {
        type: 'hook_outcome',
        hookName: 'deposit_before_tool',
        checkpoint: 'PreToolUse',
        toolName: 'get_latest_deposit',
        decision: 'allow',
      },
    ],
    ...overrides,
  })
}

describe('buildAgentOpsReplayReceipt', () => {
  it('passes tool_input_equals and hook_outcome assertions over observed evidence', () => {
    const receipt = buildAgentOpsReplayReceipt({
      agentId: 'agent-default-v1',
      draftAgentConfigId: 'agent-default-v2',
      request: buildRequest(),
      now: new Date('2026-06-26T01:00:00.000Z'),
      receiptId: 'replay-test-pass',
    })

    expect(receipt.status).toBe('pass')
    expect(receipt.toolSafety.externalToolCalls).toBe(false)
    expect(receipt.assertions).toHaveLength(2)
    expect(receipt.assertions.every((assertion) => assertion.status === 'pass')).toBe(true)
    expect(receipt.scenarioReceipt).toBeNull()
  })

  it('fails mismatched tool_input_equals and hook_outcome assertions', () => {
    const request = buildRequest({
      assertions: [
        {
          type: 'tool_input_equals',
          toolName: 'get_latest_deposit',
          path: 'payload.gmt',
          expected: '+7',
        },
        {
          type: 'hook_outcome',
          hookName: 'deposit_before_tool',
          checkpoint: 'PreToolUse',
          decision: 'block',
        },
      ],
    })

    const receipt = buildAgentOpsReplayReceipt({
      agentId: 'agent-default-v1',
      draftAgentConfigId: 'agent-default-v2',
      request,
      receiptId: 'replay-test-fail',
    })

    expect(receipt.status).toBe('fail')
    expect(receipt.assertions.map((assertion) => assertion.status)).toEqual(['fail', 'fail'])
    expect(receipt.toolSafety.externalToolCalls).toBe(false)
  })

  it('blocks when observed Tool evidence indicates runtime or external execution', () => {
    const request = buildRequest({
      observed: {
        toolCalls: [{
          name: 'get_latest_deposit',
          input: { payload: { gmt: '+5' } },
          executionMode: 'runtime',
        }],
        hookDecisions: [],
      },
      assertions: [{
        type: 'tool_input_equals',
        toolName: 'get_latest_deposit',
        path: 'payload.gmt',
        expected: '+5',
      }],
    })

    const receipt = buildAgentOpsReplayReceipt({
      agentId: 'agent-default-v1',
      draftAgentConfigId: 'agent-default-v2',
      request,
      receiptId: 'replay-test-blocked',
    })

    expect(receipt.status).toBe('blocked')
    expect(receipt.toolSafety.externalToolCalls).toBe(true)
    expect(receipt.toolSafety.runtimeToolExecution).toBe(false)
    expect(receipt.assertions[0]).toMatchObject({ status: 'blocked', passed: false })
  })

  it('builds fixture Scenario receipt summaries without marking validation', () => {
    const request = AgentOpsReplayRequestSchema.parse({
      mode: 'local_dry_run',
      draftAgentConfigId: 'agent-default-v2',
      source: { type: 'scenario', name: 'deposit_gmt_check' },
      assertions: [{
        type: 'hook_outcome',
        hookName: 'deposit_before_tool',
        checkpoint: 'PreToolUse',
        decision: 'allow',
      }],
    })

    const receipt = buildAgentOpsReplayReceipt({
      agentId: 'agent-default-v1',
      draftAgentConfigId: 'agent-default-v2',
      request,
      scenario,
      receiptId: 'replay-test-scenario',
    })

    expect(receipt.status).toBe('pass')
    expect(receipt.scenarioReceipt).toMatchObject({
      scenarioName: 'deposit_gmt_check',
      executionMode: 'fixture',
      toolExecutionMode: 'mocked',
      validationStateChanged: false,
    })
    expect(receipt.toolSafety.scenarioReceiptsAppended).toBe(false)
    expect(receipt.toolSafety.scenarioValidationMarkedValidated).toBe(false)
  })
})

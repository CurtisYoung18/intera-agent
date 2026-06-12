import { describe, expect, it } from 'vitest'
import { evaluateProcedureLlmCondition } from '../../procedure-llm-evaluator'
import type { AgentConfigData } from '@intera/shared/types'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'

const config: AgentConfigData = {
  model: 'claude-sonnet-4-20250514',
  temperature: 0,
  thinkingBudget: 1024,
  maxIterations: 3,
  maxOutputTokens: 1024,
  extendedThinking: false,
  memoryStrategy: DEFAULT_MEMORY_STRATEGY,
}

describe('procedure-llm-evaluator', () => {
  it('parses a structured tool-call decision from the evaluator model', async () => {
    const result = await evaluateProcedureLlmCondition(
      {
        caseId: 'case-1',
        runId: 'run-1',
        procedureId: 'deposit_issue',
        procedureDisplayName: 'Deposit',
        stepId: 'triage',
        branchId: 'handoff',
        conditionId: 'handoff_eval',
        prompt: 'Does the latest customer message explicitly ask for a person now?',
        basedOnInputEpoch: 2,
        recentInputs: [
          {
            eventId: 'evt-1',
            inputEpoch: 1,
            source: 'customer_message',
            origin: 'customer',
            createdAt: '2026-06-12T00:00:00.000Z',
            content: 'Where is the deposit page?',
          },
          {
            eventId: 'evt-2',
            inputEpoch: 2,
            source: 'customer_message',
            origin: 'customer',
            createdAt: '2026-06-12T00:00:10.000Z',
            content: 'Please connect me to a human.',
          },
        ],
        recentEvidence: [],
      },
      config,
      {
        messages: {
          create: async () => ({
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'record_procedure_evaluation',
                input: {
                  decision: 'matched',
                  reason: 'The latest customer message explicitly asks for a human.',
                },
              },
            ],
          }),
        },
      } as any,
    )

    expect(result).toMatchObject({
      decision: 'matched',
      reason: 'The latest customer message explicitly asks for a human.',
    })
    expect(result.metadata).toMatchObject({
      conditionId: 'handoff_eval',
      basedOnInputEpoch: 2,
      recentInputCount: 2,
      recentEvidenceCount: 0,
      source: 'provider_evaluator',
    })
    expect(typeof result.metadata?.promptHash).toBe('string')
    expect(String(result.metadata?.promptHash)).toHaveLength(64)
    expect(result.metadata).not.toHaveProperty('prompt')
    expect(JSON.stringify(result.metadata)).not.toContain('Where is the deposit page?')
    expect(JSON.stringify(result.metadata)).not.toContain('Please connect me to a human.')
  })
})

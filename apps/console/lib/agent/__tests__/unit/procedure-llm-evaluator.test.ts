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

  it('includes structured tool evidence details in the evaluator prompt for conflict checks', async () => {
    let capturedPrompt = ''

    await evaluateProcedureLlmCondition(
      {
        caseId: 'case-2',
        runId: 'run-2',
        procedureId: 'deposit_not_credited',
        procedureDisplayName: 'Deposit not credited',
        stepId: 'review_recent_transactions',
        branchId: 'review_recent_transactions_when',
        conditionId: 'review_recent_transactions_when',
        prompt: 'Use when the deposit result is missing, stale, or inconsistent.',
        basedOnInputEpoch: 2,
        recentInputs: [
          {
            eventId: 'evt-form',
            inputEpoch: 2,
            source: 'customer_form_result',
            origin: 'customer',
            createdAt: '2026-06-16T18:05:00.000Z',
            content: 'Tool ask_user_questions result: {"member_id":"JAYA113C88F","amount":"200","payment_channel":"USDT","deposit_time":"2026-06-16"}',
            formAnswers: {
              member_id: 'JAYA113C88F',
              amount: '200',
              payment_channel: 'USDT',
              deposit_time: '2026-06-16',
            },
          },
        ],
        recentEvidence: [
          {
            id: 'tool-lookup-1',
            kind: 'tool',
            stepId: 'lookup_latest_deposit',
            actionId: 'lookup_latest_deposit_tool',
            label: 'Tool result: get_latest_deposit',
            toolName: 'get_latest_deposit',
            basedOnInputEpoch: 2,
            state: 'canonical',
            createdAt: '2026-06-16T18:05:10.000Z',
            metadata: {
              outcome: 'succeeded',
              output: {
                order_no: '3142251',
                amount: '200',
                status: 'approved',
                created_at: '2026-06-12 20:02:17',
                channel: 'USDT',
              },
            },
          },
        ],
      },
      config,
      {
        messages: {
          create: async (request: any) => {
            capturedPrompt = String(request.messages?.[0]?.content ?? '')
            return {
              content: [
                {
                  type: 'tool_use',
                  id: 'tool-2',
                  name: 'record_procedure_evaluation',
                  input: {
                    decision: 'matched',
                    reason: 'The customer-reported deposit time is newer than the latest deposit result, so recent history review is required.',
                  },
                },
              ],
            }
          },
        },
      } as any,
    )

    expect(capturedPrompt).toContain('form={"member_id":"JAYA113C88F","amount":"200","payment_channel":"USDT","deposit_time":"2026-06-16"}')
    expect(capturedPrompt).toContain('toolName=get_latest_deposit')
    expect(capturedPrompt).toContain('output={"order_no":"3142251","amount":"200","status":"approved","created_at":"2026-06-12 20:02:17","channel":"USDT"}')
  })
})

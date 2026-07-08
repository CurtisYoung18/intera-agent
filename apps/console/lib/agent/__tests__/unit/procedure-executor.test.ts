import { describe, it, expect } from 'vitest'
import {
  ProcedureExecutor,
} from '../../procedure-executor'
import type { ProcedureV2 } from '@intera/shared/types'

const proc: ProcedureV2 = {
  version: 'v2',
  whenToUse: 'Use this when a deposit is missing and the member needs account verification.',
  steps: [
    {
      id: 'understand_issue',
      title: 'Understand the issue',
      guidance: 'Confirm what the member needs before touching account tools.',
      actions: [
        { id: 'ask_member', kind: 'ask', label: 'Ask for member id', fields: ['member_id'], required: true },
      ],
    },
    {
      id: 'investigate_deposit',
      title: 'Investigate the latest deposit',
      guidance: 'Check the latest deposit after collecting the member id.',
      actions: [
        { id: 'check_deposit', kind: 'call_tool', label: 'Check latest deposit', toolName: 'get_latest_deposit', required: true },
      ],
      branches: [
        {
          id: 'if_flagged',
          kind: 'if',
          condition: { kind: 'llm_eval', prompt: 'Only if the account is flagged.' },
          actions: [
            { id: 'check_kyc', kind: 'call_tool', label: 'Check KYC', toolName: 'get_kyc_status', required: false },
          ],
        },
      ],
    },
    {
      id: 'close_case',
      title: 'Close the procedure',
      guidance: 'Explain the outcome and next step.',
      actions: [
        { id: 'close', kind: 'end', label: 'Finalize the procedure', status: 'completed', required: true },
      ],
    },
  ],
}

const knowledgeProc: ProcedureV2 = {
  version: 'v2',
  whenToUse: 'Use this for knowledge-only questions.',
  steps: [
    {
      id: 'search_policy',
      title: 'Search policy',
      guidance: 'Check the configured knowledge source first.',
      actions: [
        {
          id: 'search_bonus_policy',
          kind: 'search_knowledge',
          label: 'Search bonus policy',
          suggestedSources: ['deposit_bonus'],
        },
      ],
    },
  ],
}

describe('ProcedureExecutor', () => {
  it('requiredTools + isComplete delegate to the pure helpers', () => {
    const ex = new ProcedureExecutor(proc, 'deposit_issue')
    expect(ex.requiredTools()).toEqual(['get_latest_deposit'])
    expect(ex.isComplete({ calledTools: ['get_latest_deposit'], finalized: true })).toBe(true)
    expect(ex.isComplete({ calledTools: [], finalized: true })).toBe(false)
  })

  it('renders steps in order with guidance and branch conditions', () => {
    const ex = new ProcedureExecutor(proc, 'deposit_issue')
    const out = ex.buildDefinitionPrompt()
    expect(out.indexOf('1.')).toBeGreaterThanOrEqual(0)
    expect(out.indexOf('1.')).toBeLessThan(out.indexOf('2.'))
    expect(out.indexOf('2.')).toBeLessThan(out.indexOf('3.'))
    expect(out).toContain('Check latest deposit')
    expect(out).toContain('Only if the account is flagged')
  })

  it('handles an empty procedure definition', () => {
    const ex = new ProcedureExecutor({ version: 'v2', whenToUse: 'test', steps: [] }, 'deposit_issue')
    expect(ex.buildDefinitionPrompt()).toContain('no steps')
  })

  it('matches knowledge actions from structured knowledge tool names instead of prefix guessing', () => {
    const ex = new ProcedureExecutor(knowledgeProc, 'knowledge_issue', new Set(['lookup_bonus_policy']))
    expect(ex.stepIdsForTool('lookup_bonus_policy')).toContain('search_policy')
    expect(ex.stepIdsForTool('kb_search_bonus_policy')).not.toContain('search_policy')
  })

  it('selects current-step action tools for schema filtering', () => {
    const ex = new ProcedureExecutor(proc, 'deposit_issue')
    expect(ex.toolSelectionForStep('understand_issue')).toEqual({
      toolNames: ['ask_user_questions'],
      includesKnowledgeTools: false,
    })
    expect(ex.toolSelectionForStep('investigate_deposit')).toEqual({
      toolNames: ['get_latest_deposit', 'get_kyc_status'],
      includesKnowledgeTools: false,
    })
    expect(ex.toolSelectionForStep('missing_step')).toBeNull()

    const knowledgeEx = new ProcedureExecutor(knowledgeProc, 'knowledge_issue', new Set(['lookup_bonus_policy']))
    expect(knowledgeEx.toolSelectionForStep('search_policy')).toEqual({
      toolNames: ['lookup_bonus_policy'],
      includesKnowledgeTools: true,
    })
  })
})

import { describe, it, expect } from 'vitest'
import {
  PROCEDURE_V2_ACTION_KINDS,
  buildProcedureConditionLabel,
  parseProcedure,
  procedureV2Schema,
  simulateProcedure,
} from '../case-types'

describe('Procedure v2 contract', () => {
  const procedureV2 = {
    version: 'v2' as const,
    whenToUse: 'Use this when the customer reports a missing deposit or asks where to find deposit evidence.',
    overview: 'Collect evidence, search knowledge if needed, then investigate or hand off.',
    runtimeSignalDetectors: [
      {
        signal: 'knowledge_gap' as const,
        patterns: ['where can i find'],
      },
    ],
    steps: [
      {
        id: 'understand_issue',
        title: 'Understand the issue',
        guidance: 'Confirm what the customer needs before looking up account data.',
        actions: [
          { id: 'ask_context', kind: 'ask' as const, label: 'Ask for missing details', fields: ['member_id', 'amount'] },
          { id: 'search_guidance', kind: 'search_knowledge' as const, label: 'Search help center', suggestedSources: ['deposit_faq'] },
        ],
        branches: [
          {
            id: 'if_no_progress',
            kind: 'if' as const,
            condition: { id: 'no_progress', kind: 'runtime_signal' as const, signal: 'no_progress_loop' as const },
            actions: [
              { id: 'handoff_now', kind: 'request_human_handoff' as const, label: 'Request human help', queue: 'general' },
            ],
          },
        ],
      },
      {
        id: 'investigate',
        title: 'Investigate with the latest evidence',
        guidance: 'Use the account tool only after the needed details are available.',
        actions: [
          { id: 'lookup_deposit', kind: 'call_tool' as const, label: 'Check latest deposit', toolName: 'get_latest_deposit' },
          { id: 'wrap_up', kind: 'end' as const, label: 'Explain next step', status: 'completed' as const },
        ],
        branches: [],
      },
    ],
  }

  it('accepts a v2 definition with natural-language guidance, actions, and branches', () => {
    const parsed = procedureV2Schema.parse(procedureV2)
    expect(parsed.steps).toHaveLength(2)
    expect(parsed.steps[0].branches?.[0].actions[0].kind).toBe('request_human_handoff')
    expect([...PROCEDURE_V2_ACTION_KINDS]).toEqual(
      ['ask', 'search_knowledge', 'call_tool', 'request_human_handoff', 'end'],
    )
  })

  it('parses only v2 definitions from storage JSON', () => {
    const parsed = parseProcedure(JSON.stringify(procedureV2))
    expect(parsed?.version).toBe('v2')
    expect(parsed?.whenToUse).toContain('missing deposit')
  })

  it('rejects legacy step-list JSON from the v2 parser', () => {
    expect(parseProcedure('{"steps":[{"id":"ask_member","action":"ask"}]}')).toBeNull()
  })

  it('keeps v2 action semantics explicit instead of collapsing steps into legacy action strings', () => {
    const parsed = procedureV2Schema.parse(procedureV2)
    expect(parsed.steps[0].actions.map((action) => action.kind)).toEqual(['ask', 'search_knowledge'])
    expect(parsed.steps[1].actions.map((action) => action.kind)).toEqual(['call_tool', 'end'])
  })

  it('builds readable condition labels for the authoring and preview surfaces', () => {
    expect(buildProcedureConditionLabel({ kind: 'tool_event', toolName: 'get_latest_deposit', event: 'succeeded' })).toBe('get_latest_deposit succeeded')
    expect(buildProcedureConditionLabel({ kind: 'runtime_signal', signal: 'knowledge_gap' })).toBe('knowledge gap')
  })

  it('produces a lightweight simulation receipt for preview', () => {
    const receipt = simulateProcedure(procedureV2, {
      signals: ['no_progress_loop'],
      handoffRequested: true,
    })
    expect(receipt.status).toBe('handoff')
    expect(receipt.steps[0]).toMatchObject({
      stepId: 'understand_issue',
      status: 'completed',
      matchedBranchId: 'if_no_progress',
    })
  })

  it('matches knowledge tool events in simulation from explicit knowledge tool names, not kb_search_ prefixes', () => {
    const procedureWithKnowledgeEvent = {
      version: 'v2' as const,
      whenToUse: 'Use this when a docs lookup tool should drive the next branch.',
      runtimeSignalDetectors: [],
      steps: [
        {
          id: 'docs_step',
          title: 'Search docs',
          guidance: 'Use the configured docs search tool.',
          actions: [],
          branches: [
            {
              id: 'docs_hit',
              kind: 'if' as const,
              condition: {
                id: 'docs_tool_hit',
                kind: 'tool_event' as const,
                toolName: 'faq_lookup_default',
                event: 'succeeded' as const,
              },
              actions: [
                { id: 'finish', kind: 'end' as const, label: 'Done', status: 'completed' as const },
              ],
            },
          ],
        },
      ],
    }

    const receipt = simulateProcedure(procedureWithKnowledgeEvent, {
      knowledgeToolNames: ['faq_lookup_default'],
      knowledgeSearches: 1,
      ended: true,
    })

    expect(receipt.steps[0]).toMatchObject({
      stepId: 'docs_step',
      status: 'completed',
      matchedBranchId: 'docs_hit',
    })
  })
})

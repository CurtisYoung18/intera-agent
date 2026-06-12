import { describe, it, expect } from 'vitest'
import {
  PROCEDURE_ACTIONS,
  PROCEDURE_V2_ACTION_KINDS,
  buildProcedureConditionLabel,
  isProcedureV2Definition,
  normalizeProcedureDefinition,
  procedureActionSchema,
  procedureDefinitionSchema,
  procedureStepSchema,
  procedureSchema,
  parseProcedure,
  parseProcedureDefinition,
  procedureV2Schema,
  simulateProcedureDefinition,
} from '../case-types'

// Procedure contract guards: ordered steps with a closed action vocabulary.

describe('Procedure contract (Phase 1)', () => {
  it('exposes the closed action vocabulary', () => {
    expect([...PROCEDURE_ACTIONS].sort()).toEqual(
      ['ask', 'decide', 'escalate', 'finalize', 'read', 'tag', 'use'],
    )
    expect(procedureActionSchema.safeParse('use').success).toBe(true)
  })

  it('round-trips a valid procedure', () => {
    const proc = {
      steps: [
        { id: 'ask_member', action: 'ask', target: 'member_id', required: true },
        {
          id: 'check_deposit',
          action: 'use',
          target: 'get_latest_deposit',
          guidance: 'Look up the latest deposit',
          when: 'only if balance unchanged',
          required: true,
        },
        { id: 'close', action: 'finalize', target: 'resolved' },
      ],
    }
    const parsed = procedureSchema.parse(proc)
    expect(parsed.steps).toHaveLength(3)
    expect(parsed.steps[1]).toEqual({
      id: 'check_deposit',
      action: 'use',
      target: 'get_latest_deposit',
      guidance: 'Look up the latest deposit',
      when: 'only if balance unchanged',
      required: true,
    })
  })

  it('rejects an unknown action', () => {
    expect(procedureStepSchema.safeParse({ id: 's1', action: 'frobnicate' }).success).toBe(false)
  })

  it('rejects a step missing id', () => {
    expect(procedureStepSchema.safeParse({ action: 'use', target: 'get_latest_deposit' }).success).toBe(false)
  })

  it('rejects an empty-string id', () => {
    expect(procedureStepSchema.safeParse({ id: '', action: 'use' }).success).toBe(false)
  })
})

describe('parseProcedure (safe runtime parse)', () => {
  it('parses a JSON procedure string', () => {
    const p = parseProcedure('{"steps":[{"id":"a","action":"finalize"}]}')
    expect(p?.steps[0]).toEqual({ id: 'a', action: 'finalize' })
  })

  it('returns null for null / empty / malformed JSON', () => {
    expect(parseProcedure(null)).toBeNull()
    expect(parseProcedure(undefined)).toBeNull()
    expect(parseProcedure('')).toBeNull()
    expect(parseProcedure('{not json')).toBeNull()
  })

  it('returns null when the shape is invalid (unknown action)', () => {
    expect(parseProcedure('{"steps":[{"id":"a","action":"nope"}]}')).toBeNull()
  })
})

describe('Procedure v2 contract', () => {
  const procedureV2 = {
    version: 'v2' as const,
    whenToUse: 'Use this when the customer reports a missing deposit or asks where to find deposit evidence.',
    overview: 'Collect evidence, search knowledge if needed, then investigate or hand off.',
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
            id: 'if_human',
            kind: 'if' as const,
            condition: { id: 'human_request', kind: 'runtime_signal' as const, signal: 'explicit_human_request' },
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

  it('parses a v2 definition and keeps the rich shape available', () => {
    const parsed = parseProcedureDefinition(JSON.stringify(procedureV2))
    expect(parsed && isProcedureV2Definition(parsed)).toBe(true)
    expect(isProcedureV2Definition(parsed) ? parsed.whenToUse : '').toContain('missing deposit')
  })

  it('normalizes a v2 definition into the legacy ordered-step runtime shape for compatibility', () => {
    const normalized = normalizeProcedureDefinition(procedureDefinitionSchema.parse(procedureV2))
    expect(normalized.steps).toHaveLength(2)
    expect(normalized.steps[0].action).toBe('ask')
    expect(normalized.steps[1].action).toBe('use')
  })

  it('lets parseProcedure stay backward-compatible by returning a normalized step list for v2', () => {
    const parsed = parseProcedure(JSON.stringify(procedureV2))
    expect(parsed?.steps.map((step) => step.id)).toEqual(['understand_issue', 'investigate'])
    expect(parsed?.steps[1].target).toBe('get_latest_deposit')
  })

  it('builds readable condition labels for the authoring and preview surfaces', () => {
    expect(buildProcedureConditionLabel({ kind: 'tool_event', toolName: 'get_latest_deposit', event: 'succeeded' })).toBe('get_latest_deposit succeeded')
    expect(buildProcedureConditionLabel({ kind: 'runtime_signal', signal: 'knowledge_gap' })).toBe('knowledge gap')
  })

  it('produces a lightweight simulation receipt for preview', () => {
    const receipt = simulateProcedureDefinition(procedureV2, {
      signals: ['explicit_human_request'],
      handoffRequested: true,
    })
    expect(receipt.status).toBe('handoff')
    expect(receipt.steps[0]).toMatchObject({
      stepId: 'understand_issue',
      status: 'completed',
      matchedBranchId: 'if_human',
    })
  })
})

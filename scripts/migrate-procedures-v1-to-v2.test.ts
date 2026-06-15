import { describe, expect, it } from 'vitest'

import {
  collectSyntheticBucketReferences,
  extractSnapshotRows,
  looksLikeLegacyProcedure,
  migrateCaseTypeRows,
  migrateLegacyProcedureToV2,
  normalizeStoredProcedure,
} from './migrate-procedures-v1-to-v2.mjs'

describe('migrate-procedures-v1-to-v2', () => {
  it('detects a recognizable legacy procedure payload', () => {
    expect(looksLikeLegacyProcedure({
      steps: [{ id: 'finish', action: 'finalize' }],
    })).toBe(true)
  })

  it('maps a legacy procedure to a v2 definition and preserves the original payload', () => {
    const migrated = migrateLegacyProcedureToV2({
      steps: [
        { id: 'ask_member', action: 'ask', target: 'member_id, amount', guidance: 'Collect the missing details.', required: true },
        { id: 'check_deposit', action: 'use', target: 'get_latest_deposit', when: 'only when the user confirms the balance is unchanged', required: true },
        { id: 'handoff', action: 'escalate', target: 'payments' },
      ],
    })

    expect(migrated.version).toBe('v2')
    expect(migrated.steps[0]).toMatchObject({
      id: 'ask_member',
      actions: [
        expect.objectContaining({
          kind: 'ask',
          fields: ['member_id', 'amount'],
        }),
      ],
    })
    expect(migrated.steps[1]).toMatchObject({
      id: 'check_deposit',
      actions: [],
      branches: [
        expect.objectContaining({
          condition: expect.objectContaining({ kind: 'llm_eval' }),
        }),
      ],
      completionGuidance: 'Only continue after get_latest_deposit succeeds.',
    })
    expect(migrated.legacy.procedureV1.steps).toHaveLength(3)
  })

  it('treats an existing v2 definition as already migrated', () => {
    const normalized = normalizeStoredProcedure(JSON.stringify({
      version: 'v2',
      whenToUse: 'Use it for migrated rows',
      steps: [
        {
          id: 'step_1',
          title: 'Ask for details',
          guidance: 'Collect the required details.',
          actions: [{ id: 'ask_member', kind: 'ask', label: 'Ask member id', fields: ['member_id'] }],
        },
      ],
    }))

    expect(normalized.status).toBe('v2')
  })

  it('migrates the intermediate version=1 runtime procedure shape', () => {
    const normalized = normalizeStoredProcedure(JSON.stringify({
      version: 1,
      startStepId: 'collect_facts',
      steps: [
        {
          id: 'collect_facts',
          title: 'Collect deposit facts',
          instructions: 'Collect the required evidence.',
          requiredFacts: ['txnId', 'amount'],
          allowedTools: ['ask_user_questions', 'read_chat_memory'],
          next: [{ when: 'complete', stepId: 'investigate_order' }],
        },
        {
          id: 'finalize',
          title: 'Finalize answer',
          instructions: 'Explain the outcome clearly.',
          allowedTools: ['finalize_procedure', 'create_human_task'],
          next: [],
        },
      ],
    }))

    expect(normalized.status).toBe('legacy')
    expect(normalized.definition.steps[0]).toMatchObject({
      id: 'collect_facts',
      actions: [
        expect.objectContaining({
          kind: 'ask',
          fields: ['txnId', 'amount'],
        }),
      ],
    })
    expect(normalized.definition.steps[1].actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'end' }),
      ]),
    )
    expect(normalized.definition.steps[1].branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          condition: expect.objectContaining({ kind: 'llm_eval' }),
          actions: expect.arrayContaining([
            expect.objectContaining({ kind: 'request_human_handoff' }),
          ]),
        }),
      ]),
    )
  })

  it('migrates the seeded deposit runtime shape with required tool guidance and handoff escape hatches', () => {
    const normalized = normalizeStoredProcedure(JSON.stringify({
      version: 1,
      startStepId: 'collect_facts',
      steps: [
        {
          id: 'collect_facts',
          title: 'Collect deposit facts',
          instructions: 'Collect transaction ID, amount, payment method, and date before investigation.',
          requiredFacts: ['txnId', 'amount', 'paymentMethod', 'date'],
          allowedTools: ['ask_user_questions', 'read_chat_memory'],
          next: [{ when: 'complete', stepId: 'investigate_order' }],
        },
        {
          id: 'investigate_order',
          title: 'Investigate order and channel',
          instructions: 'Check order status and payment-channel status; reconcile the result with the customer report.',
          requiredToolsAny: ['query_order_status', 'query_payment_channel_status'],
          allowedTools: ['query_order_status', 'query_payment_channel_status', 'create_human_task', 'read_chat_memory'],
          next: [{ when: 'complete', stepId: 'finalize' }],
        },
        {
          id: 'finalize',
          title: 'Finalize customer answer',
          instructions: 'Give a clear customer-facing answer grounded in collected evidence.',
          allowedTools: ['finalize_procedure', 'create_human_task', 'read_chat_memory'],
          next: [],
        },
      ],
    }))

    expect(normalized.status).toBe('legacy')
    expect(normalized.definition.steps[0]).toMatchObject({
      id: 'collect_facts',
      actions: [
        expect.objectContaining({
          kind: 'ask',
          fields: ['txnId', 'amount', 'paymentMethod', 'date'],
        }),
      ],
    })
    expect(normalized.definition.steps[1]).toMatchObject({
      id: 'investigate_order',
      completionGuidance:
        'Only continue after one of these tools succeeds: query_order_status, query_payment_channel_status. If the evidence conflicts, the customer explicitly asks for a human, or safe completion is not possible, request human handoff instead of forcing an answer.',
      actions: expect.arrayContaining([
        expect.objectContaining({ kind: 'call_tool', toolName: 'query_order_status', required: true }),
        expect.objectContaining({ kind: 'call_tool', toolName: 'query_payment_channel_status', required: true }),
      ]),
    })
    expect(normalized.definition.steps[1].branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          condition: expect.objectContaining({ kind: 'llm_eval' }),
          actions: expect.arrayContaining([
            expect.objectContaining({ kind: 'request_human_handoff' }),
          ]),
        }),
      ]),
    )
    expect(normalized.definition.steps[2].actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'end', status: 'completed' }),
      ]),
    )
    expect(normalized.definition.steps[2].branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          condition: expect.objectContaining({ kind: 'llm_eval' }),
          actions: expect.arrayContaining([
            expect.objectContaining({ kind: 'request_human_handoff' }),
          ]),
        }),
      ]),
    )
    expect(normalized.definition.legacy?.procedureV1?.version).toBe(1)
  })

  it('expands aggregate ask buckets from case-type requiredFacts during legacy migration', () => {
    const { summary, normalizedRows } = migrateCaseTypeRows([
      {
        id: 'legacy_agg',
        type: 'withdrawal_not_credited',
        requiredFacts: '["member_id","amount","payment_channel","approximate_time"]',
        procedure: JSON.stringify({
          steps: [
            {
              id: 'collect_withdrawal_details',
              action: 'ask',
              target: 'withdrawal_missing_details',
              guidance: 'Collect member id, amount, withdrawal channel, and approximate withdrawal time.',
              required: true,
            },
          ],
        }),
      },
    ])

    const migrated = JSON.parse(normalizedRows[0].procedure)
    expect(summary.results[0]).toEqual({
      id: 'legacy_agg',
      type: 'withdrawal_not_credited',
      status: 'legacy_migrated',
    })
    expect(migrated.steps[0].actions[0].fields).toEqual([
      'member_id',
      'amount',
      'payment_channel',
      'approximate_time',
    ])
    expect(collectSyntheticBucketReferences(migrated)).toEqual([])
  })

  it('repairs already-migrated v2 rows when legacy.procedureV1 is still available', () => {
    const legacyProcedure = {
      steps: [
        {
          id: 'collect_login_reset_details',
          action: 'ask',
          target: 'login_reset_details',
          guidance: 'Collect member id and login name.',
          required: true,
        },
      ],
    }
    const { summary, normalizedRows } = migrateCaseTypeRows([
      {
        id: 'repair_1',
        type: 'login_password_reset',
        requiredFacts: '["member_id","login_name"]',
        procedure: JSON.stringify({
          version: 'v2',
          whenToUse: 'Migrated from a legacy Procedure v1 definition. Review and refine before production use.',
          overview: 'Auto-migrated from the legacy Procedure v1 shape.',
          knowledgeGuidance: '',
          handoffGuidance: '',
          steps: [
            {
              id: 'collect_login_reset_details',
              title: 'Ask for login_reset_details',
              guidance: 'Collect member id and login name.',
              actions: [
                {
                  id: 'collect_login_reset_details_ask',
                  kind: 'ask',
                  label: 'Ask for login_reset_details',
                  fields: ['login_reset_details'],
                },
              ],
              branches: [],
            },
          ],
          legacy: { procedureV1: legacyProcedure },
        }),
      },
    ])

    const repaired = JSON.parse(normalizedRows[0].procedure)
    expect(summary.repairedV2).toBe(1)
    expect(summary.results[0]).toEqual({
      id: 'repair_1',
      type: 'login_password_reset',
      status: 'v2_repaired',
    })
    expect(repaired.steps[0].actions[0].fields).toEqual(['member_id', 'login_name'])
    expect(collectSyntheticBucketReferences(repaired)).toEqual([])
  })

  it('fails migration when a synthetic ask bucket has no case-type requiredFacts to expand from', () => {
    const { summary, normalizedRows } = migrateCaseTypeRows([
      {
        id: 'bad_agg',
        type: 'withdrawal_not_credited',
        requiredFacts: '[]',
        procedure: JSON.stringify({
          steps: [
            {
              id: 'collect_withdrawal_details',
              action: 'ask',
              target: 'withdrawal_missing_details',
              guidance: 'Collect member id, amount, withdrawal channel, and approximate withdrawal time.',
              required: true,
            },
          ],
        }),
      },
    ])

    expect(summary.invalid).toBe(1)
    expect(summary.failures[0]?.reason).toContain('Synthetic ask field(s) withdrawal_missing_details require caseType.requiredFacts')
    expect(summary.results[0]).toMatchObject({
      id: 'bad_agg',
      type: 'withdrawal_not_credited',
      status: 'invalid',
    })
    expect(normalizedRows[0].procedure).toContain('withdrawal_missing_details')
  })

  it('extracts case types from a production-style api envelope', () => {
    const rows = extractSnapshotRows({
      ok: true,
      data: {
        types: [
          { id: 'ct_1', type: 'deposit_not_credited', procedure: '{"version":"v2","steps":[{"id":"step_1","title":"Ask","guidance":"Collect","actions":[]}]}' },
        ],
      },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'ct_1', type: 'deposit_not_credited' })
  })

  it('migrates snapshot rows and preserves v2 rows while surfacing invalid ones', () => {
    const legacyProcedure = {
      steps: [
        { id: 'collect', action: 'ask', target: 'member_id', guidance: 'Collect member id.', required: true },
        { id: 'finish', action: 'finalize', guidance: 'Finish the procedure.' },
      ],
    }
    const v2Procedure = {
      version: 'v2',
      whenToUse: 'Use for existing v2 rows',
      overview: 'Already migrated.',
      knowledgeGuidance: '',
      handoffGuidance: '',
      steps: [
        {
          id: 'step_1',
          title: 'Ask for details',
          guidance: 'Collect the required details.',
          actions: [{ id: 'ask_member', kind: 'ask', label: 'Ask member id', fields: ['member_id'] }],
        },
      ],
    }

    const { summary, normalizedRows } = migrateCaseTypeRows([
      { id: 'legacy_1', type: 'deposit_not_credited', procedure: JSON.stringify(legacyProcedure) },
      { id: 'v2_1', type: 'withdrawal_not_credited', procedure: JSON.stringify(v2Procedure) },
      { id: 'bad_1', type: 'broken_case', procedure: '{"wat":true}' },
    ])

    expect(summary).toMatchObject({
      scanned: 3,
      migrated: 1,
      alreadyV2: 1,
      invalid: 1,
    })
    expect(summary.failures).toEqual([
      expect.objectContaining({
        id: 'bad_1',
        type: 'broken_case',
      }),
    ])
    expect(summary.results).toEqual([
      { id: 'legacy_1', type: 'deposit_not_credited', status: 'legacy_migrated' },
      { id: 'v2_1', type: 'withdrawal_not_credited', status: 'v2' },
      expect.objectContaining({ id: 'bad_1', type: 'broken_case', status: 'invalid' }),
    ])

    const migratedLegacy = JSON.parse(normalizedRows[0].procedure)
    expect(migratedLegacy.version).toBe('v2')
    expect(migratedLegacy.legacy?.procedureV1?.steps).toHaveLength(2)
    expect(normalizedRows[1].procedure).toBe(JSON.stringify(v2Procedure))
    expect(normalizedRows[2].procedure).toBe('{"wat":true}')
  })
})

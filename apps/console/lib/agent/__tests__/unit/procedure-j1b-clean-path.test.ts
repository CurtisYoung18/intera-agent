import { describe, expect, it } from 'vitest'

import {
  closeSession,
  getActiveProcedureRun,
  recordInitialInputEvent,
  recordProcedureToolCall,
  recordProcedureToolResult,
  startProcedureRun,
} from '../../session-store'
import {
  collectSyntheticBucketReferences,
  migrateCaseTypeRows,
} from '../../../../../../scripts/migrate-procedures-v1-to-v2.mjs'

type J1BFixture = {
  type: string
  displayName: string
  requiredFacts: string
  procedure: string
  formAnswers: Record<string, string>
  expectedFields: string[]
  expectedToolStep: string
  expectedToolName: string
  expectedStepAfterTool: string
  toolOutput: Record<string, unknown>
}

const fixtures: J1BFixture[] = [
  {
    type: 'withdrawal_not_credited',
    displayName: 'Withdrawal not credited',
    requiredFacts: '["member_id","amount","approximate_time"]',
    procedure: JSON.stringify({
      steps: [
        {
          id: 'collect_withdrawal_details',
          action: 'ask',
          target: 'withdrawal_missing_details',
          guidance: 'Collect member id, amount, withdrawal channel, and approximate withdrawal time.',
          required: true,
        },
        {
          id: 'lookup_latest_withdrawal',
          action: 'use',
          target: 'get_latest_withdrawal',
          guidance: 'Check the most recent withdrawal status for this member.',
          required: true,
        },
        {
          id: 'lookup_withdraw_conditions',
          action: 'use',
          target: 'get_withdraw_conditions',
          guidance: 'Check turnover or conditions that may explain the payout status.',
          when: 'Use when status alone does not explain why funds are not yet received.',
        },
      ],
    }),
    formAnswers: {
      member_id: 'JAYA113C88F',
      amount: '500',
      approximate_time: 'today morning',
    },
    expectedFields: ['member_id', 'amount', 'approximate_time'],
    expectedToolStep: 'lookup_latest_withdrawal',
    expectedToolName: 'get_latest_withdrawal',
    expectedStepAfterTool: 'lookup_withdraw_conditions',
    toolOutput: { status: 'approved', created_at: '2026-06-15 10:00:00' },
  },
  {
    type: 'duplicate_deposit',
    displayName: 'Duplicate deposit',
    requiredFacts: '["member_id","amount","payment_channel","approximate_time"]',
    procedure: JSON.stringify({
      steps: [
        {
          id: 'collect_duplicate_details',
          action: 'ask',
          target: 'duplicate_deposit_details',
          guidance: 'Collect member id, amount, payment channel, and whether there were one or two successful charges.',
          required: true,
        },
        {
          id: 'review_recent_transactions',
          action: 'use',
          target: 'get_transaction_history',
          guidance: 'Inspect recent transaction history for repeated or adjacent deposit attempts.',
          required: true,
        },
        {
          id: 'check_latest_deposit',
          action: 'use',
          target: 'get_latest_deposit',
          guidance: 'Check the newest deposit record to anchor timing and status.',
        },
      ],
    }),
    formAnswers: {
      member_id: 'JAYA113C88F',
      amount: '200',
      payment_channel: 'bank_transfer',
      approximate_time: '2026-06-15 10:30',
    },
    expectedFields: ['member_id', 'amount', 'payment_channel', 'approximate_time'],
    expectedToolStep: 'review_recent_transactions',
    expectedToolName: 'get_transaction_history',
    expectedStepAfterTool: 'check_latest_deposit',
    toolOutput: { data: [{ order_id: 1, amount: '200.00', status: 'approved' }] },
  },
  {
    type: 'account_wallet_frozen',
    displayName: 'Account or wallet frozen',
    requiredFacts: '["member_id","error_message"]',
    procedure: JSON.stringify({
      steps: [
        {
          id: 'collect_frozen_details',
          action: 'ask',
          target: 'frozen_account_details',
          guidance: 'Collect member id and the error message or frozen surface the customer sees.',
          required: true,
        },
        {
          id: 'lookup_account_status',
          action: 'use',
          target: 'get_account_status',
          guidance: 'Check the live account status for freezes, restrictions, or inactive states.',
          required: true,
        },
        {
          id: 'lookup_kyc_status',
          action: 'use',
          target: 'get_kyc_status',
          guidance: 'Check whether verification or compliance state may explain the freeze.',
        },
      ],
    }),
    formAnswers: {
      member_id: 'JAYA113C88F',
      error_message: 'Account locked',
    },
    expectedFields: ['member_id', 'error_message'],
    expectedToolStep: 'lookup_account_status',
    expectedToolName: 'get_account_status',
    expectedStepAfterTool: 'lookup_kyc_status',
    toolOutput: { status: 'locked', restriction: 'manual_review' },
  },
  {
    type: 'login_password_reset',
    displayName: 'Login password reset',
    requiredFacts: '["member_id","login_name"]',
    procedure: JSON.stringify({
      steps: [
        {
          id: 'collect_login_reset_details',
          action: 'ask',
          target: 'login_reset_details',
          guidance: 'Collect member id and the login name or bound account identifier.',
          required: true,
        },
        {
          id: 'lookup_account_status',
          action: 'use',
          target: 'get_account_status',
          guidance: 'Check basic account status before routing a login-password reset.',
        },
        {
          id: 'decide_login_reset_path',
          action: 'decide',
          guidance: 'Decide whether the customer can follow the standard reset path or needs human identity verification.',
        },
      ],
    }),
    formAnswers: {
      member_id: 'JAYA113C88F',
      login_name: 'jaya_login',
    },
    expectedFields: ['member_id', 'login_name'],
    expectedToolStep: 'lookup_account_status',
    expectedToolName: 'get_account_status',
    expectedStepAfterTool: 'decide_login_reset_path',
    toolOutput: { status: 'active', login_locked: true },
  },
]

function migrateFixture(fixture: J1BFixture) {
  const { summary, normalizedRows } = migrateCaseTypeRows([{
    id: `${fixture.type}_row`,
    type: fixture.type,
    requiredFacts: fixture.requiredFacts,
    procedure: fixture.procedure,
  }])
  expect(summary.invalid).toBe(0)
  expect(summary.failures).toEqual([])
  return JSON.parse(normalizedRows[0].procedure)
}

describe('J1B clean-path migration regressions', () => {
  it.each(fixtures)('migrates $type to literal form fields and unlocks the next required tool from customer_form_result evidence', (fixture) => {
    const caseId = `j1b-clean-${fixture.type}`
    const migrated = migrateFixture(fixture)

    try {
      expect(collectSyntheticBucketReferences(migrated)).toEqual([])
      expect(migrated.steps[0]?.actions?.[0]?.fields).toEqual(fixture.expectedFields)

      recordInitialInputEvent(caseId, {
        content: `Customer entered ${fixture.type}.`,
        source: 'customer_message',
        origin: 'customer',
      })

      startProcedureRun(caseId, {
        procedureId: fixture.type,
        displayName: fixture.displayName,
        procedure: migrated,
      })

      recordInitialInputEvent(caseId, {
        content: `Tool ask_user_questions result: ${JSON.stringify(fixture.formAnswers)}`,
        source: 'customer_form_result',
        origin: 'customer',
        formAnswers: fixture.formAnswers,
      })

      const afterForm = getActiveProcedureRun(caseId)
      expect(afterForm?.steps[0]).toMatchObject({ status: 'completed' })
      expect(afterForm?.currentStepId).toBe(fixture.expectedToolStep)

      recordProcedureToolCall(caseId, {
        toolName: fixture.expectedToolName,
        toolUseId: `${fixture.type}-tool`,
      })
      recordProcedureToolResult(caseId, {
        toolName: fixture.expectedToolName,
        toolUseId: `${fixture.type}-tool`,
        toolOutput: fixture.toolOutput,
      })

      const afterTool = getActiveProcedureRun(caseId)
      expect(afterTool?.steps.find((step) => step.id === fixture.expectedToolStep)).toMatchObject({
        status: 'completed',
      })
      expect(afterTool?.currentStepId).toBe(fixture.expectedStepAfterTool)
      expect(afterTool?.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: fixture.expectedToolName,
          }),
        ]),
      )
    } finally {
      closeSession(caseId)
    }
  })

  it('does not infer J1B form fields from plain customer text once runtime heuristics are removed', () => {
    const fixture = fixtures[0]
    const caseId = 'j1b-clean-no-plain-text'
    const migrated = migrateFixture(fixture)

    try {
      recordInitialInputEvent(caseId, {
        content: 'Withdrawal not received.',
        source: 'customer_message',
        origin: 'customer',
      })

      startProcedureRun(caseId, {
        procedureId: fixture.type,
        displayName: fixture.displayName,
        procedure: migrated,
      })

      recordInitialInputEvent(caseId, {
        content: '我的 member_id 是 JAYA113C88F，金额 500，今天上午提的现。',
        source: 'customer_message',
        origin: 'customer',
      })

      const active = getActiveProcedureRun(caseId)
      expect(active?.currentStepId).toBe('collect_withdrawal_details')
      expect(active?.steps[0]).toMatchObject({
        status: 'active',
      })
      expect(active?.evidence.filter((entry) => entry.kind === 'form')).toEqual([])
      expect(active?.inputs.at(-1)?.formAnswers).toBeUndefined()
    } finally {
      closeSession(caseId)
    }
  })
})

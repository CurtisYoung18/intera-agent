import { describe, expect, it } from 'vitest'
import {
  buildConversationContinuityContext,
  resolveConversationSegmentTransition,
} from '../conversation-continuity'

describe('conversation continuity segment prototype', () => {
  it('starts a new segment after the configured idle window', () => {
    const transition = resolveConversationSegmentTransition({
      now: '2026-06-26T12:05:00.000Z',
      idleTimeoutMs: 60 * 60 * 1000,
      currentSegment: {
        id: 'seg_1',
        status: 'active',
        lastUserMessageAt: '2026-06-26T10:59:00.000Z',
      },
    })

    expect(transition).toEqual({
      action: 'rollover',
      reason: 'idle_timeout',
      previousSegmentId: 'seg_1',
    })
  })

  it('continues the current segment inside the idle window', () => {
    const transition = resolveConversationSegmentTransition({
      now: '2026-06-26T12:05:00.000Z',
      idleTimeoutMs: 60 * 60 * 1000,
      currentSegment: {
        id: 'seg_1',
        status: 'active',
        lastUserMessageAt: '2026-06-26T11:20:00.000Z',
      },
    })

    expect(transition).toEqual({
      action: 'continue',
      reason: 'within_idle_window',
      segmentId: 'seg_1',
    })
  })

  it('builds a continuity context with member id as fact, not an anti-repeat instruction', () => {
    const context = buildConversationContinuityContext({
      knownFacts: {
        member_id: 'JAYA1126511',
        withdrawal_status: 'pending',
        turnover_status: 'completed',
      },
      previousSegmentDigest: [
        'Customer had a delayed withdrawal.',
        'Withdrawal status was pending and turnover was completed.',
        'HumanTask was created for payment_ops.',
      ].join('\n'),
    })

    expect(context).toContain('## Conversation Continuity Context')
    expect(context).toContain('- member_id: JAYA1126511')
    expect(context).toContain('- withdrawal_status: pending')
    expect(context).toContain('Customer had a delayed withdrawal.')
    expect(context).not.toMatch(/do not ask|don't ask|do not repeat|don't repeat|不要.*问|不要.*重复/i)
  })

  it('keeps long previous segment digests inside the prompt budget', () => {
    const context = buildConversationContinuityContext({
      knownFacts: { member_id: 'JAYA1126511' },
      previousSegmentDigest: Array.from({ length: 400 }, (_, index) => (
        `Historical support detail ${index + 1}: withdrawal pending, turnover completed, customer asked for update.`
      )).join('\n'),
      maxApproxTokens: 1000,
    })

    expect(context.length).toBeGreaterThan(0)
    expect(Math.ceil(context.length / 4)).toBeLessThanOrEqual(1000)
    expect(context).toContain('- member_id: JAYA1126511')
  })

  it('uses a 1000-token continuity budget by default', () => {
    const context = buildConversationContinuityContext({
      knownFacts: { member_id: 'JAYA1126511' },
      previousSegmentDigest: Array.from({ length: 400 }, (_, index) => (
        `Historical support detail ${index + 1}: deposit, withdrawal, promotion, and account status context.`
      )).join('\n'),
    })

    expect(Math.ceil(context.length / 4)).toBeLessThanOrEqual(1000)
  })
})

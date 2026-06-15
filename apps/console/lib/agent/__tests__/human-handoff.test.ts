import { describe, expect, it } from 'vitest'
import { buildHumanHandoffQuestion } from '../human-handoff'

describe('buildHumanHandoffQuestion', () => {
  it('appends the latest customer message and compact known facts', () => {
    const text = buildHumanHandoffQuestion({
      baseQuestion: 'Need manual review for this deposit issue.',
      caseType: 'deposit_not_credited',
      latestCustomerMessage: '我有笔存款没到帐啊',
      confirmedFacts: {
        member_id: 'JAYA11C5184',
        amount: '800',
        __intera_runtime: { hidden: true },
      },
    })

    expect(text).toContain('Need manual review for this deposit issue.')
    expect(text).toContain('案例类型: deposit_not_credited')
    expect(text).toContain('客户最新消息: 我有笔存款没到帐啊')
    expect(text).toContain('"member_id":"JAYA11C5184"')
    expect(text).not.toContain('__intera_runtime')
  })
})

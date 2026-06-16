import { describe, expect, it } from 'vitest'
import { classifyExplicitJ1BCaseType, classifyExplicitMoneyMovementTopic } from '../../money-movement-routing'

describe('money movement and J1B routing classifiers', () => {
  it('keeps explicit deposit and withdrawal topics distinct', () => {
    expect(classifyExplicitMoneyMovementTopic('今天早上银行转账存款成功了，但是余额一直没有更新')).toBe('deposit')
    expect(classifyExplicitMoneyMovementTopic('今天上午提现成功了，但是账户还没有收到钱')).toBe('withdrawal')
  })

  it('classifies high-signal J1B support intents', () => {
    expect(classifyExplicitJ1BCaseType('我的账号和钱包都被冻结了。')).toBe('account_wallet_frozen')
    expect(classifyExplicitJ1BCaseType('我把300元转到旧订单OLD556677了，现在那个订单已经过期。')).toBe('deposit_old_order')
    expect(classifyExplicitJ1BCaseType('我的银行转账好像被重复扣款了，两笔都成功了。')).toBe('duplicate_deposit')
    expect(classifyExplicitJ1BCaseType('今天上午提现成功了，但是账户还没有收到钱。')).toBe('withdrawal_not_credited')
    expect(classifyExplicitJ1BCaseType('我忘了提款密码，而且之前绑定的手机号已经停用了。')).toBe('withdrawal_password_reset')
    expect(classifyExplicitJ1BCaseType('我都达到这个活动要求了，结果还是不能参加。')).toBe('promotion_condition_conflict')
  })

  it('prefers withdrawal blocked when security review is specifically about withdrawal', () => {
    expect(classifyExplicitJ1BCaseType('我提款时提示账户正在安全审核，不能提现。')).toBe('withdrawal_blocked')
  })
})

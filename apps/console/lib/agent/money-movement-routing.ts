export type ExplicitMoneyMovementTopic = 'deposit' | 'withdrawal'
export type ExplicitJ1BCaseType =
  | 'account_wallet_frozen'
  | 'app_reward_missing'
  | 'deposit_not_credited'
  | 'deposit_old_order'
  | 'duplicate_deposit'
  | 'human_support_requested'
  | 'login_password_reset'
  | 'promotion_claim_failed'
  | 'promotion_condition_conflict'
  | 'withdrawal_blocked'
  | 'withdrawal_not_credited'
  | 'withdrawal_password_reset'

export function classifyExplicitMoneyMovementTopic(userMessage: string): ExplicitMoneyMovementTopic | null {
  const normalized = userMessage.toLowerCase()
  const hasDepositSignal = [
    /存款/,
    /充值/,
    /入金/,
    /\bdeposit(?:ed|s|ing)?\b/,
    /\brecharge(?:d|s|ing)?\b/,
    /\btop\s*up\b/,
  ].some((pattern) => pattern.test(normalized))
  const hasWithdrawalSignal = [
    /提款/,
    /提现/,
    /出款/,
    /取款/,
    /(?:提|取)(?:了|款|现|出|钱|回)?\s*[0-9０-９]+(?:\.\d+)?\s*(?:元|块|rmb|cny|usd|usdt)?/,
    /\bwithdraw(?:al|n|ing|s)?\b/,
    /\bpayout(?:s)?\b/,
    /\bcash\s*out\b/,
  ].some((pattern) => pattern.test(normalized))

  if (hasDepositSignal === hasWithdrawalSignal) return null
  return hasDepositSignal ? 'deposit' : 'withdrawal'
}

export function retargetMoneyMovementProcedureId(
  requestedProcedureId: string,
  userMessage: string,
): string | null {
  const topic = classifyExplicitMoneyMovementTopic(userMessage)
  if (!topic) return null

  const requested = requestedProcedureId.toLowerCase()
  if (topic === 'deposit' && requested.includes('withdrawal')) {
    return requestedProcedureId.replace(/withdrawal/gi, 'deposit')
  }
  if (topic === 'withdrawal' && requested.includes('deposit')) {
    return requestedProcedureId.replace(/deposit/gi, 'withdrawal')
  }
  return null
}

export function classifyExplicitJ1BCaseType(userMessage: string): ExplicitJ1BCaseType | null {
  const normalized = userMessage.toLowerCase()
  const has = (...patterns: RegExp[]) => patterns.some((pattern) => pattern.test(normalized))
  const topic = classifyExplicitMoneyMovementTopic(userMessage)

  if (has(/人工/, /真人/, /客服/, /\bhuman\b/, /\bagent\b/) && has(/转|接|找|要|需要|帮忙|处理|联系|客服/)) {
    return 'human_support_requested'
  }

  if (has(/提款密码/, /取款密码/, /提现密码/, /出款密码/, /\bwithdraw(?:al)? password\b/)) {
    return 'withdrawal_password_reset'
  }
  if (has(/登录密码/, /登入密码/, /login password/, /sign[ -]?in password/) && has(/忘|重置|找回|reset|forgot/)) {
    return 'login_password_reset'
  }

  if (has(/旧订单/, /老订单/, /过期订单/, /\bold order\b/, /\bexpired order\b/)) {
    return 'deposit_old_order'
  }
  if (has(/重复存款/, /重复充值/, /重复扣款/, /存款.*两次/, /扣款.*两次/, /\bduplicate deposit\b/, /\bcharged twice\b/)) {
    return 'duplicate_deposit'
  }
  if (topic === 'deposit' && has(/未到账/, /没到账/, /没有到账/, /余额.*(没|未|没有).*更新/, /一直没有更新/, /\bnot credited\b/, /\bnot arrived\b/)) {
    return 'deposit_not_credited'
  }

  if (has(/app.*奖励/, /app下载奖励/, /下载奖励/, /app388/, /reward.*missing/, /奖励.*未到账/, /奖励.*没到账/)) {
    return 'app_reward_missing'
  }
  if (has(/活动|优惠|promotion|bonus|cashback|reward/) && has(/条件|要求|流水|turnover|qualified|eligible/) && has(/达|满足|完成|符合|够了|qualified/) && has(/仍|还是|仍然|却|但|不能|无法|参加不了|join/)) {
    return 'promotion_condition_conflict'
  }
  if (has(/活动|优惠|promotion|bonus|cashback|reward/) && has(/领取不了|无法领取|不能领取|按钮.*灰|灰色|claim failed|cannot claim|not eligible|条件不满足/)) {
    return 'promotion_claim_failed'
  }

  if (topic === 'withdrawal' && has(/成功|已通过|approved|completed/) && has(/未到账|没到账|没有收到|没收到|不到账|not credited|not received/)) {
    return 'withdrawal_not_credited'
  }
  if (topic === 'withdrawal' && has(/无法|不能|失败|被拦|被阻止|安全审核|审核|冻结|条件|流水|kyc|blocked|hold|review/)) {
    return 'withdrawal_blocked'
  }

  if (has(/账号|账户|钱包|account|wallet/) && has(/冻结|被冻|安全审核|审核|锁定|封|frozen|locked|security review/)) {
    return 'account_wallet_frozen'
  }

  return null
}

export function retargetExplicitJ1BProcedureId(
  requestedProcedureId: string,
  userMessage: string,
): string | null {
  const classified = classifyExplicitJ1BCaseType(userMessage)
  if (!classified || classified === requestedProcedureId) return null
  return classified
}

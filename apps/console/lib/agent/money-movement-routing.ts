export type ExplicitMoneyMovementTopic = 'deposit' | 'withdrawal'

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

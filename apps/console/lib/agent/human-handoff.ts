import { stripInternalMemoryKeys } from './memory'

function containsCjk(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(text)
}

function normalizeContext(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const facts = stripInternalMemoryKeys(input ?? {})
  const normalized: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(facts)) {
    if (value == null) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) normalized[key] = trimmed
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = value
    }
  }
  return Object.fromEntries(Object.entries(normalized).slice(0, 8))
}

export function buildHumanHandoffQuestion(input: {
  baseQuestion: string
  caseType?: string | null
  latestCustomerMessage?: string | null
  contextMap?: Record<string, unknown>
}): string {
  const baseQuestion = input.baseQuestion.trim() || 'Human task requested.'
  const latestCustomerMessage = input.latestCustomerMessage?.trim()
  const contextMap = normalizeContext(input.contextMap)
  const localeIsZh = containsCjk([baseQuestion, latestCustomerMessage].filter(Boolean).join(' '))

  const lines = [baseQuestion]
  if (input.caseType) {
    lines.push(localeIsZh ? `案例类型: ${input.caseType}` : `Case type: ${input.caseType}`)
  }
  if (
    latestCustomerMessage &&
    !baseQuestion.includes(latestCustomerMessage)
  ) {
    lines.push(
      localeIsZh
        ? `客户最新消息: ${latestCustomerMessage}`
        : `Latest customer message: ${latestCustomerMessage}`,
    )
  }
  if (Object.keys(contextMap).length > 0) {
    lines.push(
      localeIsZh
        ? `已知上下文: ${JSON.stringify(contextMap)}`
        : `Known context: ${JSON.stringify(contextMap)}`,
    )
  }
  return lines.join('\n')
}

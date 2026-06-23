import { stripInternalMemoryKeys } from './memory'
import type { CaseSchemaConfig } from '@intera/shared/types'

export type HumanHandoffKnownFacts = Record<string, string | number | boolean>

export interface HumanHandoffNotePayload {
  known_facts?: HumanHandoffKnownFacts
  chat_summary?: string
  handoff_reason?: string
}

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

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeKnownFactsValue(value: unknown): HumanHandoffKnownFacts | undefined {
  if (typeof value === 'string' && value.trim()) {
    return { details: value.trim() }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const normalized = normalizeContext(value as Record<string, unknown>)
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

export function normalizeHumanHandoffNotePayload(input: Record<string, unknown>): HumanHandoffNotePayload {
  const knownFacts =
    normalizeKnownFactsValue(input.known_facts) ??
    normalizeKnownFactsValue(input.knownFacts) ??
    normalizeKnownFactsValue(input.context)
  const chatSummary = optionalString(input.chat_summary) ?? optionalString(input.chatSummary)
  const handoffReason = optionalString(input.handoff_reason) ?? optionalString(input.handoffReason)

  return {
    ...(knownFacts ? { known_facts: knownFacts } : {}),
    ...(chatSummary ? { chat_summary: chatSummary } : {}),
    ...(handoffReason ? { handoff_reason: handoffReason } : {}),
  }
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

export function defaultHumanQueueForCaseSchema(caseSchema?: CaseSchemaConfig | null): string {
  const steps = caseSchema?.procedure?.steps ?? []
  for (const step of steps) {
    for (const action of step.actions ?? []) {
      if (action.kind === 'request_human_handoff' && typeof action.queue === 'string' && action.queue.trim()) {
        return action.queue.trim()
      }
    }
    for (const branch of step.branches ?? []) {
      for (const action of branch.actions ?? []) {
        if (action.kind === 'request_human_handoff' && typeof action.queue === 'string' && action.queue.trim()) {
          return action.queue.trim()
        }
      }
    }
  }
  return 'general'
}

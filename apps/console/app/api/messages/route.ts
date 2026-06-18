// Intera Harness - Messages API Route
// POST /api/messages — Main entry point for user messages
// Supports resumeTrigger for human task resolution

import { NextRequest, NextResponse } from 'next/server'
import { AgentLoop } from '@/lib/agent/loop'
import {
  hasProviderOrDisplayContent,
  hydrateMessageFromDb,
  makeProviderMeta,
  providerTranscriptPersistenceReceipt,
  serializeMessageForPersistence,
  toolResultProviderContent,
  type MessagePersistenceRecord,
} from '@/lib/agent/provider-transcript'
import {
  bindProcedureRuntimeAgentConfig,
  enqueueMessageOrCreate,
  flushProcedureRunPersistence,
  getActiveProcedureRun,
  getOrCreateSession,
  hasSession,
  hydrateProcedureRuntime,
  parkSessionUntilNextRequest,
  recordInitialInputEvent,
  startProcedureRun,
  type CaseSession,
  type RuntimeEventSource,
} from '@/lib/agent/session-store'
import { isInvestigableCaseType } from '@/lib/agent/case-type-slugs'
import { knowledgeSourceToolName } from '@/lib/agent/tool-names'
import { prisma } from '@intera/shared/prisma'
import { buildModePrompt } from '@/lib/agent/buildModePrompt'
import { profileKey } from '@/lib/agent/identity'
import { createSafeSseWriter } from '@/lib/api/safe-sse'
import { defineRoute } from '@/lib/api/define-route'
import { readUserProfile } from '@/lib/db/user-profiles'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { maybeProxyMessagesToRuntime } from '@/lib/runtime/runtime-service'
import { generateCaseId } from '@/lib/utils'
import type { SSEEvent, AgentConfigData, CaseSchemaConfig, Message } from '@intera/shared/types'
import { parseProcedure } from '@intera/shared/contracts/case-types'
import { DEFAULT_MEMORY_MODEL } from '@intera/shared/memory/contract'
import { LOOP_HISTORY_REPLAY_LIMIT } from '@/lib/agent/history-window'

// Verify env vars at module load (logged once per cold start)
const AUTH_SET = !!process.env.ANTHROPIC_AUTH_TOKEN
const URL_SET = !!process.env.ANTHROPIC_BASE_URL
if (AUTH_SET && URL_SET) {
  console.log('[Intera] ✓ API credentials loaded from env')
} else {
  console.warn('[Intera] ⚠️  ANTHROPIC_AUTH_TOKEN or ANTHROPIC_BASE_URL missing in env')
}

import {
  CORE_SYSTEM_PROMPT,
  DEFAULT_MEMORY_STRATEGY,
  HARNESS_DEFAULT_RESUME_PROMPT_APPEND,
} from '@intera/shared/defaults'

import { loadAgentConfig } from '@/lib/agent/config-loader'

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}

/** Build harness CaseSchemaConfig from a CaseType DB row (shared load / hydrate paths). */
function schemaFromCaseTypeRow(caseType: {
  type: string
  displayName: string
  description: string | null
  icon: string
  requiredFacts: string
  defaultGoal: string
  escalateOn: string
  autoCloseConditions: string | null
  procedure?: string | null
  maxAutoTurns?: number | null
}): CaseSchemaConfig {
  const requiredFacts = parseMemoryJson(caseType.requiredFacts) as string[]
  const procedure = parseProcedure(caseType.procedure)

  return {
    type: caseType.type,
    displayName: caseType.displayName,
    description: caseType.description || undefined,
    icon: caseType.icon,
    requiredFacts: Array.isArray(requiredFacts) ? requiredFacts : [],
    defaultGoal: caseType.defaultGoal,
    escalateOn: (parseMemoryJson(caseType.escalateOn) as string[]) || [],
    autoCloseConditions: parseMemoryJson(caseType.autoCloseConditions) as Record<string, unknown> | undefined,
    procedure: procedure ?? undefined,
    maxAutoTurns: typeof caseType.maxAutoTurns === 'number' ? caseType.maxAutoTurns : undefined,
  }
}

function parseMemoryJson(raw: string | null | undefined): unknown {
  if (!raw) return {}
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return {} }
}

function formResultRuntimeText(answers: Record<string, string>): string {
  return [
    `Tool ask_user_questions result: ${JSON.stringify(answers)}`,
    '[Harness instruction] These are structured form answers for the active case. Reuse them as provided, do not ask for the same fields again, and continue the active Procedure with the next live tool or KB step.',
  ].join('\n')
}

type FormTraceField = {
  id: string
  type: string
  label: string
  required?: boolean
  options?: string[]
  placeholder?: string
}

function normalizeFormTraceFields(raw: unknown): FormTraceField[] {
  if (!Array.isArray(raw)) return []
  const normalized: FormTraceField[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string'
      ? record.id.trim()
      : typeof record.key === 'string'
        ? record.key.trim()
        : ''
    const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim() : id
    if (!id || !label) continue
    const type = typeof record.type === 'string' && record.type.trim() ? record.type.trim() : 'text'
    const options = Array.isArray(record.options)
      ? record.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
      : undefined

    normalized.push({
      id,
      type,
      label,
      required: record.required === true ? true : undefined,
      options,
      placeholder: typeof record.placeholder === 'string' && record.placeholder.trim().length > 0
        ? record.placeholder.trim()
        : undefined,
    })
  }

  return normalized
}

function formatFormSubmissionTraceDetail(args: {
  title?: string
  description?: string
  answers: Record<string, string>
  fields: FormTraceField[]
}): string {
  const lines: string[] = []
  if (args.title?.trim()) lines.push(`title: ${args.title.trim()}`)
  if (args.description?.trim()) lines.push(`description: ${args.description.trim()}`)

  const labelById = new Map(args.fields.map((field) => [field.id, field.label]))
  const answerLines = Object.entries(args.answers).map(([key, value]) => {
    const label = labelById.get(key) ?? key
    const rendered = typeof value === 'string' ? value.trim() : String(value)
    return `${label}: ${rendered || '(empty)'}`
  })

  if (answerLines.length > 0) {
    lines.push('answers:')
    lines.push(...answerLines.map((line) => `- ${line}`))
  }

  return lines.join('\n')
}

function formatFormSubmissionDisplayText(answers: Record<string, string>): string {
  const entries = Object.entries(answers)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([key, value]) => `${key}: ${value.trim()}`)

  if (entries.length === 0) {
    return ['[FORM_SUBMISSION]', '[/FORM_SUBMISSION]'].join('\n')
  }

  return [
    '[FORM_SUBMISSION]',
    ...entries,
    '[/FORM_SUBMISSION]',
  ].join('\n')
}

function rewritePersistedFormTurnMessages(
  messages: Message[],
  formAnswers: Record<string, string> | undefined,
  toolCallId: string | undefined,
): Message[] {
  if (!formAnswers || !toolCallId) return messages

  const rawRuntimePrefix = `Tool ask_user_questions result: ${JSON.stringify(formAnswers)}`
  let targetIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && message.content.startsWith(rawRuntimePrefix)) {
      targetIndex = index
      break
    }
  }
  if (targetIndex < 0) return messages

  const target = messages[targetIndex]!
  const toolResultPayload = JSON.stringify(formAnswers)
  const visibleMessage: Message = {
    ...target,
    content: formatFormSubmissionDisplayText(formAnswers),
    createdAt: new Date(target.createdAt.getTime() + 1),
    providerContent: undefined,
    providerMeta: undefined,
  }
  const internalToolResultMessage: Message = {
    id: `${target.id}__tool_result`,
    role: 'user',
    content: '',
    createdAt: target.createdAt,
    providerContent: toolResultProviderContent([
      {
        type: 'tool_result',
        tool_use_id: toolCallId,
        content: toolResultPayload,
      },
    ]),
    providerMeta: makeProviderMeta({
      visibility: 'internal',
      transcriptKind: 'tool_result',
      toolUseIds: [toolCallId],
    }),
  }

  return [
    ...messages.slice(0, targetIndex),
    internalToolResultMessage,
    visibleMessage,
    ...messages.slice(targetIndex + 1),
  ]
}

function buildMessagesToPersist(args: {
  messages: Message[]
  caseId: string
  orgId: string
  chatId: string
  runId: string | null
  formAnswers?: Record<string, string>
  formToolCallId?: string
}): Array<MessagePersistenceRecord & { orgId: string; chatId: string; runId: string | null }> {
  const rewrittenMessages = rewritePersistedFormTurnMessages(
    args.messages,
    args.formAnswers,
    args.formToolCallId,
  )

  return rewrittenMessages
    .filter((message) => hasProviderOrDisplayContent(message))
    .map((message) => ({
      ...serializeMessageForPersistence(message, args.caseId),
      orgId: args.orgId,
      chatId: args.chatId,
      runId: args.runId,
    }))
}

function deriveCaseStatusFromRuntimeProcedure(
  runtimeProcedure: { status?: string } | null | undefined,
  currentCaseStatus: string | null | undefined,
  options?: { resumeFromHumanTaskResult?: boolean },
): string | undefined {
  if (options?.resumeFromHumanTaskResult && runtimeProcedure?.status === 'paused') {
    return 'investigating'
  }
  if (runtimeProcedure?.status === 'paused') return 'waiting_human'
  if (runtimeProcedure?.status === 'active') {
    return currentCaseStatus === 'resolved' || currentCaseStatus === 'escalated'
      ? currentCaseStatus
      : 'investigating'
  }
  return currentCaseStatus ?? undefined
}

async function writeProviderTranscriptPersistedTrace(
  caseId: string,
  orgId: string,
  chatId: string,
  runId: string | null | undefined,
  messages: MessagePersistenceRecord[],
): Promise<void> {
  const receipt = providerTranscriptPersistenceReceipt(messages)
  if (!receipt.providerTranscriptPersisted) return
  try {
    await prisma.actionTrace.create({
      data: {
        caseId,
        orgId,
        chatId,
        runId,
        actionType: 'provider_transcript_persisted',
        title: 'Provider transcript persisted',
        detail: `${receipt.providerTranscriptMessageCount} provider transcript message(s) persisted`,
        payload: JSON.stringify(receipt),
      },
    })
  } catch (err) {
    console.error('[Intera] Failed to write provider transcript persistence trace:', err)
  }
}

async function writeFormSubmissionTrace(args: {
  caseId: string
  orgId: string
  chatId: string
  runId: string | null
  title?: string
  description?: string
  fields: FormTraceField[]
  answers: Record<string, string>
}): Promise<void> {
  try {
    await prisma.actionTrace.create({
      data: {
        caseId: args.caseId,
        orgId: args.orgId,
        chatId: args.chatId,
        runId: args.runId,
        actionType: 'form_submit',
        title: args.title?.trim() ? `Form submitted: ${args.title.trim()}` : 'Form submitted',
        detail: formatFormSubmissionTraceDetail(args),
        payload: JSON.stringify({
          title: args.title ?? null,
          description: args.description ?? null,
          fields: args.fields,
          answers: args.answers,
        }),
      },
    })
  } catch (err) {
    console.error('[Intera] Failed to write form submission trace:', err)
  }
}

/** Lightweight LLM-based intent routing: classify a user message to the best
 *  matching active case. Falls back to the most recent case on error. */
type CaseRoutingDecision =
  | { kind: 'existing'; caseId: string }
  | { kind: 'new' }

type CaseTypeRoutingRow = {
  type: string
  displayName: string
  description: string | null
  icon: string
  requiredFacts: string
  defaultGoal: string
  escalateOn: string
  autoCloseConditions: string | null
  procedure?: string | null
  maxAutoTurns?: number | null
}

type CaseTypeRoutingDecision =
  | { kind: 'case_type'; caseType: CaseTypeRoutingRow; confidence: number; reason?: string }
  | { kind: 'general'; reason?: string }

const ACTIVE_CASE_TOPIC_SYNONYMS: Record<string, string[]> = {
  deposit: ['deposit', 'deposited', 'top up', 'topup', 'recharge', 'bank transfer', 'transfer receipt', '存款', '充值', '入款'],
  withdrawal: ['withdraw', 'withdrawal', 'withdrew', 'cash out', 'payout', '提现', '提款', '出款', '提了', '提取', '提現'],
}

const MEMBER_ID_PATTERN = /\bJAYA(?=[A-Z0-9]*\d)[A-Z0-9]{4,}\b/i

function deterministicRouteActiveCaseByText(
  userMessage: string,
  activeCases: Array<{ id: string; type: string }>,
): CaseRoutingDecision | null {
  const normalized = userMessage.toLowerCase()
  const topicHits = Object.entries(ACTIVE_CASE_TOPIC_SYNONYMS)
    .filter(([, terms]) => terms.some((term) => normalized.includes(term.toLowerCase())))
    .map(([topic]) => topic)

  if (topicHits.length !== 1) return null
  const [topic] = topicHits
  const matches = activeCases.filter((c) => c.type.toLowerCase().includes(topic))
  if (matches.length === 1) return { kind: 'existing', caseId: matches[0].id }

  const conflictingTopicExists = activeCases.some((c) =>
    Object.keys(ACTIVE_CASE_TOPIC_SYNONYMS)
      .filter((candidate) => candidate !== topic)
      .some((candidate) => c.type.toLowerCase().includes(candidate)),
  )
  if (conflictingTopicExists) return { kind: 'new' }
  return null
}

function normalizeRoutingText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function caseTypeRoutingSearchText(row: CaseTypeRoutingRow): string {
  const procedure = parseProcedure(row.procedure)
  return normalizeRoutingText([
    row.type,
    row.displayName,
    row.description,
    procedure?.whenToUse,
    procedure?.overview,
    procedure?.knowledgeGuidance,
  ].filter(Boolean).join(' '))
}

function findCaseTypeByNeedles(
  candidates: CaseTypeRoutingRow[],
  needles: string[],
): CaseTypeRoutingRow | null {
  const normalizedNeedles = needles.map(normalizeRoutingText)
  const typeMatches = candidates.filter((row) => {
    const type = normalizeRoutingText(row.type)
    return normalizedNeedles.some((needle) => type.includes(needle))
  })
  if (typeMatches.length > 0) {
    return typeMatches
      .slice()
      .sort((a, b) => a.type.length - b.type.length)[0]
  }

  const matches = candidates.filter((row) => {
    const text = caseTypeRoutingSearchText(row)
    return normalizedNeedles.some((needle) => text.includes(needle))
  })
  if (matches.length === 0) return null
  return matches
    .slice()
    .sort((a, b) => a.type.length - b.type.length)[0]
}

function hasAnyRoutingTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}

function hasPersonalLookupCue(text: string): boolean {
  return (
    MEMBER_ID_PATTERN.test(text) ||
    /\b(my|me|mine|i|i'm|im|mero|malai|maile|malaai)\b/.test(text) ||
    /\b(member|player)\s*id\b/.test(text) ||
    /\b(account|status|latest|current|check|verify|verification|kyc|history|record|records|eligib|eligible)\b/.test(text) ||
    /\b(not|no|missing|failed|rejected|blocked|stuck|pending|arrived|received|credited|deducted|wrong|issue|problem|unable)\b/.test(text) ||
    /\b(kina|hudaina|bhayena|aayena|audaina|milena)\b/.test(text)
  )
}

function looksLikeSelfServiceFaq(text: string): boolean {
  if (/\b(can you|please)\s+check\b/.test(text)) return false
  if (/\b(status|latest|current|rejected|blocked|failed|pending|wrong|not\s+(?:received|arrived|credited))\b/.test(text)) {
    return false
  }
  if (/\b(is|am)\s+my\s+account\s+verified\b/.test(text)) return true
  return (
    /\b(how\s+(?:to|do|can)|where\s+(?:to|can)|what\s+(?:are|is)|do\s+you\s+support|can\s+i\s+(?:deposit|withdraw|claim|view|check))\b/.test(text) ||
    /\b(rule|rules|limit|limits|method|methods|process|processing\s+time|crypto|minimum|maximum|min|max|welcome\s+bonus\s+terms)\b/.test(text)
  )
}

function deterministicRouteCaseTypeByText(
  userMessage: string,
  caseTypes: CaseTypeRoutingRow[],
): CaseTypeRoutingDecision | null {
  const candidates = caseTypes.filter((row) => isInvestigableCaseType(row.type))
  if (candidates.length === 0) return { kind: 'general', reason: 'No configured case types.' }

  const text = normalizeRoutingText(userMessage)
  const personal = hasPersonalLookupCue(text)
  const selfServiceFaq = looksLikeSelfServiceFaq(text)
  const route = (needles: string[], reason: string): CaseTypeRoutingDecision | null => {
    const row = findCaseTypeByNeedles(candidates, needles)
    return row ? { kind: 'case_type', caseType: row, confidence: 0.9, reason } : null
  }

  // Reset PIN is always a member-specific workflow, even before the member_id is known.
  if (
    hasAnyRoutingTerm(text, ['withdrawal pin', 'withdraw pin', 'withdraw pin', 'pin reset', 'reset pin']) ||
    (text.includes('pin') && hasAnyRoutingTerm(text, ['forgot', 'forget', 'lost', 'reset']))
  ) {
    return route(['reset_withdrawal_pin', 'reset withdrawal pin', 'reset pin'], 'Customer asks to reset or recover withdrawal PIN.')
  }

  // Avoid turning ordinary FAQ/how-to questions into live lookups.
  const memberSpecific = personal && !selfServiceFaq

  if (memberSpecific && hasAnyRoutingTerm(text, ['deposit', 'deposited', 'top up', 'topup', 'recharge', 'bank transfer', 'balance not updated', 'not credited', 'not arrived', 'has not arrived'])) {
    return route(['deposit'], 'Customer asks for a member-specific deposit check.')
  }

  if (memberSpecific && hasAnyRoutingTerm(text, ['withdraw', 'withdrawal', 'withdrew', 'cash out', 'payout', 'turnover', 'hudaina', 'cashout'])) {
    return route(['withdrawal', 'withdraw'], 'Customer asks for a member-specific withdrawal check.')
  }

  if (memberSpecific && hasAnyRoutingTerm(text, ['promo', 'promotion', 'bonus', 'cashback', 'vip bonus']) && hasAnyRoutingTerm(text, ['active', 'have', 'eligib', 'account', 'now', 'my'])) {
    return route(['promotion'], 'Customer asks for personal promotion or cashback status.')
  }

  if (memberSpecific && hasAnyRoutingTerm(text, ['kyc', 'verification', 'verify my account', 'check my account', 'account status', 'account rejected', 'account blocked', 'restricted'])) {
    return route(['account'], 'Customer asks for member-specific account or KYC status.')
  }

  if (memberSpecific && hasAnyRoutingTerm(text, ['recommend game', 'recommend games', 'games for me', 'game for me', 'based on my account', 'based on account'])) {
    return route(['game_recommendation', 'game recommendation', 'recommendation'], 'Customer asks for personalized game recommendation.')
  }

  if (memberSpecific && hasAnyRoutingTerm(text, ['bet result', 'last bet', 'bet history', 'wager', 'round', 'game result', 'result wrong'])) {
    return route(['bet'], 'Customer asks for member-specific bet history or dispute check.')
  }

  if (memberSpecific && hasAnyRoutingTerm(text, ['transaction history', 'transaction records', 'statement records', 'deposit history', 'withdrawal history'])) {
    return route(['transaction'], 'Customer asks for member-specific transaction history.')
  }

  if (hasAnyRoutingTerm(text, ['not received my money', 'money not received', 'funds missing', 'transfer issue']) && !hasAnyRoutingTerm(text, ['deposit', 'withdraw', 'withdrawal', 'bonus', 'cashback', 'bet', 'game'])) {
    return { kind: 'general', reason: 'Ambiguous money issue; agent should ask issue_type before choosing a procedure.' }
  }

  return null
}

function normalizeFactKeyForRoute(fact: string): string {
  const normalized = fact.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (['memberid', 'member_id', 'playerid', 'player_id', 'user_id', 'userid'].includes(normalized)) return 'member_id'
  if (['issuetype', 'issue_type', 'intent_type'].includes(normalized)) return 'issue_type'
  return normalized || fact
}

function formFieldFromRequiredFact(fact: string): Record<string, unknown> {
  const key = normalizeFactKeyForRoute(fact)
  if (key === 'issue_type') {
    return {
      key,
      label: 'Issue type',
      type: 'select',
      required: true,
      options: ['Deposit not credited', 'Withdrawal not received', 'Bonus/cashback not received', 'Game/bet money issue', 'Other'],
    }
  }
  if (key === 'method') {
    return {
      key,
      label: 'Transaction type',
      type: 'select',
      required: true,
      options: ['deposit', 'withdrawal'],
    }
  }
  return {
    key,
    label: key === 'member_id'
      ? 'Member ID'
      : key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
    type: 'text',
    required: true,
    placeholder: key === 'member_id' ? 'JAYA...' : undefined,
  }
}

function fallbackRequiredFactsFormTitle(missingFacts: string[]): string {
  const normalized = missingFacts.map(normalizeFactKeyForRoute)
  if (normalized.length === 1 && normalized[0] === 'member_id') return 'Member ID Required'
  if (normalized.includes('issue_type')) return 'Please choose the issue type'
  return 'Information Required'
}

function fallbackRequiredFactsFormDescription(missingFacts: string[]): string {
  const normalized = missingFacts.map(normalizeFactKeyForRoute)
  if (normalized.length === 1 && normalized[0] === 'member_id') {
    return 'Please provide your Jayabaji Member ID so I can continue.'
  }
  if (normalized.includes('issue_type')) {
    return 'Please select the closest issue type so I can route this correctly.'
  }
  return 'Please provide the missing details so I can continue.'
}

function extractFactsFromTextForRoute(text: string | undefined): Record<string, string> {
  const facts: Record<string, string> = {}
  if (!text) return facts
  const memberId = text.match(MEMBER_ID_PATTERN)?.[0]
  if (memberId) facts.member_id = memberId.toUpperCase()
  const normalized = normalizeRoutingText(text)
  if (hasAnyRoutingTerm(normalized, ['deposit history', 'deposit transaction'])) facts.method = 'deposit'
  if (hasAnyRoutingTerm(normalized, ['withdrawal history', 'withdraw history', 'withdrawal transaction', 'withdraw transaction'])) facts.method = 'withdrawal'
  return facts
}

function extractMemberIdFromProfile(profile: string | undefined, sections: unknown): string | null {
  const haystack = [profile ?? '', JSON.stringify(sections ?? {})].join('\n')
  return haystack.match(MEMBER_ID_PATTERN)?.[0]?.toUpperCase() ?? null
}

async function readProfileFactsForRoute(args: {
  orgId: string
  userId: string
  chatId?: string | null
  agentConfigId?: string | null
}): Promise<Record<string, string>> {
  const key = profileKey(args.userId, args.chatId)
  if (!key) return {}
  try {
    const profile = await readUserProfile(prisma as any, {
      orgId: args.orgId,
      userId: key,
      agentConfigId: args.agentConfigId,
    })
    const memberId = extractMemberIdFromProfile(profile?.profile, parseMemoryJson(profile?.sections))
    return memberId ? { member_id: memberId } : {}
  } catch {
    return {}
  }
}

function missingRequiredFactsForRoute(args: {
  requiredFacts: string[]
  messageText?: string
  formAnswers?: Record<string, string>
  profileFacts?: Record<string, string>
}): string[] {
  const fromMessage = extractFactsFromTextForRoute(args.messageText)
  const known = new Map<string, string>()
  for (const source of [args.profileFacts ?? {}, fromMessage, args.formAnswers ?? {}]) {
    for (const [key, value] of Object.entries(source)) {
      const normalizedKey = normalizeFactKeyForRoute(key)
      if (typeof value === 'string' && value.trim()) known.set(normalizedKey, value.trim())
    }
  }
  return args.requiredFacts
    .map(normalizeFactKeyForRoute)
    .filter((fact, index, all) => all.indexOf(fact) === index)
    .filter((fact) => !known.has(fact))
}

function isExplicitHumanHandoffRequest(text: string): boolean {
  const normalized = normalizeRoutingText(text)
  if (!normalized) return false
  if (/\b(help me|help|support)\b/.test(normalized) && !/\b(human|agent|operator|real person|live chat|live agent|customer service)\b/.test(normalized)) {
    return false
  }
  return /\b(human|human please|real agent|real person|live agent|operator|manual review|customer service|support agent)\b/.test(normalized)
}

function isOperationalEvidenceTool(title: string | null): boolean {
  const toolName = (title || '').replace(/^Tool: /, '').trim()
  if (!toolName) return false
  return ![
    'ask_user_questions',
    'read_user_profile',
    'read_chat_memory',
    'remember',
    'get_current_time',
    'create_human_task',
  ].includes(toolName)
}

async function resolveCaseByIntent(
  userMessage: string,
  activeCases: Array<{ id: string; type: string }>,
  fallbackCaseId: string,
): Promise<CaseRoutingDecision> {
  const model = process.env.HUB_ROUTING_MODEL || DEFAULT_MEMORY_MODEL

  const caseList = activeCases
    .map((c) => `- id: "${c.id}", type: ${c.type}`)
    .join('\n')

  const prompt = [
    'You are a message router. Given a customer message and a list of active cases,',
    'return the case ID that best matches what the customer is talking about.',
    'If the message is about a NEW topic not covered by any case, return "new".',
    '',
    'Active cases:',
    caseList,
    '',
    'Reply with ONLY the case ID or "new". No other text.',
  ].join('\n')

  try {
    const { createAgentClient } = await import('@/lib/agent/api/provider-config')
    const client = createAgentClient(model)
    const resp = await client.messages.create({
      model,
      max_tokens: 32,
      temperature: 0,
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
    })
    const text = (resp.content[0] as any)?.text?.trim() || ''
    // Extract caseId from response (handle quotes, whitespace)
    const clean = text.replace(/^["']|["']$/g, '').trim()
    if (clean === 'new') return { kind: 'new' }
    if (!clean) return { kind: 'existing', caseId: fallbackCaseId }
    // Verify the returned ID is in the active cases list
    if (activeCases.some((c) => c.id === clean)) return { kind: 'existing', caseId: clean }
    return { kind: 'existing', caseId: fallbackCaseId }
  } catch {
    return { kind: 'existing', caseId: fallbackCaseId }
  }
}

function caseTypeRoutingDescriptor(row: CaseTypeRoutingRow): string {
  const procedure = parseProcedure(row.procedure)
  const requiredFacts = parseMemoryJson(row.requiredFacts)
  const facts = Array.isArray(requiredFacts) ? requiredFacts.join(', ') : ''
  return [
    `- type: "${row.type}"`,
    `  displayName: ${row.displayName}`,
    row.description ? `  description: ${row.description}` : null,
    procedure?.whenToUse ? `  whenToUse: ${procedure.whenToUse}` : null,
    procedure?.overview ? `  overview: ${procedure.overview}` : null,
    procedure?.knowledgeGuidance ? `  knowledgeGuidance: ${procedure.knowledgeGuidance}` : null,
    facts ? `  requiredFacts: ${facts}` : `  requiredFacts: none`,
  ].filter(Boolean).join('\n')
}

function parseCaseTypeRoutingText(text: string): { type: string; confidence: number; reason?: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const jsonText = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    const rawType = typeof parsed.type === 'string'
      ? parsed.type
      : typeof parsed.caseType === 'string'
        ? parsed.caseType
        : typeof parsed.case_type === 'string'
          ? parsed.case_type
          : ''
    if (!rawType.trim()) return null
    const confidence = typeof parsed.confidence === 'number'
      ? parsed.confidence
      : Number(parsed.confidence ?? 0.75)
    return {
      type: rawType.trim().replace(/^["']|["']$/g, ''),
      confidence: Number.isFinite(confidence) ? confidence : 0.75,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    }
  } catch {
    const clean = trimmed.replace(/^["']|["']$/g, '').trim()
    if (!clean) return null
    return { type: clean, confidence: 0.7 }
  }
}

async function resolveCaseTypeByIntent(
  userMessage: string,
  caseTypes: CaseTypeRoutingRow[],
): Promise<CaseTypeRoutingDecision> {
  const candidates = caseTypes.filter((row) => isInvestigableCaseType(row.type))
  if (candidates.length === 0) return { kind: 'general', reason: 'No configured case types.' }

  const model = process.env.HUB_ROUTING_MODEL || DEFAULT_MEMORY_MODEL
  const caseList = candidates.map(caseTypeRoutingDescriptor).join('\n\n')
  const prompt = [
    'You are an Intera harness case-type router.',
    'Given a customer message and configured CaseTypes, choose the exact CaseType type only when the message clearly matches that CaseType.',
    'Return "general" when the customer asks an ordinary FAQ, self-service how-to, rules/limits/policy question, or when the money/funds intent is ambiguous.',
    'Do not choose a member-specific lookup CaseType unless the customer asks for their own current status/history/eligibility/reset/dispute or a transaction-specific check.',
    '',
    'Configured CaseTypes:',
    caseList,
    '',
    'Reply as compact JSON only: {"type":"<exact type or general>","confidence":0.0-1.0,"reason":"short reason"}.',
  ].join('\n')

  try {
    const { createAgentClient } = await import('@/lib/agent/api/provider-config')
    const client = createAgentClient(model)
    const resp = await client.messages.create({
      model,
      max_tokens: 160,
      temperature: 0,
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
    })
    const text = (resp.content[0] as any)?.text?.trim() || ''
    const parsed = parseCaseTypeRoutingText(text)
    if (!parsed) return { kind: 'general', reason: 'Router returned no parseable type.' }
    const requested = parsed.type.trim()
    if (requested.toLowerCase() === 'general') {
      return { kind: 'general', reason: parsed.reason }
    }
    const row = candidates.find((candidate) => candidate.type === requested)
    if (!row) return { kind: 'general', reason: `Unknown routed type: ${requested}` }
    return {
      kind: 'case_type',
      caseType: row,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      reason: parsed.reason,
    }
  } catch (err) {
    console.error('[Intera] CaseType routing failed:', err)
    return { kind: 'general', reason: 'Router error.' }
  }
}

export async function POST(request: NextRequest) {
  // Rate limit: 120 requests per minute per IP
  const ip = clientIp(request)
  const rl = checkRateLimit({ key: `messages:${ip}`, max: 120, windowSec: 60 })
  if (!rl.allowed) {
    return new Response('Too Many Requests', { status: 429 })
  }

  return defineRoute({
    method: 'POST',
    auth: 'apiKey',
    async handler({ session, repo }) {
      const authOrgId = session.orgId
      const authAgentConfigId = session.agentConfigId

      const runtimeProxyResponse = await maybeProxyMessagesToRuntime(request, {
        orgId: authOrgId,
        agentConfigId: authAgentConfigId,
      })
      if (runtimeProxyResponse) return runtimeProxyResponse

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const streamWriter = createSafeSseWriter(controller, encoder)
      const sendEvent = (event: SSEEvent) => {
        streamWriter.sendEvent(event)
      }
      const closeStream = () => {
        streamWriter.close()
      }

      let registeredSession: CaseSession | null = null

      try {
        // Body size validation
        const contentLength = Number(request.headers.get('content-length') || 0)
        if (contentLength > 100_000) {
          sendEvent({ type: 'error', data: 'Request body too large (max 100KB)', timestamp: new Date().toISOString() })
          closeStream()
          return
        }

        const body = await request.json()
        const {
          message,
          contentBlocks,
          resumeTrigger,
          formResult,
          interactionResult,
          caseId,
          configId: bodyConfigId,
          orgId,
          userId,
          userLabel,
          chatId,
          caseType: bodyCaseType,
          bootstrapNewCase: rawBootstrapNewCase,
          sessionCasePinned: rawSessionCasePinned,
          disableCaseRouting: rawDisableCaseRouting,
        } = body

        // Session-based requests (web/playground) pass agentConfigId via body;
        // API-key and internal calls get it from the auth layer.
        const resolvedAgentConfigId = authAgentConfigId || (typeof bodyConfigId === 'string' ? bodyConfigId : null)

        const bootstrapNewCase = Boolean(rawBootstrapNewCase)
        const sessionCasePinned = rawSessionCasePinned === true
        const disableCaseRouting = rawDisableCaseRouting === true

        // orgId mismatch check: if body sends a different orgId than the credential
        if (authOrgId && orgId && orgId !== authOrgId) {
          sendEvent({ type: 'error', data: 'orgId mismatch — body orgId must match API key org', timestamp: new Date().toISOString() })
          closeStream()
          return
        }

        // Validate orgId format
        if (orgId && (typeof orgId !== 'string' || orgId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(orgId))) {
          sendEvent({ type: 'error', data: 'Invalid orgId format', timestamp: new Date().toISOString() })
          closeStream()
          return
        }

        // Validate userId format
        if (userId && (typeof userId !== 'string' || userId.length > 64 || !/^[a-zA-Z0-9_@.-]+$/.test(userId))) {
          sendEvent({ type: 'error', data: 'Invalid userId format', timestamp: new Date().toISOString() })
          closeStream()
          return
        }

        // Validate caseId format
        if (caseId && (typeof caseId !== 'string' || caseId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(caseId))) {
          sendEvent({ type: 'error', data: 'Invalid caseId format', timestamp: new Date().toISOString() })
          closeStream()
          return
        }

        // Validate resumeTrigger format
        if (resumeTrigger && (typeof resumeTrigger !== 'string' || resumeTrigger.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(resumeTrigger))) {
          sendEvent({ type: 'error', data: 'Invalid resumeTrigger format', timestamp: new Date().toISOString() })
          closeStream()
          return
        }

        // Validate message length
        if (message && typeof message === 'string' && message.length > 50000) {
          sendEvent({ type: 'error', data: 'Message too long (max 50000 characters)', timestamp: new Date().toISOString() })
          closeStream()
          return
        }

        // Validate contentBlocks format
        const resolvedContentBlocks = contentBlocks && Array.isArray(contentBlocks) ? contentBlocks : undefined

        let userMessage = message
        let resolvedCaseId = caseId || generateCaseId()
        let resolvedOrgId = authOrgId || orgId
        if (!resolvedOrgId) {
          sendEvent({ type: 'error', data: 'Unable to resolve organization', timestamp: new Date().toISOString() })
          closeStream()
          return
        }
        let resolvedUserId = userId || 'anonymous'
        let resolvedChatId =
          typeof chatId === 'string' && chatId.trim().length > 0
            ? chatId.trim()
            : resolvedCaseId
        let createdCaseForIntent = false
        let inferredCaseTypeRow: CaseTypeRoutingRow | null = null
        let inferredCaseTypeConfidence: number | null = null
        let inferredCaseTypeReason: string | undefined
        const emittedCaseCreated = new Set<string>()
        let runtimeInputSource: RuntimeEventSource = 'customer_message'
        let naturalMemberIdForProfile: string | null = null

        // If the client sent an explicit caseId that doesn't exist yet in DB,
        // it's a fresh conversation — skip hub routing so it doesn't hijack
        // old active cases for the same userId.
        const clientProvidedCaseId = !!caseId
        let clientCaseIsNew = false
        if (clientProvidedCaseId) {
          try {
            const existing = await prisma.case.findUnique({
              where: { id: resolvedCaseId },
              select: { orgId: true, chatId: true },
            })
            if (existing && existing.orgId !== resolvedOrgId) {
              sendEvent({ type: 'error', data: 'Case not found for this organization', timestamp: new Date().toISOString() })
              closeStream()
              return
            }
            if (existing?.chatId) resolvedChatId = existing.chatId
            clientCaseIsNew = !existing
          } catch { /* noop */ }
        }

        // ── Form response: customer submitted form answers ──
        let formAnswers: Record<string, string> | undefined
        let formToolCallId: string | undefined
        let formTitle: string | undefined
        let formDescription: string | undefined
        let formFields: FormTraceField[] = []
        if (formResult && !message) {
          resolvedCaseId = formResult.caseId || resolvedCaseId
          const answers = (formResult.answers || {}) as Record<string, string>
          // Validate form payload size
          const answersJson = JSON.stringify(answers)
          if (answersJson.length > 50_000) {
            sendEvent({ type: 'error', data: 'Form answers too large (max 50KB)', timestamp: new Date().toISOString() })
            closeStream()
            return
          }
          formAnswers = answers
          formToolCallId =
            typeof formResult.toolCallId === 'string' && formResult.toolCallId.trim().length > 0
              ? formResult.toolCallId.trim()
              : undefined
          formTitle =
            typeof formResult.title === 'string' && formResult.title.trim().length > 0
              ? formResult.title.trim()
              : undefined
          formDescription =
            typeof formResult.description === 'string' && formResult.description.trim().length > 0
              ? formResult.description.trim()
              : undefined
          formFields = normalizeFormTraceFields((formResult as { fields?: unknown }).fields)
          runtimeInputSource = 'customer_form_result'
          // Format as tool_result so the model sees it exactly like any other
          // tool execution result — matching CC's AskUserQuestion pattern.
          userMessage = formResultRuntimeText(answers)
          console.log('[Intera] Form submitted', {
            chatId: resolvedChatId,
            internalCaseId: resolvedCaseId,
            fieldCount: formFields.length,
          })
        }

        // ── Interaction response: customer selected an option ──
        if (interactionResult && !message && !formResult) {
          resolvedCaseId = interactionResult.caseId || resolvedCaseId
          const { optionId, input } = interactionResult as { caseId?: string; optionId: string; input?: string }
          // Validate optionId and input size
          if (!optionId || typeof optionId !== 'string' || optionId.length > 256) {
            sendEvent({ type: 'error', data: 'Invalid interaction option', timestamp: new Date().toISOString() })
            closeStream()
            return
          }
          if (input && typeof input === 'string' && input.length > 10_000) {
            sendEvent({ type: 'error', data: 'Interaction input too large (max 10KB)', timestamp: new Date().toISOString() })
            closeStream()
            return
          }
          const payload: Record<string, unknown> = { optionId }
          if (input) payload.input = input
          userMessage = `Tool ask_user_questions result: ${JSON.stringify(payload)}`
          runtimeInputSource = 'customer_form_result'
          console.log(`[Intera] Interaction resolved for case ${resolvedCaseId}: option=${optionId}`)
        }

        // ── Resume flow: human resolved a task, agent continues ──
        if (resumeTrigger && !message) {
          const task = await prisma.humanTask.findUnique({
            where: { id: resumeTrigger },
            include: { case: true },
          })

          if (task && task.status === 'resolved') {
            if (authOrgId && task.case.orgId !== authOrgId) {
              sendEvent({
                type: 'error',
                data: 'Task not found or not resolved',
                timestamp: new Date().toISOString(),
              })
              closeStream()
              return
            }

            resolvedCaseId = task.caseId
            resolvedOrgId = task.case.orgId
            resolvedUserId = task.case.userId
            resolvedChatId = task.case.chatId || resolvedChatId

            const resumeTmpl =
              (await loadAgentConfig(resolvedAgentConfigId)).resumePrompt || HARNESS_DEFAULT_RESUME_PROMPT_APPEND
            const parts = ['[Human task resolved — operator closed the case]']
            if (task.verdict) parts.push(`Operator verdict: ${task.verdict.replace(/_/g, ' ')}`)
            if (task.expectedEta) parts.push(`Expected resolution time: ${task.expectedEta}`)
            if (task.notes) parts.push(`Internal notes (do NOT share verbatim with customer): ${task.notes}`)
            parts.push(resumeTmpl)
            userMessage = parts.join('\n')
            runtimeInputSource = 'human_task_result'
            await prisma.case.update({
              where: { id: resolvedCaseId },
              data: { status: 'investigating', blocker: null },
            }).catch((err: unknown) => { console.error('[Intera] Failed to align case truth on resumeTrigger:', err) })

            console.log(`[Intera] Resuming case ${resolvedCaseId} after human resolution`)
          } else {
            sendEvent({
              type: 'error',
              data: 'Task not found or not resolved',
              timestamp: new Date().toISOString(),
            })
            closeStream()
            return
          }
        }

        if (!userMessage) {
          sendEvent({
            type: 'error',
            data: 'Message is required',
            timestamp: new Date().toISOString(),
          })
          closeStream()
          return
        }

        if (runtimeInputSource === 'customer_message' && typeof message === 'string') {
          naturalMemberIdForProfile = message.match(MEMBER_ID_PATTERN)?.[0]?.toUpperCase() ?? null
        }

        try {
          const claimedCase = await prisma.case.findUnique({
            where: { id: resolvedCaseId },
            select: { orgId: true, chatId: true },
          })
          if (claimedCase && claimedCase.orgId !== resolvedOrgId) {
            sendEvent({ type: 'error', data: 'Case not found for this organization', timestamp: new Date().toISOString() })
            closeStream()
            return
          }
          if (claimedCase?.chatId) resolvedChatId = claimedCase.chatId
        } catch { /* non-critical; the upsert path below will still enforce FK/DB constraints */ }

        // ── System prompts (Core + Case) ──
        // Unified assembly via buildModePrompt — single source of truth
        // shared with playground-runner.ts. Eliminates dual-path drift.
        let coreSystemPrompt: string = CORE_SYSTEM_PROMPT
        let systemPrompt: string = ''

        // Stream progress immediately so the user sees movement (CC pattern)
        sendEvent({ type: 'stream_request_start', data: null, timestamp: new Date().toISOString() })

        // ── Hub: route message to the correct active case ──
        // When multiple cases are active in a single chat window (no tabs),
        // the Hub decides which case receives this message.
        if (
          userMessage &&
          !resumeTrigger &&
          !formResult &&
          !bootstrapNewCase &&
          !interactionResult &&
          !clientCaseIsNew &&
          !sessionCasePinned &&
          !disableCaseRouting
        ) {
          try {
            const activeCases = await prisma.case.findMany({
              where: {
                orgId: resolvedOrgId,
                userId: resolvedUserId,
                chatId: resolvedChatId,
                status: { notIn: ['resolved'] },
              },
              orderBy: { updatedAt: 'desc' },
            })

            if (activeCases.length === 1) {
              const routed = deterministicRouteActiveCaseByText(userMessage, activeCases) ??
                await resolveCaseByIntent(
                  userMessage,
                  activeCases,
                  activeCases[0].id,
                )
              if (routed.kind === 'new') {
                const newCase = await prisma.case.create({
                  data: {
                    orgId: resolvedOrgId,
                    userId: resolvedUserId,
                    type: 'general',
                    status: 'created',
                    chatId: resolvedChatId,
                  },
                })
                resolvedCaseId = newCase.id
              } else {
                resolvedCaseId = routed.caseId
              }
            } else if (activeCases.length > 1) {
              // LLM-based intent routing: classify the message to the right case.
              // Do not auto-hijack arbitrary customer text into the newest pending
              // human task; that keeps stale handoff cases alive forever.
              const routed = deterministicRouteActiveCaseByText(userMessage, activeCases) ??
                await resolveCaseByIntent(
                  userMessage,
                  activeCases,
                  resolvedCaseId,
                )
              if (routed.kind === 'new') {
                const newCase = await prisma.case.create({
                  data: {
                    orgId: resolvedOrgId,
                    userId: resolvedUserId,
                    type: 'general',
                    status: 'created',
                    chatId: resolvedChatId,
                  },
                })
                resolvedCaseId = newCase.id
              } else {
                resolvedCaseId = routed.caseId
              }
            }
          } catch (err) { console.error('[Intera] Hub routing failed:', err) }
        }

        // ── Fresh lane case-type routing ──
        // If this is a new/general lane, classify against configured CaseTypes
        // before the first AgentLoop call so Procedure context can be injected
        // from turn one. This stays harness-level: the router sees only rows
        // operators configured in Console, not hardcoded J1N keyword branches.
        if (
          resolvedAgentConfigId &&
          userMessage &&
          !resumeTrigger &&
          !formResult &&
          !bootstrapNewCase &&
          !interactionResult &&
          !bodyCaseType &&
          !sessionCasePinned &&
          !disableCaseRouting
        ) {
          try {
            const targetCase = await prisma.case.findUnique({
              where: { id: resolvedCaseId },
              select: { id: true, type: true, status: true },
            })
            const activeOrPausedRun = targetCase
              ? await prisma.procedureRun.findFirst({
                  where: {
                    caseId: resolvedCaseId,
                    orgId: resolvedOrgId,
                    chatId: resolvedChatId,
                    status: { in: ['active', 'paused'] },
                  },
                  select: { id: true },
                })
              : null
            const canInferCaseType =
              !activeOrPausedRun &&
              (!targetCase ||
                ((targetCase.type == null || targetCase.type === 'general') &&
                  targetCase.status !== 'waiting_human' &&
                  targetCase.status !== 'resolved'))

            if (canInferCaseType) {
              const caseTypes = await prisma.caseType.findMany({
                where: { agentConfigId: resolvedAgentConfigId, enabled: true },
                select: {
                  type: true,
                  displayName: true,
                  description: true,
                  icon: true,
                  requiredFacts: true,
                  defaultGoal: true,
                  escalateOn: true,
                  autoCloseConditions: true,
                  procedure: true,
                  maxAutoTurns: true,
                },
              })
              const routed =
                deterministicRouteCaseTypeByText(userMessage, caseTypes) ??
                await resolveCaseTypeByIntent(userMessage, caseTypes)
              if (routed.kind === 'case_type') {
                inferredCaseTypeRow = routed.caseType
                inferredCaseTypeConfidence = routed.confidence
                inferredCaseTypeReason = routed.reason
                userMessage =
                  `[Intent selected: ${routed.caseType.type}] ` +
                  `The harness matched the customer's message to configured CaseType "${routed.caseType.type}". ` +
                  `Handle this CaseType unless the customer corrects it. ` +
                  `Original message: "${userMessage}"`
              }
            }
          } catch (err) {
            console.error('[Intera] Fresh lane CaseType inference failed:', err)
          }
        }

        // ── Bootstrap new case from Chat UI (multi-case parallel lanes) ──
        if (
          bootstrapNewCase &&
          bodyCaseType &&
          isInvestigableCaseType(bodyCaseType) &&
          userMessage &&
          !resumeTrigger &&
          !formResult
        ) {
          try {
            const ctRow = await prisma.caseType.findUnique({
              where: { agentConfigId_type: { agentConfigId: resolvedAgentConfigId ?? '', type: bodyCaseType } },
            })
            const newCase = await prisma.case.create({
              data: {
                orgId: resolvedOrgId,
                userId: resolvedUserId,
                type: bodyCaseType,
                status: 'created',
                chatId: resolvedChatId,
              },
            })
            resolvedCaseId = newCase.id
            createdCaseForIntent = true

            // Rewrite userMessage to scope the agent to the single selected case type.
            // The agent sees the selected case type and the original details.
            userMessage =
              `[Intent selected: ${bodyCaseType}] ` +
              `The customer already chose "${bodyCaseType}" from the intent card. ` +
              `Handle ONLY this case type. ` +
              `Original message: "${userMessage}"`

            sendEvent({
              type: 'case_created',
              data: {
                caseId: newCase.id,
                caseType: bodyCaseType,
                displayName: ctRow?.displayName ?? bodyCaseType,
                icon: ctRow?.icon ?? '📋',
              },
              timestamp: new Date().toISOString(),
            })
            emittedCaseCreated.add(newCase.id)
            console.log(`[Intera] bootstrapNewCase → ${newCase.id} (${bodyCaseType})`)
          } catch (err) {
            console.error('[Intera] bootstrapNewCase failed:', err)
            sendEvent({
              type: 'error',
              data: err instanceof Error ? err.message : 'Failed to create case',
              timestamp: new Date().toISOString(),
            })
            closeStream()
            return
          }
        }

        if (bodyCaseType) {
          systemPrompt += `\n\n[Manual Case Type]: The user has already selected case type "${bodyCaseType}" from the intent clarification card. The user already made their choice. Proceed directly with this case type. If the original message mentions other issues, ignore them unless the customer brings them up again.`
        }

        if (inferredCaseTypeRow) {
          systemPrompt += `\n\n[Inferred Case Type]: The harness classified this fresh lane as "${inferredCaseTypeRow.type}" from configured CaseTypes. Confidence: ${inferredCaseTypeConfidence ?? 0}. ${inferredCaseTypeReason ? `Reason: ${inferredCaseTypeReason}` : ''}`
        }

        // Chat UI binds SSE events to lane.caseId via case_created.
        if (!resumeTrigger && !formResult && !createdCaseForIntent && resolvedCaseId && !emittedCaseCreated.has(resolvedCaseId)) {
          const inferredType =
            (bodyCaseType && isInvestigableCaseType(bodyCaseType) ? bodyCaseType : undefined) ??
            (inferredCaseTypeRow?.type && isInvestigableCaseType(inferredCaseTypeRow.type) ? inferredCaseTypeRow.type : undefined)
          if (inferredType) {
            try {
              const ctRow = inferredCaseTypeRow?.type === inferredType
                ? inferredCaseTypeRow
                : await prisma.caseType.findUnique({
                    where: {
                      agentConfigId_type: {
                        agentConfigId: resolvedAgentConfigId ?? '',
                        type: inferredType,
                      },
                    },
                  })
              sendEvent({
                type: 'case_created',
                data: {
                  caseId: resolvedCaseId,
                  caseType: inferredType,
                  displayName: ctRow?.displayName ?? inferredType,
                  icon: ctRow?.icon ?? '📋',
                  extractedFacts: {},
                },
                timestamp: new Date().toISOString(),
              })
              emittedCaseCreated.add(resolvedCaseId)
            } catch (err) {
              console.error('[Intera] Failed to lookup case type for emit:', err)
            }
          }
        }

        // ── Load case memory + schema from DB (CC-style session memory pattern) ──
        let existingMemory: unknown = null
        let caseSchema: CaseSchemaConfig | null = null
        let existingCaseStatus: string | null = null
        let runtimeProcedure: { id: string; procedureId: string; status: string } | null = null
        try {
          const existingCase = await prisma.case.findFirst({
            where: { id: resolvedCaseId, orgId: resolvedOrgId },
            include: { memory: true },
          })
          if (existingCase) {
            existingCaseStatus = existingCase.status
            resolvedChatId = existingCase.chatId || resolvedChatId
            try {
              const activeOrPausedRun = await prisma.procedureRun.findFirst({
                where: {
                  caseId: resolvedCaseId,
                  orgId: resolvedOrgId,
                  chatId: resolvedChatId,
                  status: { in: ['active', 'paused'] },
                },
                orderBy: { updatedAt: 'desc' },
                select: { id: true, procedureId: true, status: true },
              })
              if (activeOrPausedRun) {
                runtimeProcedure = activeOrPausedRun
              }
            } catch (err) {
              console.error('[Intera] Failed to load runtime procedure truth:', err)
            }

            // Load case type schema if available
            try {
              const caseTypeSlug = runtimeProcedure?.procedureId || existingCase.type
              const caseType = await prisma.caseType.findUnique({
                where: { agentConfigId_type: { agentConfigId: resolvedAgentConfigId ?? '', type: caseTypeSlug } },
              })
              if (caseType) {
                caseSchema = schemaFromCaseTypeRow(caseType)
              }
            } catch (err) { console.error('[Intera] Failed to load caseType schema:', err) }

            // Auto-resume: if case is waiting for human and task was resolved, inject verdict
            const effectiveExistingCaseStatus = deriveCaseStatusFromRuntimeProcedure(runtimeProcedure, existingCase.status) ?? existingCase.status
            if (effectiveExistingCaseStatus === 'waiting_human' && !resumeTrigger && !formResult && message) {
              try {
                const resolvedTask = await prisma.humanTask.findFirst({
                  where: { caseId: resolvedCaseId, status: 'resolved', notifiedAt: null },
                  orderBy: { resolvedAt: 'desc' },
                })
                if (resolvedTask) {
                  const resumeTmpl = (await loadAgentConfig(resolvedAgentConfigId)).resumePrompt || HARNESS_DEFAULT_RESUME_PROMPT_APPEND
                  const parts = ['[Human task resolved — operator reviewed your case]']
                  if (resolvedTask.verdict) parts.push(`Operator verdict: ${resolvedTask.verdict.replace(/_/g, ' ')}`)
                  if (resolvedTask.notes) parts.push(`Internal notes: ${resolvedTask.notes}`)
                  parts.push(resumeTmpl)
                  userMessage = parts.join('\n') + '\n\nCustomer also said: ' + message
                  runtimeInputSource = 'human_task_result'
                  existingCaseStatus = 'investigating'

                  // Mark task as notified so it doesn't replay on every message
                  await prisma.humanTask.update({
                    where: { id: resolvedTask.id },
                    data: { notifiedAt: new Date() },
                  }).catch((err: unknown) => { console.error('[Intera] Failed to mark humanTask notifiedAt:', err) })
                  await prisma.case.update({
                    where: { id: resolvedCaseId },
                    data: { status: 'investigating', blocker: null },
                  }).catch((err: unknown) => { console.error('[Intera] Failed to align case truth on auto-resume:', err) })
                }
              } catch (err) { console.error('[Intera] Auto-resume humanTask lookup failed:', err) }
            }

            if (existingCase.memory) {
              existingMemory = existingCase.memory

              if (existingCase.memory.summary) {
                systemPrompt += `\n\n## Case Session Memory\n${existingCase.memory.summary}`
              }
            }
          }
        } catch (err) {
          console.error('[Intera] Failed to load case/memory from DB:', err)
        }

        // FK: traces/messages reference Case.caseId — rows must exist before AgentLoop writes ActionTrace/Message.
        const isHumanTaskResumeInput = runtimeInputSource === 'human_task_result'
        const inferredCaseTypeForRecord =
          caseSchema?.type ??
          runtimeProcedure?.procedureId ??
          inferredCaseTypeRow?.type ??
          bodyCaseType ??
          'general'
        const inferredCaseStatusForRecord =
          deriveCaseStatusFromRuntimeProcedure(runtimeProcedure, existingCaseStatus, {
            resumeFromHumanTaskResult: isHumanTaskResumeInput,
          }) ??
          'created'

        try {
          await prisma.case.upsert({
            where: { id: resolvedCaseId },
            update: {
              ...(inferredCaseTypeForRecord !== 'general' ? { type: inferredCaseTypeForRecord } : {}),
              status: inferredCaseStatusForRecord,
              ...(inferredCaseStatusForRecord === 'investigating' ? { blocker: null } : {}),
            },
            create: {
              id: resolvedCaseId,
              orgId: resolvedOrgId,
              userId: resolvedUserId,
              type: inferredCaseTypeForRecord,
              status: inferredCaseStatusForRecord,
              chatId: resolvedChatId,
              ...(inferredCaseStatusForRecord === 'investigating' ? { blocker: null } : {}),
            },
          })
        } catch (err) {
          console.error('[Intera] Failed to ensure Customer/Case row before agent loop:', err)
        }

        // First-touch lanes: Case row now exists but schema was only attached when existingCase was found earlier.
        if (!caseSchema && inferredCaseTypeForRecord !== 'general') {
          try {
            const ctRow = await prisma.caseType.findUnique({
              where: {
                agentConfigId_type: {
                  agentConfigId: resolvedAgentConfigId ?? '',
                  type: inferredCaseTypeForRecord,
                },
              },
            })
            if (ctRow) {
              caseSchema = schemaFromCaseTypeRow(ctRow)
            }
          } catch (err) {
            console.error('[Intera] Failed to load caseType for first-touch lane:', err)
          }
        }

        // ── Resolve prompt placeholders with live Console config ──
        const existingMemoryData = existingMemory as Record<string, unknown> | null
        const existingContextMap = ((parseMemoryJson(existingMemoryData?.contextMap as string) as Record<string, unknown>) || {})
        const activeProcedureV2 = !!caseSchema?.procedure
        const resolvedCaseState = existingMemoryData ? {
          toolsCalled: (parseMemoryJson(existingMemoryData.toolsCalled as string) as string[]) || [],
          missingFacts: (parseMemoryJson(existingMemoryData.missingFacts as string) as string[]) || [],
          keyEvents: (parseMemoryJson(existingMemoryData.keyEvents as string) as Array<{ at: string; text: string; source: string }>) || [],
          summary: typeof existingMemoryData.summary === 'string' ? existingMemoryData.summary : '',
        } : caseSchema ? {
          toolsCalled: [],
          missingFacts: Array.isArray(caseSchema.requiredFacts) ? [...caseSchema.requiredFacts] : [],
          keyEvents: [],
          summary: '',
        } : undefined

        if (resolvedCaseState && formAnswers) {
          for (const [key, value] of Object.entries(formAnswers)) {
            if (value && value.trim()) {
              resolvedCaseState.missingFacts = resolvedCaseState.missingFacts.filter((f) => f !== key)
            }
          }
        }

        if (
          runtimeInputSource === 'customer_message' &&
          typeof userMessage === 'string' &&
          isExplicitHumanHandoffRequest(userMessage)
        ) {
          try {
            const [existingTask, evidenceTraces] = await Promise.all([
              prisma.humanTask.findFirst({
                where: { caseId: resolvedCaseId, status: 'pending' },
                orderBy: { createdAt: 'desc' },
                select: { id: true, queue: true, status: true },
              }),
              prisma.actionTrace.findMany({
                where: {
                  caseId: resolvedCaseId,
                  actionType: 'tool_result',
                },
                orderBy: { createdAt: 'desc' },
                take: 12,
                select: { title: true },
              }),
            ])
            const hasAutomatedEvidence = evidenceTraces.some((trace) => isOperationalEvidenceTool(trace.title))
            if (hasAutomatedEvidence) {
              const queue = caseSchema?.escalateOn?.[0] || 'general'
              const task = existingTask ?? await prisma.humanTask.create({
                data: {
                  caseId: resolvedCaseId,
                  orgId: resolvedOrgId,
                  chatId: resolvedChatId,
                  runId: runtimeProcedure?.id ?? null,
                  queue,
                  question: [
                    'Customer explicitly requested a human after automated support was attempted.',
                    `Latest customer message: ${userMessage}`,
                    caseSchema?.type ? `CaseType: ${caseSchema.type}` : null,
                  ].filter(Boolean).join('\n'),
                  status: 'pending',
                },
                select: { id: true, queue: true, status: true },
              })
              await prisma.case.update({
                where: { id: resolvedCaseId },
                data: { status: 'waiting_human' },
              }).catch((err: unknown) => { console.error('[Intera] Failed to mark case waiting_human for explicit handoff:', err) })
              await prisma.actionTrace.create({
                data: {
                  caseId: resolvedCaseId,
                  orgId: resolvedOrgId,
                  chatId: resolvedChatId,
                  runId: runtimeProcedure?.id ?? null,
                  actionType: 'human_task_created',
                  title: 'Human task created',
                  detail: `Explicit customer handoff request routed to ${task.queue}.`,
                  payload: JSON.stringify({ taskId: task.id, queue: task.queue, source: 'route_explicit_handoff' }),
                },
              }).catch((err: unknown) => { console.error('[Intera] Failed to trace explicit handoff task:', err) })
              await prisma.message.create({
                data: {
                  caseId: resolvedCaseId,
                  orgId: resolvedOrgId,
                  chatId: resolvedChatId,
                  role: 'user',
                  content: userMessage,
                  contentBlocks: resolvedContentBlocks as any,
                  isStreaming: false,
                },
              }).catch((err: unknown) => { console.error('[Intera] Failed to persist explicit handoff user message:', err) })
              const handoffText = 'Maile human support task create gareko chu. Specialist le yo case hernu hunecha.'
              await prisma.message.create({
                data: {
                  caseId: resolvedCaseId,
                  orgId: resolvedOrgId,
                  chatId: resolvedChatId,
                  role: 'assistant',
                  content: handoffText,
                  isStreaming: false,
                },
              }).catch((err: unknown) => { console.error('[Intera] Failed to persist explicit handoff assistant message:', err) })
              sendEvent({
                type: 'human_task_created',
                data: { taskId: task.id, queue: task.queue, status: task.status },
                timestamp: new Date().toISOString(),
              })
              sendEvent({
                type: 'text_delta',
                data: handoffText,
                timestamp: new Date().toISOString(),
              })
              sendEvent({
                type: 'message_stop',
                data: { reason: 'waiting_human' },
                timestamp: new Date().toISOString(),
              })
              closeStream()
              return
            }
          } catch (err) {
            console.error('[Intera] Explicit human handoff routing failed:', err)
          }
        }

        const agentConfig = await loadAgentConfig(resolvedAgentConfigId)

        // Load tool summaries for {{available_tools}} template var
        const toolSummaries: Array<{
          name: string
          description: string
          needsMemberId: boolean
          knowledgeSourceId?: string
        }> = []
        try {
          const dbTools = await prisma.tool.findMany({
            where: { agentConfigId: resolvedAgentConfigId ?? '', enabled: true },
            select: { name: true, description: true, inputSchema: true, mode: true },
          })
          for (const s of dbTools) {
            const schema = s.inputSchema ? JSON.parse(s.inputSchema) : {}
            const needsMemberId = !!schema.properties?.member_id
            toolSummaries.push({ name: s.name, description: s.description, needsMemberId })
          }
          const kbSources = await prisma.knowledgeSource.findMany({
            where: { agentConfigId: resolvedAgentConfigId ?? '', enabled: true },
            select: { id: true, name: true, description: true },
          })
          for (const ks of kbSources) {
            toolSummaries.push({
              name: knowledgeSourceToolName(ks.name, ks.id),
              description: ks.description || `Search the ${ks.name} knowledge base`,
              needsMemberId: false,
              knowledgeSourceId: ks.id,
            })
          }
          // Include built-in tools not in DB
          const { BUILT_IN_TOOLS } = await import('@/lib/agent/tools')
          for (const s of BUILT_IN_TOOLS) {
            if (!toolSummaries.find(t => t.name === s.name)) {
              toolSummaries.push({ name: s.name, description: s.description, needsMemberId: false })
            }
          }
        } catch { /* DB unavailable, prompt just won't list tools */ }

        // ── Unified prompt assembly (base+append model) ──
        // Unified assembly via buildModePrompt — single source of truth
        const isCaseActive = !!caseSchema
        const caseStateForPrompt = isCaseActive && resolvedCaseState
          ? {
              toolsCalled: resolvedCaseState.toolsCalled,
              missingFacts: resolvedCaseState.missingFacts,
              keyEvents: resolvedCaseState.keyEvents,
              summary: resolvedCaseState.summary,
            }
          : null
        const assembled = await buildModePrompt({
          agentConfigId: resolvedAgentConfigId ?? '',
          coreSystemPrompt: agentConfig.coreSystemPrompt ?? null,
          hasActiveCase: isCaseActive,
          caseSchema,
          caseState: caseStateForPrompt,
          sessionBinding: { userId: resolvedUserId, userLabel: userLabel || undefined },
          availableTools: toolSummaries,
        })

        systemPrompt = assembled.prompt
        coreSystemPrompt = agentConfig.coreSystemPrompt?.trim() || assembled.basePrompt

        if (formAnswers && caseSchema) {
          systemPrompt += `\n\n[Structured Form Answers Received]\nThe current customer input is the submitted ask_user_questions form for CaseType "${caseSchema.type}". Treat these fields as already provided: ${Object.keys(formAnswers).join(', ') || 'none'}. Do not ask for those same fields again. If required facts are now available, continue the active Procedure and call the next required live tool or KB tool.`
        }

        if (naturalMemberIdForProfile) {
          systemPrompt += `\n\n[Profile Memory Nudge]\nThe customer naturally provided member_id "${naturalMemberIdForProfile}" in the latest message. If this appears to be their own Jayabaji member_id and they did not say it belongs to someone else, call remember(scope="user", facts={"member_id":"${naturalMemberIdForProfile}"}, reason="Customer provided member_id in chat") once so future chats can reuse it.`
        }

        // ── Concurrency guard: if an AgentLoop is already running for this caseId,
        //     enqueue the message and return 202 — don't create a second loop.
        const existingLiveSession = hasSession(resolvedCaseId)
        if (!existingLiveSession) {
          await hydrateProcedureRuntime(resolvedCaseId, { agentConfigId: resolvedAgentConfigId })
        } else {
          bindProcedureRuntimeAgentConfig(resolvedCaseId, resolvedAgentConfigId)
        }

        if (existingLiveSession) {
          enqueueMessageOrCreate(resolvedCaseId, {
            content: userMessage,
            contentBlocks,
            formAnswers,
            metadata:
              formToolCallId || formTitle || formDescription || formFields.length > 0
                ? {
                    ...(formToolCallId ? { toolCallId: formToolCallId } : {}),
                    ...(formTitle ? { formTitle } : {}),
                    ...(formDescription ? { formDescription } : {}),
                    ...(formFields.length > 0 ? { formFields } : {}),
                  }
                : undefined,
            source: runtimeInputSource,
            origin: runtimeInputSource === 'human_task_result' ? 'human' : 'customer',
          })
          await flushProcedureRunPersistence(resolvedCaseId)
          sendEvent({
            type: 'withheld',
            data: 'Message queued — agent is currently processing',
            timestamp: new Date().toISOString(),
          })
          sendEvent({
            type: 'message_stop',
            data: { reason: 'queued' },
            timestamp: new Date().toISOString(),
          })
          closeStream()
          return
        }

        const shouldAutoStartProcedure =
          !!caseSchema?.procedure &&
          !runtimeProcedure &&
          !resumeTrigger &&
          !formResult &&
          !interactionResult &&
          (Boolean(bodyCaseType) || Boolean(inferredCaseTypeRow) || bootstrapNewCase)

        const autoStartCaseSchema = shouldAutoStartProcedure ? caseSchema : null
        if (autoStartCaseSchema?.procedure) {
          try {
            const started = startProcedureRun(resolvedCaseId, {
              agentConfigId: resolvedAgentConfigId ?? undefined,
              procedureId: autoStartCaseSchema.type,
              displayName: autoStartCaseSchema.displayName,
              procedure: autoStartCaseSchema.procedure,
              reason: inferredCaseTypeRow
                ? `Auto-started from configured CaseType routing. ${inferredCaseTypeReason ?? ''}`.trim()
                : 'Auto-started from selected CaseType.',
              confidence: inferredCaseTypeConfidence ?? undefined,
              requestId: `route:${resolvedCaseId}:${autoStartCaseSchema.type}`,
            })
            runtimeProcedure = {
              id: started.run.runId,
              procedureId: started.run.procedureId,
              status: started.run.status,
            }
          } catch (err) {
            console.error('[Intera] Failed to auto-start ProcedureRun for selected CaseType:', err)
          }
        }

        if (
          caseSchema &&
          Array.isArray(caseSchema.requiredFacts) &&
          caseSchema.requiredFacts.length > 0 &&
          !resumeTrigger &&
          !formResult &&
          !interactionResult &&
          runtimeInputSource === 'customer_message' &&
          (Boolean(bodyCaseType) || Boolean(inferredCaseTypeRow) || bootstrapNewCase)
        ) {
          const profileFacts = await readProfileFactsForRoute({
            orgId: resolvedOrgId,
            userId: resolvedUserId,
            chatId: resolvedChatId,
            agentConfigId: resolvedAgentConfigId,
          })
          const missingFacts = missingRequiredFactsForRoute({
            requiredFacts: caseSchema.requiredFacts,
            messageText: typeof userMessage === 'string' ? userMessage : undefined,
            profileFacts,
          })

          if (missingFacts.length > 0) {
            const fields = missingFacts.map(formFieldFromRequiredFact)
            const title = fallbackRequiredFactsFormTitle(missingFacts)
            const description = fallbackRequiredFactsFormDescription(missingFacts)
            const toolCallId = `harness_required_facts_${resolvedCaseId}_${Date.now()}`

            await flushProcedureRunPersistence(resolvedCaseId)
            parkSessionUntilNextRequest(resolvedCaseId)
            await prisma.case.update({
              where: { id: resolvedCaseId },
              data: { status: 'collecting' },
            }).catch((err: unknown) => { console.error('[Intera] Failed to mark case collecting for required facts:', err) })
            await prisma.message.create({
              data: {
                caseId: resolvedCaseId,
                orgId: resolvedOrgId,
                chatId: resolvedChatId,
                role: 'user',
                content: typeof userMessage === 'string' ? userMessage : '',
                contentBlocks: resolvedContentBlocks as any,
                isStreaming: false,
              },
            }).catch((err: unknown) => { console.error('[Intera] Failed to persist preflight form user message:', err) })
            await prisma.actionTrace.create({
              data: {
                caseId: resolvedCaseId,
                orgId: resolvedOrgId,
                chatId: resolvedChatId,
                actionType: 'tool_result',
                title: 'Tool: ask_user_questions',
                detail: `Harness required-facts form requested for missing fields: ${missingFacts.join(', ')}`,
                payload: JSON.stringify({
                  status: 'form_request_harness',
                  title,
                  description,
                  fields,
                  caseType: caseSchema.type,
                }),
              },
            }).catch((err: unknown) => { console.error('[Intera] Failed to trace harness required-facts form:', err) })

            sendEvent({
              type: 'form_request',
              data: {
                caseId: resolvedCaseId,
                toolCallId,
                title,
                description,
                fields,
              },
              timestamp: new Date().toISOString(),
            })
            sendEvent({
              type: 'message_stop',
              data: { reason: 'waiting_form' },
              timestamp: new Date().toISOString(),
            })
            closeStream()
            return
          }
        }

        // Register the session so subsequent requests for this caseId are queued.
        const activeSession = getOrCreateSession(resolvedCaseId)
        registeredSession = activeSession
        activeSession.resolved = false
        activeSession.aborted = false
        activeSession.lastActiveAt = Date.now()
        recordInitialInputEvent(resolvedCaseId, {
          content: userMessage,
          contentBlocks,
          formAnswers,
          metadata:
            formToolCallId || formTitle || formDescription || formFields.length > 0
              ? {
                  ...(formToolCallId ? { toolCallId: formToolCallId } : {}),
                  ...(formTitle ? { formTitle } : {}),
                  ...(formDescription ? { formDescription } : {}),
                  ...(formFields.length > 0 ? { formFields } : {}),
                }
              : undefined,
          source: runtimeInputSource,
          origin: runtimeInputSource === 'human_task_result' ? 'human' : 'customer',
        })
        await flushProcedureRunPersistence(resolvedCaseId)

        const agentLoop = await AgentLoop.create({
          config: agentConfig,
          configId: resolvedAgentConfigId ?? '',
          caseId: resolvedCaseId,
          orgId: resolvedOrgId,
          userId: resolvedUserId,
          systemPrompt,
          coreSystemPrompt,
          caseSchema,
          chatId: resolvedChatId,
          bootstrapNewCase,
        })

        // Restore memory from DB into the in-memory manager
        if (existingMemory) {
          const memData = { ...(existingMemory as Record<string, unknown>) }
          const runtimeBackedCaseStatus =
            deriveCaseStatusFromRuntimeProcedure(runtimeProcedure, existingCaseStatus, {
              resumeFromHumanTaskResult: isHumanTaskResumeInput,
            }) ??
            inferredCaseStatusForRecord
          if (runtimeBackedCaseStatus) {
            memData.caseStatus = runtimeBackedCaseStatus
          }
          agentLoop.loadMemory(memData)
        }

        // Restore prior-turn messages so the agent has conversation context
        try {
          const priorMessages = await prisma.message.findMany({
            where: { orgId: resolvedOrgId, caseId: resolvedCaseId },
            orderBy: { createdAt: 'asc' },
            take: LOOP_HISTORY_REPLAY_LIMIT,
          })
          if (priorMessages.length > 0) {
            agentLoop.loadMessages(
              priorMessages.map((m) => hydrateMessageFromDb(m as any)),
            )
          }
        } catch (err) { console.error('[Intera] Failed to load prior messages:', err) }

        let result = await agentLoop.run(userMessage, sendEvent, contentBlocks)

        // P0-2: Drain queued messages that arrived during the run but after the last iteration's drain.
        // BUG-C: followup results must be persisted — capture the last run's result for DB writes.
        while (activeSession.queue.pendingCount > 0) {
          const next = activeSession.queue.dequeueNonBlocking()
          if (!next || next.content === '__SESSION_CLOSED__') break
          const followup = await AgentLoop.create({
            config: agentConfig,
            configId: resolvedAgentConfigId ?? '',
            caseId: resolvedCaseId,
            orgId: resolvedOrgId,
            userId: resolvedUserId,
            systemPrompt,
            coreSystemPrompt,
            caseSchema,
            chatId: resolvedChatId,
            bootstrapNewCase: false,
          })
          // Re-load prior-turn messages for the follow-up loop
          try {
            const priorMsgs = await prisma.message.findMany({
              where: { orgId: resolvedOrgId, caseId: resolvedCaseId },
              orderBy: { createdAt: 'asc' },
              take: LOOP_HISTORY_REPLAY_LIMIT,
            })
            if (priorMsgs.length > 0) {
              followup.loadMessages(priorMsgs.map((m) => hydrateMessageFromDb(m as any)))
            }
          } catch (_) { /* non-critical */ }
          // Re-load memory from the master loop
          followup.loadMemory(agentLoop.getMemorySummary())
          result = await followup.run(next.content, sendEvent, next.contentBlocks)
          // Persist followup messages immediately so the next drain iteration sees them
          const followupMem = followup.getMemorySummary()
          if (result.messages.length > 0) {
            try {
              const caseTypeForUpsert = followup.getCaseType()
              const shouldClearFollowupBlocker =
                next.source === 'human_task_result' && result.caseStatus !== 'waiting_human'
              await prisma.case.upsert({
                where: { id: resolvedCaseId },
                        update: {
                          ...(caseTypeForUpsert !== 'general' ? { type: caseTypeForUpsert } : {}),
                          status: result.caseStatus,
                          ...(shouldClearFollowupBlocker ? { blocker: null } : {}),
                        },
                create: {
                  id: resolvedCaseId, orgId: resolvedOrgId, userId: resolvedUserId,
                  type: caseTypeForUpsert,
                  status: result.caseStatus,
                  chatId: resolvedChatId,
                  ...(shouldClearFollowupBlocker ? { blocker: null } : {}),
                },
              })
              const runId = getActiveProcedureRun(resolvedCaseId)?.runId ?? runtimeProcedure?.id ?? null
              const persistedContextMap = activeProcedureV2 ? existingContextMap : followupMem.contextMap
              await prisma.chatMemory.upsert({
                where: { caseId: resolvedCaseId },
                update: {
                  orgId: resolvedOrgId,
                  chatId: resolvedChatId,
                  runId,
                  contextMap: JSON.stringify(persistedContextMap),
                  missingFacts: JSON.stringify(followupMem.missingFacts),
                  toolsCalled: JSON.stringify(followupMem.toolsCalled),
                  toolResults: JSON.stringify(followupMem.toolResults),
                  keyEvents: JSON.stringify(followupMem.keyEvents),
                  summary: followupMem.summary || undefined,
                  todos: followupMem.todos ? JSON.stringify(followupMem.todos) : null,
                },
                create: {
                  caseId: resolvedCaseId,
                  orgId: resolvedOrgId,
                  chatId: resolvedChatId,
                  runId,
                  contextMap: JSON.stringify(persistedContextMap),
                  missingFacts: JSON.stringify(followupMem.missingFacts),
                  toolsCalled: JSON.stringify(followupMem.toolsCalled),
                  toolResults: JSON.stringify(followupMem.toolResults),
                  keyEvents: JSON.stringify(followupMem.keyEvents),
                  summary: followupMem.summary || undefined,
                  todos: followupMem.todos ? JSON.stringify(followupMem.todos) : null,
                },
              })
              const msgsToPersist = buildMessagesToPersist({
                messages: result.messages,
                caseId: resolvedCaseId,
                orgId: resolvedOrgId,
                chatId: resolvedChatId,
                runId,
                formAnswers:
                  next.source === 'customer_form_result'
                    ? (next.formAnswers ?? undefined)
                    : undefined,
                formToolCallId:
                  next.source === 'customer_form_result' &&
                  typeof next.metadata?.toolCallId === 'string' &&
                  next.metadata.toolCallId.trim().length > 0
                    ? next.metadata.toolCallId.trim()
                    : undefined,
              })
              if (msgsToPersist.length > 0) {
                await prisma.$transaction(
                  msgsToPersist.map((msg) =>
                    prisma.message.upsert({
                      where: { id: msg.id },
                      update: {
                        orgId: resolvedOrgId,
                        chatId: resolvedChatId,
                        runId,
                        content: msg.content,
                        contentBlocks: msg.contentBlocks ?? undefined,
                        providerContent: (msg.providerContent ?? undefined) as any,
                        providerMeta: (msg.providerMeta ?? undefined) as any,
                        isStreaming: false,
                      },
                      create: msg as any,
                    }),
                  ),
                )
                await writeProviderTranscriptPersistedTrace(
                  resolvedCaseId,
                  resolvedOrgId,
                  resolvedChatId,
                  runId,
                  msgsToPersist,
                )
              }
              if (next.source === 'customer_form_result' && next.formAnswers) {
                await writeFormSubmissionTrace({
                  caseId: resolvedCaseId,
                  orgId: resolvedOrgId,
                  chatId: resolvedChatId,
                  runId,
                  title:
                    typeof next.metadata?.formTitle === 'string' && next.metadata.formTitle.trim().length > 0
                      ? next.metadata.formTitle.trim()
                      : undefined,
                  description:
                    typeof next.metadata?.formDescription === 'string' && next.metadata.formDescription.trim().length > 0
                      ? next.metadata.formDescription.trim()
                      : undefined,
                  fields: normalizeFormTraceFields(next.metadata?.formFields),
                  answers: next.formAnswers,
                })
              }
            } catch (e) {
              console.error('[Intera] Failed to persist followup result:', e)
            }
          }
          // Transfer memory back to master loop for subsequent drain iterations
          agentLoop.loadMemory(followupMem)
        }

        // Mark session as resolved so subsequent messages create a new loop.
        activeSession.resolved = true

        // ── Persist case memory — only if real work was done (not casual chat) ──
        const mem = agentLoop.getMemorySummary()
        const hasRealWork = mem.toolsCalled.length > 0 ||
          Object.keys(mem.contextMap).length > 0 ||
          result.transition !== 'next_turn' ||
          (mem.summary && mem.summary.length > 0) ||
          (mem.caseStatus && mem.caseStatus !== 'created')
        if (hasRealWork) {
          try {
            // Read type from AgentLoop (may have been set by start_procedure mid-loop)
            const caseTypeForUpsert = agentLoop.getCaseType()
            const shouldClearCaseBlocker =
              runtimeInputSource === 'human_task_result' && result.caseStatus !== 'waiting_human'
            await prisma.case.upsert({
              where: { id: resolvedCaseId },
              update: {
                ...(caseTypeForUpsert !== 'general' ? { type: caseTypeForUpsert } : {}),
                status: result.caseStatus,
                ...(shouldClearCaseBlocker ? { blocker: null } : {}),
              },
              create: {
                id: resolvedCaseId,
                orgId: resolvedOrgId,
                userId: resolvedUserId,
                type: caseTypeForUpsert,
                status: result.caseStatus,
                chatId: resolvedChatId,
                ...(shouldClearCaseBlocker ? { blocker: null } : {}),
              },
            })
            const runId = getActiveProcedureRun(resolvedCaseId)?.runId ?? runtimeProcedure?.id ?? null
            const persistedContextMap = activeProcedureV2 ? existingContextMap : mem.contextMap
            await prisma.chatMemory.upsert({
              where: { caseId: resolvedCaseId },
              update: {
                orgId: resolvedOrgId,
                chatId: resolvedChatId,
                runId,
                contextMap: JSON.stringify(persistedContextMap),
                missingFacts: JSON.stringify(mem.missingFacts),
                toolsCalled: JSON.stringify(mem.toolsCalled),
                toolResults: JSON.stringify(mem.toolResults),
                keyEvents: JSON.stringify(mem.keyEvents),
                summary: mem.summary || undefined,
                todos: mem.todos ? JSON.stringify(mem.todos) : null,
              },
              create: {
                caseId: resolvedCaseId,
                orgId: resolvedOrgId,
                chatId: resolvedChatId,
                runId,
                contextMap: JSON.stringify(persistedContextMap),
                missingFacts: JSON.stringify(mem.missingFacts),
                toolsCalled: JSON.stringify(mem.toolsCalled),
                toolResults: JSON.stringify(mem.toolResults),
                keyEvents: JSON.stringify(mem.keyEvents),
                humanTaskStatus: 'none',
                summary: mem.summary || undefined,
                todos: mem.todos ? JSON.stringify(mem.todos) : null,
              },
            })
          } catch (err) {
            console.error('[Intera] Failed to persist case memory:', err)
          }
        }

        // ── Persist messages to DB (always, even for casual chat) ──
        try {
          const runId = getActiveProcedureRun(resolvedCaseId)?.runId ?? runtimeProcedure?.id ?? null
          const messagesToPersist = buildMessagesToPersist({
            messages: result.messages,
            caseId: resolvedCaseId,
            orgId: resolvedOrgId,
            chatId: resolvedChatId,
            runId,
            formAnswers,
            formToolCallId,
          })

          if (messagesToPersist.length > 0) {
            await prisma.$transaction(
              messagesToPersist.map((msg) =>
                prisma.message.upsert({
                  where: { id: msg.id },
                  update: {
                    orgId: resolvedOrgId,
                    chatId: resolvedChatId,
                    runId,
                    content: msg.content,
                    contentBlocks: msg.contentBlocks ?? undefined,
                    providerContent: (msg.providerContent ?? undefined) as any,
                    providerMeta: (msg.providerMeta ?? undefined) as any,
                    isStreaming: false,
                  },
                  create: msg as any,
                }),
              ),
            )
            await writeProviderTranscriptPersistedTrace(
              resolvedCaseId,
              resolvedOrgId,
              resolvedChatId,
              runId,
              messagesToPersist,
            )
          }

          if (formAnswers) {
            await writeFormSubmissionTrace({
              caseId: resolvedCaseId,
              orgId: resolvedOrgId,
              chatId: resolvedChatId,
              runId,
              title: formTitle,
              description: formDescription,
              fields: formFields,
              answers: formAnswers,
            })
          }
        } catch (err) {
          console.error('[Intera] Failed to persist messages:', err)
        }

        sendEvent({
          type: 'message_stop',
          data: { transition: result.transition, reason: result.reason },
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        console.error('Agent loop error:', error)
        try {
          sendEvent({
            type: 'error',
            data: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString(),
          })
        } catch { /* stream already closed */ }
      } finally {
        if (registeredSession) registeredSession.resolved = true
        closeStream()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
},
})(request)
}

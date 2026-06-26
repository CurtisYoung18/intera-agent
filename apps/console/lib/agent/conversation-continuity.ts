export const DEFAULT_SEGMENT_IDLE_TIMEOUT_MS = 60 * 60 * 1000
export const DEFAULT_CONTINUITY_CONTEXT_MAX_APPROX_TOKENS = 1000

type SegmentStatus = 'active' | 'waiting_human' | 'resolved' | 'idle_closed' | 'transferred' | 'abandoned' | string

export interface ConversationSegmentSnapshot {
  id: string
  status: SegmentStatus
  lastUserMessageAt?: string | Date | null
}

export type ConversationSegmentTransition =
  | { action: 'start'; reason: 'no_current_segment' }
  | { action: 'continue'; reason: 'within_idle_window' | 'missing_last_user_message'; segmentId: string }
  | { action: 'rollover'; reason: 'idle_timeout' | 'terminal_segment'; previousSegmentId: string }

const TERMINAL_SEGMENT_STATUSES = new Set(['resolved', 'idle_closed', 'transferred', 'abandoned'])

function toTime(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isFinite(time) ? time : null
}

export function resolveConversationSegmentTransition(input: {
  now: string | Date
  currentSegment?: ConversationSegmentSnapshot | null
  idleTimeoutMs?: number
}): ConversationSegmentTransition {
  const current = input.currentSegment
  if (!current) return { action: 'start', reason: 'no_current_segment' }

  if (TERMINAL_SEGMENT_STATUSES.has(String(current.status ?? '').toLowerCase())) {
    return { action: 'rollover', reason: 'terminal_segment', previousSegmentId: current.id }
  }

  const now = toTime(input.now)
  const lastUserMessageAt = toTime(current.lastUserMessageAt)
  if (now == null || lastUserMessageAt == null) {
    return { action: 'continue', reason: 'missing_last_user_message', segmentId: current.id }
  }

  const idleTimeoutMs = input.idleTimeoutMs ?? DEFAULT_SEGMENT_IDLE_TIMEOUT_MS
  if (now - lastUserMessageAt >= idleTimeoutMs) {
    return { action: 'rollover', reason: 'idle_timeout', previousSegmentId: current.id }
  }

  return { action: 'continue', reason: 'within_idle_window', segmentId: current.id }
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function renderKnownFacts(facts: Record<string, string | number | boolean>): string[] {
  return Object.entries(facts)
    .filter(([key, value]) => key.trim() && value !== null && value !== undefined && String(value).trim())
    .map(([key, value]) => `- ${key.trim()}: ${String(value).trim()}`)
}

function fitToApproxTokenBudget(lines: string[], maxApproxTokens: number): string {
  const kept: string[] = []
  for (const line of lines) {
    const candidate = [...kept, line].join('\n')
    if (approxTokens(candidate) > maxApproxTokens) break
    kept.push(line)
  }
  if (kept.length < lines.length && kept.length > 0) {
    const marker = '[continuity context truncated]'
    while (kept.length > 0 && approxTokens([...kept, marker].join('\n')) > maxApproxTokens) {
      kept.pop()
    }
    kept.push(marker)
  }
  return kept.join('\n').trim()
}

export function buildConversationContinuityContext(input: {
  knownFacts?: Record<string, string | number | boolean> | null
  previousSegmentDigest?: string | null
  openHumanTaskSummary?: string | null
  maxApproxTokens?: number
}): string {
  const facts = renderKnownFacts(input.knownFacts ?? {})
  const digest = input.previousSegmentDigest?.trim()
  const openHumanTaskSummary = input.openHumanTaskSummary?.trim()

  if (facts.length === 0 && !digest && !openHumanTaskSummary) return ''

  const lines = [
    '## Conversation Continuity Context',
    'The following facts are from prior Intera records for the same user or external chat.',
  ]

  if (facts.length > 0) {
    lines.push('', '### Known Customer Facts', ...facts)
  }

  if (digest) {
    lines.push('', '### Previous Segment Digest', digest)
  }

  if (openHumanTaskSummary) {
    lines.push('', '### Open Human Task', openHumanTaskSummary)
  }

  return fitToApproxTokenBudget(
    lines,
    input.maxApproxTokens ?? DEFAULT_CONTINUITY_CONTEXT_MAX_APPROX_TOKENS,
  )
}

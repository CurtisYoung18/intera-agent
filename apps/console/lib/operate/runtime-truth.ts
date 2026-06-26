const PLAYGROUND_REVIEW_PREFIX = 'playground-test-'

const EXPORTED_REVIEW_STAGES = new Set([
  'Hooks',
  'Knowledge retrieval',
  'Tools',
  'Procedure',
  'Model generation',
])

export type RuntimeSourceKind = 'live' | 'synthetic_review' | 'mixed' | 'unknown'

export interface RuntimeSourceTruth {
  kind: RuntimeSourceKind
  shortLabel: string
  label: string
  description: string
  isSynthetic: boolean
}

export interface RuntimeSourceInput {
  source?: string | null
  userId?: string | null
}

export interface TraceTruthInput {
  actionType: string
  title: string
  detail: string | null
  payload: string | null
}

export type OperateTraceKind =
  | 'user_message'
  | 'form_request'
  | 'form_submission'
  | 'channel_message'
  | 'tool_call'
  | 'tool_result'
  | 'hook_decision'
  | 'stale_evidence'
  | 'procedure_runtime'
  | 'runtime_debug'
  | 'human_handoff'
  | 'model_request'
  | 'model_response'
  | 'exported_review'
  | 'info'

export type OperateTraceStatus = 'ok' | 'info' | 'warn' | 'block' | 'neutral'

export interface OperateTraceTruth {
  kind: OperateTraceKind
  status: OperateTraceStatus
  semanticLabel: string
  title: string
  detailText: string | null
  payload: Record<string, unknown> | null
  toolName?: string
  latencyMs?: number | null
  executionLabel?: string
  executionNote?: string
  isExportedReviewStage: boolean
}

export interface ToolPairingSummary {
  toolCalls: number
  toolResults: number
  label: string
  labelZh: string
  tone: 'neutral' | 'warning'
}

function parseJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function toolNameFromTrace(
  trace: TraceTruthInput,
  payload: Record<string, unknown> | null,
): string | undefined {
  if (typeof payload?.toolName === 'string' && payload.toolName.trim()) return payload.toolName

  const match = trace.title.match(/Tool(?: called| result)?:\s*(.+)$/)
  return match?.[1]?.trim()
}

function hookOutcome(payload: Record<string, unknown> | null): 'block' | 'warn' | null {
  if (!payload) return null

  const results = Array.isArray(payload.results) ? payload.results : []
  const summary = String(payload.summary ?? payload.result ?? '')

  if (
    summary === 'blocked' ||
    summary === 'block' ||
    results.some((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
      const record = entry as Record<string, unknown>
      return record.result === 'blocked' || record.action === 'block'
    })
  ) {
    return 'block'
  }

  if (
    summary === 'escalated' ||
    summary === 'warn' ||
    results.some((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
      const record = entry as Record<string, unknown>
      return record.result === 'escalated' || record.action === 'warn' || record.action === 'escalate'
    })
  ) {
    return 'warn'
  }

  return null
}

function isHookLoopDecision(title: string): boolean {
  return /^Hook\b/.test(title) || title.includes('Stop Hook') || title === 'Exit: max Hook hits'
}

function isProcedureRuntimeDecision(title: string): boolean {
  return (
    title.includes('Stale ProcedureRun') ||
    title.startsWith('Procedure selected inline:') ||
    title.startsWith('Procedure nudge:')
  )
}

function stripBracketedRuntimePrefix(title: string): string {
  const trimmed = title.trim()
  if (!trimmed.startsWith('[')) return trimmed

  let depth = 0
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (char === '[') depth += 1
    if (char === ']') {
      depth = Math.max(0, depth - 1)
      if (depth === 0) {
        return trimmed.slice(index + 1).trim()
      }
    }
  }

  return trimmed
}

function humanizeRuntimeDebugTitle(title: string): string {
  const stripped = stripBracketedRuntimePrefix(title)
  if (!stripped) return stripped
  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}

function deriveTraceStatus(
  trace: TraceTruthInput,
  payload: Record<string, unknown> | null,
): OperateTraceStatus {
  const raw = `${trace.title} ${trace.detail ?? ''} ${trace.payload ?? ''}`.toLowerCase()

  if (trace.actionType === 'hook_hit') {
    const outcome = hookOutcome(payload)
    if (outcome) return outcome
    if (raw.includes('block')) return 'block'
    if (raw.includes('warn') || raw.includes('escalat')) return 'warn'
    return 'ok'
  }

  if (trace.actionType === 'loop_decision' && isHookLoopDecision(trace.title)) {
    const outcome = hookOutcome(payload)
    if (outcome) return outcome
    if (raw.includes('block')) return 'block'
    if (raw.includes('warn') || raw.includes('escalat') || raw.includes('retry')) return 'warn'
    return 'info'
  }

  if (trace.actionType === 'loop_decision' && isProcedureRuntimeDecision(trace.title)) {
    if (trace.title.includes('blocked')) return 'block'
    if (trace.title.includes('Stale')) return 'warn'
    if (payload?.evidenceState === 'stale' || payload?.stale === true) return 'warn'
    return 'info'
  }

  if (trace.actionType === 'tool_result') {
    if (typeof payload?.error === 'string' && payload.error.trim()) return 'warn'
    if (/"ok"\s*:\s*false/i.test(raw) || /\bok:\s*false/i.test(raw)) return 'warn'
    if (/error|failed/.test(raw)) return 'warn'
    return 'ok'
  }

  if (trace.actionType === 'tool_call') return 'info'
  if (trace.actionType === 'form_request') return 'info'
  if (trace.actionType === 'form_submit') return 'ok'
  if (trace.actionType === 'channel_rich_message') return 'ok'
  if (trace.actionType === 'llm_request_start') return 'info'
  if (trace.actionType === 'llm_response') return 'ok'
  if (trace.actionType === 'human_task_created') return 'warn'
  if (trace.actionType === 'human_task_resolved') return 'ok'
  if (trace.actionType === 'final_resolution') return 'ok'
  if (trace.actionType === 'user_message') return 'info'
  if (EXPORTED_REVIEW_STAGES.has(trace.actionType)) return 'info'

  return 'neutral'
}

function summarizeLoopDecision(trace: TraceTruthInput, payload: Record<string, unknown> | null): string | null {
  if (trace.detail?.trim()) return trace.detail
  if (!payload) return trace.title || null

  if (Array.isArray(payload.results)) {
    const lines = payload.results
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry) => {
        const hookName = typeof entry.hookName === 'string' ? entry.hookName : 'hook'
        const action = typeof entry.action === 'string' ? entry.action : typeof entry.result === 'string' ? entry.result : 'allow'
        const reason = typeof entry.reason === 'string' && entry.reason.trim() ? `: ${entry.reason}` : ''
        return `${hookName} -> ${action}${reason}`
      })
    if (lines.length > 0) return lines.join('\n')
  }

  const simpleLines = Object.entries(payload)
    .filter(([, value]) => value != null && value !== '')
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    .map(([key, value]) => `${key}: ${String(value)}`)

  return simpleLines.length > 0 ? simpleLines.join('\n') : trace.title || null
}

const INTERNAL_HANDOFF_FACT_KEY_RE = /(?:^|_)(?:automated_)?(?:tool|tools|hook|hooks|procedure|procedure_id|case_type|case_id|run_id|task_id|queue|runtime|model)(?:_|$)/i
const INTERNAL_HANDOFF_VALUE_RE = /\b(?:kb_search|start_procedure|create_human_task|ask_user_questions|read_chat_memory|read_user_profile|finalize_procedure|remember|check_latest_|turnover_|reset_withdrawal_pin|get_account_status|get_id_verification_details|get_transaction_history|get_bet_history|get_recommend_games)\b/i

const HANDOFF_FACT_LABELS: Record<string, string> = {
  member_id: 'Member ID',
  memberId: 'Member ID',
  phone: 'Phone',
  phone_number: 'Phone',
  phoneNumber: 'Phone',
  mobile: 'Phone',
  email: 'Email',
  name: 'Name',
  customer_name: 'Name',
  customerName: 'Name',
  amount: 'Amount',
  date: 'Date',
  time: 'Time',
  date_time: 'Date/time',
  dateTime: 'Date/time',
  method: 'Method',
  payment_method: 'Payment method',
  paymentMethod: 'Payment method',
  transaction_id: 'Transaction/reference no',
  transactionId: 'Transaction/reference no',
  reference_no: 'Transaction/reference no',
  referenceNo: 'Transaction/reference no',
  screenshot: 'Screenshot/receipt',
  receipt: 'Screenshot/receipt',
  status: 'Status',
}

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function mergedHandoffPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const nested = payload.handoffNote && typeof payload.handoffNote === 'object' && !Array.isArray(payload.handoffNote)
    ? (payload.handoffNote as Record<string, unknown>)
    : {}
  return { ...nested, ...payload }
}

function normalizeHandoffFacts(value: unknown): Array<[string, string]> {
  if (typeof value === 'string' && value.trim()) return [['details', value.trim()]]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []

  return Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => {
      const rendered = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim()
      return [key.trim(), rendered] as [string, string]
    })
    .filter(([key, rendered]) => (
      key &&
      rendered &&
      !INTERNAL_HANDOFF_FACT_KEY_RE.test(key) &&
      !INTERNAL_HANDOFF_VALUE_RE.test(rendered)
    ))
    .slice(0, 12)
}

function humanizeHandoffFactKey(key: string): string {
  const known = HANDOFF_FACT_LABELS[key]
  if (known) return known
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  if (!spaced) return key
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function formatHumanHandoffDetail(
  trace: TraceTruthInput,
  payload: Record<string, unknown>,
): string | null {
  const handoff = mergedHandoffPayload(payload)
  const chatSummary = trimmedString(handoff.chat_summary) ?? trimmedString(handoff.chatSummary)
  const handoffReason = trimmedString(handoff.handoff_reason) ?? trimmedString(handoff.handoffReason)
  const question = trimmedString(handoff.question)
  const facts = normalizeHandoffFacts(handoff.known_facts ?? handoff.knownFacts)

  const lines: string[] = []
  if (chatSummary) {
    lines.push('Issue summary:')
    lines.push(chatSummary)
  }
  if (facts.length > 0) {
    lines.push('Known facts collected:')
    for (const [key, value] of facts) lines.push(`- ${humanizeHandoffFactKey(key)}: ${value}`)
  }
  if (handoffReason) {
    lines.push('Reason for handoff:')
    lines.push(handoffReason)
  } else if (question) {
    lines.push('Reason for handoff:')
    lines.push(question)
  }

  if (lines.length > 0) return lines.join('\n')

  const taskId = trimmedString(handoff.taskId)
  const queue = trimmedString(handoff.queue)
  const status = trimmedString(handoff.status)
  const parts = [
    taskId ? `taskId: ${taskId}` : null,
    queue ? `queue: ${queue}` : null,
    status ? `status: ${status}` : null,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' · ') : trace.detail
}

function traceFieldRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    : []
}

function formatFormFieldLine(field: Record<string, unknown>): string | null {
  const rawId = trimmedString(field.id) ?? trimmedString(field.key) ?? ''
  const label = trimmedString(field.label) ?? rawId
  if (!label) return null

  const type = trimmedString(field.type) ?? 'text'
  const tags = [type]
  if (field.required === true) tags.push('required')
  const suffix = trimmedString(field.placeholder) ?? trimmedString(field.defaultValue)
  return suffix ? `${label} [${tags.join(', ')}] - ${suffix}` : `${label} [${tags.join(', ')}]`
}

function formatFormRequestDetail(
  trace: TraceTruthInput,
  payload: Record<string, unknown>,
): string | null {
  const lines: string[] = []
  const title = trimmedString(payload.title)
  const description = trimmedString(payload.description)
  const toolCallId = trimmedString(payload.toolCallId)
  const fields = traceFieldRecords(payload.fields)
    .map(formatFormFieldLine)
    .filter((line): line is string => Boolean(line))

  if (title) lines.push(`title: ${title}`)
  if (description) lines.push(`description: ${description}`)
  if (toolCallId) lines.push(`toolCallId: ${toolCallId}`)
  if (fields.length > 0) {
    lines.push('fields:')
    lines.push(...fields.map((line) => `- ${line}`))
  }

  return lines.length > 0 ? lines.join('\n') : trace.detail
}

function formatCardLines(card: Record<string, unknown>, prefix = ''): string[] {
  const lines: string[] = []
  const title = trimmedString(card.title)
  const subtitle = trimmedString(card.subtitle)
  const buttons = traceFieldRecords(card.buttons)
    .map((button) => trimmedString(button.label) ?? trimmedString(button.text) ?? trimmedString(button.id))
    .filter((label): label is string => Boolean(label))
  if (title) lines.push(`${prefix}title: ${title}`)
  if (subtitle) lines.push(`${prefix}subtitle: ${subtitle}`)
  if (buttons.length > 0) lines.push(`${prefix}buttons: ${buttons.join(', ')}`)
  return lines
}

function formatChannelRichMessageDetail(
  trace: TraceTruthInput,
  payload: Record<string, unknown>,
): string | null {
  const lines: string[] = []
  const richType = trimmedString(payload.richType) ?? trimmedString(payload.rendererAction)
  const sourceEventType = trimmedString(payload.sourceEventType)
  const channel = trimmedString(payload.channel)
  if (channel) lines.push(`channel: ${channel}`)
  if (richType) lines.push(`richType: ${richType}`)
  if (sourceEventType) lines.push(`source: ${sourceEventType}`)

  const card = payload.card && typeof payload.card === 'object' && !Array.isArray(payload.card)
    ? (payload.card as Record<string, unknown>)
    : null
  if (card) lines.push(...formatCardLines(card))

  const cards = traceFieldRecords(payload.cards)
  if (cards.length > 0) {
    lines.push(`cards: ${cards.length}`)
    for (const [index, entry] of cards.slice(0, 5).entries()) {
      const title = trimmedString(entry.title) ?? '(untitled)'
      const subtitle = trimmedString(entry.subtitle)
      lines.push(`- ${index + 1}. ${subtitle ? `${title} - ${subtitle}` : title}`)
    }
    if (cards.length > 5) lines.push(`- ... ${cards.length - 5} more`)
  }

  const options = traceFieldRecords(payload.options)
    .map((option) => trimmedString(option.label) ?? trimmedString(option.id))
    .filter((label): label is string => Boolean(label))
  if (options.length > 0) lines.push(`options: ${options.join(', ')}`)

  const widgetPayload = payload.widgetPayload && typeof payload.widgetPayload === 'object' && !Array.isArray(payload.widgetPayload)
    ? (payload.widgetPayload as Record<string, unknown>)
    : null
  if (widgetPayload) {
    const widgetKind = trimmedString(widgetPayload.kind) ?? trimmedString(payload.widgetKind)
    if (widgetKind) lines.push(`widget: ${widgetKind}`)
    const widgetFields = traceFieldRecords(widgetPayload.fields)
      .map(formatFormFieldLine)
      .filter((line): line is string => Boolean(line))
    if (widgetFields.length > 0) {
      lines.push('widget fields:')
      lines.push(...widgetFields.map((line) => `- ${line}`))
    }
  }

  const imageUrl = trimmedString(payload.imageUrl)
  if (imageUrl) lines.push(`image: ${imageUrl}`)
  const caption = trimmedString(payload.caption)
  if (caption) lines.push(`caption: ${caption}`)

  return lines.length > 0 ? lines.join('\n') : trace.detail
}

function detailTextForTrace(
  trace: TraceTruthInput,
  payload: Record<string, unknown> | null,
): string | null {
  if (!payload) return trace.detail

  const normalizedToolName =
    typeof payload.toolName === 'string' && payload.toolName.trim().length > 0
      ? payload.toolName.trim()
      : undefined

  const summarizeScalarFields = (record: Record<string, unknown>): string | null => {
    const scalarEntries = Object.entries(record)
      .filter(([, value]) => value != null && value !== '')
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')

    if (scalarEntries.length === 0) return null

    return scalarEntries
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(' · ')
  }

  const summarizeStructuredValue = (value: unknown): string | null => {
    if (value == null) return null
    if (typeof value === 'string') return value.length > 220 ? `${value.slice(0, 220)}…` : value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) {
      return value.length === 0
        ? 'No items returned'
        : `Returned ${value.length} item${value.length === 1 ? '' : 's'}`
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>
      const failureMessage = typeof record.error === 'string'
        ? record.error
        : typeof record.message === 'string' && (record.ok === false || record.success === false)
          ? record.message
          : null
      if (failureMessage) return `Error: ${failureMessage}`
      if (typeof record.status === 'string' && record.status.trim()) {
        const rest = summarizeScalarFields(
          Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'status')),
        )
        return rest ? `status: ${record.status} · ${rest}` : `status: ${record.status}`
      }
      if (Array.isArray(record.list)) {
        return record.list.length === 0 ? 'No items returned' : `Returned ${record.list.length} item${record.list.length === 1 ? '' : 's'}`
      }
      if (Array.isArray(record.data)) {
        return record.data.length === 0 ? 'No items returned' : `Returned ${record.data.length} item${record.data.length === 1 ? '' : 's'}`
      }
      const scalarSummary = summarizeScalarFields(record)
      if (scalarSummary) return scalarSummary
      return `Structured result (${Object.keys(record).length} fields)`
    }
    return null
  }

  if (trace.actionType === 'form_request') {
    return formatFormRequestDetail(trace, payload)
  }

  if (trace.actionType === 'form_submit') {
    const answers = payload.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers)
      ? (payload.answers as Record<string, unknown>)
      : null
    const fields = Array.isArray(payload.fields)
      ? payload.fields.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
      : []
    const labelById = new Map<string, string>()
    for (const field of fields) {
      const id = typeof field.id === 'string' ? field.id : ''
      const label = typeof field.label === 'string' && field.label.trim() ? field.label.trim() : id
      if (id && label) labelById.set(id, label)
    }

    const lines: string[] = []
    if (typeof payload.title === 'string' && payload.title.trim()) lines.push(`title: ${payload.title.trim()}`)
    if (typeof payload.description === 'string' && payload.description.trim()) lines.push(`description: ${payload.description.trim()}`)
    if (answers) {
      const answerLines = Object.entries(answers).map(([key, value]) => {
        const label = labelById.get(key) ?? key
        return `${label}: ${String(value ?? '').trim() || '(empty)'}`
      })
      if (answerLines.length > 0) {
        lines.push('answers:')
        lines.push(...answerLines.map((line) => `- ${line}`))
      }
    }
    return lines.length > 0 ? lines.join('\n') : trace.detail
  }

  if (trace.actionType === 'channel_rich_message') {
    return formatChannelRichMessageDetail(trace, payload)
  }

  if (trace.actionType === 'human_task_created' || trace.actionType === 'human_task_resolved') {
    return formatHumanHandoffDetail(trace, payload)
  }

  if (trace.actionType === 'tool_call') {
    if (normalizedToolName === 'ask_user_questions') {
      const input = payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
        ? (payload.input as Record<string, unknown>)
        : null
      if (input) {
        const lines: string[] = []
        if (typeof input.title === 'string' && input.title.trim()) lines.push(`title: ${input.title.trim()}`)
        if (typeof input.description === 'string' && input.description.trim()) lines.push(`description: ${input.description.trim()}`)
        const fields = Array.isArray(input.fields)
          ? input.fields.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
          : []
        if (fields.length > 0) {
          lines.push('fields:')
          for (const field of fields) {
            const rawId = typeof field.id === 'string'
              ? field.id.trim()
              : typeof field.key === 'string'
                ? field.key.trim()
                : ''
            const label = typeof field.label === 'string' && field.label.trim() ? field.label.trim() : rawId
            if (!label) continue
            const type = typeof field.type === 'string' && field.type.trim() ? field.type.trim() : 'text'
            const tags = [type]
            if (field.required === true) tags.push('required')
            lines.push(`- ${label} [${tags.join(', ')}]`)
          }
        }
        if (lines.length > 0) return lines.join('\n')
      }
    }
    const summary = summarizeStructuredValue(payload.input)
    return summary ? `input: ${summary}` : trace.detail
  }

  if (trace.actionType === 'tool_result') {
    const parts: string[] = []
    const inputSummary = summarizeStructuredValue(payload.input)
    const outputSummary = summarizeStructuredValue(payload.output)
    const resultSummary = payload.output == null ? summarizeStructuredValue(payload.result) : null
    if (inputSummary) parts.push(`input: ${inputSummary}`)
    if (outputSummary) parts.push(`output: ${outputSummary}`)
    if (resultSummary) parts.push(`output: ${resultSummary}`)
    if (typeof payload.error === 'string' && payload.error.trim()) parts.push(`error: ${payload.error}`)
    return parts.length > 0 ? parts.join('\n') : trace.detail
  }

  if (trace.actionType === 'llm_response' && payload.usage && typeof payload.usage === 'object') {
    const usage = payload.usage as Record<string, unknown>
    const input = usage.input_tokens ?? usage.inputTokens
    const output = usage.output_tokens ?? usage.outputTokens
    const model = typeof payload.model === 'string' ? payload.model : null
    const stopReason =
      typeof payload.stopReason === 'string'
        ? payload.stopReason
        : typeof payload.stop_reason === 'string'
          ? payload.stop_reason
          : null

    const parts = [
      model ? `model: ${model}` : null,
      input != null ? `input: ${String(input)}` : null,
      output != null ? `output: ${String(output)}` : null,
      stopReason ? `stop: ${stopReason}` : null,
    ].filter(Boolean)

    return parts.length > 0 ? parts.join(' · ') : trace.detail
  }

  if (trace.actionType === 'loop_decision' || trace.actionType === 'hook_hit') {
    return summarizeLoopDecision(trace, payload)
  }

  if (EXPORTED_REVIEW_STAGES.has(trace.actionType)) {
    const usage =
      payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)
        ? (payload.usage as Record<string, unknown>)
        : null
    const parts = [
      trace.detail,
      usage?.inputTokens != null ? `input: ${String(usage.inputTokens)}` : null,
      usage?.outputTokens != null ? `output: ${String(usage.outputTokens)}` : null,
      payload.ms != null ? `runtime: ${String(payload.ms)}ms` : null,
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : trace.detail
  }

  if (trace.actionType === 'agent_tree_node') {
    const cleanedTitle = humanizeRuntimeDebugTitle(trace.title)
    return cleanedTitle || trace.detail
  }

  return trace.detail
}

export function isSyntheticReviewSource(input: RuntimeSourceInput): boolean {
  return input.source === 'playground' || Boolean(input.userId?.startsWith(PLAYGROUND_REVIEW_PREFIX))
}

export function getRuntimeSourceTruth(input: RuntimeSourceInput): RuntimeSourceTruth {
  if (isSyntheticReviewSource(input)) {
    return {
      kind: 'synthetic_review',
      shortLabel: 'Synthetic export',
      label: 'Synthetic review export',
      description:
        'Exported from Playground for review. This is not a live customer chat and it does not prove live external side effects.',
      isSynthetic: true,
    }
  }

  if (!input.source || input.source === 'live') {
    return {
      kind: 'live',
      shortLabel: 'Live runtime',
      label: 'Live runtime chat',
      description:
        'Recorded from the real conversation surface. Runtime evidence may still include mocked or partial tool results where the runtime says so.',
      isSynthetic: false,
    }
  }

  return {
    kind: 'unknown',
    shortLabel: input.source,
    label: `Runtime source: ${input.source}`,
    description: 'This record uses a non-default source tag. Treat the runtime evidence according to the stored source metadata.',
    isSynthetic: false,
  }
}

export function summarizeConversationSourceTruth(cases: RuntimeSourceInput[]): RuntimeSourceTruth {
  if (cases.length === 0) {
    return {
      kind: 'unknown',
      shortLabel: 'Unknown source',
      label: 'Unknown conversation source',
      description: 'No ProcedureRun source metadata is available for this conversation yet.',
      isSynthetic: false,
    }
  }

  const truths = cases.map(getRuntimeSourceTruth)
  const syntheticCount = truths.filter((truth) => truth.isSynthetic).length

  if (syntheticCount === truths.length) {
    return {
      kind: 'synthetic_review',
      shortLabel: 'Synthetic export',
      label: 'Synthetic review conversation',
      description:
        'Every ProcedureRun in this chat came from Playground export. Treat it as review evidence, not a live customer runtime transcript.',
      isSynthetic: true,
    }
  }

  if (syntheticCount > 0) {
    return {
      kind: 'mixed',
      shortLabel: 'Mixed sources',
      label: 'Mixed live and review evidence',
      description:
        'This chat mixes live ProcedureRuns with synthetic Playground review copies. Inspect each ProcedureRun source before treating the timeline as authoritative.',
      isSynthetic: true,
    }
  }

  return truths[0]
}

export function summarizeToolPairing(traces: TraceTruthInput[]): ToolPairingSummary {
  const toolCalls = traces.filter((trace) => trace.actionType === 'tool_call').length
  const toolResults = traces.filter((trace) => trace.actionType === 'tool_result').length

  if (toolCalls === 0 && toolResults === 0) {
    return {
      toolCalls,
      toolResults,
      label: 'No tool events recorded yet',
      labelZh: '暂无工具事件',
      tone: 'neutral',
    }
  }

  if (toolCalls === toolResults) {
    return {
      toolCalls,
      toolResults,
      label: `${toolCalls} tool calls matched to ${toolResults} results`,
      labelZh: `${toolCalls} 次工具调用已匹配 ${toolResults} 个结果`,
      tone: 'neutral',
    }
  }

  if (toolCalls > toolResults) {
    const gap = toolCalls - toolResults
    return {
      toolCalls,
      toolResults,
      label: `${toolCalls} tool calls, ${toolResults} results, ${gap} still pending or missing`,
      labelZh: `${toolCalls} 次工具调用，${toolResults} 个结果，${gap} 个仍在等待或缺失`,
      tone: 'warning',
    }
  }

  const extra = toolResults - toolCalls
  return {
    toolCalls,
    toolResults,
    label: toolCalls === 0
      ? `${toolResults} tool result events (tool_call records unavailable)`
      : `${toolResults} tool result events, ${toolCalls} tool calls, ${extra} without call records`,
    labelZh: toolCalls === 0
      ? `${toolResults} 个工具结果事件（缺少对应 tool_call 记录）`
      : `${toolResults} 个工具结果事件，${toolCalls} 次工具调用，${extra} 个缺少对应 tool_call 记录`,
    tone: 'warning',
  }
}

export function classifyOperateTrace(trace: TraceTruthInput): OperateTraceTruth {
  const payload = parseJson(trace.payload) ?? parseJson(trace.detail)
  const toolName = toolNameFromTrace(trace, payload)
  const status = deriveTraceStatus(trace, payload)
  const executionTruth =
    payload?.executionTruth && typeof payload.executionTruth === 'object' && !Array.isArray(payload.executionTruth)
      ? (payload.executionTruth as Record<string, unknown>)
      : null

  const executionLabel =
    typeof executionTruth?.label === 'string' && executionTruth.label.trim() ? executionTruth.label : undefined
  const executionNote =
    typeof executionTruth?.note === 'string' && executionTruth.note.trim() ? executionTruth.note : undefined

  if (trace.actionType === 'tool_call') {
    return {
      kind: 'tool_call',
      status,
      semanticLabel: 'Tool call',
      title: toolName || trace.title || 'Tool call',
      detailText: detailTextForTrace(trace, payload),
      payload,
      toolName,
      executionLabel,
      executionNote,
      isExportedReviewStage: false,
    }
  }

  if (trace.actionType === 'form_request') {
    return {
      kind: 'form_request',
      status,
      semanticLabel: 'Form request',
      title: trace.title || 'Form requested',
      detailText: detailTextForTrace(trace, payload),
      payload,
      executionLabel,
      executionNote,
      isExportedReviewStage: false,
    }
  }

  if (trace.actionType === 'form_submit') {
    return {
      kind: 'form_submission',
      status,
      semanticLabel: 'Form submission',
      title: trace.title || 'Form submitted',
      detailText: detailTextForTrace(trace, payload),
      payload,
      executionLabel,
      executionNote,
      isExportedReviewStage: false,
    }
  }

  if (trace.actionType === 'channel_rich_message') {
    return {
      kind: 'channel_message',
      status,
      semanticLabel: 'Channel rich message',
      title: trace.title || 'Channel rich message',
      detailText: detailTextForTrace(trace, payload),
      payload,
      isExportedReviewStage: false,
    }
  }

  if (trace.actionType === 'tool_result') {
    return {
      kind: 'tool_result',
      status,
      semanticLabel: 'Tool result',
      title: toolName || trace.title || 'Tool result',
      detailText: detailTextForTrace(trace, payload),
      payload,
      toolName,
      latencyMs: typeof payload?.latencyMs === 'number' ? payload.latencyMs : null,
      executionLabel,
      executionNote,
      isExportedReviewStage: false,
    }
  }

  if (trace.actionType === 'hook_hit' || (trace.actionType === 'loop_decision' && isHookLoopDecision(trace.title))) {
    return {
      kind: 'hook_decision',
      status,
      semanticLabel: 'Hook decision',
      title: trace.title || 'Hook decision',
      detailText: detailTextForTrace(trace, payload),
      payload,
      isExportedReviewStage: false,
    }
  }

  if (trace.actionType === 'loop_decision' && isProcedureRuntimeDecision(trace.title)) {
    const isStale = trace.title.includes('Stale') || payload?.evidenceState === 'stale' || payload?.stale === true
    return {
      kind: isStale ? 'stale_evidence' : 'procedure_runtime',
      status,
      semanticLabel: isStale ? 'Stale evidence' : 'Procedure runtime',
      title: trace.title || 'Procedure runtime',
      detailText: detailTextForTrace(trace, payload),
      payload,
      isExportedReviewStage: false,
    }
  }

  if (trace.actionType === 'human_task_created' || trace.actionType === 'human_task_resolved') {
    return {
      kind: 'human_handoff',
      status,
      semanticLabel: 'Human handoff',
      title: trace.title || 'Human handoff',
      detailText: detailTextForTrace(trace, payload),
      payload,
      isExportedReviewStage: false,
    }
  }

  if (trace.actionType === 'final_resolution') {
    return {
      kind: 'procedure_runtime',
      status,
      semanticLabel: 'Final resolution',
      title: trace.title || 'Final resolution',
      detailText: detailTextForTrace(trace, payload),
      payload,
      isExportedReviewStage: false,
    }
  }

  if (trace.actionType === 'llm_request_start') {
    return {
      kind: 'model_request',
      status,
      semanticLabel: 'Model request',
      title: trace.title || 'Model request',
      detailText: detailTextForTrace(trace, payload),
      payload,
      isExportedReviewStage: false,
    }
  }

  if (trace.actionType === 'llm_response') {
    return {
      kind: 'model_response',
      status,
      semanticLabel: 'Model response',
      title: trace.title || 'Model response',
      detailText: detailTextForTrace(trace, payload),
      payload,
      isExportedReviewStage: false,
    }
  }

  if (trace.actionType === 'user_message') {
    return {
      kind: 'user_message',
      status,
      semanticLabel: 'User message',
      title: trace.title || 'User message',
      detailText: detailTextForTrace(trace, payload),
      payload,
      isExportedReviewStage: false,
    }
  }

  if (EXPORTED_REVIEW_STAGES.has(trace.actionType)) {
    return {
      kind: 'exported_review',
      status,
      semanticLabel: 'Exported review stage',
      title: trace.actionType,
      detailText: detailTextForTrace(trace, payload),
      payload,
      isExportedReviewStage: true,
    }
  }

  if (
    trace.actionType === 'agent_tree_node' ||
    trace.actionType === 'stream_event' ||
    trace.actionType === 'case_created' ||
    trace.actionType === 'microcompact' ||
    trace.actionType === 'queue_message_enqueued' ||
    trace.actionType === 'queue_message_consumed' ||
    trace.actionType === 'incoming_chat' ||
    trace.actionType === 'chat_deactivated' ||
    trace.actionType === 'case_merged' ||
    trace.actionType.startsWith('provider_transcript_') ||
    (trace.actionType === 'loop_decision' && trace.title === 'Iteration Snapshot')
  ) {
    const cleanedTitle = trace.actionType === 'agent_tree_node'
      ? humanizeRuntimeDebugTitle(trace.title)
      : trace.title
    return {
      kind: 'runtime_debug',
      status,
      semanticLabel: 'Runtime debug',
      title: cleanedTitle || trace.title || 'Runtime debug',
      detailText: detailTextForTrace(trace, payload),
      payload,
      isExportedReviewStage: false,
    }
  }

  return {
    kind: 'info',
    status,
    semanticLabel: 'Runtime event',
    title: trace.title || trace.actionType || 'Runtime event',
    detailText: detailTextForTrace(trace, payload),
    payload,
    isExportedReviewStage: false,
  }
}

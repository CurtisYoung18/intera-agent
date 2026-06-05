// 5-stage trace aggregator for Playground.
// Maps fine-grained ActionType events → PlaygroundTraceStep with timing + status.

import type { TraceRecord } from './persistence-port'
import type { ActionType } from './trace'

export type TraceStage =
  | 'Guardrails'
  | 'Knowledge retrieval'
  | 'Skills & tools'
  | 'Stage SOP'
  | 'Model generation'

export type TraceStatus = 'ok' | 'info' | 'warn' | 'block' | 'neutral'
export type TraceSource = 'caseTypes' | 'guardrails' | 'knowledge' | 'tools' | 'agent' | 'humanTasks'

export interface PlaygroundTraceStep {
  stage: string
  source: TraceSource
  status: TraceStatus | 'skipped'
  fired: boolean
  ms: number
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  summary: string
  detail: [string, string][]
  json?: object
  /** Full prompt data captured from llm_request_start (available for Model generation stage). */
  promptData?: { systemPrompt: string; messages: unknown[] }
}

/** Bookkeeping actionTypes — excluded from stage bucketing, kept aside for F4 timing + debug JSON. */
const BOOKKEEPING: ReadonlySet<string> = new Set([
  'user_message', 'stream_event', 'loop_decision', 'agent_tree_node',
  'stream_request_start', 'microcompact', 'queue_message_enqueued', 'queue_message_consumed',
  // Lifecycle / multi-agent events — not user-facing pipeline stages
  'case_created', 'fact_extracted', 'cron_tick',
  'human_task_created', 'human_task_resolved', 'final_resolution',
  'incoming_chat', 'chat_deactivated',
  'fork_dispatch', 'case_merged', 'sub_agent_dispatched', 'sub_agent_merged',
  'message_bus_send', 'message_bus_receive',
])

const STAGE_MAP: Partial<Record<ActionType | 'kb_search', { stage: TraceStage; source: TraceSource }>> = {
  policy_hit: { stage: 'Guardrails', source: 'guardrails' },
  // kb_search_* tools
  kb_search: { stage: 'Knowledge retrieval', source: 'knowledge' },
  // All other skill_called / skill_result
  skill_called: { stage: 'Skills & tools', source: 'tools' },
  skill_result: { stage: 'Skills & tools', source: 'tools' },
  stage_eval: { stage: 'Stage SOP', source: 'agent' },
  llm_request_start: { stage: 'Model generation', source: 'agent' },
  llm_response: { stage: 'Model generation', source: 'agent' },
}

/** Parse the structured policy outcome — real policy_hit records carry the
 *  PolicyEvaluation object in `payload` (objects land in payload, not detail). */
function policyOutcome(payload?: string | null): 'block' | 'warn' | null {
  if (!payload) return null
  try {
    const p = JSON.parse(payload)
    const results: Array<{ result?: string }> = Array.isArray(p?.results) ? p.results : []
    const summary = String(p?.summary ?? p?.result ?? '')
    if (summary === 'blocked' || results.some(r => r?.result === 'blocked')) return 'block'
    if (summary === 'escalated' || results.some(r => r?.result === 'escalated')) return 'warn'
  } catch { /* fall through to legacy detail-string check */ }
  return null
}

function deriveStatus(record: TraceRecord): TraceStatus {
  const { actionType, detail } = record
  if (actionType === 'policy_hit') {
    // Structured payload is authoritative (TraceWriter stores the eval object there);
    // legacy/string callers used `detail`. Check payload first.
    const outcome = policyOutcome(record.payload)
    if (outcome) return outcome
    if (detail?.includes('block')) return 'block'
    if (detail?.includes('warn') || detail?.includes('escalat')) return 'warn'
    return 'ok'
  }
  if (actionType === 'skill_result') {
    const blob = `${detail ?? ''} ${record.payload ?? ''}`
    if (/"ok"\s*:\s*false|error|failed/i.test(blob)) return 'warn'
    return 'ok'
  }
  if (actionType === 'skill_called') {
    const blob = `${detail ?? ''} ${record.payload ?? ''}`
    if (blob.includes('kb_search')) return 'info'
  }
  return 'ok'
}

/** Extract usage from an llm_response record's detail or payload JSON. */
function extractUsage(record: TraceRecord): { inputTokens: number; outputTokens: number; totalTokens: number } | undefined {
  const raw = record.detail || record.payload
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    const u = parsed?.usage
    if (u && (typeof u.input_tokens === 'number' || typeof u.output_tokens === 'number')) {
      const inputTokens = Number(u.input_tokens ?? 0)
      const outputTokens = Number(u.output_tokens ?? 0)
      return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
    }
  } catch { /* ignore parse errors */ }
  return undefined
}

/** All 5 stages in fixed order — used as fallback when applicableStages is not provided. */
const allStages: { stage: TraceStage; source: TraceSource }[] = [
  { stage: 'Guardrails', source: 'guardrails' },
  { stage: 'Knowledge retrieval', source: 'knowledge' },
  { stage: 'Skills & tools', source: 'tools' },
  { stage: 'Stage SOP', source: 'agent' },
  { stage: 'Model generation', source: 'agent' },
]

/** Aggregate raw TraceRecord[] into Playground stages with timing. */
export function aggregateTraces(
  traces: TraceRecord[],
  startTime: number,
  debug: boolean,
  applicableStages?: string[],
): PlaygroundTraceStep[] {
  const stageMap = new Map<string, { records: TraceRecord[]; earliest: number }>()
  const bookkeeping: TraceRecord[] = []

  for (const t of traces) {
    if (BOOKKEEPING.has(t.actionType)) { bookkeeping.push(t); continue }
    const actionType = t.actionType

    // kb_search_* → Knowledge retrieval (must run before STAGE_MAP lookup,
    // since skill_called/skill_result have their own mappings)
    let mapping: { stage: TraceStage; source: TraceSource } | undefined

    if (actionType.startsWith('kb_search') || t.title?.startsWith('kb_search')) {
      mapping = { stage: 'Knowledge retrieval', source: 'knowledge' }
    } else if (actionType === 'skill_called' || actionType === 'skill_result') {
      // Check payload for kb_search skill name
      if (t.payload) {
        try {
          const p = JSON.parse(t.payload)
          if (typeof p?.skillName === 'string' && p.skillName.startsWith('kb_search_')) {
            mapping = { stage: 'Knowledge retrieval', source: 'knowledge' }
          }
        } catch { /* not valid JSON */ }
      }
    }

    mapping ??= STAGE_MAP[actionType as ActionType | 'kb_search']

    // Default: Skills & tools
    if (!mapping) {
      mapping = { stage: 'Skills & tools', source: 'tools' }
    }

    const existing = stageMap.get(mapping.stage)
    const recordTime = new Date(t.createdAt || Date.now()).getTime()
    if (!existing || recordTime < existing.earliest) {
      stageMap.set(mapping.stage, { records: [t], earliest: recordTime })
    } else {
      existing.records.push(t)
    }
  }

  // Stages that actually produced records — always shown
  const firedStages = new Set(stageMap.keys())
  const ordered = allStages.filter(s => firedStages.has(s.stage) || (applicableStages ?? allStages.map(a => a.stage)).includes(s.stage))

  return ordered.map(({ stage, source }) => {
    const entry = stageMap.get(stage)
    const fired = !!(entry && entry.records.length > 0)

    if (!fired) {
      const step: PlaygroundTraceStep = {
        stage,
        source,
        status: 'skipped',
        fired: false,
        ms: 0,
        summary: '(no events)',
        detail: [],
      }
      return step
    }

    const records = entry!.records

    // Per-stage ms = span between earliest and latest record (0 for single-record stages)
    const times = records.map(r => new Date(r.createdAt || Date.now()).getTime()).sort((a, b) => a - b)
    const ms = times.length > 1 ? Math.max(0, times[times.length - 1] - times[0]) : 0

    const statuses = records.map((r) => deriveStatus(r))
    const worstStatus = statuses.includes('block') ? 'block'
      : statuses.includes('warn') ? 'warn'
      : statuses.includes('info') ? 'info'
      : 'ok'

    const summary = records.map((r) => r.title).filter(Boolean).join(' → ') || '(no summary)'
    const detail: [string, string][] = records.slice(0, 10).map((r) => {
      // For skill records, show input/output from payload
      if ((r.actionType === 'skill_called' || r.actionType === 'skill_result') && r.payload) {
        try {
          const p = JSON.parse(r.payload)
          if (r.actionType === 'skill_called') {
            return [r.actionType, p.input ? JSON.stringify(p.input) : r.title || '']
          }
          // skill_result: show both input and output when available
          const parts: string[] = []
          if (p.input) parts.push(`input: ${JSON.stringify(p.input)}`)
          if (p.output) parts.push(`output: ${JSON.stringify(p.output)}`)
          return [r.actionType, parts.length > 0 ? parts.join('\n') : r.title || '']
        } catch { /* fall through */ }
      }
      return [r.actionType, r.detail || r.title || '']
    })

    const step: PlaygroundTraceStep = {
      stage,
      source,
      status: worstStatus as TraceStatus,
      fired: true,
      ms,
      summary,
      detail,
    }

    // For Model generation, extract full prompt data from llm_request_start records
    if (stage === 'Model generation') {
      const llmReqRecord = records.find(r => r.actionType === 'llm_request_start')
      if (llmReqRecord?.payload) {
        try {
          const parsed = JSON.parse(llmReqRecord.payload)
          if (parsed.systemPrompt || parsed.messages || parsed.lastMessages) {
            step.promptData = {
              systemPrompt: parsed.systemPrompt || '',
              // TraceWriter.writeLlmRequestStart stores the conversation under `lastMessages`.
              messages: parsed.lastMessages || parsed.messages || [],
            }
          }
        } catch { /* ignore parse errors */ }
      }

      // F4: Read real LLM wall-time from Iteration Snapshot payloads
      const iterationSnapshots = bookkeeping.filter(r => r.actionType === 'loop_decision')
      const realLlmMs = iterationSnapshots.reduce((sum, r) => {
        try {
          const p = JSON.parse(r.payload ?? '{}')
          return sum + (typeof p?.llmWallMs === 'number' ? p.llmWallMs : 0)
        } catch { return sum }
      }, 0)
      if (realLlmMs > 0) {
        step.ms = realLlmMs
      }

      // Extract usage from llm_response
      const llmRespRecord = records.find(r => r.actionType === 'llm_response')
      if (llmRespRecord) {
        step.usage = extractUsage(llmRespRecord)
      }
    }

    if (debug) {
      step.json = records.map((r) => ({
        actionType: r.actionType,
        title: r.title,
        detail: r.detail,
        payload: r.payload ? (() => { try { return JSON.parse(r.payload!) } catch { return r.payload } })() : undefined,
      }))
    }

    return step
  })
}

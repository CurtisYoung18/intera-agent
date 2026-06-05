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

function deriveStatus(actionType: string, detail?: string | null): TraceStatus {
  if (actionType === 'policy_hit') {
    if (detail?.includes('block')) return 'block'
    if (detail?.includes('warn')) return 'warn'
    return 'ok'
  }
  if (actionType === 'skill_result') {
    if (detail?.includes('error') || detail?.includes('failed')) return 'warn'
    return 'ok'
  }
  if (actionType === 'skill_called' && detail?.includes('kb_search')) return 'info'
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

  for (const t of traces) {
    const actionType = t.actionType
    let mapping = STAGE_MAP[actionType as ActionType | 'kb_search']

    // kb_search_* tools → Knowledge retrieval
    if (!mapping && (actionType.startsWith('kb_search') || t.title?.startsWith('kb_search'))) {
      mapping = { stage: 'Knowledge retrieval', source: 'knowledge' }
    }

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

    const statuses = records.map((r) => deriveStatus(r.actionType, r.detail))
    const worstStatus = statuses.includes('block') ? 'block'
      : statuses.includes('warn') ? 'warn'
      : statuses.includes('info') ? 'info'
      : 'ok'

    const summary = records.map((r) => r.title).filter(Boolean).join(' → ') || '(no summary)'
    const detail: [string, string][] = records.slice(0, 10).map((r) => [r.actionType, r.detail || r.title || ''])

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
          if (parsed.systemPrompt || parsed.messages) {
            step.promptData = {
              systemPrompt: parsed.systemPrompt || '',
              messages: parsed.messages || [],
            }
          }
        } catch { /* ignore parse errors */ }
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

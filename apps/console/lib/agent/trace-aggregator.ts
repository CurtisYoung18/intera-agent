// 6-stage trace aggregator for Playground.
// Maps fine-grained ActionType events → PlaygroundTraceStep with timing + status.

import type { TraceRecord } from './persistence-port'

export type TraceStage =
  | 'Intent classification'
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
  status: TraceStatus
  ms: number
  summary: string
  detail: [string, string][]
  json?: object
}

const STAGE_MAP: Record<string, { stage: TraceStage; source: TraceSource }> = {
  intent_classify: { stage: 'Intent classification', source: 'caseTypes' },
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

/** Aggregate raw TraceRecord[] into 6 Playground stages with timing. */
export function aggregateTraces(
  traces: TraceRecord[],
  startTime: number,
  debug: boolean,
): PlaygroundTraceStep[] {
  const stageMap = new Map<TraceStage, { records: TraceRecord[]; earliest: number }>()

  for (const t of traces) {
    const actionType = t.actionType
    let mapping = STAGE_MAP[actionType]

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

  // All 6 stages in order
  const allStages: { stage: TraceStage; source: TraceSource }[] = [
    { stage: 'Intent classification', source: 'caseTypes' },
    { stage: 'Guardrails', source: 'guardrails' },
    { stage: 'Knowledge retrieval', source: 'knowledge' },
    { stage: 'Skills & tools', source: 'tools' },
    { stage: 'Stage SOP', source: 'agent' },
    { stage: 'Model generation', source: 'agent' },
  ]

  return allStages.map(({ stage, source }) => {
    const entry = stageMap.get(stage)
    if (!entry || entry.records.length === 0) {
      return {
        stage,
        source,
        status: 'neutral' as TraceStatus,
        ms: 0,
        summary: '(no events)',
        detail: [] as [string, string][],
      }
    }

    const records = entry.records
    const ms = Math.max(1, Math.round((Date.now() - entry.earliest) / 100) * 100) // rough timing
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
      ms,
      summary,
      detail,
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

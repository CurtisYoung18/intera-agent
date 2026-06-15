export interface ProcedureMetricsRunInput {
  id: string
  caseId: string
  chatId?: string | null
  procedureId: string
  status: string
  outcome?: string | null
  inputEpoch?: number | null
  currentStepId?: string | null
  state?: unknown
  createdAt: Date | string
  updatedAt: Date | string
}

export interface ProcedureMetricsBlocker {
  label: string
  count: number
}

export interface ProcedureMetricsRecentRun {
  id: string
  caseId: string
  chatId: string | null
  status: string
  outcome: string | null
  currentStepId: string | null
  blockers: string[]
  turnsToTerminal: number | null
  updatedAt: string
}

export interface ProcedureMetricsRow {
  procedureId: string
  runs: number
  resolvedByAgent: number
  handedOff: number
  abandoned: number
  active: number
  unknownTerminal: number
  resolutionRate: number
  handoffRate: number
  abandonmentRate: number
  medianTurnsToTerminal: number | null
  topBlockers: ProcedureMetricsBlocker[]
  recentRuns: ProcedureMetricsRecentRun[]
}

export interface ProcedureMetricsSummary {
  totalRuns: number
  resolvedByAgent: number
  handedOff: number
  abandoned: number
  active: number
  unknownTerminal: number
  resolutionRate: number
  handoffRate: number
  abandonmentRate: number
  latestActivityAt: string | null
  generatedAt: string
  rows: ProcedureMetricsRow[]
}

type OutcomeBucket = 'resolvedByAgent' | 'handedOff' | 'abandoned' | 'active' | 'unknownTerminal'

const ACTIVE_STATUSES = new Set(['active', 'paused', 'waiting_human'])
const TERMINAL_STATUSES = new Set(['completed', 'cancelled'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString()
}

function toDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

function classifyRun(input: ProcedureMetricsRunInput): OutcomeBucket {
  const status = input.status.toLowerCase()
  const outcome = String(input.outcome ?? '').toLowerCase()
  if (outcome === 'resolved_by_agent') return 'resolvedByAgent'
  if (outcome === 'handed_off') return 'handedOff'
  if (outcome === 'abandoned' || outcome === 'expired') return 'abandoned'
  if (status === 'cancelled') return 'abandoned'
  if (ACTIVE_STATUSES.has(status)) return 'active'
  if (TERMINAL_STATUSES.has(status)) return 'unknownTerminal'
  return 'active'
}

function pushStringBlockers(target: string[], value: unknown) {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      target.push(item.trim())
    }
  }
}

export function extractProcedureBlockers(state: unknown): string[] {
  if (!isRecord(state)) return []
  const blockers: string[] = []
  pushStringBlockers(blockers, state.blockers)

  const timeline = state.timeline
  if (Array.isArray(timeline)) {
    for (const event of timeline) {
      if (!isRecord(event)) continue
      pushStringBlockers(blockers, event.blockers)
      if (isRecord(event.metadata)) {
        pushStringBlockers(blockers, event.metadata.blockers)
      }
    }
  }

  return [...new Set(blockers)]
}

function countCustomerInputs(state: unknown): number {
  if (!isRecord(state) || !Array.isArray(state.inputs)) return 0
  let customerInputs = 0
  for (const input of state.inputs) {
    if (!isRecord(input)) continue
    const origin = String(input.origin ?? input.role ?? input.source ?? '').toLowerCase()
    if (origin === 'customer' || origin === 'user') {
      customerInputs += 1
    }
  }
  return customerInputs || state.inputs.length
}

function turnsToTerminal(input: ProcedureMetricsRunInput, bucket: OutcomeBucket): number | null {
  if (bucket === 'active') return null
  const fromInputs = countCustomerInputs(input.state)
  if (fromInputs > 0) return fromInputs
  if (typeof input.inputEpoch === 'number' && input.inputEpoch >= 0) return input.inputEpoch
  return null
}

function topBlockers(blockers: string[]): ProcedureMetricsBlocker[] {
  const counts = new Map<string, number>()
  for (const blocker of blockers) {
    counts.set(blocker, (counts.get(blocker) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }))
}

export function summarizeProcedureMetrics(
  runs: ProcedureMetricsRunInput[],
  now = new Date(),
): ProcedureMetricsSummary {
  const groups = new Map<string, ProcedureMetricsRunInput[]>()
  let latestActivity: Date | null = null

  for (const run of runs) {
    const procedureId = run.procedureId || 'unknown_procedure'
    const group = groups.get(procedureId) ?? []
    group.push(run)
    groups.set(procedureId, group)

    const updatedAt = toDate(run.updatedAt)
    if (updatedAt && (!latestActivity || updatedAt > latestActivity)) {
      latestActivity = updatedAt
    }
  }

  const rows: ProcedureMetricsRow[] = [...groups.entries()].map(([procedureId, group]) => {
    const counters: Record<OutcomeBucket, number> = {
      resolvedByAgent: 0,
      handedOff: 0,
      abandoned: 0,
      active: 0,
      unknownTerminal: 0,
    }
    const blockerBag: string[] = []
    const turnCounts: number[] = []

    const classifiedRuns = group.map((run) => {
      const bucket = classifyRun(run)
      const blockers = extractProcedureBlockers(run.state)
      const turns = turnsToTerminal(run, bucket)
      counters[bucket] += 1
      blockerBag.push(...blockers)
      if (turns !== null) turnCounts.push(turns)
      return { run, blockers, turns }
    })

    const recentRuns = classifiedRuns
      .sort((a, b) => toIso(b.run.updatedAt).localeCompare(toIso(a.run.updatedAt)))
      .slice(0, 8)
      .map(({ run, blockers, turns }) => {
        return {
          id: run.id,
          caseId: run.caseId,
          chatId: run.chatId ?? null,
          status: run.status,
          outcome: run.outcome ?? null,
          currentStepId: run.currentStepId ?? null,
          blockers,
          turnsToTerminal: turns,
          updatedAt: toIso(run.updatedAt),
        }
      })

    const total = group.length
    return {
      procedureId,
      runs: total,
      resolvedByAgent: counters.resolvedByAgent,
      handedOff: counters.handedOff,
      abandoned: counters.abandoned,
      active: counters.active,
      unknownTerminal: counters.unknownTerminal,
      resolutionRate: rate(counters.resolvedByAgent, total),
      handoffRate: rate(counters.handedOff, total),
      abandonmentRate: rate(counters.abandoned, total),
      medianTurnsToTerminal: median(turnCounts),
      topBlockers: topBlockers(blockerBag),
      recentRuns,
    }
  }).sort((a, b) => b.runs - a.runs || a.procedureId.localeCompare(b.procedureId))

  const totals = rows.reduce((acc, row) => {
    acc.resolvedByAgent += row.resolvedByAgent
    acc.handedOff += row.handedOff
    acc.abandoned += row.abandoned
    acc.active += row.active
    acc.unknownTerminal += row.unknownTerminal
    return acc
  }, {
    resolvedByAgent: 0,
    handedOff: 0,
    abandoned: 0,
    active: 0,
    unknownTerminal: 0,
  })

  return {
    totalRuns: runs.length,
    ...totals,
    resolutionRate: rate(totals.resolvedByAgent, runs.length),
    handoffRate: rate(totals.handedOff, runs.length),
    abandonmentRate: rate(totals.abandoned, runs.length),
    latestActivityAt: latestActivity?.toISOString() ?? null,
    generatedAt: now.toISOString(),
    rows,
  }
}

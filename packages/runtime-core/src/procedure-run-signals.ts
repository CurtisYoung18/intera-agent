import type { ProcedureRuntimeSignal, ProcedureRuntimeSignalDetector } from '@intera/shared/types'
import type { ProcedureRunState } from './procedure-run-state'

const SUPPORTED_RUNTIME_SIGNALS: readonly ProcedureRuntimeSignal[] = [
  'no_progress_loop',
  'knowledge_gap',
]

export function updateSignalsFromInput(run: ProcedureRunState, content: string): void {
  const text = content.trim()
  if (!text) return

  for (const detector of getRuntimeSignalDetectors(run)) {
    if (!isSupportedRuntimeSignal(detector.signal)) continue
    if (matchesDetector(detector, text)) {
      setProcedureSignal(run, detector.signal, detector.reason || 'Procedure runtime signal detector matched customer input.')
    }
  }
}

function getRuntimeSignalDetectors(run: ProcedureRunState): ProcedureRuntimeSignalDetector[] {
  const detectors = run.definition?.runtimeSignalDetectors
  return Array.isArray(detectors) ? detectors : []
}

function matchesDetector(detector: ProcedureRuntimeSignalDetector, text: string): boolean {
  for (const pattern of detector.patterns) {
    try {
      if (new RegExp(pattern, 'i').test(text)) return true
    } catch {
      continue
    }
  }
  return false
}

function isSupportedRuntimeSignal(signal: unknown): signal is ProcedureRuntimeSignal {
  return typeof signal === 'string' && SUPPORTED_RUNTIME_SIGNALS.includes(signal as ProcedureRuntimeSignal)
}

function setProcedureSignal(run: ProcedureRunState, signal: ProcedureRuntimeSignal, reason: string): void {
  const existing = run.signals.find((entry) => entry.signal === signal)
  if (existing) {
    existing.active = true
    existing.reason = reason
    return
  }
  run.signals.push({ signal, active: true, reason })
}

export function clearProcedureSignal(run: ProcedureRunState, signal: ProcedureRuntimeSignal): void {
  const existing = run.signals.find((entry) => entry.signal === signal)
  if (existing) existing.active = false
}

export function refreshNoProgressSignal(run: ProcedureRunState): void {
  const stepId = run.currentStepId
  if (!stepId) return
  const latestProgressAt = latestProgressTimestamp(run, stepId)
  const repeatedInputs = run.timeline.filter((event) =>
    event.source === 'customer_message' &&
    (!latestProgressAt || event.createdAt >= latestProgressAt)
  )
  if (repeatedInputs.length >= 3) {
    setProcedureSignal(
      run,
      'no_progress_loop',
      `Customer sent ${repeatedInputs.length} new messages while step ${stepId} remained open.`,
    )
  }
}

function latestProgressTimestamp(run: ProcedureRunState, stepId: string): string | undefined {
  let latest: string | undefined
  for (const step of run.steps) {
    if (step.id !== stepId) continue
    if (step.completedAt && (!latest || step.completedAt > latest)) latest = step.completedAt
    if (step.startedAt && (!latest || step.startedAt > latest)) latest = step.startedAt
    if (step.actions) {
      for (const action of step.actions) {
        if (action.status === 'completed') {
          for (const evidenceId of action.evidenceIds) {
            const evidence = run.evidence.find((entry) => entry.id === evidenceId)
            if (evidence?.createdAt && (!latest || evidence.createdAt > latest)) latest = evidence.createdAt
          }
        }
      }
    }
  }
  return latest
}

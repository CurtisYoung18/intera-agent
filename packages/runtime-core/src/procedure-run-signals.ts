import type { ProcedureRuntimeSignal } from '@intera/shared/types'
import type { ProcedureRunState } from './procedure-run-state'

export function updateSignalsFromInput(run: ProcedureRunState, content: string): void {
  const text = content.trim()
  if (!text) return

  if (isExplicitHumanRequest(text)) {
    setProcedureSignal(run, 'explicit_human_request', 'Customer explicitly asked for a person.')
  }
  if (isKnowledgeGapRequest(text)) {
    setProcedureSignal(run, 'knowledge_gap', 'Customer asked where to find something or lacked context.')
  }
}

function isExplicitHumanRequest(text: string): boolean {
  return [
    /(?:speak|talk|chat|connect|transfer|hand(?:\s+me)?)\s+(?:me\s+)?(?:to|with)?\s*(?:a\s+)?(?:human|person|agent|specialist|representative)/i,
    /\b(?:human|live)\s+(?:agent|support|person)\b/i,
    /\b(?:real|actual)\s+person\b/i,
    /人工|真人|客服|专员/,
  ].some((pattern) => pattern.test(text))
}

function isKnowledgeGapRequest(text: string): boolean {
  return [
    /where\s+(?:do|can)\s+i\s+find/i,
    /how\s+do\s+i\s+find/i,
    /what(?:'s| is)\s+the\s+link/i,
    /which\s+page/i,
    /哪里.*找|在哪.*找|去哪里.*找|什么页面|什么链接/,
  ].some((pattern) => pattern.test(text))
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
    event.inputEpoch > run.lastReconciledInputEpoch &&
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

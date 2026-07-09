import { currentStep } from './procedure-run-progress'
import type {
  ProcedureRunActionState,
  ProcedureRunEvidenceState,
  ProcedureRunState,
  ProcedureRunStepState,
} from './procedure-run-state'

export function findLatestPersistedHandoffEvidence(
  run: ProcedureRunState,
  taskId?: string,
): ProcedureRunEvidenceState | undefined {
  return [...run.evidence]
    .filter((entry) => {
      if (entry.toolName !== 'create_human_task') return false
      const output = isRecord(entry.metadata?.output) ? entry.metadata.output : null
      if (!output || output.persisted !== true) return false
      if (!taskId) return true
      return output.taskId === taskId
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
}

export function findHandoffMatch(
  run: ProcedureRunState,
  evidence: ProcedureRunEvidenceState,
): { step: ProcedureRunStepState; action?: ProcedureRunActionState } | null {
  const step = evidence.stepId
    ? run.steps.find((candidate) => candidate.id === evidence.stepId)
    : undefined
  if (!step) return null
  const action = evidence.actionId
    ? step.actions?.find((candidate) => candidate.id === evidence.actionId)
    : undefined
  return { step, action }
}

export function finalizationBlockers(run: ProcedureRunState): string[] {
  const blockers = [...run.blockers]
  if (run.definition?.version === 'v2') {
    const incompleteRequiredSteps = run.steps.filter((step) =>
      step.status !== 'completed' &&
      step.status !== 'skipped',
    )
    for (const step of incompleteRequiredSteps) {
      blockers.push(`Step "${step.title || step.id}" is still ${step.status}.`)
    }

    const pendingEval = currentStep(run)?.branches?.find((branch) => branch.status === 'pending')
    if (pendingEval) {
      blockers.push(`Branch "${pendingEval.conditionLabel || pendingEval.label || pendingEval.id}" still needs structured evidence or an evaluator receipt.`)
    }

    const activeHints = run.signals.filter((signal) => signal.active)
    for (const signal of activeHints) {
      if (signal.signal === 'no_progress_loop') {
        blockers.push(`Safety hint "${signal.signal}" is still active: ${signal.reason}`)
      }
    }
  }

  return [...new Set(blockers)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

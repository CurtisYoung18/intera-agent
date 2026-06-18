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
      if (signal.signal === 'explicit_human_request' || signal.signal === 'no_progress_loop') {
        blockers.push(`Safety hint "${signal.signal}" is still active: ${signal.reason}`)
      }
    }
  }

  return [...new Set(blockers)]
}

export function promisesHumanHandoff(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return [
    /(?:i|we)\s+(?:have|\'ve)\s+(?:created|opened|submitted|arranged|escalated)\s+(?:a\s+)?(?:ticket|case|handoff|human support request)/i,
    /(?:i|we)\s+will\s+(?:arrange|transfer|connect|escalate)\s+(?:you\s+)?(?:to|with)?\s*(?:a\s+)?(?:human|agent|specialist|representative)/i,
    /(?:i|we)\s+will\s+(?:forward|send|submit|route|escalate)\s+(?:this|it|your\s+(?:case|issue|concern|request))?\s*(?:to|with)?\s*(?:the\s+)?(?:local|relevant|human)?\s*(?:support|team|department|specialist|agent)/i,
    /\bma\s+[^.?!\n]{0,80}?\b(?:sthaniya|local|relevant)?\s*(?:sahayog|support|team|department)\s+ma\s+(?:patha(?:u)?nchu|pathaunchu|pathaunechhu|forward|escalate)\b/i,
    /已为您创建工单/,
    /已经为您创建工单/,
    /已安排人工/,
    /将安排人工/,
    /正在(?:为您|帮您)?人工处理/,
    /(?:为您|帮您)?人工处理(?:中|。|，|,|$)/,
    /已转人工/,
    /已经转人工/,
    /已为您转接/,
    /客服会(?:尽快)?(?:联系|回复)您/,
    /(?:人工|客服|专员)(?:会|将)(?:尽快)?(?:联系|回复)您/,
    /专员将尽快与您联系/,
  ].some((pattern) => pattern.test(trimmed))
}

export function hasPersistedHandoffEvidence(run: ProcedureRunState): boolean {
  return run.evidence.some((entry) =>
    entry.kind === 'handoff' &&
    (
      entry.metadata?.outcome === 'succeeded' ||
      (isRecord(entry.metadata?.output) && entry.metadata.output.persisted === true)
    ),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

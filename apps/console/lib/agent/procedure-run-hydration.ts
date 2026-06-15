import type { ProcedureV2 } from '@intera/shared/types'
import type { PersistedProcedureRunRecord } from './procedure-run-persistence'
import type { RuntimeEvent } from './session-queue'
import type {
  ProcedureRunActionState,
  ProcedureRunBranchState,
  ProcedureRunConditionEvaluationState,
  ProcedureRunEvidenceState,
  ProcedureRunInputState,
  ProcedureRunSignalState,
  ProcedureRunState,
  ProcedureRunStatus,
  ProcedureRunStepState,
  ProcedureStepStatus,
} from './procedure-run-state'

export function hydratePersistedRun(record: PersistedProcedureRunRecord): ProcedureRunState | null {
  const raw = isRecord(record.state) ? record.state : {}
  const status = isProcedureRunStatus(record.status) ? record.status : 'paused'
  return {
    runId: stringFrom(raw.runId) ?? record.id,
    agentConfigId: stringFrom(raw.agentConfigId) ?? record.agentConfigId,
    procedureId: stringFrom(raw.procedureId) ?? record.procedureId,
    caseType: stringFrom(raw.caseType) ?? record.procedureId,
    displayName: stringFrom(raw.displayName) ?? record.procedureId,
    status,
    inputEpoch: record.inputEpoch,
    lastReconciledInputEpoch: numberFrom(raw.lastReconciledInputEpoch) ?? record.inputEpoch,
    needsReconcile: record.needsReconcile,
    currentStepId: stringFrom(raw.currentStepId) ?? null,
    steps: Array.isArray(raw.steps)
      ? raw.steps
        .map((step) => hydrateProcedureRunStepState(step))
        .filter((step): step is ProcedureRunStepState => step !== null)
      : [],
    inputs: Array.isArray(raw.inputs) ? raw.inputs as ProcedureRunInputState[] : [],
    evidenceToolCallIds: Array.isArray(raw.evidenceToolCallIds) ? raw.evidenceToolCallIds as string[] : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence as ProcedureRunEvidenceState[] : [],
    evaluations: Array.isArray(raw.evaluations) ? raw.evaluations as ProcedureRunConditionEvaluationState[] : [],
    signals: Array.isArray(raw.signals) ? raw.signals as ProcedureRunSignalState[] : [],
    blockers: Array.isArray(raw.blockers) ? raw.blockers as string[] : [],
    timeline: Array.isArray(raw.timeline) ? raw.timeline as RuntimeEvent[] : [],
    definition: isRecord(raw.definition) ? raw.definition as unknown as ProcedureV2 : undefined,
    reason: stringFrom(raw.reason),
    outcome: stringFrom(raw.outcome) ?? record.outcome ?? undefined,
    confidence: numberFrom(raw.confidence),
    currentProcedureAction: isCurrentProcedureAction(raw.currentProcedureAction)
      ? raw.currentProcedureAction
      : undefined,
    startedAt: stringFrom(raw.startedAt) ?? dateString(record.createdAt) ?? new Date().toISOString(),
    updatedAt: stringFrom(raw.updatedAt) ?? dateString(record.updatedAt) ?? new Date().toISOString(),
    lastStartRequestId: stringFrom(raw.lastStartRequestId),
  }
}

export function normalizeHydratedRun(run: ProcedureRunState | null): ProcedureRunState | null {
  if (!run) return null
  if (!isLegacyPausedHandoffRun(run)) return run
  return {
    ...run,
    status: 'completed',
    currentStepId: null,
    blockers: [],
    reason: legacyHandoffFinalizationReason(run),
    outcome: run.outcome ?? 'handed_off',
  }
}

function isLegacyPausedHandoffRun(run: ProcedureRunState): boolean {
  if (run.status !== 'paused') return false
  if (typeof run.reason === 'string' && run.reason.toLowerCase().startsWith('waiting for human handoff')) {
    return true
  }
  return run.evidence.some((entry) =>
    entry.kind === 'handoff' &&
    isRecord(entry.metadata) &&
    (
      entry.metadata.outcome === 'succeeded' ||
      (isRecord(entry.metadata.output) && entry.metadata.output.persisted === true)
    ),
  )
}

function legacyHandoffFinalizationReason(run: ProcedureRunState): string {
  const handoffEvidence = run.evidence.find((entry) =>
    entry.kind === 'handoff' &&
    isRecord(entry.metadata) &&
    isRecord(entry.metadata.output) &&
    typeof entry.metadata.output.taskId === 'string',
  )
  const taskId = handoffEvidence && isRecord(handoffEvidence.metadata) && isRecord(handoffEvidence.metadata.output)
    ? handoffEvidence.metadata.output.taskId
    : undefined
  return typeof taskId === 'string'
    ? `Finalized after human handoff task ${taskId}.`
    : 'Finalized after human handoff.'
}

function isProcedureRunStatus(value: unknown): value is ProcedureRunStatus {
  return value === 'active' || value === 'paused' || value === 'completed' || value === 'cancelled'
}

function isCurrentProcedureAction(value: unknown): value is ProcedureRunState['currentProcedureAction'] {
  return value === 'pause' || value === 'complete' || value === 'abandon'
}

function isProcedureStepStatus(value: unknown): value is ProcedureStepStatus {
  return value === 'pending' || value === 'active' || value === 'completed' || value === 'skipped' || value === 'blocked'
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function dateString(value: Date | string | undefined): string | undefined {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : undefined
}

function hydrateProcedureRunStepState(value: unknown): ProcedureRunStepState | null {
  if (!isRecord(value)) return null
  const id = stringFrom(value.id)
  const status = isProcedureStepStatus(value.status) ? value.status : undefined
  if (!id || !status) return null
  return {
    id,
    title: stringFrom(value.title),
    guidance: stringFrom(value.guidance),
    status,
    startedAt: stringFrom(value.startedAt),
    completedAt: stringFrom(value.completedAt),
    evidenceToolCallIds: Array.isArray(value.evidenceToolCallIds)
      ? value.evidenceToolCallIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
    actions: Array.isArray(value.actions)
      ? value.actions
        .map((action) => hydrateProcedureRunActionState(action))
        .filter((action): action is ProcedureRunActionState => action !== null)
      : [],
    branches: Array.isArray(value.branches)
      ? value.branches
        .map((branch) => hydrateProcedureRunBranchState(branch))
        .filter((branch): branch is ProcedureRunBranchState => branch !== null)
      : [],
    skipReason: stringFrom(value.skipReason),
    completionReason: stringFrom(value.completionReason),
  }
}

function hydrateProcedureRunActionState(value: unknown): ProcedureRunActionState | null {
  if (!isRecord(value)) return null
  const id = stringFrom(value.id)
  const kind = stringFrom(value.kind)
  const label = stringFrom(value.label)
  const status = isProcedureStepStatus(value.status) ? value.status : undefined
  if (!id || !kind || !label || !status) return null
  return {
    id,
    kind,
    label,
    target: stringFrom(value.target),
    guidance: stringFrom(value.guidance),
    branchId: stringFrom(value.branchId),
    required: typeof value.required === 'boolean' ? value.required : undefined,
    status,
    evidenceIds: Array.isArray(value.evidenceIds)
      ? value.evidenceIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
  }
}

function hydrateProcedureRunBranchState(value: unknown): ProcedureRunBranchState | null {
  if (!isRecord(value)) return null
  const id = stringFrom(value.id)
  const kind = value.kind === 'if' || value.kind === 'else_if' || value.kind === 'else'
    ? value.kind
    : undefined
  const status = value.status === 'pending' || value.status === 'matched' || value.status === 'skipped'
    ? value.status
    : undefined
  if (!id || !kind || !status) return null
  return {
    id,
    kind,
    label: stringFrom(value.label),
    conditionLabel: stringFrom(value.conditionLabel),
    status,
    reason: stringFrom(value.reason),
    actionIds: Array.isArray(value.actionIds)
      ? value.actionIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

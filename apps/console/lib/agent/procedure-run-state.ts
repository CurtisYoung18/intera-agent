import type {
  ProcedureRuntimeSignal,
  ProcedureV2,
} from '@intera/shared/types'
import type {
  RuntimeEvent,
  RuntimeEventOrigin,
  RuntimeEventSource,
} from './session-queue'

export type ProcedureRunStatus = 'active' | 'paused' | 'completed' | 'cancelled'
export type ProcedureStepStatus = 'pending' | 'active' | 'completed' | 'skipped' | 'blocked'

export interface ProcedureRunStepState {
  id: string
  title?: string
  guidance?: string
  status: ProcedureStepStatus
  startedAt?: string
  completedAt?: string
  evidenceToolCallIds: string[]
  actions?: ProcedureRunActionState[]
  branches?: ProcedureRunBranchState[]
  skipReason?: string
  completionReason?: string
}

export interface ProcedureRunActionState {
  id: string
  kind: string
  label: string
  target?: string
  guidance?: string
  branchId?: string
  required?: boolean
  status: ProcedureStepStatus
  evidenceIds: string[]
}

export interface ProcedureRunBranchState {
  id: string
  kind: 'if' | 'else_if' | 'else'
  label?: string
  conditionLabel?: string
  status: 'pending' | 'matched' | 'skipped'
  reason?: string
  actionIds: string[]
}

export interface ProcedureRunInputState {
  eventId: string
  inputEpoch: number
  source: Extract<RuntimeEventSource, 'customer_message' | 'customer_form_result' | 'human_task_result'>
  origin: RuntimeEventOrigin
  createdAt: string
  content?: string
  formAnswers?: Record<string, string>
  summary?: string
}

export type ProcedureConditionEvaluationDecision = 'matched' | 'skipped' | 'pending' | 'error'

export interface ProcedureRunConditionEvaluationState {
  id: string
  branchId: string
  conditionId: string
  label: string
  decision: ProcedureConditionEvaluationDecision
  reason: string
  basedOnInputEpoch: number
  model?: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface ProcedureRunEvidenceState {
  id: string
  kind: 'tool' | 'knowledge' | 'form' | 'handoff' | 'text_reply' | 'runtime_signal' | 'evaluator'
  stepId?: string
  actionId?: string
  branchId?: string
  label: string
  toolName?: string
  basedOnInputEpoch?: number
  state: 'canonical' | 'stale'
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface ProcedureRunSignalState {
  signal: ProcedureRuntimeSignal
  active: boolean
  reason: string
}

export interface ProcedureRunState {
  runId: string
  agentConfigId?: string
  procedureId: string
  caseType: string
  displayName: string
  status: ProcedureRunStatus
  inputEpoch: number
  lastReconciledInputEpoch: number
  needsReconcile: boolean
  currentStepId: string | null
  steps: ProcedureRunStepState[]
  inputs: ProcedureRunInputState[]
  evidenceToolCallIds: string[]
  evidence: ProcedureRunEvidenceState[]
  evaluations: ProcedureRunConditionEvaluationState[]
  signals: ProcedureRunSignalState[]
  blockers: string[]
  timeline: RuntimeEvent[]
  definition?: ProcedureV2
  reason?: string
  outcome?: string | null
  confidence?: number
  currentProcedureAction?: 'pause' | 'complete' | 'abandon'
  startedAt: string
  updatedAt: string
  lastStartRequestId?: string
}

export interface ProcedureRuntimeState {
  activeProcedureRun?: ProcedureRunState
  pausedProcedureRuns: ProcedureRunState[]
  completedProcedureRuns: ProcedureRunState[]
}

export interface PendingProcedureLlmEvaluation {
  caseId: string
  runId: string
  procedureId: string
  procedureDisplayName: string
  stepId: string
  stepTitle?: string
  branchId: string
  branchLabel?: string
  conditionId: string
  prompt: string
  basedOnInputEpoch: number
  recentInputs: ProcedureRunInputState[]
  recentEvidence: ProcedureRunEvidenceState[]
}

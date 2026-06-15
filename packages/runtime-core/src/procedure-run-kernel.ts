export type ProcedureRunKernelStatus = 'active' | 'paused' | 'completed' | 'cancelled'
export type ProcedureRunKernelStepStatus = 'pending' | 'active' | 'completed' | 'skipped' | 'blocked'

export interface ProcedureRunKernelAction {
  id: string
  kind: string
  label: string
  target?: string
  guidance?: string
  branchId?: string
  required?: boolean
  status: ProcedureRunKernelStepStatus
  evidenceIds: string[]
}

export interface ProcedureRunKernelBranch {
  id: string
  kind: 'if' | 'else_if' | 'else'
  label?: string
  conditionLabel?: string
  status: 'pending' | 'matched' | 'skipped'
  reason?: string
  actionIds: string[]
}

export interface ProcedureRunKernelStep {
  id: string
  title?: string
  guidance?: string
  status: ProcedureRunKernelStepStatus
  startedAt?: string
  completedAt?: string
  evidenceToolCallIds: string[]
  actions?: ProcedureRunKernelAction[]
  branches?: ProcedureRunKernelBranch[]
  skipReason?: string
  completionReason?: string
}

export interface ProcedureRunKernelState {
  runId: string
  status: ProcedureRunKernelStatus
  inputEpoch: number
  currentStepId: string | null
  steps: ProcedureRunKernelStep[]
  blockers: string[]
  updatedAt: string
  reason?: string
  outcome?: string | null
}

export interface ProcedureRunKernelClock {
  now: string
}

export interface ProcedureRunKernelMatch {
  stepId?: string
  actionId?: string
}

export type ProcedureRunKernelEvent =
  | {
    type: 'finalize'
    status: Extract<ProcedureRunKernelStatus, 'completed' | 'cancelled'>
    basedOnInputEpoch: number
    summary?: string
  }
  | {
    type: 'human_handoff_finalized'
    taskId?: string
    queue?: string
    match?: ProcedureRunKernelMatch | null
  }

export interface ProcedureRunKernelTimelineEffect {
  type: 'timeline'
  origin: 'system'
  source: 'tool_result' | 'control'
  basedOnInputEpoch?: number
  summary: string
  metadata: Record<string, unknown>
}

export interface ProcedureRunKernelCompletedEffect {
  type: 'completed_run'
  runId: string
  status: Extract<ProcedureRunKernelStatus, 'completed' | 'cancelled'>
  outcome?: string | null
}

export type ProcedureRunKernelEffect =
  | ProcedureRunKernelTimelineEffect
  | ProcedureRunKernelCompletedEffect

export interface ProcedureRunKernelResult<TState extends ProcedureRunKernelState> {
  state: TState
  effects: ProcedureRunKernelEffect[]
}

export function applyProcedureRunEvent<TState extends ProcedureRunKernelState>(
  state: TState,
  event: ProcedureRunKernelEvent,
  clock: ProcedureRunKernelClock,
): ProcedureRunKernelResult<TState> {
  const next = cloneProcedureRunState(state)
  switch (event.type) {
    case 'finalize':
      return applyFinalizeEvent(next, event, clock)
    case 'human_handoff_finalized':
      return applyHumanHandoffFinalizedEvent(next, event, clock)
    default:
      return exhaustive(event)
  }
}

function applyFinalizeEvent<TState extends ProcedureRunKernelState>(
  state: TState,
  event: Extract<ProcedureRunKernelEvent, { type: 'finalize' }>,
  clock: ProcedureRunKernelClock,
): ProcedureRunKernelResult<TState> {
  state.status = event.status
  state.updatedAt = clock.now

  return {
    state,
    effects: [
      {
        type: 'timeline',
        origin: 'system',
        source: 'tool_result',
        basedOnInputEpoch: event.basedOnInputEpoch,
        summary: event.summary ?? `ProcedureRun ${state.status}`,
        metadata: { terminal: true, evidenceState: 'canonical' },
      },
      {
        type: 'completed_run',
        runId: state.runId,
        status: state.status,
        outcome: state.outcome,
      },
    ],
  }
}

function applyHumanHandoffFinalizedEvent<TState extends ProcedureRunKernelState>(
  state: TState,
  event: Extract<ProcedureRunKernelEvent, { type: 'human_handoff_finalized' }>,
  clock: ProcedureRunKernelClock,
): ProcedureRunKernelResult<TState> {
  const match = findKernelMatch(state, event.match)

  if (match?.step) {
    completeHandoffStep(state, match.step, match.action, event.taskId, clock.now)
  }

  state.blockers = []
  state.status = 'completed'
  state.currentStepId = null
  state.reason = event.taskId
    ? `Finalized after human handoff task ${event.taskId}.`
    : 'Finalized after human handoff.'
  state.outcome = 'handed_off'
  state.updatedAt = clock.now

  return {
    state,
    effects: [
      {
        type: 'timeline',
        origin: 'system',
        source: 'control',
        basedOnInputEpoch: state.inputEpoch,
        summary: event.taskId
          ? `ProcedureRun finalized after human handoff task ${event.taskId}`
          : 'ProcedureRun finalized after human handoff',
        metadata: {
          terminal: true,
          handoffFinalized: true,
          taskId: event.taskId,
          queue: event.queue,
          persisted: true,
          outcome: 'handed_off',
        },
      },
      {
        type: 'completed_run',
        runId: state.runId,
        status: 'completed',
        outcome: 'handed_off',
      },
    ],
  }
}

function completeHandoffStep(
  state: ProcedureRunKernelState,
  step: ProcedureRunKernelStep,
  action: ProcedureRunKernelAction | undefined,
  taskId: string | undefined,
  now: string,
): void {
  const handoffActionId = action?.id
  const matchedBranchId = action?.branchId ?? step.branches?.find((branch) => branch.status === 'matched')?.id

  for (const candidate of step.actions ?? []) {
    clearKernelBlocker(state, `action:${candidate.id}`)
    if (candidate.id === handoffActionId) {
      candidate.status = 'completed'
      continue
    }
    if (candidate.status !== 'completed') {
      candidate.status = 'skipped'
    }
  }

  if (matchedBranchId) {
    for (const branch of step.branches ?? []) {
      if (branch.id === matchedBranchId) {
        branch.status = 'matched'
        branch.reason = branch.reason || 'Persisted human handoff evidence observed.'
      } else {
        branch.status = 'skipped'
        branch.reason = 'Another branch already matched.'
      }
    }
  }

  step.status = 'completed'
  step.completedAt = now
  step.completionReason = taskId
    ? `Persisted human handoff task ${taskId} created.`
    : 'Persisted human handoff created.'
}

function findKernelMatch(
  state: ProcedureRunKernelState,
  match?: ProcedureRunKernelMatch | null,
): { step: ProcedureRunKernelStep; action?: ProcedureRunKernelAction } | null {
  if (!match?.stepId) return null
  const step = state.steps.find((candidate) => candidate.id === match.stepId)
  if (!step) return null
  const action = match.actionId
    ? step.actions?.find((candidate) => candidate.id === match.actionId)
    : undefined
  return { step, action }
}

function clearKernelBlocker(state: ProcedureRunKernelState, key: string): void {
  state.blockers = state.blockers.filter((entry) => !entry.startsWith(`[${key}] `))
}

function cloneProcedureRunState<TState extends ProcedureRunKernelState>(state: TState): TState {
  return JSON.parse(JSON.stringify(state)) as TState
}

function exhaustive(value: never): never {
  throw new Error(`Unhandled ProcedureRun kernel event: ${JSON.stringify(value)}`)
}

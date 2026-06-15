/**
 * session-store.ts — Runtime session registry for Agent loops.
 *
 * Architecture (inspired by Claude Code's single-process runtime model):
 *   GET /api/cases/[caseId]/stream  → opens a long-lived SSE, runs a sessionLoop()
 *                                     that awaits messages from the queue and calls
 *                                     agentLoop.run() for each.
 *   POST /api/cases/[caseId]/message → enqueues a message; returns 200 immediately.
 *
 * Key design:
 *   - MessageQueue handles the race between POST (enqueue) and SSE (dequeue).
 *     If POST fires before SSE loop calls dequeue(), the message is buffered.
 *     If SSE loop is already waiting, it's notified immediately.
 *   - Sessions are kept in a WeakRef-free Map with a TTL; a periodic cleanup
 *     evicts idle sessions after preserving durable ProcedureRun state.
 *   - ProcedureRun state is write-through durable: Postgres is the restart
 *     boundary, while this module remains the in-process cache/queue adapter.
 *
 * R3/M2 boundary:
 *   ProcedureRun state must not be persisted through ChatMemory/UserProfile or
 *   public memory APIs. Durable authority is the ProcedureRun table introduced
 *   by consolidation M2; in-memory state is an adapter cache only.
 */

import type { AgentLoop } from './loop'
import type {
  ProcedureRuntimeSignal,
  ProcedureV2,
  ProcedureV2Action,
  ProcedureV2Branch,
  ProcedureV2Step,
} from '@intera/shared/types'
import {
  buildProcedureConditionLabel,
} from '@intera/shared/contracts/case-types'
import {
  applyProcedureRunEvent,
  type ProcedureRunKernelEffect,
  type ProcedureRunKernelMatch,
} from '@intera/runtime-core/procedure-run-kernel'
import {
  enqueueCaseInputEpochPersist,
  enqueueProcedureRunPersist,
  flushProcedureRunPersistence,
  loadProcedureRuntime,
  setProcedureRunPersistenceForTest,
  type PersistedProcedureRunRecord,
  type ProcedureRunPersistenceAdapter,
} from './procedure-run-persistence'
import { MessageQueue } from './session-queue'
import type {
  QueuedMessage,
  QueuedMessageInput,
  RuntimeEvent,
  RuntimeEventOrigin,
  RuntimeEventSource,
} from './session-queue'
export { MessageQueue } from './session-queue'
export type {
  QueuedMessage,
  QueuedMessageInput,
  RuntimeEvent,
  RuntimeEventOrigin,
  RuntimeEventSource,
} from './session-queue'
export {
  flushProcedureRunPersistence,
  setProcedureRunPersistenceForTest,
} from './procedure-run-persistence'
import type {
  PendingProcedureLlmEvaluation,
  ProcedureConditionEvaluationDecision,
  ProcedureRunActionState,
  ProcedureRunBranchState,
  ProcedureRunConditionEvaluationState,
  ProcedureRunEvidenceState,
  ProcedureRunInputState,
  ProcedureRunSignalState,
  ProcedureRunState,
  ProcedureRunStatus,
  ProcedureRunStepState,
  ProcedureRuntimeState,
  ProcedureStepStatus,
} from './procedure-run-state'
export type {
  PendingProcedureLlmEvaluation,
  ProcedureConditionEvaluationDecision,
  ProcedureRunActionState,
  ProcedureRunBranchState,
  ProcedureRunConditionEvaluationState,
  ProcedureRunEvidenceState,
  ProcedureRunInputState,
  ProcedureRunSignalState,
  ProcedureRunState,
  ProcedureRunStatus,
  ProcedureRunStepState,
  ProcedureRuntimeState,
  ProcedureStepStatus,
} from './procedure-run-state'

// ─── CaseSession ─────────────────────────────────────────────────────────────

export interface CaseSession {
  caseId: string
  sessionId: string
  agentConfigId?: string | null
  /** Populated after AgentLoop.create() resolves inside the SSE handler. */
  loop: AgentLoop | null
  /** True once the SSE handler has started its session loop. */
  initialized: boolean
  /** True once the agent loop has completed (case resolved/escalated). */
  resolved: boolean
  queue: MessageQueue
  latestInputEpoch: number
  runtimeEvents: RuntimeEvent[]
  procedureRuntime: ProcedureRuntimeState
  procedureRuntimeHydrated: boolean
  aborted: boolean
  lastActiveAt: number
}

export type { ProcedureRunPersistenceAdapter }

// ─── Registry ────────────────────────────────────────────────────────────────

const sessions = new Map<string, CaseSession>()

/** TTL for idle sessions (30 minutes). */
const SESSION_TTL_MS = 30 * 60 * 1000

/**
 * Return the existing session for caseId, or create a new one.
 * Called by both the SSE route (first consumer) and the POST route (first producer).
 */
export function getOrCreateSession(caseId: string): CaseSession {
  const existing = sessions.get(caseId)
  if (existing) return existing

  const session = createSession(caseId)
  sessions.set(caseId, session)
  return session
}

export function bindProcedureRuntimeAgentConfig(caseId: string, agentConfigId?: string | null): CaseSession {
  const session = getOrCreateSession(caseId)
  if (agentConfigId) session.agentConfigId = agentConfigId
  return session
}

export async function hydrateProcedureRuntime(
  caseId: string,
  options: { agentConfigId?: string | null } = {},
): Promise<CaseSession> {
  const session = bindProcedureRuntimeAgentConfig(caseId, options.agentConfigId)
  if (session.procedureRuntimeHydrated) return session

  const hydrated = await loadProcedureRuntime(caseId)
  session.latestInputEpoch = Math.max(session.latestInputEpoch, hydrated.latestInputEpoch)
  const runs = hydrated.runs
    .map(hydratePersistedRun)
    .map(normalizeHydratedRun)
    .filter((run): run is ProcedureRunState => !!run)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  const activeRuns = runs.filter((run) => run.status === 'active')
  const pausedRuns = runs.filter((run) => run.status === 'paused')
  const completedRuns = runs.filter((run) => run.status !== 'active' && run.status !== 'paused')
  const active = activeRuns[0]
  session.procedureRuntime = {
    activeProcedureRun: active,
    pausedProcedureRuns: [
      ...activeRuns.slice(1).map((run) => ({ ...run, status: 'paused' as const })),
      ...pausedRuns,
    ],
    completedProcedureRuns: completedRuns,
  }
  session.procedureRuntimeHydrated = true
  return session
}

/**
 * Enqueue a message for an existing session.
 * Returns false if the session doesn't exist or is aborted.
 */
export function enqueueMessage(caseId: string, msg: QueuedMessageInput): boolean {
  const session = sessions.get(caseId)
  if (!session || session.aborted) return false
  session.lastActiveAt = Date.now()
  const event = normalizeQueuedMessage(session, msg)
  session.runtimeEvents.push(event)
  appendInputEventToActiveRun(session, event)
  session.queue.enqueue(event)
  return true
}

/**
 * Enqueue a message, creating the session if it doesn't exist yet.
 * Used when POST arrives before SSE opens (race condition on first message).
 * The SSE handler calls getOrCreateSession() which will find the pre-created entry.
 */
export function enqueueMessageOrCreate(caseId: string, msg: QueuedMessageInput): CaseSession {
  let session = sessions.get(caseId)
  if (!session) {
    session = createSession(caseId)
    sessions.set(caseId, session)
  }
  session.lastActiveAt = Date.now()
  const event = normalizeQueuedMessage(session, msg)
  session.runtimeEvents.push(event)
  appendInputEventToActiveRun(session, event)
  session.queue.enqueue(event)
  return session
}

/** Record the initial request message before AgentLoop starts, without queueing it. */
export function recordInitialInputEvent(
  caseId: string,
  msg: QueuedMessageInput,
): QueuedMessage {
  const session = getOrCreateSession(caseId)
  session.lastActiveAt = Date.now()
  const event = normalizeQueuedMessage(session, msg)
  session.runtimeEvents.push(event)
  appendInputEventToActiveRun(session, event)
  return event
}

export function appendRuntimeEvent(
  caseId: string,
  input: Omit<Partial<RuntimeEvent>, 'eventId' | 'createdAt' | 'enqueuedAt' | 'caseId' | 'sessionId'> & {
    origin: RuntimeEventOrigin
    source: RuntimeEventSource
  },
): RuntimeEvent {
  const session = getOrCreateSession(caseId)
  const event = createRuntimeEvent({
    ...input,
    caseId,
    sessionId: session.sessionId,
    inputEpoch: input.inputEpoch ?? session.latestInputEpoch,
    runId: input.runId ?? session.procedureRuntime.activeProcedureRun?.runId,
    priority: input.priority ?? defaultPriority(input.source),
    enqueuePolicy: input.enqueuePolicy ?? 'fifo',
  })
  session.runtimeEvents.push(event)
  const active = session.procedureRuntime.activeProcedureRun
  if (active) {
    active.timeline.push(event)
    active.updatedAt = event.createdAt
    active.inputEpoch = session.latestInputEpoch
    scheduleRunPersist(session, active)
  }
  session.lastActiveAt = Date.now()
  return event
}

export function latestInputEpoch(caseId: string): number {
  return sessions.get(caseId)?.latestInputEpoch ?? 0
}

export function getRuntimeEvents(caseId: string): RuntimeEvent[] {
  return [...(sessions.get(caseId)?.runtimeEvents ?? [])]
}

export function getProcedureRuntime(caseId: string): ProcedureRuntimeState {
  const state = getOrCreateSession(caseId).procedureRuntime
  return {
    activeProcedureRun: state.activeProcedureRun ? cloneRun(state.activeProcedureRun) : undefined,
    pausedProcedureRuns: state.pausedProcedureRuns.map(cloneRun),
    completedProcedureRuns: state.completedProcedureRuns.map(cloneRun),
  }
}

export function getActiveProcedureRun(caseId: string): ProcedureRunState | undefined {
  const active = sessions.get(caseId)?.procedureRuntime.activeProcedureRun
  return active ? cloneRun(active) : undefined
}

export function getPendingProcedureLlmEvaluations(caseId: string): PendingProcedureLlmEvaluation[] {
  const run = sessions.get(caseId)?.procedureRuntime.activeProcedureRun
  if (!run || run.definition?.version !== 'v2') return []
  const step = currentStep(run)
  if (!step?.branches?.length || !run.definition) return []
  const matchedBranchId = step.branches.find((branch) => branch.status === 'matched')?.id

  const pending: PendingProcedureLlmEvaluation[] = []
  for (const branch of step.branches) {
    if (matchedBranchId && branch.id !== matchedBranchId) continue
    const branchDefinition = findBranchDefinition(run, branch.id)
    const condition = branchDefinition?.condition
    if (!condition || condition.kind !== 'llm_eval') continue
    const conditionId = condition.id ?? branch.id
    const latest = latestConditionEvaluation(run, branch.id, conditionId)
    if (latest && latest.basedOnInputEpoch >= run.inputEpoch && (latest.decision === 'matched' || latest.decision === 'skipped')) {
      continue
    }
    pending.push({
      caseId,
      runId: run.runId,
      procedureId: run.procedureId,
      procedureDisplayName: run.displayName,
      stepId: step.id,
      stepTitle: step.title,
      branchId: branch.id,
      branchLabel: branch.conditionLabel || branch.label,
      conditionId,
      prompt: condition.prompt,
      basedOnInputEpoch: run.inputEpoch,
      recentInputs: run.inputs.slice(-6).map((entry) => ({
        ...entry,
        formAnswers: entry.formAnswers ? { ...entry.formAnswers } : undefined,
      })),
      recentEvidence: run.evidence.slice(-8).map((entry) => ({
        ...entry,
        metadata: entry.metadata ? { ...entry.metadata } : undefined,
      })),
    })
  }
  return pending
}

export function recordProcedureConditionEvaluation(caseId: string, input: {
  runId: string
  branchId: string
  conditionId: string
  label: string
  decision: ProcedureConditionEvaluationDecision
  reason: string
  basedOnInputEpoch: number
  model?: string
  metadata?: Record<string, unknown>
}): { ok: boolean; run?: ProcedureRunState; error?: string } {
  const session = sessions.get(caseId)
  const run = session?.procedureRuntime.activeProcedureRun
  if (!session || !run || run.runId !== input.runId) {
    return { ok: false, error: 'No matching active ProcedureRun.' }
  }

  const now = new Date().toISOString()
  const evaluation: ProcedureRunConditionEvaluationState = {
    id: `eval:${input.branchId}:${input.conditionId}:${input.basedOnInputEpoch}`,
    branchId: input.branchId,
    conditionId: input.conditionId,
    label: input.label,
    decision: input.decision,
    reason: input.reason,
    basedOnInputEpoch: input.basedOnInputEpoch,
    model: input.model,
    createdAt: now,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  }
  const existingIndex = run.evaluations.findIndex((entry) =>
    entry.branchId === input.branchId &&
    entry.conditionId === input.conditionId &&
    entry.basedOnInputEpoch === input.basedOnInputEpoch,
  )
  if (existingIndex >= 0) {
    run.evaluations[existingIndex] = evaluation
  } else {
    run.evaluations.push(evaluation)
  }

  upsertEvidence(run, {
    id: evaluation.id,
    kind: 'evaluator',
    branchId: input.branchId,
    label: `${input.label}: ${input.decision}`,
    basedOnInputEpoch: input.basedOnInputEpoch,
    state: 'canonical',
    createdAt: now,
    metadata: {
      decision: input.decision,
      reason: input.reason,
      model: input.model,
      ...(input.metadata ?? {}),
    },
  })
  clearRunBlocker(run, `eval:${input.branchId}`)
  if (input.decision === 'error' || input.decision === 'pending') {
    setRunBlocker(
      run,
      `eval:${input.branchId}`,
      input.reason || `${input.label} is not ready yet.`,
    )
  }
  appendProcedureTimeline(session, run, {
    origin: 'system',
    source: 'evaluator',
    basedOnInputEpoch: input.basedOnInputEpoch,
    summary: `Procedure llm_eval ${input.decision}: ${input.label}`,
    metadata: {
      branchId: input.branchId,
      conditionId: input.conditionId,
      decision: input.decision,
      reason: input.reason,
      model: input.model,
    },
  })
  const step = currentStep(run) ?? run.steps[0]
  if (step) refreshStepBranchStates(run, step)
  syncCurrentStepAfterProgress(run, now)
  scheduleRunPersist(session, run)
  return { ok: true, run: cloneRun(run) }
}

export function startProcedureRun(caseId: string, input: {
  agentConfigId?: string
  procedureId: string
  displayName: string
  procedure?: ProcedureV2
  reason?: string
  confidence?: number
  requestId?: string
  currentProcedureAction?: 'pause' | 'complete' | 'abandon'
}): { run: ProcedureRunState; idempotent: boolean; pausedRun?: ProcedureRunState } {
  const session = getOrCreateSession(caseId)
  const now = new Date().toISOString()
  const state = session.procedureRuntime
  const active = state.activeProcedureRun

  if (
    active &&
    active.procedureId === input.procedureId &&
    (input.requestId == null || active.lastStartRequestId === input.requestId || active.status === 'active')
  ) {
    active.lastStartRequestId = input.requestId ?? active.lastStartRequestId
    active.reason = input.reason ?? active.reason
    active.confidence = input.confidence ?? active.confidence
    active.updatedAt = now
    appendProcedureTimeline(session, active, {
      origin: 'system',
      source: 'tool_call',
      summary: `start_procedure idempotent for ${input.procedureId}`,
      metadata: { idempotent: true, requestId: input.requestId },
    })
    scheduleRunPersist(session, active)
    return { run: cloneRun(active), idempotent: true }
  }

  let pausedRun: ProcedureRunState | undefined
  if (active && active.procedureId !== input.procedureId) {
    active.status = input.currentProcedureAction === 'complete'
      ? 'completed'
      : input.currentProcedureAction === 'abandon'
        ? 'cancelled'
        : 'paused'
    active.updatedAt = now
    appendProcedureTimeline(session, active, {
      origin: 'system',
      source: 'tool_call',
      summary: `Procedure ${active.procedureId} ${active.status} before starting ${input.procedureId}`,
      metadata: { currentProcedureAction: input.currentProcedureAction ?? 'pause' },
    })
    if (active.status === 'paused') {
      state.pausedProcedureRuns.push(active)
      pausedRun = active
    } else {
      state.completedProcedureRuns.push(active)
    }
    scheduleRunPersist(session, active)
    state.activeProcedureRun = undefined
  }

  const resumedIndex = state.pausedProcedureRuns.findIndex((run) => run.procedureId === input.procedureId)
  const resumed = resumedIndex >= 0 ? state.pausedProcedureRuns.splice(resumedIndex, 1)[0] : undefined
  const run: ProcedureRunState = resumed
    ? {
        ...resumed,
        agentConfigId: input.agentConfigId ?? session.agentConfigId ?? resumed.agentConfigId,
        status: 'active',
        inputEpoch: session.latestInputEpoch,
        reason: input.reason ?? resumed.reason,
        confidence: input.confidence ?? resumed.confidence,
        updatedAt: now,
        lastStartRequestId: input.requestId ?? resumed.lastStartRequestId,
        definition: resumed.definition ?? input.procedure,
      }
    : {
        runId: `proc_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        agentConfigId: input.agentConfigId ?? session.agentConfigId ?? undefined,
        procedureId: input.procedureId,
        caseType: input.procedureId,
        displayName: input.displayName,
        status: 'active',
        inputEpoch: session.latestInputEpoch,
        lastReconciledInputEpoch: session.latestInputEpoch,
        needsReconcile: false,
        currentStepId: null,
        steps: buildInitialSteps(input.procedure),
        inputs: [],
        evidenceToolCallIds: [],
        evidence: [],
        evaluations: [],
        signals: [],
        blockers: [],
        timeline: [],
        definition: input.procedure,
        reason: input.reason,
        confidence: input.confidence,
        currentProcedureAction: input.currentProcedureAction,
        startedAt: now,
        updatedAt: now,
        lastStartRequestId: input.requestId,
      }
  if (!run.currentStepId) {
    const first = run.steps.find((step) => step.status === 'pending') ?? run.steps[0]
    if (first) {
      first.status = 'active'
      first.startedAt = first.startedAt ?? now
      run.currentStepId = first.id
    }
  }
  seedRunInputsFromRuntime(session, run)
  state.activeProcedureRun = run
  appendProcedureTimeline(session, run, {
    origin: 'system',
    source: 'tool_call',
    summary: `${resumed ? 'Resumed' : 'Started'} ProcedureRun ${run.procedureId}`,
    metadata: { requestId: input.requestId, idempotent: false },
  })
  scheduleRunPersist(session, run)
  return { run: cloneRun(run), idempotent: false, pausedRun: pausedRun ? cloneRun(pausedRun) : undefined }
}

export function recordProcedureToolCall(caseId: string, input: {
  toolName: string
  toolUseId?: string
  basedOnInputEpoch?: number
  toolInput?: unknown
}): RuntimeEvent | null {
  const session = sessions.get(caseId)
  const run = session?.procedureRuntime.activeProcedureRun
  if (!session || !run) return null
  const event = appendProcedureTimeline(session, run, {
    origin: 'system',
    source: 'tool_call',
    basedOnInputEpoch: input.basedOnInputEpoch ?? session.latestInputEpoch,
    summary: `Tool call started: ${input.toolName}`,
    metadata: {
      toolName: input.toolName,
      toolUseId: input.toolUseId,
      input: input.toolInput,
      evidenceState: 'canonical',
    },
  })
  scheduleRunPersist(session, run)
  return event
}

export function recordProcedureToolResult(caseId: string, input: {
  toolName: string
  toolUseId?: string
  basedOnInputEpoch?: number
  toolOutput?: unknown
  toolError?: string
  isKnowledgeTool?: boolean
}): { stale: boolean; run?: ProcedureRunState } {
  const session = sessions.get(caseId)
  const run = session?.procedureRuntime.activeProcedureRun
  if (!session || !run) return { stale: false }

  const basedOn = input.basedOnInputEpoch ?? session.latestInputEpoch
  const stale = basedOn < session.latestInputEpoch

  if (stale) {
    run.needsReconcile = true
    run.blockers = [...new Set([...run.blockers, 'New customer input arrived after this tool/action began.'])]
  }

  const isKnowledgeTool = isKnowledgeToolForSession(session, input)
  const assessment = assessProcedureToolOutcome(
    input.toolName,
    input.toolOutput,
    input.toolError,
    isKnowledgeTool,
  )
  const recordedAt = new Date().toISOString()
  applyToolEvidenceToRun(session, run, input, stale, basedOn, recordedAt, assessment, isKnowledgeTool)
  const stillActive = session.procedureRuntime.activeProcedureRun?.runId === run.runId
  if (stillActive) {
    syncCurrentStepAfterProgress(run)
    refreshNoProgressSignal(run)
  }
  const usableForProgress = !stale && assessment.outcome === 'succeeded'
  appendProcedureTimeline(session, run, {
    origin: 'system',
    source: 'tool_result',
    basedOnInputEpoch: basedOn,
    summary: stale
      ? `Tool result stored as stale evidence: ${input.toolName}`
      : usableForProgress
        ? `Tool result accepted: ${input.toolName}`
        : `Tool result kept as blocking evidence: ${input.toolName}`,
    metadata: {
      toolName: input.toolName,
      toolUseId: input.toolUseId,
      output: input.toolOutput,
      error: input.toolError,
      outcome: stale ? 'stale' : assessment.outcome,
      evidenceState: stale ? 'stale' : 'canonical',
      usableForProgress,
    },
  })
  scheduleRunPersist(session, run)
  return { stale, run: cloneRun(run) }
}

export function recordProcedureTextReply(caseId: string, input: {
  text: string
  basedOnInputEpoch?: number
  alreadyStreamed?: boolean
}): { stale: boolean; blockedReason?: string; run?: ProcedureRunState } {
  const session = sessions.get(caseId)
  const run = session?.procedureRuntime.activeProcedureRun
  if (!session || !run) return { stale: false }
  const basedOn = input.basedOnInputEpoch ?? session.latestInputEpoch
  const stale = basedOn < session.latestInputEpoch
  const recordedAt = new Date().toISOString()
  let blockedReason: string | undefined
  if (stale) {
    run.needsReconcile = true
    run.blockers = [...new Set([...run.blockers, 'A customer-visible reply was based on stale input.'])]
  }
  if (!stale && promisesHumanHandoff(input.text) && !hasPersistedHandoffEvidence(run)) {
    blockedReason = 'A customer-facing human-handoff promise was drafted before create_human_task produced persisted evidence.'
    run.blockers = [...new Set([...run.blockers, blockedReason])]
  }
  upsertEvidence(run, {
    id: `text:${recordedAt}:${basedOn}`,
    kind: 'text_reply',
    label: stale
      ? 'Stale customer-facing reply withheld'
      : blockedReason
        ? 'Unsafe human-handoff promise withheld'
        : 'Customer-facing reply drafted',
    state: stale || blockedReason ? 'stale' : 'canonical',
    createdAt: recordedAt,
    basedOnInputEpoch: basedOn,
    metadata: {
      textPreview: input.text.slice(0, 240),
      alreadyStreamed: input.alreadyStreamed === true,
      blockedReason,
    },
  })
  appendProcedureTimeline(session, run, {
    origin: 'system',
    source: 'text_reply',
    basedOnInputEpoch: basedOn,
    summary: stale
      ? `Stale text reply${input.alreadyStreamed ? ' already streamed' : ''}`
      : blockedReason
        ? 'Unsafe human-handoff promise withheld'
        : `Current text reply${input.alreadyStreamed ? ' already streamed' : ''}`,
    metadata: {
      textPreview: input.text.slice(0, 240),
      evidenceState: stale || blockedReason ? 'stale' : 'canonical',
      alreadyStreamed: input.alreadyStreamed === true,
      blockedReason,
    },
  })
  scheduleRunPersist(session, run)
  return { stale, blockedReason, run: cloneRun(run) }
}

export function reconcileProcedureInput(caseId: string, input: {
  runId: string
  upToInputEpoch: number
  decision: string
  summary: string
}): { ok: boolean; cleared: boolean; run?: ProcedureRunState; error?: string } {
  const session = sessions.get(caseId)
  const run = session?.procedureRuntime.activeProcedureRun
  if (!session || !run || run.runId !== input.runId) {
    return { ok: false, cleared: false, error: 'No matching active ProcedureRun.' }
  }
  run.lastReconciledInputEpoch = Math.max(run.lastReconciledInputEpoch, input.upToInputEpoch)
  const cleared = input.upToInputEpoch >= session.latestInputEpoch
  if (cleared) {
    run.needsReconcile = false
    run.blockers = run.blockers.filter((blocker) => !blocker.toLowerCase().includes('input'))
  }
  appendProcedureTimeline(session, run, {
    origin: 'system',
    source: 'reconcile',
    summary: input.summary,
    metadata: {
      decision: input.decision,
      upToInputEpoch: input.upToInputEpoch,
      cleared,
      memoryWrite: false,
    },
  })
  scheduleRunPersist(session, run)
  return { ok: true, cleared, run: cloneRun(run) }
}

export function finalizeProcedureRun(caseId: string, input: {
  runId?: string
  status?: 'completed' | 'cancelled'
  basedOnInputEpoch?: number
  summary?: string
}): { ok: boolean; stale: boolean; run?: ProcedureRunState; error?: string } {
  const session = sessions.get(caseId)
  const run = session?.procedureRuntime.activeProcedureRun
  if (!session || !run) return { ok: false, stale: false, error: 'No active ProcedureRun.' }
  if (input.runId && input.runId !== run.runId) return { ok: false, stale: false, error: 'runId does not match active ProcedureRun.' }
  const basedOn = input.basedOnInputEpoch ?? session.latestInputEpoch
  const stale = basedOn < session.latestInputEpoch || run.needsReconcile
  if (stale) {
    run.needsReconcile = true
    appendProcedureTimeline(session, run, {
      origin: 'system',
      source: 'tool_result',
      basedOnInputEpoch: basedOn,
      summary: 'finalize_procedure blocked because the ProcedureRun needs reconciliation',
      metadata: { evidenceState: 'stale', terminal: true },
    })
    scheduleRunPersist(session, run)
    return { ok: false, stale: true, run: cloneRun(run), error: 'Reconcile latest customer messages before finalizing.' }
  }
  const finalizeBlockers = finalizationBlockers(run)
  if (finalizeBlockers.length > 0) {
    run.blockers = [...new Set([...run.blockers, ...finalizeBlockers])]
    appendProcedureTimeline(session, run, {
      origin: 'system',
      source: 'tool_result',
      basedOnInputEpoch: basedOn,
      summary: 'finalize_procedure blocked because the ProcedureRun is incomplete or has unresolved blockers',
      metadata: {
        evidenceState: 'canonical',
        terminal: true,
        blockers: finalizeBlockers,
      },
    })
    scheduleRunPersist(session, run)
    return {
      ok: false,
      stale: false,
      run: cloneRun(run),
      error: finalizeBlockers[0],
    }
  }
  const transition = applyProcedureRunEvent(run, {
    type: 'finalize',
    status: input.status ?? 'completed',
    basedOnInputEpoch: basedOn,
    summary: input.summary,
  }, {
    now: new Date().toISOString(),
  })
  applyProcedureRunKernelState(run, transition.state)
  appendProcedureRunKernelEffects(session, run, transition.effects)
  session.procedureRuntime.completedProcedureRuns.push(run)
  session.procedureRuntime.activeProcedureRun = undefined
  scheduleRunPersist(session, run)
  return { ok: true, stale: false, run: cloneRun(run) }
}

function findLatestPersistedHandoffEvidence(
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

function findHandoffMatch(
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

export async function confirmProcedureHumanHandoff(caseId: string, input?: {
  agentConfigId?: string
  taskId?: string
  queue?: string
}): Promise<{ ok: boolean; run?: ProcedureRunState; error?: string }> {
  let session = sessions.get(caseId)
  if (!session) {
    await hydrateProcedureRuntime(caseId, { agentConfigId: input?.agentConfigId })
    session = sessions.get(caseId)
  }
  if (!session) return { ok: false, error: 'No ProcedureRun session found.' }

  const candidates = [
    ...(session.procedureRuntime.activeProcedureRun ? [session.procedureRuntime.activeProcedureRun] : []),
    ...session.procedureRuntime.pausedProcedureRuns,
  ]
  const run = candidates
    .filter((candidate) => candidate.outcome !== 'handed_off')
    .find((candidate) => findLatestPersistedHandoffEvidence(candidate, input?.taskId))

  if (!run) return { ok: false, error: 'No pending human handoff ProcedureRun found.' }

  const evidence = findLatestPersistedHandoffEvidence(run, input?.taskId)
  const match = evidence ? findHandoffMatch(run, evidence) : null
  const persistedOutput = isRecord(evidence?.metadata?.output) ? evidence.metadata.output : {}
  const createdAt = new Date().toISOString()

  finalizeRunForHumanHandoff(session, run, match, createdAt, {
    ...persistedOutput,
    ...(input?.taskId ? { taskId: input.taskId } : {}),
    ...(input?.queue ? { queue: input.queue } : {}),
    persisted: true,
  })
  scheduleRunPersist(session, run)
  return { ok: true, run: cloneRun(run) }
}

export function procedureRunPromptTail(caseId: string): string {
  const state = sessions.get(caseId)?.procedureRuntime
  if (!state?.activeProcedureRun && !state?.pausedProcedureRuns.length) return ''
  const lines: string[] = [
    '<procedure_run_runtime>',
    'This block is dynamic runtime context. It is not chat memory or user profile.',
    'ProcedureRunState is the canonical authority for active/paused runs, currentStepId, inputEpoch, branch state, evidence, and reconcile requirements.',
  ]
  const renderRun = (run: ProcedureRunState, label: string) => {
    lines.push('')
    lines.push(`## ${label}: ${run.displayName} (${run.procedureId})`)
    lines.push(`- runId: ${run.runId}`)
    lines.push(`- status: ${run.status}`)
    lines.push(`- inputEpoch: ${run.inputEpoch}`)
    lines.push(`- lastReconciledInputEpoch: ${run.lastReconciledInputEpoch}`)
    lines.push(`- needsReconcile: ${run.needsReconcile}`)
    lines.push(`- currentStepId: ${run.currentStepId ?? 'none'}`)
    const activeSignals = run.signals.filter((signal) => signal.active)
    if (activeSignals.length) {
      lines.push(`- activeSafetyHints: ${activeSignals.map((signal) => signal.signal).join(', ')}`)
      for (const signal of activeSignals) {
        lines.push(`  safety_hint ${signal.signal}: ${signal.reason}`)
      }
    }
    if (run.inputs.length) {
      lines.push('')
      lines.push('Recent structured inputs:')
      for (const entry of run.inputs.slice(-6)) {
        const content = entry.content?.trim()
        const form = entry.formAnswers && Object.keys(entry.formAnswers).length > 0
          ? ` form=${JSON.stringify(entry.formAnswers)}`
          : ''
        lines.push(`- [epoch ${entry.inputEpoch}] ${entry.source}${form}${content ? ` content=${JSON.stringify(content.slice(0, 240))}` : ''}`)
      }
    }
    if (run.needsReconcile) {
      lines.push('')
      lines.push('New customer messages arrived after the last tool/action began. Before calling another tool or finalizing, call reconcile_procedure_input with the active runId and latest inputEpoch.')
      const unreconciled = run.timeline.filter((event) =>
        event.inputEpoch > run.lastReconciledInputEpoch &&
        (event.source === 'customer_message' || event.source === 'customer_form_result' || event.source === 'human_task_result')
      )
      if (unreconciled.length) {
        lines.push('Unreconciled input events:')
        for (const event of unreconciled.slice(-6)) {
          lines.push(`- [epoch ${event.inputEpoch}] ${event.source}: ${event.summary || event.content || '(no content)'}`)
        }
      }
    }
    if (run.blockers.length) {
      lines.push('')
      lines.push('Open blockers:')
      for (const blocker of run.blockers.slice(-8)) {
        lines.push(`- ${blocker}`)
      }
    }
    if (run.steps.length) {
      lines.push('')
      lines.push('Steps:')
      for (const step of run.steps) {
        const evidence = step.evidenceToolCallIds.length ? ` evidence=${step.evidenceToolCallIds.join(',')}` : ''
        const title = step.title ? ` title=${JSON.stringify(step.title)}` : ''
        lines.push(`- ${step.id}: ${step.status}${title}${evidence}`)
        if (step.actions?.length) {
          for (const action of step.actions) {
            const branch = action.branchId ? ` branch=${action.branchId}` : ''
            const actionTarget = action.target ? ` target=${action.target}` : ''
            lines.push(`  action ${action.id}: ${action.status} kind=${action.kind}${branch}${actionTarget}`)
          }
        }
        if (step.branches?.length) {
          for (const branch of step.branches) {
            const labelText = branch.conditionLabel || branch.label || branch.kind
            lines.push(`  branch ${branch.id}: ${branch.status} ${labelText}`)
          }
        }
      }
    }
    if (run.evaluations.length) {
      lines.push('')
      lines.push('Evaluator receipts:')
      for (const evaluation of run.evaluations.slice(-8)) {
        const model = evaluation.model ? ` model=${evaluation.model}` : ''
        lines.push(`- branch=${evaluation.branchId} decision=${evaluation.decision} basedOnInputEpoch=${evaluation.basedOnInputEpoch}${model}: ${evaluation.reason}`)
      }
    }
    if (run.evidence.length) {
      lines.push('')
      lines.push('Recent runtime evidence:')
      for (const evidence of run.evidence.slice(-8)) {
        const scope = evidence.stepId ? ` step=${evidence.stepId}` : ''
        const action = evidence.actionId ? ` action=${evidence.actionId}` : ''
        const stateText = ` state=${evidence.state}`
        const outcome = typeof evidence.metadata?.outcome === 'string' ? ` outcome=${evidence.metadata.outcome}` : ''
        lines.push(`- ${evidence.kind}${scope}${action}${stateText}${outcome}: ${evidence.label}`)
      }
    }
    const recent = run.timeline.slice(-8)
    if (recent.length) {
      lines.push('')
      lines.push('Recent runtime timeline:')
      for (const event of recent) {
        const evidence = typeof event.metadata?.evidenceState === 'string' ? ` evidence=${event.metadata.evidenceState}` : ''
        const basedOn = event.basedOnInputEpoch != null ? ` basedOnInputEpoch=${event.basedOnInputEpoch}` : ''
        lines.push(`- ${event.source} epoch=${event.inputEpoch}${basedOn}${evidence}: ${event.summary || event.content || ''}`)
      }
    }
  }
  if (state.activeProcedureRun) renderRun(state.activeProcedureRun, 'Active ProcedureRun')
  for (const run of state.pausedProcedureRuns.slice(-3)) renderRun(run, 'Paused ProcedureRun')
  lines.push('</procedure_run_runtime>')
  return lines.join('\n')
}

/** Mark a session as aborted and remove it from the registry after terminal run state is durable. */
export async function closeSession(caseId: string): Promise<void> {
  const session = sessions.get(caseId)
  if (!session) return

  session.aborted = true
  session.queue.abort()
  const needsDurableFlush = cancelRemainingProcedureRuns(
    session,
    'abandoned',
    'Session closed before ProcedureRun completed.',
  )
  if (needsDurableFlush) {
    await flushProcedureRunPersistence(caseId)
  }
  if (sessions.get(caseId) === session) {
    sessions.delete(caseId)
  }
}

/** Check whether a live session exists for this caseId. */
export function hasSession(caseId: string): boolean {
  const s = sessions.get(caseId)
  return !!s && !s.aborted && !s.resolved
}

// ─── TTL cleanup ──────────────────────────────────────────────────────────────

/** Purge sessions idle longer than SESSION_TTL_MS. Runs every 5 minutes. */
async function cleanupStaleSessions(now = Date.now()): Promise<void> {
  const evictions: Promise<void>[] = []
  for (const [caseId, session] of sessions.entries()) {
    if (now - session.lastActiveAt > SESSION_TTL_MS) {
      console.log(`[SessionStore] Evicting idle session: ${caseId}`)
      session.aborted = true
      session.queue.abort()
      const needsDurableFlush = pauseActiveRunForEviction(session)
      const evict = (needsDurableFlush ? flushProcedureRunPersistence(caseId) : Promise.resolve())
        .then(() => {
          if (sessions.get(caseId) === session) {
            sessions.delete(caseId)
          }
        })
      evictions.push(evict)
    }
  }
  await Promise.all(evictions)
}

export async function cleanupStaleSessionsForTest(now = Date.now()): Promise<void> {
  await cleanupStaleSessions(now)
}

// Only register the interval once per process (module is a singleton).
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    void cleanupStaleSessions()
  }, 5 * 60 * 1000).unref?.()
}

/** Session count — for observability. */
export function sessionCount(): number {
  return sessions.size
}

function createSession(caseId: string): CaseSession {
  return {
    caseId,
    sessionId: `session_${crypto.randomUUID()}`,
    loop: null,
    initialized: false,
    resolved: false,
    queue: new MessageQueue(),
    latestInputEpoch: 0,
    runtimeEvents: [],
    procedureRuntime: { pausedProcedureRuns: [], completedProcedureRuns: [] },
    procedureRuntimeHydrated: false,
    aborted: false,
    lastActiveAt: Date.now(),
  }
}

function normalizeQueuedMessage(session: CaseSession, msg: QueuedMessageInput): QueuedMessage {
  const source = msg.source ?? (msg.formAnswers ? 'customer_form_result' : 'customer_message')
  const inputEpoch = isInputSource(source)
    ? nextInputEpoch(session)
    : session.latestInputEpoch
  return createRuntimeEvent({
    ...msg,
    caseId: session.caseId,
    sessionId: session.sessionId,
    inputEpoch,
    runId: msg.runId ?? session.procedureRuntime.activeProcedureRun?.runId,
    origin: msg.origin ?? 'customer',
    source,
    content: msg.content,
    contentBlocks: msg.contentBlocks,
    formAnswers: msg.formAnswers,
    priority: msg.priority ?? defaultPriority(source),
    enqueuePolicy: msg.enqueuePolicy ?? 'fifo',
  }) as QueuedMessage
}

function appendInputEventToActiveRun(session: CaseSession, event: RuntimeEvent): void {
  const active = session.procedureRuntime.activeProcedureRun ?? resumePausedRunForInput(session, event)
  if (!active || !isInputSource(event.source)) return
  active.timeline.push({ ...event, runId: active.runId })
  active.updatedAt = event.createdAt
  ingestInputIntoRun(active, event)
  scheduleRunPersist(session, active)
}

function createRuntimeEvent(input: Partial<RuntimeEvent> & {
  caseId: string
  sessionId: string
  inputEpoch: number
  origin: RuntimeEventOrigin
  source: RuntimeEventSource
  priority: number
  enqueuePolicy: 'fifo' | 'front' | 'replace'
}): RuntimeEvent {
  const now = new Date().toISOString()
  return {
    eventId: input.eventId ?? crypto.randomUUID(),
    inputEpoch: input.inputEpoch,
    origin: input.origin,
    source: input.source,
    createdAt: input.createdAt ?? now,
    enqueuedAt: input.enqueuedAt ?? now,
    caseId: input.caseId,
    sessionId: input.sessionId,
    runId: input.runId,
    content: input.content,
    contentBlocks: input.contentBlocks,
    formAnswers: input.formAnswers,
    isMeta: input.isMeta ?? false,
    isControl: input.isControl ?? false,
    priority: input.priority,
    enqueuePolicy: input.enqueuePolicy,
    basedOnInputEpoch: input.basedOnInputEpoch,
    summary: input.summary,
    metadata: input.metadata,
  }
}

function nextInputEpoch(session: CaseSession): number {
  session.latestInputEpoch += 1
  scheduleCaseInputEpochPersist(session)
  const active = session.procedureRuntime.activeProcedureRun
  if (active) {
    active.inputEpoch = session.latestInputEpoch
    active.needsReconcile = active.lastReconciledInputEpoch < session.latestInputEpoch
    active.updatedAt = new Date().toISOString()
  }
  return session.latestInputEpoch
}

function isInputSource(source: RuntimeEventSource): boolean {
  return source === 'customer_message' || source === 'customer_form_result' || source === 'human_task_result'
}

export function clearSessionsForTest(caseId?: string): void {
  if (caseId) {
    sessions.delete(caseId)
    return
  }
  sessions.clear()
}

function scheduleCaseInputEpochPersist(session: CaseSession): void {
  enqueueCaseInputEpochPersist(session.caseId, session.latestInputEpoch)
}

function scheduleRunPersist(session: CaseSession, run: ProcedureRunState): void {
  const record = toPersistedProcedureRun(session, run)
  const queueKey = `${session.caseId}:${run.runId}`
  enqueueProcedureRunPersist(queueKey, record)
}

function toPersistedProcedureRun(session: CaseSession, run: ProcedureRunState): PersistedProcedureRunRecord {
  const agentConfigId = run.agentConfigId ?? session.agentConfigId ?? 'unknown'
  run.agentConfigId = agentConfigId
  return {
    id: run.runId,
    caseId: session.caseId,
    agentConfigId,
    procedureId: run.procedureId,
    status: run.status,
    inputEpoch: run.inputEpoch,
    needsReconcile: run.needsReconcile,
    currentStepId: run.currentStepId,
    outcome: run.outcome ?? null,
    state: cloneRun(run),
  }
}

function hydratePersistedRun(record: PersistedProcedureRunRecord): ProcedureRunState | null {
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

function normalizeHydratedRun(run: ProcedureRunState | null): ProcedureRunState | null {
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

function pauseActiveRunForEviction(session: CaseSession): boolean {
  const active = session.procedureRuntime.activeProcedureRun
  if (!active) return false
  active.status = 'paused'
  active.reason = 'session evicted'
  active.updatedAt = new Date().toISOString()
  active.outcome = active.outcome ?? null
  appendProcedureTimeline(session, active, {
    origin: 'system',
    source: 'control',
    summary: 'ProcedureRun paused because the in-memory session was evicted',
    metadata: { reason: 'session evicted' },
  })
  session.procedureRuntime.activeProcedureRun = undefined
  if (!session.procedureRuntime.pausedProcedureRuns.some((run) => run.runId === active.runId)) {
    session.procedureRuntime.pausedProcedureRuns.push(active)
  }
  scheduleRunPersist(session, active)
  return true
}

function cancelRemainingProcedureRuns(session: CaseSession, outcome: string, reason: string): boolean {
  const remaining = [
    ...(session.procedureRuntime.activeProcedureRun ? [session.procedureRuntime.activeProcedureRun] : []),
    ...session.procedureRuntime.pausedProcedureRuns,
  ]
  if (remaining.length === 0) return false
  for (const run of remaining) {
    run.status = 'cancelled'
    run.outcome = outcome
    run.reason = reason
    run.updatedAt = new Date().toISOString()
    appendProcedureTimeline(session, run, {
      origin: 'system',
      source: 'control',
      summary: `ProcedureRun cancelled: ${outcome}`,
      metadata: { terminal: true, outcome, reason },
    })
    scheduleRunPersist(session, run)
  }
  session.procedureRuntime.activeProcedureRun = undefined
  session.procedureRuntime.pausedProcedureRuns = []
  session.procedureRuntime.completedProcedureRuns.push(...remaining)
  return true
}

function resumePausedRunForInput(session: CaseSession, event: RuntimeEvent): ProcedureRunState | undefined {
  if (event.source !== 'human_task_result') return undefined
  const resumed = session.procedureRuntime.pausedProcedureRuns.shift()
  if (!resumed) return undefined
  resumed.status = 'active'
  resumed.reason = 'Resumed after human task result.'
  resumed.updatedAt = event.createdAt
  resumed.inputEpoch = session.latestInputEpoch
  resumed.needsReconcile = resumed.lastReconciledInputEpoch < session.latestInputEpoch
  session.procedureRuntime.activeProcedureRun = resumed
  appendProcedureTimeline(session, resumed, {
    origin: 'system',
    source: 'control',
    summary: 'ProcedureRun resumed after human task result',
    metadata: { sourceEventId: event.eventId },
  })
  return resumed
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

function captureRunInput(run: ProcedureRunState, event: RuntimeEvent): void {
  if (!isInputSource(event.source)) return
  const next: ProcedureRunInputState = {
    eventId: event.eventId,
    inputEpoch: event.inputEpoch,
    source: event.source as ProcedureRunInputState['source'],
    origin: event.origin,
    createdAt: event.createdAt,
    content: event.content,
    formAnswers: event.formAnswers ? { ...event.formAnswers } : undefined,
    summary: event.summary,
  }
  const existingIndex = run.inputs.findIndex((entry) => entry.eventId === event.eventId)
  if (existingIndex >= 0) {
    run.inputs[existingIndex] = next
  } else {
    run.inputs.push(next)
  }
}

function ingestInputIntoRun(
  run: ProcedureRunState,
  event: RuntimeEvent,
  options?: {
    refreshNoProgress?: boolean
  },
): void {
  if (!isInputSource(event.source)) return
  captureRunInput(run, event)
  if (event.formAnswers && Object.keys(event.formAnswers).length > 0) {
    applyFormEvidenceToRun(run, event)
  }
  if (event.content) {
    updateSignalsFromInput(run, event.content)
  }
  if (options?.refreshNoProgress !== false) {
    refreshNoProgressSignal(run)
  }
  syncCurrentStepAfterProgress(run, event.createdAt)
}

function seedRunInputsFromRuntime(session: CaseSession, run: ProcedureRunState): void {
  for (const event of session.runtimeEvents) {
    if (!isInputSource(event.source)) continue
    ingestInputIntoRun(run, event, { refreshNoProgress: false })
  }
}

function defaultPriority(source: RuntimeEventSource): number {
  return source === 'control' ? -100 : 0
}

function buildInitialSteps(procedure?: ProcedureV2): ProcedureRunStepState[] {
  if (!procedure) return []
  return procedure.steps.map((step) => {
    return {
      id: step.id,
      title: step.title,
      guidance: step.guidance,
      status: 'pending',
      evidenceToolCallIds: [],
      actions: [
        ...step.actions.map((action) => toActionState(action)),
        ...(step.branches ?? []).flatMap((branch) =>
          branch.actions.map((action) => toActionState(action, branch.id)),
        ),
      ],
      branches: (step.branches ?? []).map((branch) => ({
        id: branch.id,
        kind: branch.kind,
        label: branch.label,
        conditionLabel: buildProcedureConditionLabel(branch.condition),
        status: 'pending',
        actionIds: branch.actions.map((action) => action.id),
      })),
    }
  })
}

function appendProcedureTimeline(
  session: CaseSession,
  run: ProcedureRunState,
  input: Omit<Partial<RuntimeEvent>, 'eventId' | 'createdAt' | 'enqueuedAt' | 'caseId' | 'sessionId' | 'inputEpoch' | 'runId'> & {
    origin: RuntimeEventOrigin
    source: RuntimeEventSource
  },
): RuntimeEvent {
  const event = createRuntimeEvent({
    ...input,
    caseId: session.caseId,
    sessionId: session.sessionId,
    runId: run.runId,
    inputEpoch: session.latestInputEpoch,
    priority: input.priority ?? defaultPriority(input.source),
    enqueuePolicy: input.enqueuePolicy ?? 'fifo',
  })
  session.runtimeEvents.push(event)
  run.timeline.push(event)
  run.inputEpoch = session.latestInputEpoch
  run.updatedAt = event.createdAt
  return event
}

function toActionState(action: ProcedureV2Action, branchId?: string): ProcedureRunActionState {
  return {
    id: action.id,
    kind: action.kind,
    label: action.label,
    target: targetForAction(action),
    guidance: action.guidance,
    branchId,
    required: action.required,
    status: 'pending',
    evidenceIds: [],
  }
}

function targetForAction(action: ProcedureV2Action): string | undefined {
  switch (action.kind) {
    case 'ask':
      return action.fields?.length ? action.fields.join(', ') : 'customer_details'
    case 'search_knowledge':
      return action.suggestedSources?.length ? action.suggestedSources.join(', ') : 'knowledge_base'
    case 'call_tool':
      return action.toolName
    case 'request_human_handoff':
      return action.queue || 'general'
    case 'end':
      return action.status || 'completed'
  }
}

function applyFormEvidenceToRun(run: ProcedureRunState, event: RuntimeEvent): void {
  const formAnswers = event.formAnswers
  if (!formAnswers) return
  for (const [field, value] of Object.entries(formAnswers)) {
    upsertEvidence(run, {
      id: `form:${event.eventId}:${field}`,
      kind: 'form',
      label: `Captured form field ${field}`,
      state: 'canonical',
      createdAt: event.createdAt,
      basedOnInputEpoch: event.inputEpoch,
      metadata: { field, value },
    })
  }

  const current = currentStep(run)
  if (!current?.actions?.length) return

  let progressed = false
  for (const action of current.actions) {
    if (action.kind !== 'ask') continue
    const fields = action.target?.split(',').map((field) => field.trim()).filter(Boolean) ?? []
    const hasAnswer = fields.length === 0
      ? Object.keys(formAnswers).length > 0
      : fields.some((field) => field in formAnswers)
    if (!hasAnswer) continue
    action.status = 'completed'
    clearRunBlocker(run, `action:${action.id}`)
    action.evidenceIds.push(
      ...Object.keys(formAnswers)
        .filter((field) => fields.length === 0 || fields.includes(field))
        .map((field) => `form:${event.eventId}:${field}`),
    )
    progressed = true
  }

  if (progressed) {
    clearProcedureSignal(run, 'no_progress_loop')
    if (current.status === 'blocked') current.status = 'active'
    refreshStepBranchStates(run, current)
  }
}

function updateSignalsFromInput(run: ProcedureRunState, content: string): void {
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

function clearProcedureSignal(run: ProcedureRunState, signal: ProcedureRuntimeSignal): void {
  const existing = run.signals.find((entry) => entry.signal === signal)
  if (existing) existing.active = false
}

function refreshNoProgressSignal(run: ProcedureRunState): void {
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

function upsertEvidence(run: ProcedureRunState, evidence: ProcedureRunEvidenceState): void {
  const existingIndex = run.evidence.findIndex((entry) => entry.id === evidence.id)
  if (existingIndex >= 0) {
    run.evidence[existingIndex] = evidence
  } else {
    run.evidence.push(evidence)
  }
}

function currentStep(run: ProcedureRunState): ProcedureRunStepState | undefined {
  return run.steps.find((step) => step.id === run.currentStepId)
}

function refreshStepBranchStates(run: ProcedureRunState, step: ProcedureRunStepState): void {
  if (!step.branches?.length) return

  const lockedMatch = step.branches.find((branch) => branch.status === 'matched')
  if (lockedMatch) {
    for (const branch of step.branches) {
      if (branch.id !== lockedMatch.id) {
        branch.status = 'skipped'
        branch.reason = branch.reason ?? 'Another branch already matched.'
      }
    }
    for (const action of step.actions ?? []) {
      if (action.branchId && action.branchId !== lockedMatch.id && action.status === 'pending') {
        action.status = 'skipped'
      }
    }
    return
  }

  let matchedBranchId: string | undefined
  let hasPendingCondition = false

  for (const branch of step.branches) {
    if (branch.kind === 'else') {
      if (matchedBranchId) {
        branch.status = 'skipped'
        branch.reason = 'Another branch already matched.'
      } else if (hasPendingCondition) {
        branch.status = 'pending'
        branch.reason = 'Waiting for earlier branch evidence.'
      } else {
        branch.status = 'matched'
        branch.reason = branch.reason ?? 'Fallback branch matched.'
        matchedBranchId = branch.id
      }
      continue
    }

    const evaluation = evaluateBranchCondition(run, branch)
    if (evaluation.status === 'matched' && !matchedBranchId) {
      branch.status = 'matched'
      branch.reason = evaluation.reason
      matchedBranchId = branch.id
      continue
    }

    if (evaluation.status === 'skipped') {
      branch.status = 'skipped'
      branch.reason = evaluation.reason
      continue
    }

    branch.status = 'pending'
    branch.reason = evaluation.reason
    hasPendingCondition = true
  }

  if (matchedBranchId) {
    for (const branch of step.branches) {
      if (branch.id !== matchedBranchId) {
        branch.status = 'skipped'
        branch.reason = 'Another branch already matched.'
      }
    }
    for (const action of step.actions ?? []) {
      if (action.branchId && action.branchId !== matchedBranchId && action.status === 'pending') {
        action.status = 'skipped'
      }
    }
  }
}

interface BranchConditionResolution {
  status: 'matched' | 'skipped' | 'pending'
  reason: string
}

function evaluateBranchCondition(
  run: ProcedureRunState,
  branch: ProcedureRunBranchState,
): BranchConditionResolution {
  const definition = findBranchDefinition(run, branch.id)
  const condition = definition?.condition
  if (!condition) {
    return {
      status: branch.kind === 'else' ? 'matched' : 'pending',
      reason: branch.kind === 'else'
        ? 'Fallback branch matched.'
        : 'Waiting for runtime condition data.',
    }
  }

  switch (condition.kind) {
    case 'llm_eval': {
      const latest = latestConditionEvaluation(run, branch.id, condition.id ?? branch.id)
      if (!latest || latest.basedOnInputEpoch < run.inputEpoch) {
        return {
          status: 'pending',
          reason: 'Waiting for a current llm_eval evaluator receipt.',
        }
      }
      if (latest.decision === 'matched') {
        return { status: 'matched', reason: latest.reason || 'llm_eval matched.' }
      }
      if (latest.decision === 'skipped') {
        return { status: 'skipped', reason: latest.reason || 'llm_eval did not match.' }
      }
      return {
        status: 'pending',
        reason: latest.reason || 'llm_eval is pending or unavailable.',
      }
    }
    case 'runtime_signal': {
      const signal = run.signals.find((entry) => entry.signal === condition.signal && entry.active)
      if (signal) {
        return {
          status: 'matched',
          reason: `Runtime signal "${condition.signal}" is active: ${signal.reason}`,
        }
      }
      return {
        status: 'skipped',
        reason: `Runtime signal "${condition.signal}" was not active when this branch was evaluated.`,
      }
    }
    case 'form_field': {
      const formEvidence = run.evidence.filter((entry) => entry.kind === 'form')
      if (formEvidence.length === 0) {
        return { status: 'pending', reason: 'Waiting for form evidence.' }
      }
      const matchingField = formEvidence.find((entry) => entry.metadata?.field === condition.field)
      if (!matchingField) {
        return { status: 'skipped', reason: `No form evidence captured for ${condition.field}.` }
      }
      const value = typeof matchingField.metadata?.value === 'string' ? matchingField.metadata.value : undefined
      if (condition.operator === 'equals') {
        return value === condition.value
          ? { status: 'matched', reason: `Form field ${condition.field} equals ${condition.value}.` }
          : { status: 'skipped', reason: `Form field ${condition.field} did not equal ${condition.value}.` }
      }
      return value
        ? { status: 'matched', reason: `Form field ${condition.field} is present.` }
        : { status: 'skipped', reason: `Form field ${condition.field} is missing.` }
    }
    case 'tool_event': {
      const sawCall = run.timeline.some((event) =>
        event.source === 'tool_call' && event.metadata?.toolName === condition.toolName,
      )
      const toolEvidence = run.evidence.filter((entry) => entry.toolName === condition.toolName)
      if (!sawCall && toolEvidence.length === 0) {
        return { status: 'pending', reason: `Waiting for ${condition.toolName} to run.` }
      }
      if (condition.event === 'called') {
        return sawCall
          ? { status: 'matched', reason: `${condition.toolName} was called.` }
          : { status: 'pending', reason: `Waiting for ${condition.toolName} to be called.` }
      }
      if (condition.event === 'stale') {
        return toolEvidence.some((entry) => entry.state === 'stale')
          ? { status: 'matched', reason: `${condition.toolName} produced stale evidence.` }
          : { status: 'skipped', reason: `${condition.toolName} has no stale evidence.` }
      }
      if (condition.event === 'failed') {
        return toolEvidence.some((entry) => entry.metadata?.outcome === 'failed' || entry.metadata?.outcome === 'schema_invalid')
          ? { status: 'matched', reason: `${condition.toolName} failed.` }
          : { status: 'skipped', reason: `${condition.toolName} has not failed.` }
      }
      if (condition.event === 'empty_result') {
        return toolEvidence.some((entry) => entry.metadata?.outcome === 'empty_result')
          ? { status: 'matched', reason: `${condition.toolName} returned an empty result.` }
          : { status: 'skipped', reason: `${condition.toolName} has not returned an empty result.` }
      }
      return toolEvidence.some((entry) => entry.state === 'canonical' && entry.metadata?.outcome === 'succeeded')
        ? { status: 'matched', reason: `${condition.toolName} succeeded.` }
        : { status: 'skipped', reason: `${condition.toolName} has not succeeded.` }
    }
  }
}

function latestConditionEvaluation(
  run: ProcedureRunState,
  branchId: string,
  conditionId: string,
): ProcedureRunConditionEvaluationState | undefined {
  return [...run.evaluations]
    .filter((entry) => entry.branchId === branchId && entry.conditionId === conditionId)
    .sort((left, right) =>
      left.basedOnInputEpoch === right.basedOnInputEpoch
        ? right.createdAt.localeCompare(left.createdAt)
        : right.basedOnInputEpoch - left.basedOnInputEpoch,
    )[0]
}

function findBranchDefinition(
  run: ProcedureRunState,
  branchId: string,
): ProcedureV2Branch | undefined {
  if (!run.definition) return undefined
  for (const step of run.definition.steps) {
    const branch = (step.branches ?? []).find((candidate) => candidate.id === branchId)
    if (branch) return branch
  }
  return undefined
}

function syncCurrentStepAfterProgress(run: ProcedureRunState, now = new Date().toISOString()): void {
  const current = currentStep(run)
  if (current) {
    refreshStepBranchStates(run, current)
    maybeCompleteStep(run, current, now)
  }

  const active = currentStep(run)
  if (active && (active.status === 'active' || active.status === 'blocked')) {
    run.currentStepId = active.id
    return
  }

  const next = run.steps.find((step) => step.status === 'pending')
  if (next) {
    next.status = 'active'
    next.startedAt = next.startedAt ?? now
    run.currentStepId = next.id
    return
  }

  const lastCompleted = lastMatchingStep(run.steps, (step) => step.status === 'completed' || step.status === 'skipped')
  run.currentStepId = lastCompleted?.id ?? run.currentStepId
}

function maybeCompleteStep(run: ProcedureRunState, step: ProcedureRunStepState, now: string): void {
  if (step.status === 'completed' || step.status === 'skipped') return

  if (!step.actions?.length) {
    step.status = 'completed'
    step.completedAt = step.completedAt ?? now
    step.completionReason = step.completionReason ?? 'No executable actions remained for this step.'
    return
  }

  const matchedBranchId = step.branches?.find((branch) => branch.status === 'matched')?.id
  const relevantActions = (step.actions ?? []).filter((action) => !action.branchId || action.branchId === matchedBranchId)
  if (relevantActions.length === 0) {
    // Branch-only step where no branch matched: once every branch is resolved
    // (none pending), there is nothing left to execute — complete the step so
    // the run cannot deadlock on a never-matching branch.
    const branches = step.branches ?? []
    if (branches.length > 0 && branches.every((branch) => branch.status !== 'pending')) {
      step.status = 'completed'
      step.completedAt = step.completedAt ?? now
      step.completionReason = step.completionReason ?? 'All branches resolved with no applicable actions.'
    }
    return
  }

  const pendingRequired = relevantActions.filter((action) =>
    action.required !== false &&
    action.status !== 'completed' &&
    action.status !== 'skipped',
  )
  if (pendingRequired.length > 0) {
    if (step.status !== 'blocked') step.status = 'active'
    return
  }

  if (relevantActions.some((action) => action.status === 'completed' || action.status === 'skipped')) {
    step.status = 'completed'
    step.completedAt = step.completedAt ?? now
    step.completionReason = step.completionReason ?? 'Required runtime evidence collected.'
    clearProcedureSignal(run, 'no_progress_loop')
    clearProcedureSignal(run, 'knowledge_gap')
  }
}

function lastMatchingStep(
  steps: ProcedureRunStepState[],
  predicate: (step: ProcedureRunStepState) => boolean,
): ProcedureRunStepState | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (predicate(steps[index])) return steps[index]
  }
  return undefined
}

function markBranchMatched(step: ProcedureRunStepState, branchId: string, reason: string): void {
  for (const branch of step.branches ?? []) {
    if (branch.id === branchId) {
      branch.status = 'matched'
      branch.reason = reason
      continue
    }
    branch.status = 'skipped'
    branch.reason = 'Another branch already matched.'
  }
  for (const action of step.actions ?? []) {
    if (action.branchId && action.branchId !== branchId && action.status === 'pending') {
      action.status = 'skipped'
    }
  }
}

type ProcedureToolOutcome = 'succeeded' | 'failed' | 'empty_result' | 'schema_invalid' | 'requested'

interface ProcedureToolAssessment {
  outcome: ProcedureToolOutcome
  label: string
  error?: string
}

function hasSubstantiveToolValue(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.values(value).some((entry) => hasSubstantiveToolValue(entry))
  return true
}

function hasSubstantiveToolPayload(record: Record<string, unknown>): boolean {
  return Object.entries(record).some(([key, value]) => {
    if (['ok', 'success', 'is_v3', 'ver', 'error', 'errors', 'persisted'].includes(key)) return false
    return hasSubstantiveToolValue(value)
  })
}

function setRunBlocker(run: ProcedureRunState, key: string, message: string): void {
  clearRunBlocker(run, key)
  run.blockers.push(`[${key}] ${message}`)
}

function clearRunBlocker(run: ProcedureRunState, key: string): void {
  run.blockers = run.blockers.filter((entry) => !entry.startsWith(`[${key}] `))
}

function applyProcedureRunKernelState(run: ProcedureRunState, next: ProcedureRunState): void {
  Object.assign(run, next)
}

function appendProcedureRunKernelEffects(
  session: CaseSession,
  run: ProcedureRunState,
  effects: ProcedureRunKernelEffect[],
): void {
  for (const effect of effects) {
    if (effect.type !== 'timeline') continue
    appendProcedureTimeline(session, run, {
      origin: effect.origin,
      source: effect.source,
      basedOnInputEpoch: effect.basedOnInputEpoch,
      summary: effect.summary,
      metadata: effect.metadata,
    })
  }
}

function assessProcedureToolOutcome(
  toolName: string,
  toolOutput: unknown,
  toolError?: string,
  isKnowledgeTool = false,
): ProcedureToolAssessment {
  if (toolError?.trim()) {
    return {
      outcome: 'failed',
      label: `${toolName} failed`,
      error: toolError.trim(),
    }
  }

  if (toolName === 'create_human_task') {
    if (isRecord(toolOutput) && toolOutput.persisted === true && typeof toolOutput.taskId === 'string') {
      return { outcome: 'succeeded', label: 'Human handoff persisted' }
    }
    if (isRecord(toolOutput) && typeof toolOutput.taskId === 'string' && toolOutput.status === 'pending') {
      return { outcome: 'requested', label: 'Human handoff requested but not yet persisted' }
    }
    return { outcome: 'schema_invalid', label: 'Human handoff returned an unexpected payload' }
  }

  if (isKnowledgeTool) {
    if (Array.isArray(toolOutput)) {
      return toolOutput.length > 0
        ? { outcome: 'succeeded', label: 'Knowledge search returned hits' }
        : { outcome: 'empty_result', label: 'Knowledge search returned no hits' }
    }
    if (isRecord(toolOutput) && Array.isArray(toolOutput.hits)) {
      return toolOutput.hits.length > 0
        ? { outcome: 'succeeded', label: 'Knowledge search returned hits' }
        : { outcome: 'empty_result', label: 'Knowledge search returned no hits' }
    }
    if (isRecord(toolOutput) && Array.isArray(toolOutput.list)) {
      return toolOutput.list.length > 0
        ? { outcome: 'succeeded', label: 'Knowledge search returned hits' }
        : { outcome: 'empty_result', label: 'Knowledge search returned no hits' }
    }
    return { outcome: 'schema_invalid', label: 'Knowledge search returned an unexpected payload' }
  }

  if (toolOutput == null) {
    return { outcome: 'empty_result', label: `${toolName} returned no payload` }
  }
  if (Array.isArray(toolOutput)) {
    return toolOutput.length > 0
      ? { outcome: 'succeeded', label: `${toolName} returned data` }
      : { outcome: 'empty_result', label: `${toolName} returned an empty list` }
  }
  if (isRecord(toolOutput)) {
    if (toolOutput.ok === false || toolOutput.success === false) {
      return {
        outcome: 'failed',
        label: `${toolName} reported a failed result`,
        error: typeof toolOutput.error === 'string'
          ? toolOutput.error
          : Array.isArray(toolOutput.errors)
            ? toolOutput.errors.join('; ')
            : isRecord(toolOutput.errors)
              ? Object.entries(toolOutput.errors).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('; ')
              : undefined,
      }
    }
    if (typeof toolOutput.error === 'string' && toolOutput.error.trim().length > 0) {
      return {
        outcome: 'failed',
        label: `${toolName} reported an error`,
        error: toolOutput.error.trim(),
      }
    }
    if (Array.isArray(toolOutput.errors) && toolOutput.errors.length > 0) {
      return {
        outcome: 'failed',
        label: `${toolName} reported validation errors`,
        error: toolOutput.errors.map((entry) => String(entry)).join('; '),
      }
    }
    if (isRecord(toolOutput.errors) && Object.keys(toolOutput.errors).length > 0) {
      return {
        outcome: 'failed',
        label: `${toolName} reported field errors`,
        error: Object.entries(toolOutput.errors).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('; '),
      }
    }
    if (Object.keys(toolOutput).length === 0 || !hasSubstantiveToolPayload(toolOutput)) {
      return { outcome: 'empty_result', label: `${toolName} returned an empty object` }
    }
    return { outcome: 'succeeded', label: `${toolName} returned data` }
  }
  if (typeof toolOutput === 'string' && toolOutput.trim().length === 0) {
    return { outcome: 'empty_result', label: `${toolName} returned an empty string` }
  }
  return { outcome: 'succeeded', label: `${toolName} returned data` }
}

function blockerForToolAssessment(
  toolName: string,
  assessment: ProcedureToolAssessment,
): string | undefined {
  switch (assessment.outcome) {
    case 'failed':
      return `${toolName} failed${assessment.error ? `: ${assessment.error}` : '.'} Retry, ask a clarifying question, or hand off safely before proceeding.`
    case 'empty_result':
      return `${toolName} returned no usable result. Ask a clarifying question, retry with a better query, or hand off safely before proceeding.`
    case 'schema_invalid':
      return `${toolName} returned an unexpected payload. Treat it as unusable and recover before proceeding.`
    case 'requested':
      return `${toolName} has not produced persisted handoff evidence yet.`
    default:
      return undefined
  }
}

function applyToolEvidenceToRun(
  session: CaseSession,
  run: ProcedureRunState,
  input: {
    toolName: string
    toolUseId?: string
    toolOutput?: unknown
    toolError?: string
  },
  stale: boolean,
  basedOnInputEpoch: number,
  createdAt: string,
  assessment: ProcedureToolAssessment = assessProcedureToolOutcome(input.toolName, input.toolOutput, input.toolError),
  isKnowledgeTool = false,
): void {
  const evidenceId = input.toolUseId ?? `${input.toolName}:${Date.now()}`
  const match = findMatchingToolStep(run, input.toolName, isKnowledgeTool)
  const evidenceKind = isKnowledgeTool
    ? 'knowledge'
    : input.toolName === 'create_human_task'
      ? 'handoff'
      : 'tool'

  if (!run.evidenceToolCallIds.includes(evidenceId)) run.evidenceToolCallIds.push(evidenceId)

  const evidence: ProcedureRunEvidenceState = {
    id: evidenceId,
    kind: evidenceKind,
    stepId: match?.step.id,
    actionId: match?.action?.id,
    branchId: match?.action?.branchId,
    label: buildToolEvidenceLabel(input.toolName, evidenceKind),
    toolName: input.toolName,
    basedOnInputEpoch,
    state: stale ? 'stale' : 'canonical',
    createdAt,
    metadata: {
      output: input.toolOutput,
      error: input.toolError,
      outcome: stale ? 'stale' : assessment.outcome,
    },
  }
  upsertEvidence(run, evidence)

  if (match?.step && !match.step.evidenceToolCallIds.includes(evidenceId)) {
    match.step.evidenceToolCallIds.push(evidenceId)
  }

  if (!match) {
    if (isKnowledgeTool && !stale && assessment.outcome === 'succeeded') {
      clearProcedureSignal(run, 'knowledge_gap')
    }
    return
  }

  if (match.action && !match.action.evidenceIds.includes(evidenceId)) {
    match.action.evidenceIds.push(evidenceId)
  }

  const blockerKey = `action:${match.action?.id ?? match.step.id}`
  if (stale) {
    setRunBlocker(
      run,
      blockerKey,
      `Stale ${input.toolName} evidence must be reconciled before this step can advance.`,
    )
    return
  }

  if (match.action?.branchId && assessment.outcome === 'succeeded') {
    markBranchMatched(match.step, match.action.branchId, `Observed ${input.toolName}.`)
  }

  if (match.action) {
    if (match.action.kind === 'ask') {
      match.action.status = 'active'
      match.step.status = 'blocked'
      match.step.skipReason = undefined
      match.step.completionReason = 'Waiting for customer input.'
      setRunBlocker(run, blockerKey, 'Waiting for the customer to submit the requested form fields.')
    } else if (assessment.outcome === 'succeeded') {
      clearRunBlocker(run, blockerKey)
      match.action.status = 'completed'
      match.step.status = 'active'
      match.step.completionReason = `Observed ${input.toolName}.`
    } else if (assessment.outcome === 'requested') {
      setRunBlocker(run, blockerKey, blockerForToolAssessment(input.toolName, assessment) ?? `${input.toolName} is still pending.`)
      match.action.status = 'active'
      match.step.status = 'active'
      match.step.completionReason = undefined
    } else {
      setRunBlocker(run, blockerKey, blockerForToolAssessment(input.toolName, assessment) ?? `${input.toolName} did not complete successfully.`)
      match.action.status = 'blocked'
      match.step.status = 'blocked'
      match.step.completionReason = undefined
    }
  }

  if (isKnowledgeTool && assessment.outcome === 'succeeded') {
    clearProcedureSignal(run, 'knowledge_gap')
  }
  if (input.toolName === 'create_human_task' && assessment.outcome === 'succeeded') {
    clearProcedureSignal(run, 'explicit_human_request')
    clearProcedureSignal(run, 'no_progress_loop')
    clearProcedureSignal(run, 'knowledge_gap')
    // Owner contract: persisted human handoff is terminal for the ProcedureRun
    // regardless of channel. The case/chat may remain waiting_human for ops.
    finalizeRunForHumanHandoff(session, run, match, createdAt, input.toolOutput)
  }
}

function finalizeRunForHumanHandoff(
  session: CaseSession,
  run: ProcedureRunState,
  match: { step: ProcedureRunStepState; action?: ProcedureRunActionState } | null,
  createdAt: string,
  toolOutput?: unknown,
): void {
  const taskId = isRecord(toolOutput) && typeof toolOutput.taskId === 'string'
    ? toolOutput.taskId
    : undefined
  const queue = isRecord(toolOutput) && typeof toolOutput.queue === 'string'
    ? toolOutput.queue
    : undefined
  const kernelMatch: ProcedureRunKernelMatch | null = match?.step
    ? { stepId: match.step.id, actionId: match.action?.id }
    : null
  const transition = applyProcedureRunEvent(run, {
    type: 'human_handoff_finalized',
    taskId,
    queue,
    match: kernelMatch,
  }, {
    now: createdAt,
  })
  applyProcedureRunKernelState(run, transition.state)

  if (session.procedureRuntime.activeProcedureRun?.runId === run.runId) {
    session.procedureRuntime.activeProcedureRun = undefined
  }
  session.procedureRuntime.pausedProcedureRuns = session.procedureRuntime.pausedProcedureRuns
    .filter((candidate) => candidate.runId !== run.runId)
  if (!session.procedureRuntime.completedProcedureRuns.some((candidate) => candidate.runId === run.runId)) {
    session.procedureRuntime.completedProcedureRuns.push(run)
  }

  appendProcedureRunKernelEffects(session, run, transition.effects)
  scheduleRunPersist(session, run)
}

function buildToolEvidenceLabel(toolName: string, kind: ProcedureRunEvidenceState['kind']): string {
  switch (kind) {
    case 'knowledge':
      return `Knowledge search completed with ${toolName}`
    case 'handoff':
      return 'Human handoff requested'
    default:
      return `Tool result captured for ${toolName}`
  }
}

function findMatchingToolStep(
  run: ProcedureRunState,
  toolName: string,
  isKnowledgeTool: boolean,
): { step: ProcedureRunStepState; action?: ProcedureRunActionState } | null {
  const stepsInPriority = [
    ...(run.currentStepId ? run.steps.filter((step) => step.id === run.currentStepId) : []),
    ...run.steps.filter((step) => step.id !== run.currentStepId),
  ]

  for (const step of stepsInPriority) {
    const action = (step.actions ?? []).find((candidate) => actionMatchesTool(candidate, toolName, isKnowledgeTool))
    if (action) return { step, action }
  }

  return null
}

function actionMatchesTool(action: ProcedureRunActionState, toolName: string, isKnowledgeTool: boolean): boolean {
  switch (action.kind) {
    case 'call_tool':
      return action.target === toolName
    case 'search_knowledge':
      return isKnowledgeTool
    case 'ask':
      return toolName === 'ask_user_questions'
    case 'request_human_handoff':
      return toolName === 'create_human_task'
    case 'end':
      return toolName === 'finalize_procedure'
    default:
      return false
  }
}

function isKnowledgeToolForSession(
  session: CaseSession,
  input: { toolName: string; isKnowledgeTool?: boolean },
): boolean {
  if (typeof input.isKnowledgeTool === 'boolean') return input.isKnowledgeTool
  const toolDefinition = session.loop?.getToolDefinition?.(input.toolName)
  return !!toolDefinition?.knowledgeSourceId
}

export function isRuntimeAuthorityKey(key: string): boolean {
  return [
    'runId',
    'procedureRun',
    'ProcedureRun',
    'procedureRunState',
    'currentStepId',
    'inputs',
    'evaluations',
    'needsReconcile',
    'lastReconciledInputEpoch',
    'inputEpoch',
    'activeProcedureRun',
    'pausedProcedureRuns',
    'completedProcedureRuns',
    'staleEvidence',
  ].includes(key)
}

export function filterRuntimeAuthorityKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !isRuntimeAuthorityKey(key)),
  )
}

function finalizationBlockers(run: ProcedureRunState): string[] {
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

function promisesHumanHandoff(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return [
    /(?:i|we)\s+(?:have|\'ve)\s+(?:created|opened|submitted|arranged|escalated)\s+(?:a\s+)?(?:ticket|case|handoff|human support request)/i,
    /(?:i|we)\s+will\s+(?:arrange|transfer|connect|escalate)\s+(?:you\s+)?(?:to|with)?\s*(?:a\s+)?(?:human|agent|specialist|representative)/i,
    /已为您创建工单/,
    /已经为您创建工单/,
    /已安排人工/,
    /将安排人工/,
    /已转人工/,
    /已经转人工/,
    /已为您转接/,
    /专员将尽快与您联系/,
  ].some((pattern) => pattern.test(trimmed))
}

function hasPersistedHandoffEvidence(run: ProcedureRunState): boolean {
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

function cloneRun(run: ProcedureRunState): ProcedureRunState {
  return {
    ...run,
    steps: run.steps.map((step) => ({
      ...step,
      evidenceToolCallIds: [...step.evidenceToolCallIds],
      actions: step.actions?.map((action) => ({ ...action, evidenceIds: [...action.evidenceIds] })),
      branches: step.branches?.map((branch) => ({ ...branch, actionIds: [...branch.actionIds] })),
    })),
    inputs: run.inputs.map((entry) => ({
      ...entry,
      formAnswers: entry.formAnswers ? { ...entry.formAnswers } : undefined,
    })),
    evidenceToolCallIds: [...run.evidenceToolCallIds],
    evidence: run.evidence.map((entry) => ({
      ...entry,
      metadata: entry.metadata ? { ...entry.metadata } : undefined,
    })),
    evaluations: run.evaluations.map((entry) => ({
      ...entry,
      metadata: entry.metadata ? { ...entry.metadata } : undefined,
    })),
    signals: run.signals.map((signal) => ({ ...signal })),
    blockers: [...run.blockers],
    timeline: run.timeline.map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined })),
    definition: run.definition ? JSON.parse(JSON.stringify(run.definition)) as ProcedureV2 : undefined,
  }
}

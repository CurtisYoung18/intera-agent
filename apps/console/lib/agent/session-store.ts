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
  ContentBlock,
  Procedure,
  ProcedureDefinition,
  ProcedureRuntimeSignal,
  ProcedureV2Action,
  ProcedureV2Branch,
  ProcedureV2Step,
} from '@intera/shared/types'
import {
  buildProcedureConditionLabel,
  isProcedureV2Definition,
  normalizeProcedureDefinition,
} from '@intera/shared/contracts/case-types'
import { prisma } from '@intera/shared/prisma'

// ─── Queued message shape ─────────────────────────────────────────────────────

export type RuntimeEventOrigin = 'customer' | 'operator' | 'system' | 'human'
export type RuntimeEventSource =
  | 'customer_message'
  | 'customer_form_result'
  | 'human_task_result'
  | 'tool_call'
  | 'tool_result'
  | 'text_reply'
  | 'evaluator'
  | 'hook_decision'
  | 'reconcile'
  | 'remember'
  | 'control'

export interface RuntimeEvent {
  eventId: string
  inputEpoch: number
  origin: RuntimeEventOrigin
  source: RuntimeEventSource
  createdAt: string
  enqueuedAt: string
  caseId: string
  sessionId: string
  runId?: string
  content?: string
  contentBlocks?: ContentBlock[]
  formAnswers?: Record<string, string>
  isMeta?: boolean
  isControl?: boolean
  priority: number
  enqueuePolicy: 'fifo' | 'front' | 'replace'
  basedOnInputEpoch?: number
  summary?: string
  metadata?: Record<string, unknown>
}

export interface QueuedMessage extends RuntimeEvent {
  content: string
}

export type QueuedMessageInput = {
  content: string
  contentBlocks?: ContentBlock[]
  formAnswers?: Record<string, string>
  origin?: RuntimeEventOrigin
  source?: RuntimeEventSource
  runId?: string
  isMeta?: boolean
  isControl?: boolean
  priority?: number
  enqueuePolicy?: 'fifo' | 'front' | 'replace'
  basedOnInputEpoch?: number
  summary?: string
  metadata?: Record<string, unknown>
}

export type ProcedureRunStatus = 'active' | 'paused' | 'completed' | 'cancelled'
export type ProcedureStepStatus = 'pending' | 'active' | 'completed' | 'skipped' | 'blocked'

export interface ProcedureRunStepState {
  id: string
  action: string
  target?: string
  required?: boolean
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
  procedureVersion?: 'v1' | 'v2'
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
  legacyFacts: Record<string, unknown>
  blockers: string[]
  timeline: RuntimeEvent[]
  definition?: ProcedureDefinition
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

// ─── MessageQueue ─────────────────────────────────────────────────────────────

/**
 * Single-consumer, multi-producer async queue.
 * Designed for one SSE-loop consumer awaiting messages sent by HTTP POST handlers.
 */
export class MessageQueue {
  private queue: QueuedMessage[] = []
  private waiter: ((msg: QueuedMessage) => void) | null = null

  /** Enqueue a message. If the consumer is already waiting, wake it immediately. */
  enqueue(msg: QueuedMessage): void {
    if (this.waiter) {
      const resolve = this.waiter
      this.waiter = null
      resolve(msg)
    } else {
      this.queue.push(msg)
    }
  }

  /** Await the next message. Returns immediately if one is already buffered. */
  dequeue(): Promise<QueuedMessage> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!)
    }
    return new Promise<QueuedMessage>((resolve) => {
      this.waiter = resolve
    })
  }

  /** Non-blocking dequeue: returns the next message or null if queue is empty. */
  dequeueNonBlocking(): QueuedMessage | null {
    if (this.queue.length > 0) return this.queue.shift()!
    return null
  }

  /** Abort the waiting consumer with an error (e.g. on session close). */
  abort(): void {
    if (this.waiter) {
      this.waiter(createRuntimeEvent({
        caseId: 'closed',
        sessionId: 'closed',
        inputEpoch: 0,
        origin: 'system',
        source: 'control',
        content: '__SESSION_CLOSED__',
        isControl: true,
        priority: -100,
        enqueuePolicy: 'front',
      }) as QueuedMessage)
      this.waiter = null
    }
  }

  get pendingCount(): number {
    return this.queue.length
  }
}

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

// ─── Registry ────────────────────────────────────────────────────────────────

const sessions = new Map<string, CaseSession>()

/** TTL for idle sessions (30 minutes). */
const SESSION_TTL_MS = 30 * 60 * 1000

interface PersistedProcedureRunRecord {
  id: string
  caseId: string
  orgId?: string
  chatId?: string
  agentConfigId: string
  procedureId: string
  procedureVersion: string
  status: string
  inputEpoch: number
  needsReconcile: boolean
  currentStepId: string | null
  outcome: string | null
  state: unknown
  createdAt?: Date | string
  updatedAt?: Date | string
}

interface HydratedProcedureRuntime {
  latestInputEpoch: number
  runs: PersistedProcedureRunRecord[]
}

interface ProcedureRunPersistenceAdapter {
  loadProcedureRuntime(caseId: string): Promise<HydratedProcedureRuntime>
  saveProcedureRun(record: PersistedProcedureRunRecord): Promise<void>
  saveCaseInputEpoch(caseId: string, inputEpoch: number): Promise<void>
}

const noopProcedureRunPersistence: ProcedureRunPersistenceAdapter = {
  async loadProcedureRuntime() {
    return { latestInputEpoch: 0, runs: [] }
  },
  async saveProcedureRun() {},
  async saveCaseInputEpoch() {},
}

const prismaProcedureRunPersistence: ProcedureRunPersistenceAdapter = {
  async loadProcedureRuntime(caseId) {
    const [caseRow, runs] = await Promise.all([
      prisma.case.findUnique({
        where: { id: caseId },
        select: { runtimeInputEpoch: true, orgId: true, chatId: true },
      }),
      prisma.procedureRun.findMany({
        where: {
          caseId,
          status: { in: ['active', 'paused'] },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ])
    return {
      latestInputEpoch: caseRow?.runtimeInputEpoch ?? 0,
      runs: runs.map((run) => ({
        id: run.id,
        caseId: run.caseId,
        orgId: (run as { orgId?: string }).orgId ?? caseRow?.orgId,
        chatId: (run as { chatId?: string }).chatId ?? caseRow?.chatId,
        agentConfigId: run.agentConfigId,
        procedureId: run.procedureId,
        procedureVersion: run.procedureVersion,
        status: run.status,
        inputEpoch: run.inputEpoch,
        needsReconcile: run.needsReconcile,
        currentStepId: run.currentStepId,
        outcome: run.outcome,
        state: run.state,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      })),
    }
  },
  async saveProcedureRun(record) {
    const caseRow = await prisma.case.findUnique({
      where: { id: record.caseId },
      select: { orgId: true, chatId: true },
    }).catch(() => null)
    const orgId = record.orgId ?? caseRow?.orgId ?? 'default'
    const chatId = record.chatId ?? caseRow?.chatId ?? record.caseId
    await prisma.procedureRun.upsert({
      where: { id: record.id },
      update: {
        caseId: record.caseId,
        orgId,
        chatId,
        agentConfigId: record.agentConfigId,
        procedureId: record.procedureId,
        procedureVersion: record.procedureVersion,
        status: record.status,
        inputEpoch: record.inputEpoch,
        needsReconcile: record.needsReconcile,
        currentStepId: record.currentStepId,
        outcome: record.outcome,
        state: record.state as object,
      },
      create: {
        id: record.id,
        caseId: record.caseId,
        orgId,
        chatId,
        agentConfigId: record.agentConfigId,
        procedureId: record.procedureId,
        procedureVersion: record.procedureVersion,
        status: record.status,
        inputEpoch: record.inputEpoch,
        needsReconcile: record.needsReconcile,
        currentStepId: record.currentStepId,
        outcome: record.outcome,
        state: record.state as object,
      },
    })
  },
  async saveCaseInputEpoch(caseId, inputEpoch) {
    await prisma.case.updateMany({
      where: { id: caseId },
      data: { runtimeInputEpoch: inputEpoch },
    })
  },
}

let procedureRunPersistence: ProcedureRunPersistenceAdapter =
  process.env.NODE_ENV === 'test'
    ? noopProcedureRunPersistence
    : prismaProcedureRunPersistence

const runPersistQueues = new Map<string, Promise<void>>()
const caseEpochPersistQueues = new Map<string, Promise<void>>()

export function setProcedureRunPersistenceForTest(adapter: ProcedureRunPersistenceAdapter | null): void {
  procedureRunPersistence = adapter ?? (
    process.env.NODE_ENV === 'test'
      ? noopProcedureRunPersistence
      : prismaProcedureRunPersistence
  )
  runPersistQueues.clear()
  caseEpochPersistQueues.clear()
}

export async function flushProcedureRunPersistence(caseId?: string): Promise<void> {
  const runPromises = [...runPersistQueues.entries()]
    .filter(([runId]) => !caseId || runId.startsWith(`${caseId}:`))
    .map(([, promise]) => promise)
  const casePromises = [...caseEpochPersistQueues.entries()]
    .filter(([key]) => !caseId || key === caseId)
    .map(([, promise]) => promise)
  await Promise.all([...runPromises, ...casePromises])
}

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

  const hydrated = await procedureRunPersistence.loadProcedureRuntime(caseId)
  session.latestInputEpoch = Math.max(session.latestInputEpoch, hydrated.latestInputEpoch)
  const runs = hydrated.runs
    .map(hydratePersistedRun)
    .filter((run): run is ProcedureRunState => !!run)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  const activeRuns = runs.filter((run) => run.status === 'active')
  const pausedRuns = runs.filter((run) => run.status === 'paused')
  const active = activeRuns[0]
  session.procedureRuntime = {
    activeProcedureRun: active,
    pausedProcedureRuns: [
      ...activeRuns.slice(1).map((run) => ({ ...run, status: 'paused' as const })),
      ...pausedRuns,
    ],
    completedProcedureRuns: [],
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
  if (!run || run.procedureVersion !== 'v2') return []
  const step = currentStep(run)
  if (!step?.branches?.length || !run.definition || !isProcedureV2Definition(run.definition)) return []
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
  procedure?: Procedure | ProcedureDefinition
  reason?: string
  confidence?: number
  collectedFacts?: Record<string, unknown>
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
    if (input.collectedFacts && active.procedureVersion !== 'v2') {
      active.legacyFacts = {
        ...active.legacyFacts,
        ...filterRuntimeAuthorityKeys(input.collectedFacts),
      }
    }
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
  const procedureVersion = input.procedure
    ? isProcedureV2Definition(input.procedure) ? 'v2' : 'v1'
    : undefined
  const run: ProcedureRunState = resumed
    ? {
        ...resumed,
        agentConfigId: input.agentConfigId ?? session.agentConfigId ?? resumed.agentConfigId,
        status: 'active',
        inputEpoch: session.latestInputEpoch,
        reason: input.reason ?? resumed.reason,
        confidence: input.confidence ?? resumed.confidence,
        legacyFacts: resumed.procedureVersion === 'v2'
          ? {}
          : {
              ...resumed.legacyFacts,
              ...filterRuntimeAuthorityKeys(input.collectedFacts ?? {}),
            },
        updatedAt: now,
        lastStartRequestId: input.requestId ?? resumed.lastStartRequestId,
        procedureVersion: resumed.procedureVersion ?? procedureVersion,
        definition: resumed.definition ?? input.procedure,
      }
    : {
        runId: `proc_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        agentConfigId: input.agentConfigId ?? session.agentConfigId ?? undefined,
        procedureId: input.procedureId,
        caseType: input.procedureId,
        displayName: input.displayName,
        procedureVersion,
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
        legacyFacts: procedureVersion === 'v2'
          ? {}
          : filterRuntimeAuthorityKeys(input.collectedFacts ?? {}),
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
  seedRunInputsFromRuntime(session, run)
  if (!run.currentStepId) {
    const first = run.steps.find((step) => step.status === 'pending') ?? run.steps[0]
    if (first) {
      first.status = 'active'
      first.startedAt = first.startedAt ?? now
      run.currentStepId = first.id
    }
  }
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

  const assessment = assessProcedureToolOutcome(input.toolName, input.toolOutput, input.toolError)
  const recordedAt = new Date().toISOString()
  applyToolEvidenceToRun(session, run, input, stale, basedOn, recordedAt, assessment)
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
}): { stale: boolean; run?: ProcedureRunState } {
  const session = sessions.get(caseId)
  const run = session?.procedureRuntime.activeProcedureRun
  if (!session || !run) return { stale: false }
  const basedOn = input.basedOnInputEpoch ?? session.latestInputEpoch
  const stale = basedOn < session.latestInputEpoch
  const recordedAt = new Date().toISOString()
  if (stale) {
    run.needsReconcile = true
    run.blockers = [...new Set([...run.blockers, 'A customer-visible reply was based on stale input.'])]
  }
  upsertEvidence(run, {
    id: `text:${recordedAt}:${basedOn}`,
    kind: 'text_reply',
    label: stale ? 'Stale customer-facing reply withheld' : 'Customer-facing reply drafted',
    state: stale ? 'stale' : 'canonical',
    createdAt: recordedAt,
    basedOnInputEpoch: basedOn,
    metadata: {
      textPreview: input.text.slice(0, 240),
      alreadyStreamed: input.alreadyStreamed === true,
    },
  })
  appendProcedureTimeline(session, run, {
    origin: 'system',
    source: 'text_reply',
    basedOnInputEpoch: basedOn,
    summary: `${stale ? 'Stale' : 'Current'} text reply${input.alreadyStreamed ? ' already streamed' : ''}`,
    metadata: {
      textPreview: input.text.slice(0, 240),
      evidenceState: stale ? 'stale' : 'canonical',
      alreadyStreamed: input.alreadyStreamed === true,
    },
  })
  scheduleRunPersist(session, run)
  return { stale, run: cloneRun(run) }
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
  run.status = input.status ?? 'completed'
  run.updatedAt = new Date().toISOString()
  appendProcedureTimeline(session, run, {
    origin: 'system',
    source: 'tool_result',
    basedOnInputEpoch: basedOn,
    summary: input.summary ?? `ProcedureRun ${run.status}`,
    metadata: { terminal: true, evidenceState: 'canonical' },
  })
  session.procedureRuntime.completedProcedureRuns.push(run)
  session.procedureRuntime.activeProcedureRun = undefined
  scheduleRunPersist(session, run)
  return { ok: true, stale: false, run: cloneRun(run) }
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
    lines.push(`- version: ${run.procedureVersion ?? 'v1'}`)
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
        const target = step.target ? ` target=${step.target}` : ''
        const title = step.title ? ` title=${JSON.stringify(step.title)}` : ''
        lines.push(`- ${step.id}: ${step.status} action=${step.action}${target}${title}${evidence}`)
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
  captureRunInput(active, event)
  if (event.formAnswers && Object.keys(event.formAnswers).length > 0) {
    applyFormEvidenceToRun(active, event)
  }
  if (event.content) {
    updateSignalsFromInput(active, event.content)
  }
  refreshNoProgressSignal(active)
  syncCurrentStepAfterProgress(active, event.createdAt)
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
  const previous = caseEpochPersistQueues.get(session.caseId) ?? Promise.resolve()
  const inputEpoch = session.latestInputEpoch
  const next = previous
    .catch(() => undefined)
    .then(() => procedureRunPersistence.saveCaseInputEpoch(session.caseId, inputEpoch))
  caseEpochPersistQueues.set(session.caseId, next)
  void next.catch((error) => {
    console.error('[SessionStore] Failed to persist Case.runtimeInputEpoch:', error)
  })
}

function scheduleRunPersist(session: CaseSession, run: ProcedureRunState): void {
  const record = toPersistedProcedureRun(session, run)
  const queueKey = `${session.caseId}:${run.runId}`
  const previous = runPersistQueues.get(queueKey) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => procedureRunPersistence.saveProcedureRun(record))
  runPersistQueues.set(queueKey, next)
  void next.catch((error) => {
    console.error('[SessionStore] Failed to persist ProcedureRun:', error)
  })
}

function toPersistedProcedureRun(session: CaseSession, run: ProcedureRunState): PersistedProcedureRunRecord {
  const agentConfigId = run.agentConfigId ?? session.agentConfigId ?? 'unknown'
  run.agentConfigId = agentConfigId
  return {
    id: run.runId,
    caseId: session.caseId,
    agentConfigId,
    procedureId: run.procedureId,
    procedureVersion: run.procedureVersion ?? 'v2',
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
  const procedureVersion = record.procedureVersion === 'v1' ? 'v1' : 'v2'
  return {
    runId: stringFrom(raw.runId) ?? record.id,
    agentConfigId: stringFrom(raw.agentConfigId) ?? record.agentConfigId,
    procedureId: stringFrom(raw.procedureId) ?? record.procedureId,
    caseType: stringFrom(raw.caseType) ?? record.procedureId,
    displayName: stringFrom(raw.displayName) ?? record.procedureId,
    procedureVersion,
    status,
    inputEpoch: record.inputEpoch,
    lastReconciledInputEpoch: numberFrom(raw.lastReconciledInputEpoch) ?? record.inputEpoch,
    needsReconcile: record.needsReconcile,
    currentStepId: stringFrom(raw.currentStepId) ?? null,
    steps: Array.isArray(raw.steps) ? raw.steps as ProcedureRunStepState[] : [],
    inputs: Array.isArray(raw.inputs) ? raw.inputs as ProcedureRunInputState[] : [],
    evidenceToolCallIds: Array.isArray(raw.evidenceToolCallIds) ? raw.evidenceToolCallIds as string[] : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence as ProcedureRunEvidenceState[] : [],
    evaluations: Array.isArray(raw.evaluations) ? raw.evaluations as ProcedureRunConditionEvaluationState[] : [],
    signals: Array.isArray(raw.signals) ? raw.signals as ProcedureRunSignalState[] : [],
    legacyFacts: isRecord(raw.legacyFacts) ? raw.legacyFacts : {},
    blockers: Array.isArray(raw.blockers) ? raw.blockers as string[] : [],
    timeline: Array.isArray(raw.timeline) ? raw.timeline as RuntimeEvent[] : [],
    definition: isRecord(raw.definition) ? raw.definition as unknown as ProcedureDefinition : undefined,
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

function seedRunInputsFromRuntime(session: CaseSession, run: ProcedureRunState): void {
  for (const event of session.runtimeEvents) {
    if (!isInputSource(event.source)) continue
    captureRunInput(run, event)
  }
}

function defaultPriority(source: RuntimeEventSource): number {
  return source === 'control' ? -100 : 0
}

function buildInitialSteps(procedure?: Procedure | ProcedureDefinition): ProcedureRunStepState[] {
  if (!procedure) return []
  if (!isProcedureV2Definition(procedure)) {
    return procedure.steps.map((step) => ({
      id: step.id,
      action: step.action,
      target: step.target,
      required: step.required === true ? true : undefined,
      title: buildLegacyStepTitle(step),
      guidance: step.guidance,
      status: 'pending',
      evidenceToolCallIds: [],
    }))
  }

  const normalized = normalizeProcedureDefinition(procedure)
  return procedure.steps.map((step, index) => {
    const normalizedStep = normalized.steps[index]
    return {
      id: step.id,
      action: normalizedStep?.action ?? 'decide',
      target: normalizedStep?.target,
      required: true,
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

function buildLegacyStepTitle(step: Procedure['steps'][number]): string {
  if (step.guidance?.trim()) return step.guidance.trim()
  if (step.target?.trim()) return `${step.action} ${step.target.trim()}`
  return step.action
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
  if (!run.definition || !isProcedureV2Definition(run.definition)) return undefined
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
    if (step.action !== 'ask' || step.evidenceToolCallIds.length > 0) {
      if (
        step.action !== 'use' &&
        step.action !== 'read' &&
        step.action !== 'escalate' &&
        step.action !== 'finalize'
      ) {
        step.status = 'completed'
        step.completedAt = step.completedAt ?? now
      }
    }
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

function assessProcedureToolOutcome(
  toolName: string,
  toolOutput: unknown,
  toolError?: string,
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

  if (toolName.startsWith('kb_search_')) {
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
): void {
  const evidenceId = input.toolUseId ?? `${input.toolName}:${Date.now()}`
  const match = findMatchingToolStep(run, input.toolName)
  const evidenceKind = input.toolName.startsWith('kb_search_')
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
    if (input.toolName.startsWith('kb_search_') && !stale && assessment.outcome === 'succeeded') {
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
  } else if (stepMatchesLegacyTool(match.step, input.toolName)) {
    if (assessment.outcome === 'succeeded') {
      clearRunBlocker(run, blockerKey)
      match.step.status = 'completed'
      match.step.completedAt = createdAt
      match.step.completionReason = `Observed ${input.toolName}.`
    } else {
      setRunBlocker(run, blockerKey, blockerForToolAssessment(input.toolName, assessment) ?? `${input.toolName} did not complete successfully.`)
      match.step.status = 'blocked'
      match.step.completedAt = undefined
      match.step.completionReason = undefined
    }
  }

  if (input.toolName.startsWith('kb_search_') && assessment.outcome === 'succeeded') {
    clearProcedureSignal(run, 'knowledge_gap')
  }
  if (input.toolName === 'create_human_task' && assessment.outcome === 'succeeded') {
    clearProcedureSignal(run, 'explicit_human_request')
    clearProcedureSignal(run, 'no_progress_loop')
    clearProcedureSignal(run, 'knowledge_gap')
    transitionRunToWaitingHuman(session, run, match, createdAt, input.toolOutput)
  }
}

function transitionRunToWaitingHuman(
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

  if (match?.step) {
    const handoffActionId = match.action?.id
    const matchedBranchId = match.action?.branchId ?? match.step.branches?.find((branch) => branch.status === 'matched')?.id

    for (const action of match.step.actions ?? []) {
      clearRunBlocker(run, `action:${action.id}`)
      if (action.id === handoffActionId) {
        action.status = 'completed'
        continue
      }
      if (action.status !== 'completed') {
        action.status = 'skipped'
      }
    }

    if (matchedBranchId) {
      for (const branch of match.step.branches ?? []) {
        if (branch.id === matchedBranchId) {
          branch.status = 'matched'
          branch.reason = branch.reason || 'Persisted human handoff evidence observed.'
        } else {
          branch.status = 'skipped'
          branch.reason = 'Another branch already matched.'
        }
      }
    }

    match.step.status = 'completed'
    match.step.completedAt = createdAt
    match.step.completionReason = taskId
      ? `Persisted human handoff task ${taskId} created.`
      : 'Persisted human handoff created.'
  }

  run.blockers = []
  run.status = 'paused'
  run.currentStepId = null
  run.reason = taskId
    ? `Waiting for human handoff task ${taskId}.`
    : 'Waiting for human handoff.'
  run.updatedAt = createdAt

  if (session.procedureRuntime.activeProcedureRun?.runId === run.runId) {
    session.procedureRuntime.activeProcedureRun = undefined
    if (!session.procedureRuntime.pausedProcedureRuns.some((candidate) => candidate.runId === run.runId)) {
      session.procedureRuntime.pausedProcedureRuns.push(run)
    }
  }

  appendProcedureTimeline(session, run, {
    origin: 'system',
    source: 'control',
    basedOnInputEpoch: run.inputEpoch,
    summary: taskId
      ? `ProcedureRun paused for human handoff task ${taskId}`
      : 'ProcedureRun paused for human handoff',
    metadata: {
      terminal: true,
      waitingHuman: true,
      taskId,
      queue,
      persisted: true,
    },
  })
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
): { step: ProcedureRunStepState; action?: ProcedureRunActionState } | null {
  const stepsInPriority = [
    ...(run.currentStepId ? run.steps.filter((step) => step.id === run.currentStepId) : []),
    ...run.steps.filter((step) => step.id !== run.currentStepId),
  ]

  for (const step of stepsInPriority) {
    const action = (step.actions ?? []).find((candidate) => actionMatchesTool(candidate, toolName))
    if (action) return { step, action }
    if (stepMatchesLegacyTool(step, toolName)) return { step }
  }

  return null
}

function actionMatchesTool(action: ProcedureRunActionState, toolName: string): boolean {
  switch (action.kind) {
    case 'call_tool':
      return action.target === toolName
    case 'search_knowledge':
      return toolName.startsWith('kb_search_')
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

function stepMatchesLegacyTool(step: ProcedureRunStepState, toolName: string): boolean {
  if (step.actions?.length) return false
  if (step.target && step.target === toolName) return true
  if (step.action === 'ask' && toolName === 'ask_user_questions') return true
  if (step.action === 'escalate' && toolName === 'create_human_task') return true
  if (step.action === 'finalize' && toolName === 'finalize_procedure') return true
  return false
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
  if (run.procedureVersion === 'v2') {
    const incompleteRequiredSteps = run.steps.filter((step) =>
      step.required !== false &&
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
    legacyFacts: { ...run.legacyFacts },
    blockers: [...run.blockers],
    timeline: run.timeline.map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined })),
    definition: run.definition ? JSON.parse(JSON.stringify(run.definition)) as ProcedureDefinition : undefined,
  }
}

/**
 * session-store.ts — In-memory session registry for runtime Agent loops.
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
 *     purges sessions idle for > SESSION_TTL_MS.
 *   - On server restart all sessions are lost; the SSE endpoint reinitialises
 *     AgentLoop from DB (same as the old per-message /api/messages path).
 *
 * R3 boundary:
 *   ProcedureRun state is authoritative only inside this in-memory runtime
 *   tracker. It is intentionally not persisted to ChatMemory/UserProfile or a
 *   Prisma table in V1. This is acceptable for the current single-process,
 *   restart-loses-active-runtime deployment; multi-instance or restart-safe
 *   ProcedureRuns require Redis/leases or a later schema lane.
 */

import type { AgentLoop } from './loop'
import type { Procedure, ContentBlock } from '@intera/shared/types'

// ─── Queued message shape ─────────────────────────────────────────────────────

export type RuntimeEventOrigin = 'customer' | 'operator' | 'system' | 'human'
export type RuntimeEventSource =
  | 'customer_message'
  | 'customer_form_result'
  | 'human_task_result'
  | 'tool_call'
  | 'tool_result'
  | 'text_reply'
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
  status: ProcedureStepStatus
  startedAt?: string
  completedAt?: string
  evidenceToolCallIds: string[]
}

export interface ProcedureRunState {
  runId: string
  procedureId: string
  caseType: string
  displayName: string
  status: ProcedureRunStatus
  inputEpoch: number
  lastReconciledInputEpoch: number
  needsReconcile: boolean
  currentStepId: string | null
  steps: ProcedureRunStepState[]
  evidenceToolCallIds: string[]
  facts: Record<string, unknown>
  blockers: string[]
  timeline: RuntimeEvent[]
  reason?: string
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
  aborted: boolean
  lastActiveAt: number
}

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

export function startProcedureRun(caseId: string, input: {
  procedureId: string
  displayName: string
  procedure?: Procedure
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
    if (input.collectedFacts) active.facts = { ...active.facts, ...filterRuntimeAuthorityKeys(input.collectedFacts) }
    active.updatedAt = now
    appendProcedureTimeline(session, active, {
      origin: 'system',
      source: 'tool_call',
      summary: `start_procedure idempotent for ${input.procedureId}`,
      metadata: { idempotent: true, requestId: input.requestId },
    })
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
    state.activeProcedureRun = undefined
  }

  const resumedIndex = state.pausedProcedureRuns.findIndex((run) => run.procedureId === input.procedureId)
  const resumed = resumedIndex >= 0 ? state.pausedProcedureRuns.splice(resumedIndex, 1)[0] : undefined
  const run: ProcedureRunState = resumed
    ? {
        ...resumed,
        status: 'active',
        inputEpoch: session.latestInputEpoch,
        reason: input.reason ?? resumed.reason,
        confidence: input.confidence ?? resumed.confidence,
        facts: { ...resumed.facts, ...filterRuntimeAuthorityKeys(input.collectedFacts ?? {}) },
        updatedAt: now,
        lastStartRequestId: input.requestId ?? resumed.lastStartRequestId,
      }
    : {
        runId: `proc_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        procedureId: input.procedureId,
        caseType: input.procedureId,
        displayName: input.displayName,
        status: 'active',
        inputEpoch: session.latestInputEpoch,
        lastReconciledInputEpoch: session.latestInputEpoch,
        needsReconcile: false,
        currentStepId: null,
        steps: buildInitialSteps(input.procedure),
        evidenceToolCallIds: [],
        facts: filterRuntimeAuthorityKeys(input.collectedFacts ?? {}),
        blockers: [],
        timeline: [],
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
  state.activeProcedureRun = run
  appendProcedureTimeline(session, run, {
    origin: 'system',
    source: 'tool_call',
    summary: `${resumed ? 'Resumed' : 'Started'} ProcedureRun ${run.procedureId}`,
    metadata: { requestId: input.requestId, idempotent: false },
  })
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
  return appendProcedureTimeline(session, run, {
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
  const evidenceId = input.toolUseId ?? `${input.toolName}:${Date.now()}`
  if (!run.evidenceToolCallIds.includes(evidenceId)) run.evidenceToolCallIds.push(evidenceId)

  const currentStep = run.steps.find((step) => step.id === run.currentStepId)
  if (currentStep && !currentStep.evidenceToolCallIds.includes(evidenceId)) {
    currentStep.evidenceToolCallIds.push(evidenceId)
  }

  if (stale) {
    run.needsReconcile = true
    run.blockers = [...new Set([...run.blockers, 'New customer input arrived after this tool/action began.'])]
  } else {
    maybeAdvanceCurrentStep(run, input.toolName)
  }

  appendProcedureTimeline(session, run, {
    origin: 'system',
    source: 'tool_result',
    basedOnInputEpoch: basedOn,
    summary: `Tool result ${stale ? 'stored as stale evidence' : 'accepted'}: ${input.toolName}`,
    metadata: {
      toolName: input.toolName,
      toolUseId: input.toolUseId,
      output: input.toolOutput,
      error: input.toolError,
      evidenceState: stale ? 'stale' : 'canonical',
    },
  })
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
  if (stale) {
    run.needsReconcile = true
    run.blockers = [...new Set([...run.blockers, 'A customer-visible reply was based on stale input.'])]
  }
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
    return { ok: false, stale: true, run: cloneRun(run), error: 'Reconcile latest customer messages before finalizing.' }
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
  return { ok: true, stale: false, run: cloneRun(run) }
}

export function procedureRunPromptTail(caseId: string): string {
  const state = sessions.get(caseId)?.procedureRuntime
  if (!state?.activeProcedureRun && !state?.pausedProcedureRuns.length) return ''
  const lines: string[] = [
    '<procedure_run_runtime>',
    'This block is dynamic runtime context. It is not chat memory or user profile.',
    'ProcedureRunState is the canonical authority for active/paused runs, currentStepId, inputEpoch, needsReconcile, stale evidence, and step status.',
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
    if (run.steps.length) {
      lines.push('')
      lines.push('Steps:')
      for (const step of run.steps) {
        const evidence = step.evidenceToolCallIds.length ? ` evidence=${step.evidenceToolCallIds.join(',')}` : ''
        const target = step.target ? ` target=${step.target}` : ''
        lines.push(`- ${step.id}: ${step.status} action=${step.action}${target}${evidence}`)
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

/** Mark a session as aborted and remove it from the registry. */
export function closeSession(caseId: string): void {
  const session = sessions.get(caseId)
  if (session) {
    session.aborted = true
    session.queue.abort()
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
function cleanupStaleSessions() {
  const now = Date.now()
  for (const [caseId, session] of sessions.entries()) {
    if (now - session.lastActiveAt > SESSION_TTL_MS) {
      console.log(`[SessionStore] Evicting idle session: ${caseId}`)
      session.aborted = true
      session.queue.abort()
      sessions.delete(caseId)
    }
  }
}

// Only register the interval once per process (module is a singleton).
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupStaleSessions, 5 * 60 * 1000).unref?.()
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
  const active = session.procedureRuntime.activeProcedureRun
  if (!active || !isInputSource(event.source)) return
  active.timeline.push({ ...event, runId: active.runId })
  active.updatedAt = event.createdAt
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

function defaultPriority(source: RuntimeEventSource): number {
  return source === 'control' ? -100 : 0
}

function buildInitialSteps(procedure?: Procedure): ProcedureRunStepState[] {
  return (procedure?.steps ?? []).map((step) => ({
    id: step.id,
    action: step.action,
    target: step.target,
    required: step.required === true ? true : undefined,
    status: 'pending',
    evidenceToolCallIds: [],
  }))
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

function maybeAdvanceCurrentStep(run: ProcedureRunState, toolName: string): void {
  const now = new Date().toISOString()
  const current = run.steps.find((step) => step.id === run.currentStepId)
  if (current && stepMatchesTool(current, toolName)) {
    current.status = 'completed'
    current.completedAt = now
    const next = run.steps.find((step) => step.status === 'pending')
    if (next) {
      next.status = 'active'
      next.startedAt = now
      run.currentStepId = next.id
    } else {
      run.currentStepId = current.id
    }
  }
}

function stepMatchesTool(step: ProcedureRunStepState, toolName: string): boolean {
  if (step.target && step.target === toolName) return true
  if (step.action === 'ask' && toolName === 'ask_user_questions') return true
  if (step.action === 'escalate' && toolName === 'create_human_task') return true
  if (step.action === 'finalize' && (toolName === 'finalize_procedure' || toolName === 'finalize_case')) return true
  return false
}

export function isRuntimeAuthorityKey(key: string): boolean {
  return [
    'runId',
    'procedureRun',
    'ProcedureRun',
    'procedureRunState',
    'currentStepId',
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

function cloneRun(run: ProcedureRunState): ProcedureRunState {
  return {
    ...run,
    steps: run.steps.map((step) => ({ ...step, evidenceToolCallIds: [...step.evidenceToolCallIds] })),
    evidenceToolCallIds: [...run.evidenceToolCallIds],
    facts: { ...run.facts },
    blockers: [...run.blockers],
    timeline: run.timeline.map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined })),
  }
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  bindProcedureRuntimeAgentConfig,
  cleanupStaleSessionsForTest,
  clearSessionsForTest,
  closeSession,
  finalizeProcedureRun,
  flushProcedureRunPersistence,
  getActiveProcedureRun,
  getOrCreateSession,
  getProcedureRuntime,
  hydrateProcedureRuntime,
  latestInputEpoch,
  reconcileProcedureInput,
  recordInitialInputEvent,
  recordProcedureConditionEvaluation,
  recordProcedureTextReply,
  recordProcedureToolCall,
  recordProcedureToolResult,
  setProcedureRunPersistenceForTest,
  sessionCount,
  startProcedureRun,
} from '../../session-store'

type PersistedRecord = {
  id: string
  caseId: string
  agentConfigId: string
  procedureId: string
  status: string
  inputEpoch: number
  needsReconcile: boolean
  currentStepId: string | null
  outcome: string | null
  state: unknown
  createdAt?: Date | string
  updatedAt?: Date | string
}

class MemoryProcedureRunPersistence {
  readonly epochs = new Map<string, number>()
  readonly runs = new Map<string, PersistedRecord>()

  async loadProcedureRuntime(caseId: string) {
    return {
      latestInputEpoch: this.epochs.get(caseId) ?? 0,
      runs: [...this.runs.values()]
        .filter((run) => run.caseId === caseId)
        .map(clone),
    }
  }

  async saveProcedureRun(record: PersistedRecord) {
    this.runs.set(record.id, {
      ...clone(record),
      updatedAt: record.updatedAt ?? new Date().toISOString(),
    })
  }

  async saveCaseInputEpoch(caseId: string, inputEpoch: number) {
    this.epochs.set(caseId, inputEpoch)
  }
}

class ControlledMemoryProcedureRunPersistence extends MemoryProcedureRunPersistence {
  holdRunSaves = false
  pendingRunSaves = 0
  private releaseRunSaveCallbacks: Array<() => void> = []

  override async saveProcedureRun(record: PersistedRecord) {
    if (this.holdRunSaves) {
      this.pendingRunSaves += 1
      await new Promise<void>((resolve) => {
        this.releaseRunSaveCallbacks.push(resolve)
      })
      this.pendingRunSaves -= 1
    }
    await super.saveProcedureRun(record)
  }

  releaseRunSaves() {
    this.holdRunSaves = false
    for (const release of this.releaseRunSaveCallbacks.splice(0)) {
      release()
    }
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function activePausedRuntime(caseId: string) {
  const runtime = getProcedureRuntime(caseId)
  return {
    activeProcedureRun: runtime.activeProcedureRun,
    pausedProcedureRuns: runtime.pausedProcedureRuns,
  }
}

async function expectHydratesToSameActivePaused(adapter: MemoryProcedureRunPersistence, caseId: string) {
  await flushProcedureRunPersistence(caseId)
  const before = clone(activePausedRuntime(caseId))
  clearSessionsForTest(caseId)
  await hydrateProcedureRuntime(caseId, { agentConfigId: 'agent-1' })
  expect(clone(activePausedRuntime(caseId))).toEqual(before)
  expect(adapter.runs.size).toBeGreaterThan(0)
}

function bindCase(caseId: string) {
  bindProcedureRuntimeAgentConfig(caseId, 'agent-1')
}

function startSimpleRun(caseId: string) {
  bindCase(caseId)
  recordInitialInputEvent(caseId, { content: 'start' })
  return startProcedureRun(caseId, {
    agentConfigId: 'agent-1',
    procedureId: 'deposit_issue',
    displayName: 'Deposit',
    procedure: {
      version: 'v2',
      whenToUse: 'Use for deposit issues.',
      steps: [
        {
          id: 'lookup',
          title: 'Lookup deposit',
          guidance: 'Run lookup.',
          actions: [
            {
              id: 'lookup_latest',
              kind: 'call_tool',
              label: 'Lookup latest deposit',
              toolName: 'get_latest_deposit',
            },
          ],
          branches: [],
        },
      ],
    },
  })
}

async function letPersistQueueStart() {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  clearSessionsForTest()
})

afterEach(() => {
  setProcedureRunPersistenceForTest(null)
  clearSessionsForTest()
})

describe('ProcedureRun durability', () => {
  it('awaits cancelled ProcedureRun persistence before closeSession drops the session', async () => {
    const adapter = new ControlledMemoryProcedureRunPersistence()
    setProcedureRunPersistenceForTest(adapter)
    const caseId = 'durable-close-flush'
    const started = startSimpleRun(caseId)
    await flushProcedureRunPersistence(caseId)
    expect(adapter.runs.get(started.run.runId)).toMatchObject({ status: 'active' })

    adapter.holdRunSaves = true
    const closePromise = closeSession(caseId)
    await letPersistQueueStart()

    expect(adapter.pendingRunSaves).toBeGreaterThan(0)
    expect(sessionCount()).toBe(1)
    expect(adapter.runs.get(started.run.runId)).toMatchObject({ status: 'active' })

    adapter.releaseRunSaves()
    await closePromise

    expect(sessionCount()).toBe(0)
    expect(adapter.runs.get(started.run.runId)).toMatchObject({
      status: 'cancelled',
      outcome: 'abandoned',
    })
  })

  it('awaits paused ProcedureRun persistence before TTL eviction drops the session', async () => {
    const adapter = new ControlledMemoryProcedureRunPersistence()
    setProcedureRunPersistenceForTest(adapter)
    const caseId = 'durable-ttl-flush'
    const started = startSimpleRun(caseId)
    await flushProcedureRunPersistence(caseId)
    expect(adapter.runs.get(started.run.runId)).toMatchObject({ status: 'active' })

    const session = getOrCreateSession(caseId)
    session.lastActiveAt = Date.now() - (31 * 60 * 1000)
    adapter.holdRunSaves = true

    const cleanupPromise = cleanupStaleSessionsForTest(Date.now())
    await letPersistQueueStart()

    expect(adapter.pendingRunSaves).toBeGreaterThan(0)
    expect(sessionCount()).toBe(1)
    expect(adapter.runs.get(started.run.runId)).toMatchObject({ status: 'active' })

    adapter.releaseRunSaves()
    await cleanupPromise

    expect(sessionCount()).toBe(0)
    expect(adapter.runs.get(started.run.runId)).toMatchObject({
      status: 'paused',
      state: expect.objectContaining({
        status: 'paused',
        reason: 'session evicted',
      }),
    })
  })

  it('persists Case.runtimeInputEpoch across session restart', async () => {
    const adapter = new MemoryProcedureRunPersistence()
    setProcedureRunPersistenceForTest(adapter)
    const caseId = 'durable-epoch-case'

    bindCase(caseId)
    recordInitialInputEvent(caseId, { content: 'first input' })
    await flushProcedureRunPersistence(caseId)
    expect(adapter.epochs.get(caseId)).toBe(1)

    clearSessionsForTest(caseId)
    await hydrateProcedureRuntime(caseId, { agentConfigId: 'agent-1' })
    expect(latestInputEpoch(caseId)).toBe(1)

    recordInitialInputEvent(caseId, { content: 'second input' })
    await flushProcedureRunPersistence(caseId)
    expect(latestInputEpoch(caseId)).toBe(2)
    expect(adapter.epochs.get(caseId)).toBe(2)
  })

  it('persists fresh ProcedureRun steps without legacy normalized step fields', async () => {
    const adapter = new MemoryProcedureRunPersistence()
    setProcedureRunPersistenceForTest(adapter)
    const caseId = 'durable-v2-step-shape'

    const started = startSimpleRun(caseId)
    await flushProcedureRunPersistence(caseId)

    const persisted = adapter.runs.get(started.run.runId)
    const step = (persisted?.state as { steps?: Array<Record<string, unknown>> } | undefined)?.steps?.[0]
    expect(step).toBeDefined()
    expect(step).not.toHaveProperty('action')
    expect(step).not.toHaveProperty('target')
    expect(step).not.toHaveProperty('required')
    expect(step).toMatchObject({
      id: 'lookup',
      title: 'Lookup deposit',
      actions: [
        expect.objectContaining({
          id: 'lookup_latest',
          kind: 'call_tool',
          target: 'get_latest_deposit',
        }),
      ],
    })
  })

  it('hydrates legacy-normalized persisted steps into the v2 runtime shape', async () => {
    const adapter = new MemoryProcedureRunPersistence()
    setProcedureRunPersistenceForTest(adapter)
    const caseId = 'durable-legacy-step-hydrate'
    const now = new Date().toISOString()

    adapter.epochs.set(caseId, 1)
    adapter.runs.set('legacy-run', {
      id: 'legacy-run',
      caseId,
      agentConfigId: 'agent-1',
      procedureId: 'deposit_issue',
      status: 'paused',
      inputEpoch: 1,
      needsReconcile: false,
      currentStepId: 'lookup',
      outcome: null,
      state: {
        runId: 'legacy-run',
        agentConfigId: 'agent-1',
        procedureId: 'deposit_issue',
        caseType: 'deposit_issue',
        displayName: 'Deposit',
        status: 'paused',
        inputEpoch: 1,
        lastReconciledInputEpoch: 1,
        needsReconcile: false,
        currentStepId: 'lookup',
        steps: [
          {
            id: 'lookup',
            action: 'use',
            target: 'get_latest_deposit',
            required: true,
            title: 'Lookup deposit',
            guidance: 'Run lookup.',
            status: 'active',
            evidenceToolCallIds: [],
            actions: [
              {
                id: 'lookup_latest',
                kind: 'call_tool',
                label: 'Lookup latest deposit',
                target: 'get_latest_deposit',
                status: 'pending',
                evidenceIds: [],
              },
            ],
            branches: [],
          },
        ],
        inputs: [],
        evidenceToolCallIds: [],
        evidence: [],
        evaluations: [],
        signals: [],
        blockers: [],
        timeline: [],
        definition: {
          version: 'v2',
          whenToUse: 'Use for deposit issues.',
          steps: [
            {
              id: 'lookup',
              title: 'Lookup deposit',
              guidance: 'Run lookup.',
              actions: [
                {
                  id: 'lookup_latest',
                  kind: 'call_tool',
                  label: 'Lookup latest deposit',
                  toolName: 'get_latest_deposit',
                },
              ],
              branches: [],
            },
          ],
        },
        startedAt: now,
        updatedAt: now,
      },
    })

    await hydrateProcedureRuntime(caseId, { agentConfigId: 'agent-1' })

    const hydrated = getProcedureRuntime(caseId).pausedProcedureRuns[0]
    expect(hydrated).toBeDefined()
    expect(hydrated?.steps[0]).not.toHaveProperty('action')
    expect(hydrated?.steps[0]).not.toHaveProperty('target')
    expect(hydrated?.steps[0]).not.toHaveProperty('required')
    expect(hydrated?.steps[0]).toMatchObject({
      id: 'lookup',
      actions: [
        expect.objectContaining({
          id: 'lookup_latest',
          kind: 'call_tool',
          target: 'get_latest_deposit',
        }),
      ],
    })
  })

  it('rehydrates a persisted handoff run as finalized instead of resumable', async () => {
    const adapter = new MemoryProcedureRunPersistence()
    setProcedureRunPersistenceForTest(adapter)
    const caseId = 'durable-handoff-resume'

    bindCase(caseId)
    recordInitialInputEvent(caseId, { content: 'Please connect me to support.' })
    const started = startProcedureRun(caseId, {
      agentConfigId: 'agent-1',
      procedureId: 'human_support_requested',
      displayName: 'Human support',
      procedure: {
        version: 'v2',
        whenToUse: 'Use when the customer asks for a person.',
        steps: [
          {
            id: 'handoff',
            title: 'Create human task',
            guidance: 'Persist a human handoff task.',
            actions: [],
            branches: [
              {
                id: 'needs_person',
                kind: 'if',
                condition: {
                  id: 'needs_person_eval',
                  kind: 'llm_eval',
                  prompt: 'Did the customer ask for a person?',
                },
                actions: [
                  {
                    id: 'handoff_now',
                    kind: 'request_human_handoff',
                    label: 'Hand off',
                    queue: 'general',
                  },
                ],
              },
            ],
          },
        ],
      },
    })
    recordProcedureConditionEvaluation(caseId, {
      runId: started.run.runId,
      branchId: 'needs_person',
      conditionId: 'needs_person_eval',
      label: 'human requested',
      decision: 'matched',
      reason: 'The customer explicitly asked for support.',
      basedOnInputEpoch: 1,
      model: 'test-evaluator',
    })
    recordProcedureToolCall(caseId, {
      toolName: 'create_human_task',
      toolUseId: 'handoff-1',
      basedOnInputEpoch: 1,
    })
    recordProcedureToolResult(caseId, {
      toolName: 'create_human_task',
      toolUseId: 'handoff-1',
      basedOnInputEpoch: 1,
      toolOutput: { taskId: 'task-1', queue: 'general', status: 'pending', persisted: true },
    })
    await flushProcedureRunPersistence(caseId)

    const completedBeforeRestart = getProcedureRuntime(caseId).completedProcedureRuns[0]
    expect(completedBeforeRestart).toMatchObject({
      runId: started.run.runId,
      status: 'completed',
      inputEpoch: 1,
      currentStepId: null,
      outcome: 'handed_off',
      reason: 'Finalized after human handoff task task-1.',
    })

    clearSessionsForTest(caseId)
    await hydrateProcedureRuntime(caseId, { agentConfigId: 'agent-1' })
    expect(clone(getProcedureRuntime(caseId).completedProcedureRuns[0])).toEqual(clone(completedBeforeRestart))

    recordInitialInputEvent(caseId, {
      content: '[Human task resolved] Operator says the customer can continue.',
      source: 'human_task_result',
      origin: 'human',
    })
    await flushProcedureRunPersistence(caseId)

    expect(getActiveProcedureRun(caseId)).toBeUndefined()
    const completedAfterHumanResult = getProcedureRuntime(caseId).completedProcedureRuns[0]
    expect(completedAfterHumanResult).toMatchObject({
      runId: started.run.runId,
      status: 'completed',
      inputEpoch: 1,
      reason: 'Finalized after human handoff task task-1.',
      outcome: 'handed_off',
    })
    expect(completedAfterHumanResult?.inputs.map((input) => input.source)).toEqual(['customer_message'])
    expect(completedAfterHumanResult?.evidence.find((entry) => entry.id === 'handoff-1')).toMatchObject({
      kind: 'handoff',
      state: 'canonical',
    })
    expect(completedAfterHumanResult?.evaluations[0]).toMatchObject({
      branchId: 'needs_person',
      decision: 'matched',
    })
    expect(completedAfterHumanResult?.timeline.map((event) => event.source)).toEqual(
      expect.arrayContaining(['tool_call', 'tool_result', 'control']),
    )
    expect(adapter.epochs.get(caseId)).toBe(2)
  })

  it('rehydrates active/paused ProcedureRun state after each mutating transition', async () => {
    const adapter = new MemoryProcedureRunPersistence()
    setProcedureRunPersistenceForTest(adapter)
    const caseId = 'durable-invariant-case'

    bindCase(caseId)
    recordInitialInputEvent(caseId, { content: 'I need deposit help.' })
    startProcedureRun(caseId, {
      agentConfigId: 'agent-1',
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit issues.',
        steps: [
          {
            id: 'lookup',
            title: 'Lookup deposit',
            guidance: 'Run the deposit lookup.',
            actions: [
              {
                id: 'lookup_latest',
                kind: 'call_tool',
                label: 'Lookup latest deposit',
                toolName: 'get_latest_deposit',
              },
            ],
            branches: [],
          },
        ],
      },
    })
    await expectHydratesToSameActivePaused(adapter, caseId)

    recordProcedureToolCall(caseId, {
      toolName: 'get_latest_deposit',
      toolUseId: 'tool-1',
      basedOnInputEpoch: 1,
    })
    await expectHydratesToSameActivePaused(adapter, caseId)

    recordProcedureToolResult(caseId, {
      toolName: 'get_latest_deposit',
      toolUseId: 'tool-1',
      basedOnInputEpoch: 1,
      toolOutput: { status: 'found', amount: 500 },
    })
    await expectHydratesToSameActivePaused(adapter, caseId)

    recordInitialInputEvent(caseId, { content: 'The amount was 500.' })
    await expectHydratesToSameActivePaused(adapter, caseId)

    recordProcedureTextReply(caseId, { text: 'I found the deposit.', basedOnInputEpoch: 1 })
    await expectHydratesToSameActivePaused(adapter, caseId)

    const active = getActiveProcedureRun(caseId)
    reconcileProcedureInput(caseId, {
      runId: active?.runId ?? 'missing',
      upToInputEpoch: 2,
      decision: 'continue',
      summary: 'Included the latest amount.',
    })
    await expectHydratesToSameActivePaused(adapter, caseId)

    finalizeProcedureRun(caseId, {
      runId: getActiveProcedureRun(caseId)?.runId,
      basedOnInputEpoch: 2,
      summary: 'Procedure complete.',
    })
    await flushProcedureRunPersistence(caseId)
    clearSessionsForTest(caseId)
    await hydrateProcedureRuntime(caseId, { agentConfigId: 'agent-1' })
    expect(activePausedRuntime(caseId)).toEqual({
      activeProcedureRun: undefined,
      pausedProcedureRuns: [],
    })
    expect([...adapter.runs.values()][0]).toMatchObject({
      status: 'completed',
      outcome: 'resolved_by_agent',
    })
  })
})

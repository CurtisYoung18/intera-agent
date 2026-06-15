import { prisma } from '@intera/shared/prisma'
import type { PersistedProcedureRunRecord } from '@intera/runtime-core/procedure-run-hydration'

export interface HydratedProcedureRuntime {
  latestInputEpoch: number
  runs: PersistedProcedureRunRecord[]
}

export interface ProcedureRunPersistenceAdapter {
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
        where: { caseId },
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

export async function loadProcedureRuntime(caseId: string): Promise<HydratedProcedureRuntime> {
  return procedureRunPersistence.loadProcedureRuntime(caseId)
}

export function enqueueCaseInputEpochPersist(caseId: string, inputEpoch: number): void {
  const previous = caseEpochPersistQueues.get(caseId) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => procedureRunPersistence.saveCaseInputEpoch(caseId, inputEpoch))
  caseEpochPersistQueues.set(caseId, next)
  void next.catch((error) => {
    console.error('[SessionStore] Failed to persist Case.runtimeInputEpoch:', error)
  })
}

export function enqueueProcedureRunPersist(queueKey: string, record: PersistedProcedureRunRecord): void {
  const previous = runPersistQueues.get(queueKey) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => procedureRunPersistence.saveProcedureRun(record))
  runPersistQueues.set(queueKey, next)
  void next.catch((error) => {
    console.error('[SessionStore] Failed to persist ProcedureRun:', error)
  })
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

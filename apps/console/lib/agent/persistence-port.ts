// Persistence port — all DB writes from the agent pipeline flow through this interface.
// Production: PrismaPersistence (real DB). Playground: MemoryPersistence (zero side-effects).

import { prisma } from '@intera/shared/prisma'

export interface CaseRecord {
  id: string
  orgId: string
  userId: string
  type: string
  status: string
  chatId: string | null
  goal?: string | null
  blocker?: string | null
}

export interface MemoryRecord {
  caseId: string
  confirmedFacts?: string
  missingFacts?: string
  skillsCalled?: string
  skillResults?: string
  keyEvents?: string
  summary?: string | null
  todos?: string | null
  agentTodos?: string | null
  dashboardVersion?: number
  humanTaskStatus?: string
  needsContinuation?: boolean
  continuationLock?: Date | null
}

export interface MessageRecord {
  id: string
  caseId: string
  role: string
  content: string
  contentBlocks?: unknown
  isStreaming?: boolean
}

export interface TraceRecord {
  id?: string
  caseId: string
  chatId?: string | null
  actionType: string
  title: string
  detail?: string | null
  payload?: string | null
  createdAt?: string | Date
}

export interface PersistencePort {
  /** Ensure a case row exists (upsert). */
  ensureCase(record: CaseRecord): Promise<void>

  /** Persist chat memory for a case (upsert). */
  saveMemory(caseId: string, record: MemoryRecord): Promise<void>

  /** Persist new messages (upsert each). */
  saveMessages(messages: MessageRecord[]): Promise<void>

  /** Write an action trace row (or accumulate in memory). */
  saveTrace(record: TraceRecord): Promise<void>

  /** Create a human task escalation record. Memory port no-ops this. */
  createHumanTask(record: {
    caseId: string
    queue: string
    question: string
    status?: string
  }): Promise<void>

  /** Flush any buffered writes (no-op for Prisma, meaningful for batched memory). */
  flush(): Promise<void>
}

/** Factory: return the production Prisma-backed persistence port. */
export function createPrismaPersistence(): PersistencePort {
  return {
    async ensureCase(record: CaseRecord) {
      await prisma.case.upsert({
        where: { id: record.id },
        update: { status: record.status, type: record.type },
        create: record,
      })
    },

    async saveMemory(caseId: string, record: MemoryRecord) {
      await prisma.chatMemory.upsert({
        where: { caseId },
        update: {
          confirmedFacts: record.confirmedFacts,
          missingFacts: record.missingFacts,
          skillsCalled: record.skillsCalled,
          skillResults: record.skillResults,
          keyEvents: record.keyEvents,
          summary: record.summary ?? undefined,
          todos: record.todos ?? null,
          agentTodos: record.agentTodos ?? null,
          dashboardVersion: record.dashboardVersion ?? 0,
        },
        create: {
          caseId,
          confirmedFacts: record.confirmedFacts,
          missingFacts: record.missingFacts,
          skillsCalled: record.skillsCalled,
          skillResults: record.skillResults,
          keyEvents: record.keyEvents,
          humanTaskStatus: 'none',
          summary: record.summary ?? undefined,
          todos: record.todos ?? null,
          agentTodos: record.agentTodos ?? null,
          dashboardVersion: record.dashboardVersion ?? 0,
        },
      })
    },

    async saveMessages(messages: MessageRecord[]) {
      if (messages.length === 0) return
      await prisma.$transaction(
        messages.map((msg) =>
          prisma.message.upsert({
            where: { id: msg.id },
            update: { content: msg.content, contentBlocks: msg.contentBlocks ?? undefined, isStreaming: false },
            create: msg,
          }),
        ),
      )
    },

    async saveTrace(record: TraceRecord) {
      await prisma.actionTrace.create({
        data: {
          id: record.id,
          caseId: record.caseId,
          chatId: record.chatId ?? null,
          actionType: record.actionType,
          title: record.title,
          detail: record.detail ?? null,
          payload: record.payload ?? null,
        },
      })
    },

    async createHumanTask(record) {
      await prisma.humanTask.create({
        data: {
          caseId: record.caseId,
          queue: record.queue,
          question: record.question,
          status: record.status ?? 'pending',
        },
      })
    },

    async flush() {
      // Prisma writes are immediate — no buffering needed
    },
  }
}

/** Factory: return an in-memory persistence port (no DB writes). */
export function createMemoryPersistence(): {
  port: PersistencePort
  cases: CaseRecord[]
  memories: MemoryRecord[]
  messages: MessageRecord[]
  traces: TraceRecord[]
  humanTasks: { caseId: string; queue: string; question: string; status?: string }[]
} {
  const cases: CaseRecord[] = []
  const memories: MemoryRecord[] = []
  const messages: MessageRecord[] = []
  const traces: TraceRecord[] = []
  const humanTasks: { caseId: string; queue: string; question: string; status?: string }[] = []

  const port: PersistencePort = {
    async ensureCase(record: CaseRecord) {
      const idx = cases.findIndex((c) => c.id === record.id)
      if (idx >= 0) cases[idx] = record
      else cases.push(record)
    },

    async saveMemory(_caseId: string, record: MemoryRecord) {
      const idx = memories.findIndex((m) => m.caseId === record.caseId)
      if (idx >= 0) memories[idx] = record
      else memories.push(record)
    },

    async saveMessages(msgs: MessageRecord[]) {
      for (const msg of msgs) {
        const idx = messages.findIndex((m) => m.id === msg.id)
        if (idx >= 0) messages[idx] = msg
        else messages.push(msg)
      }
    },

    async saveTrace(record: TraceRecord) {
      traces.push(record)
    },

    async createHumanTask(record) {
      humanTasks.push(record) // accumulate in memory, no real DB write
    },

    async flush() {
      // no-op — everything is already in-memory
    },
  }

  return { port, cases, memories, messages, traces, humanTasks }
}

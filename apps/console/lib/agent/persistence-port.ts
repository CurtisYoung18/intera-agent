// Persistence port — all DB writes from the agent pipeline flow through this interface.
// Production: PrismaPersistence (real DB). Playground: MemoryPersistence (zero side-effects).

import { prisma } from '@intera/shared/prisma'

export interface CaseRecord {
  id: string
  orgId: string
  userId: string
  type: string
  status: string
  chatId: string
  goal?: string | null
  blocker?: string | null
}

export interface MemoryRecord {
  caseId: string
  contextMap?: string
  missingFacts?: string
  toolsCalled?: string
  toolResults?: string
  keyEvents?: string
  summary?: string | null
  todos?: string | null
  humanTaskStatus?: string
}

export interface MessageRecord {
  id: string
  caseId: string
  role: string
  content: string
  createdAt?: Date
  contentBlocks?: unknown
  providerContent?: unknown
  providerMeta?: unknown
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
    id?: string
    caseId: string
    queue: string
    question: string
    fields?: string | null
    status?: string
  }): Promise<{ id: string }>

  /** Flush any buffered writes (no-op for Prisma, meaningful for batched memory). */
  flush(): Promise<void>
}

/** Factory: return the production Prisma-backed persistence port. */
export function createPrismaPersistence(): PersistencePort {
  return {
    async ensureCase(record: CaseRecord) {
      await prisma.case.upsert({
        where: { id: record.id },
        update: {
          status: record.status,
          type: record.type,
          goal: record.goal ?? undefined,
          blocker: record.blocker ?? undefined,
          chatId: record.chatId,
        },
        create: record,
      })
    },

    async saveMemory(caseId: string, record: MemoryRecord) {
      await prisma.chatMemory.upsert({
        where: { caseId },
        update: {
          contextMap: record.contextMap,
          missingFacts: record.missingFacts,
          toolsCalled: record.toolsCalled,
          toolResults: record.toolResults,
          keyEvents: record.keyEvents,
          humanTaskStatus: record.humanTaskStatus,
          summary: record.summary ?? undefined,
          todos: record.todos ?? null,
        },
        create: {
          caseId,
          contextMap: record.contextMap,
          missingFacts: record.missingFacts,
          toolsCalled: record.toolsCalled,
          toolResults: record.toolResults,
          keyEvents: record.keyEvents,
          humanTaskStatus: 'none',
          summary: record.summary ?? undefined,
          todos: record.todos ?? null,
        },
      })
    },

    async saveMessages(messages: MessageRecord[]) {
      if (messages.length === 0) return
      await prisma.$transaction(
        messages.map((msg) =>
          prisma.message.upsert({
            where: { id: msg.id },
            update: {
              content: msg.content,
              contentBlocks: msg.contentBlocks ?? undefined,
              providerContent: msg.providerContent ?? undefined,
              providerMeta: msg.providerMeta ?? undefined,
              isStreaming: false,
            },
            create: msg as any,
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
      const task = await prisma.humanTask.create({
        data: {
          id: record.id,
          caseId: record.caseId,
          queue: record.queue,
          question: record.question,
          fields: record.fields ?? null,
          status: record.status ?? 'pending',
        },
      })
      return { id: task.id }
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
  humanTasks: { id: string; caseId: string; queue: string; question: string; fields?: string | null; status?: string }[]
} {
  const cases: CaseRecord[] = []
  const memories: MemoryRecord[] = []
  const messages: MessageRecord[] = []
  const traces: TraceRecord[] = []
  const humanTasks: { id: string; caseId: string; queue: string; question: string; fields?: string | null; status?: string }[] = []

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
      const id = record.id ?? crypto.randomUUID()
      humanTasks.push({ ...record, id }) // accumulate in memory, no real DB write
      return { id }
    },

    async flush() {
      // no-op — everything is already in-memory
    },
  }

  return { port, cases, memories, messages, traces, humanTasks }
}

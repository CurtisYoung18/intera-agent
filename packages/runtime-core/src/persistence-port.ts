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
  orgId?: string
  chatId?: string
  runId?: string | null
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
  orgId?: string
  chatId?: string
  runId?: string | null
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
  orgId?: string
  chatId?: string | null
  runId?: string | null
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
    orgId?: string
    chatId?: string
    runId?: string | null
    queue: string
    question: string
    fields?: string | null
    status?: string
  }): Promise<{ id: string }>

  /** Flush any buffered writes (no-op for Prisma, meaningful for batched memory). */
  flush(): Promise<void>
}

interface CaseOwnership {
  orgId: string
  chatId: string
  runId?: string | null
}

function caseOwnershipCacheKey(caseId: string) {
  return caseId
}

/** Factory: return the production Prisma-backed persistence port. */
export function createPrismaPersistence(): PersistencePort {
  const ownershipCache = new Map<string, CaseOwnership>()

  async function resolveOwnership(caseId: string): Promise<CaseOwnership> {
    const key = caseOwnershipCacheKey(caseId)
    const cached = ownershipCache.get(key)
    if (cached?.runId) return cached

    const [caseRow, activeRun] = await Promise.all([
      prisma.case.findUnique({
        where: { id: caseId },
        select: { orgId: true, chatId: true },
      }),
      prisma.procedureRun.findFirst({
        where: { caseId, status: { in: ['active', 'paused'] } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      }).catch(() => null),
    ])

    const ownership: CaseOwnership = {
      orgId: cached?.orgId ?? caseRow?.orgId ?? 'default',
      chatId: cached?.chatId ?? caseRow?.chatId ?? caseId,
      runId: activeRun?.id ?? null,
    }
    ownershipCache.set(key, ownership)
    return ownership
  }

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
      ownershipCache.set(caseOwnershipCacheKey(record.id), {
        orgId: record.orgId,
        chatId: record.chatId,
        runId: null,
      })
    },

    async saveMemory(caseId: string, record: MemoryRecord) {
      const ownership = await resolveOwnership(caseId)
      const orgId = record.orgId ?? ownership.orgId
      const chatId = record.chatId ?? ownership.chatId
      const runId = record.runId ?? ownership.runId ?? null
      await prisma.chatMemory.upsert({
        where: { caseId },
        update: {
          orgId,
          chatId,
          runId,
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
          orgId,
          chatId,
          runId,
          contextMap: record.contextMap,
          missingFacts: record.missingFacts,
          toolsCalled: record.toolsCalled,
          toolResults: record.toolResults,
          keyEvents: record.keyEvents,
          humanTaskStatus: record.humanTaskStatus ?? 'none',
          summary: record.summary ?? undefined,
          todos: record.todos ?? null,
        },
      })
    },

    async saveMessages(messages: MessageRecord[]) {
      if (messages.length === 0) return
      const ownershipByCase = new Map<string, CaseOwnership>()
      for (const caseId of new Set(messages.map((msg) => msg.caseId))) {
        ownershipByCase.set(caseId, await resolveOwnership(caseId))
      }
      const enrichedMessages = messages.map((msg) => {
        const ownership = ownershipByCase.get(msg.caseId)
        return {
          ...msg,
          orgId: msg.orgId ?? ownership?.orgId ?? 'default',
          chatId: msg.chatId ?? ownership?.chatId ?? msg.caseId,
          runId: msg.runId ?? ownership?.runId ?? null,
        }
      })
      await prisma.$transaction(
        enrichedMessages.map((msg) =>
          prisma.message.upsert({
            where: { id: msg.id },
            update: {
              orgId: msg.orgId,
              chatId: msg.chatId,
              runId: msg.runId,
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
      const ownership = await resolveOwnership(record.caseId)
      await prisma.actionTrace.create({
        data: {
          id: record.id,
          caseId: record.caseId,
          orgId: record.orgId ?? ownership.orgId,
          chatId: record.chatId ?? ownership.chatId,
          runId: record.runId ?? ownership.runId ?? null,
          actionType: record.actionType,
          title: record.title,
          detail: record.detail ?? null,
          payload: record.payload ?? null,
        },
      })
    },

    async createHumanTask(record) {
      const ownership = await resolveOwnership(record.caseId)
      const task = await prisma.humanTask.create({
        data: {
          id: record.id,
          caseId: record.caseId,
          orgId: record.orgId ?? ownership.orgId,
          chatId: record.chatId ?? ownership.chatId,
          runId: record.runId ?? ownership.runId ?? null,
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
  humanTasks: { id: string; caseId: string; orgId?: string; chatId?: string; runId?: string | null; queue: string; question: string; fields?: string | null; status?: string }[]
} {
  const cases: CaseRecord[] = []
  const memories: MemoryRecord[] = []
  const messages: MessageRecord[] = []
  const traces: TraceRecord[] = []
  const humanTasks: { id: string; caseId: string; orgId?: string; chatId?: string; runId?: string | null; queue: string; question: string; fields?: string | null; status?: string }[] = []

  const port: PersistencePort = {
    async ensureCase(record: CaseRecord) {
      const idx = cases.findIndex((c) => c.id === record.id)
      if (idx >= 0) cases[idx] = record
      else cases.push(record)
    },

    async saveMemory(_caseId: string, record: MemoryRecord) {
      const idx = memories.findIndex((m) => m.caseId === record.caseId)
      if (idx >= 0) {
        memories[idx] = {
          ...memories[idx],
          ...record,
          humanTaskStatus: record.humanTaskStatus ?? memories[idx].humanTaskStatus,
        }
      } else {
        memories.push(record)
      }
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

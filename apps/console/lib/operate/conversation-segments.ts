export const CONVERSATION_SEGMENT_IDLE_MS = 60 * 60 * 1000

export interface SegmentMessageInput {
  id?: string
  caseId?: string
  role?: string | null
  createdAt: Date | string
  isInternal?: boolean
  providerContent?: unknown
  providerMeta?: unknown
}

export interface SegmentTaskInput {
  createdAt?: Date | string | null
}

export interface SegmentCaseInput {
  id: string
  chatId: string
  createdAt: Date | string
  updatedAt: Date | string
  humanTasks?: SegmentTaskInput[]
  messages?: SegmentMessageInput[]
  _count?: { messages?: number } | null
}

export interface ConversationSegmentGroup<TCase extends SegmentCaseInput> {
  segmentId: string
  chatId: string
  segmentIndex: number
  segmentStartAt: string
  segmentEndAt: string
  windowStartAt: string
  windowEndExclusive: string | null
  lastActivity: string
  cases: TCase[]
  messageCount: number
  messageCountByCaseId: Map<string, number>
}

type ActivityEvent = {
  caseId: string
  at: Date
  isCustomerUser: boolean
  weight: number
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function hasToolResultProviderBlock(providerContent: unknown): boolean {
  return Array.isArray(providerContent) && providerContent.some((block) => (
    block && typeof block === 'object' && (block as { type?: unknown }).type === 'tool_result'
  ))
}

function isInternalMessage(message: SegmentMessageInput): boolean {
  if (message.isInternal === true) return true
  const meta = message.providerMeta && typeof message.providerMeta === 'object'
    ? message.providerMeta as { visibility?: unknown; transcriptKind?: unknown }
    : null
  return meta?.visibility === 'internal' ||
    meta?.transcriptKind === 'tool_result' ||
    hasToolResultProviderBlock(message.providerContent)
}

function activityEventsForCase(item: SegmentCaseInput): ActivityEvent[] {
  const events = (item.messages ?? [])
    .map((message) => {
      const at = toDate(message.createdAt)
      if (!at) return null
      return {
        caseId: item.id,
        at,
        isCustomerUser: String(message.role ?? '').toLowerCase() === 'user' && !isInternalMessage(message),
        weight: 1,
      }
    })
    .filter((event): event is ActivityEvent => Boolean(event))

  if (events.length > 0) return events

  const fallbackAt = toDate(item.updatedAt) ?? toDate(item.createdAt)
  return fallbackAt ? [{
    caseId: item.id,
    at: fallbackAt,
    isCustomerUser: true,
    weight: item._count?.messages ?? 1,
  }] : []
}

function segmentIdFor(chatId: string, segmentIndex: number): string {
  return `${chatId}::seg_${segmentIndex + 1}`
}

function findWindowIndex(time: Date, starts: Date[]): number {
  let index = 0
  for (let i = 1; i < starts.length; i += 1) {
    if (time >= starts[i]) index = i
    else break
  }
  return index
}

export function isTimeInsideSegment(
  value: Date | string | null | undefined,
  segment: Pick<ConversationSegmentGroup<SegmentCaseInput>, 'windowStartAt' | 'windowEndExclusive'>,
): boolean {
  const time = toDate(value)
  const start = toDate(segment.windowStartAt)
  const end = toDate(segment.windowEndExclusive)
  if (!time || !start) return false
  return time >= start && (!end || time < end)
}

export function splitCasesIntoConversationSegments<TCase extends SegmentCaseInput>(
  cases: TCase[],
  idleMs: number = CONVERSATION_SEGMENT_IDLE_MS,
): ConversationSegmentGroup<TCase>[] {
  const casesByChat = new Map<string, TCase[]>()
  for (const item of cases) {
    const key = item.chatId || item.id
    const bucket = casesByChat.get(key) ?? []
    bucket.push(item)
    casesByChat.set(key, bucket)
  }

  const groups: ConversationSegmentGroup<TCase>[] = []

  for (const [chatId, chatCases] of casesByChat) {
    const events = chatCases
      .flatMap((item) => activityEventsForCase(item))
      .sort((a, b) => a.at.getTime() - b.at.getTime())

    if (events.length === 0) {
      const latest = chatCases
        .map((item) => toDate(item.updatedAt) ?? toDate(item.createdAt))
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => a.getTime() - b.getTime())
      const start = latest[0] ?? new Date(0)
      const end = latest[latest.length - 1] ?? start
      groups.push({
        segmentId: segmentIdFor(chatId, 0),
        chatId,
        segmentIndex: 0,
        segmentStartAt: start.toISOString(),
        segmentEndAt: end.toISOString(),
        windowStartAt: start.toISOString(),
        windowEndExclusive: null,
        lastActivity: end.toISOString(),
        cases: [...chatCases],
        messageCount: chatCases.reduce((sum, item) => sum + (item._count?.messages ?? 0), 0),
        messageCountByCaseId: new Map(chatCases.map((item) => [item.id, item._count?.messages ?? 0])),
      })
      continue
    }

    const customerEvents = events.filter((event) => event.isCustomerUser)
    const starts: Date[] = []
    if (customerEvents.length === 0) {
      starts.push(events[0].at)
    } else {
      let previousCustomerAt: Date | null = null
      for (const event of customerEvents) {
        if (!previousCustomerAt || event.at.getTime() - previousCustomerAt.getTime() >= idleMs) {
          starts.push(event.at)
        }
        previousCustomerAt = event.at
      }
    }

    const segmentCases = new Map<number, Map<string, TCase>>()
    const segmentMessageCounts = new Map<number, Map<string, number>>()
    const segmentTimes = new Map<number, { start: Date; end: Date }>()

    for (const event of events) {
      const index = findWindowIndex(event.at, starts)
      const caseBucket = segmentCases.get(index) ?? new Map<string, TCase>()
      const item = chatCases.find((candidate) => candidate.id === event.caseId)
      if (item) caseBucket.set(item.id, item)
      segmentCases.set(index, caseBucket)

      const counts = segmentMessageCounts.get(index) ?? new Map<string, number>()
      counts.set(event.caseId, (counts.get(event.caseId) ?? 0) + event.weight)
      segmentMessageCounts.set(index, counts)

      const times = segmentTimes.get(index) ?? { start: event.at, end: event.at }
      if (event.at < times.start) times.start = event.at
      if (event.at > times.end) times.end = event.at
      segmentTimes.set(index, times)
    }

    for (let index = 0; index < starts.length; index += 1) {
      const times = segmentTimes.get(index) ?? { start: starts[index], end: starts[index] }
      const counts = segmentMessageCounts.get(index) ?? new Map<string, number>()
      groups.push({
        segmentId: segmentIdFor(chatId, index),
        chatId,
        segmentIndex: index,
        segmentStartAt: times.start.toISOString(),
        segmentEndAt: times.end.toISOString(),
        windowStartAt: starts[index].toISOString(),
        windowEndExclusive: starts[index + 1]?.toISOString() ?? null,
        lastActivity: times.end.toISOString(),
        cases: Array.from(segmentCases.get(index)?.values() ?? []),
        messageCount: Array.from(counts.values()).reduce((sum, count) => sum + count, 0),
        messageCountByCaseId: counts,
      })
    }
  }

  return groups.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
}

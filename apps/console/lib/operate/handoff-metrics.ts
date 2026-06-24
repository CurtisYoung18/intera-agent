export interface HandoffMetricsTaskInput {
  status?: string | null
  createdAt?: Date | string | null
  resolvedAt?: Date | string | null
}

export interface HandoffMetricsCaseInput {
  id: string
  chatId: string
  type: string
  status: string
  createdAt: Date | string
  updatedAt: Date | string
  humanTasks?: HandoffMetricsTaskInput[]
  _count?: {
    messages?: number
  } | null
}

export interface HandoffMetricsSummary {
  totalConversations: number
  totalProcedureRuns: number
  totalMessages: number
  escalatedConversations: number
  escalatedProcedureRuns: number
  escalationRate: number
  activeHandoffConversations: number
  activeHandoffProcedureRuns: number
  activeHumanTasks: number
  resolvedHumanTasks: number
  handoffProcedureTypes: number
  latestActivityAt: string | null
  generatedAt: string
}

const RESOLVED_CASE_STATUSES = new Set(['resolved', 'completed', 'done', 'closed'])
const RESOLVED_TASK_STATUSES = new Set(['resolved', 'closed', 'completed', 'done'])

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function isResolvedTask(status: string | null | undefined) {
  return RESOLVED_TASK_STATUSES.has(String(status ?? '').toLowerCase())
}

function hasAnyHumanTask(item: HandoffMetricsCaseInput) {
  return Boolean(item.humanTasks?.length)
}

function hasActiveHumanTask(item: HandoffMetricsCaseInput) {
  return (item.humanTasks ?? []).some((task) => !isResolvedTask(task.status) && !task.resolvedAt)
}

function hasOpenEscalation(item: HandoffMetricsCaseInput) {
  return hasActiveHumanTask(item) && !RESOLVED_CASE_STATUSES.has(String(item.status ?? '').toLowerCase())
}

export function summarizeHandoffMetrics(
  cases: HandoffMetricsCaseInput[],
  now = new Date(),
): HandoffMetricsSummary {
  const conversationIds = new Set<string>()
  const escalatedConversationIds = new Set<string>()
  const activeHandoffConversationIds = new Set<string>()
  const handoffTypes = new Set<string>()
  let totalMessages = 0
  let escalatedProcedureRuns = 0
  let activeHandoffProcedureRuns = 0
  let activeHumanTasks = 0
  let resolvedHumanTasks = 0
  let latestActivity: Date | null = null

  for (const item of cases) {
    conversationIds.add(item.chatId)
    totalMessages += item._count?.messages ?? 0

    const updatedAt = toDate(item.updatedAt)
    if (updatedAt && (!latestActivity || updatedAt > latestActivity)) {
      latestActivity = updatedAt
    }

    if (hasAnyHumanTask(item)) {
      escalatedProcedureRuns += 1
      escalatedConversationIds.add(item.chatId)
    }

    if (hasOpenEscalation(item)) {
      activeHandoffProcedureRuns += 1
      activeHandoffConversationIds.add(item.chatId)
      handoffTypes.add(item.type)
    }

    for (const task of item.humanTasks ?? []) {
      if (isResolvedTask(task.status) || task.resolvedAt) {
        resolvedHumanTasks += 1
      } else {
        activeHumanTasks += 1
      }
    }
  }

  return {
    totalConversations: conversationIds.size,
    totalProcedureRuns: cases.length,
    totalMessages,
    escalatedConversations: escalatedConversationIds.size,
    escalatedProcedureRuns,
    escalationRate: conversationIds.size > 0 ? escalatedConversationIds.size / conversationIds.size : 0,
    activeHandoffConversations: activeHandoffConversationIds.size,
    activeHandoffProcedureRuns,
    activeHumanTasks,
    resolvedHumanTasks,
    handoffProcedureTypes: handoffTypes.size,
    latestActivityAt: latestActivity?.toISOString() ?? null,
    generatedAt: now.toISOString(),
  }
}

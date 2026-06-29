// GET /api/chats — List chat sessions grouped by chatId.
//
// Each "chat" is a conversation that may contain 1-N cases.
// Cases without a chatId are treated as standalone sessions.
//
// Migrated to defineRoute + repoForOrg (Wave 1 G1/G2).
// orgId is auto-injected by the repo Proxy.

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { ChatsListInput, type ChatMatchedMessage, type ChatSession, type ChatsListQueryMeta } from '@intera/shared/contracts/chats'
import { hydrateMessageFromDb, isCustomerVisibleMessage } from '@/lib/agent/provider-transcript'
import { Prisma } from '@prisma/client'
import { caseIdFilterForScope, resolveRequiredAgentCaseScope, type AgentCaseScope } from './_agent-scope'
import { isTimeInsideSegment, splitCasesIntoConversationSegments, type SegmentMessageInput } from '@/lib/operate/conversation-segments'
import { attachSegmentMessageActivity, loadSegmentMessageActivityByCaseId } from '@/lib/operate/segment-message-activity'

type ChatCaseRow = {
  id: string
  userId: string
  chatId: string
  type: string
  status: string
  source: string
  goal: string | null
  createdAt: Date
  updatedAt: Date
  humanTasks: Array<{ id: string; createdAt?: Date | string | null }>
  messages?: SegmentMessageInput[]
  _count: { messages: number }
}

type MessageSearchRow = {
  id: string
  caseId: string
  chatId: string
  runId: string | null
  role: string
  content: string
  contentBlocks: unknown
  providerContent: unknown
  providerMeta: unknown
  createdAt: Date
  rank: number
  matchMode: 'fts' | 'contains_fallback'
}

type ChatSearchData = {
  matchesByChatId: Map<string, ChatMatchedMessage[]>
  sortByChatId: Map<string, { maxRank: number; latestMatchAt: string }>
  searchMode: ChatsListQueryMeta['searchMode']
}

type ChatMetadataSearchData = {
  matchedChatIds: Set<string>
}

const MAX_MATCHES_PER_CHAT = 3

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function snippetForQuery(content: string, query: string): string {
  const text = content.replace(/\s+/g, ' ').trim()
  if (text.length <= 180) return text

  const lower = text.toLowerCase()
  const index = lower.indexOf(query.toLowerCase())
  if (index < 0) return `${text.slice(0, 177)}...`

  const start = Math.max(0, index - 70)
  const end = Math.min(text.length, index + query.length + 90)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < text.length ? '...' : ''
  return `${prefix}${text.slice(start, end)}${suffix}`
}

function normalizeQuery(input: string | undefined): string | null {
  const normalized = input?.trim().replace(/\s+/g, ' ') ?? ''
  return normalized.length > 0 ? normalized : null
}

async function searchVisibleMessages(
  repo: { orgId: string; raw: { $queryRaw: <T = unknown>(query: TemplateStringsArray | Prisma.Sql) => Promise<T> } },
  scope: AgentCaseScope,
  normalizedQuery: string,
): Promise<ChatSearchData> {
  if (scope.caseIds.length === 0) {
    return { matchesByChatId: new Map(), sortByChatId: new Map(), searchMode: 'contains_fallback' }
  }

  const containsPattern = `%${escapeLikePattern(normalizedQuery)}%`
  const rows = await repo.raw.$queryRaw<MessageSearchRow[]>(Prisma.sql`
    WITH search_input AS (
      SELECT websearch_to_tsquery('simple', ${normalizedQuery}) AS query
    ),
    matching_messages AS (
      SELECT
        m.id,
        m."caseId",
        m."chatId",
        m."run_id" AS "runId",
        m.role,
        m.content,
        m."contentBlocks",
        m."providerContent",
        m."providerMeta",
        m."createdAt",
        CASE
          WHEN to_tsvector('simple', coalesce(m.content, '')) @@ search_input.query
            THEN ts_rank_cd(to_tsvector('simple', coalesce(m.content, '')), search_input.query)
          ELSE 0
        END::float8 AS rank,
        CASE
          WHEN to_tsvector('simple', coalesce(m.content, '')) @@ search_input.query
            THEN 'fts'
          ELSE 'contains_fallback'
        END AS "matchMode"
      FROM "messages" AS m
      CROSS JOIN search_input
      WHERE m."org_id" = ${repo.orgId}
        AND m."caseId" IN (${Prisma.join(scope.caseIds)})
        AND coalesce(m.content, '') <> ''
        AND coalesce(m."providerMeta"->>'visibility', '') <> 'internal'
        AND NOT (
          m.role = 'user'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(coalesce(m."providerContent", '[]'::jsonb)) AS provider_block
            WHERE provider_block->>'type' = 'tool_result'
          )
        )
        AND (
          to_tsvector('simple', coalesce(m.content, '')) @@ search_input.query
          OR m.content ILIKE ${containsPattern} ESCAPE '\\'
        )
    ),
    ranked_messages AS (
      SELECT
        *,
        row_number() OVER (PARTITION BY "chatId" ORDER BY rank DESC, "createdAt" DESC) AS "messageRank",
        max(rank) OVER (PARTITION BY "chatId") AS "chatRank",
        max("createdAt") OVER (PARTITION BY "chatId") AS "latestMatchAt"
      FROM matching_messages
    )
    SELECT
      id,
      "caseId",
      "chatId",
      "runId",
      role,
      content,
      "contentBlocks",
      "providerContent",
      "providerMeta",
      "createdAt",
      rank,
      "matchMode"
    FROM ranked_messages
    WHERE "messageRank" <= ${MAX_MATCHES_PER_CHAT}
    ORDER BY "chatRank" DESC, "latestMatchAt" DESC, "createdAt" DESC
  `)

  const matchesByChatId = new Map<string, ChatMatchedMessage[]>()
  const sortByChatId = new Map<string, { maxRank: number; latestMatchAt: string }>()
  let hasFtsMatch = false

  for (const row of rows) {
    const hydrated = hydrateMessageFromDb({
      id: row.id,
      role: row.role,
      content: row.content,
      contentBlocks: row.contentBlocks,
      providerContent: row.providerContent,
      providerMeta: row.providerMeta,
      createdAt: row.createdAt,
    })
    if (!isCustomerVisibleMessage(hydrated)) continue

    const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString()
    const rank = Number(row.rank) || 0
    const match: ChatMatchedMessage = {
      messageId: row.id,
      caseId: row.caseId,
      runId: row.runId ?? null,
      role: hydrated.role,
      createdAt,
      snippet: snippetForQuery(hydrated.content, normalizedQuery),
      rank,
    }
    const bucket = matchesByChatId.get(row.chatId) ?? []
    if (bucket.length < MAX_MATCHES_PER_CHAT) {
      bucket.push(match)
      matchesByChatId.set(row.chatId, bucket)
    }
    const sort = sortByChatId.get(row.chatId)
    if (!sort || rank > sort.maxRank || createdAt > sort.latestMatchAt) {
      sortByChatId.set(row.chatId, {
        maxRank: Math.max(rank, sort?.maxRank ?? 0),
        latestMatchAt: sort && sort.latestMatchAt > createdAt ? sort.latestMatchAt : createdAt,
      })
    }
    if (row.matchMode === 'fts') hasFtsMatch = true
  }

  return {
    matchesByChatId,
    sortByChatId,
    searchMode: hasFtsMatch ? 'fts' : 'contains_fallback',
  }
}

function includesQuery(value: string | null | undefined, normalizedQuery: string): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(normalizedQuery.toLowerCase())
}

function matchingRunCaseIds(scope: AgentCaseScope, normalizedQuery: string): string[] {
  return scope.runs
    .filter((run) => includesQuery(run.id, normalizedQuery))
    .map((run) => run.caseId)
}

async function searchChatMetadata(
  repo: {
    externalConversation: {
      findMany: (args: {
        where: Record<string, unknown>
        select: { internalCaseId: true }
      }) => Promise<Array<{ internalCaseId: string | null }>>
    }
    case: {
      findMany: (args: {
        where: Record<string, unknown>
        select: { id: true; chatId: true }
      }) => Promise<Array<{ id: string; chatId: string }>>
    }
  },
  scope: AgentCaseScope,
  normalizedQuery: string,
): Promise<ChatMetadataSearchData> {
  if (scope.caseIds.length === 0) {
    return { matchedChatIds: new Set() }
  }

  const runCaseIds = matchingRunCaseIds(scope, normalizedQuery)
  const externalMatches = await repo.externalConversation.findMany({
    where: {
      internalCaseId: { in: scope.caseIds },
      externalChatId: { contains: normalizedQuery, mode: 'insensitive' },
    },
    select: { internalCaseId: true },
  })
  const externalCaseIds = externalMatches
    .map((row) => row.internalCaseId)
    .filter((caseId): caseId is string => typeof caseId === 'string' && caseId.length > 0)
  const directCaseIds = [...new Set([...runCaseIds, ...externalCaseIds])]

  const metadataOr: Record<string, unknown>[] = [
    { chatId: { contains: normalizedQuery, mode: 'insensitive' } },
    { userId: { contains: normalizedQuery, mode: 'insensitive' } },
    { id: { contains: normalizedQuery, mode: 'insensitive' } },
    { type: { contains: normalizedQuery, mode: 'insensitive' } },
    { goal: { contains: normalizedQuery, mode: 'insensitive' } },
  ]
  if (directCaseIds.length > 0) metadataOr.push({ id: { in: directCaseIds } })

  const cases = await repo.case.findMany({
    where: { ...caseIdFilterForScope(scope), OR: metadataOr },
    select: { id: true, chatId: true },
  })

  return {
    matchedChatIds: new Set(cases.map((row) => row.chatId)),
  }
}

async function loadCasesWithSegmentActivity(
  repo: Parameters<typeof loadSegmentMessageActivityByCaseId>[0] & {
    case: {
      findMany: (args: {
        where: Record<string, unknown>
        orderBy: { updatedAt: 'desc' }
        include: {
          humanTasks: {
            select: { id: true; createdAt: true }
            orderBy: { createdAt: 'asc' }
          }
          _count: { select: { messages: true } }
        }
      }) => Promise<ChatCaseRow[]>
    }
  },
  where: Record<string, unknown>,
): Promise<ChatCaseRow[]> {
  const cases = await repo.case.findMany({
    where,
    orderBy: { updatedAt: 'desc' as const },
    include: {
      humanTasks: {
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'asc' as const },
      },
      _count: { select: { messages: true } },
    },
  })
  const messagesByCaseId = await loadSegmentMessageActivityByCaseId(repo, cases.map((caseRow) => caseRow.id))
  return attachSegmentMessageActivity(cases, messagesByCaseId)
}

function metadataScore(session: ChatSession, metadataMatchedChatIds: Set<string>, normalizedQuery: string): number {
  const exactValues = [
    session.chatId,
    session.userId,
    ...session.cases.flatMap((caseItem) => [caseItem.id, caseItem.runId ?? '', caseItem.type, caseItem.goal ?? '']),
  ]
  const query = normalizedQuery.toLowerCase()
  if (exactValues.some((value) => value.toLowerCase() === query)) return 2
  if (exactValues.some((value) => value.toLowerCase().startsWith(query))) return 1.5
  if (exactValues.some((value) => value.toLowerCase().includes(query))) return 1
  if (metadataMatchedChatIds.has(session.chatId)) return 1
  return 0
}

function buildChatSessions(
  cases: ChatCaseRow[],
  scope: AgentCaseScope,
  matchesByChatId?: Map<string, ChatMatchedMessage[]>,
): ChatSession[] {
  const caseIds = new Set(cases.map((c) => c.id))
  const activeRuns = scope.runs.filter((run) => caseIds.has(run.caseId))
  const runByCase = new Map<string, string>()
  for (const run of activeRuns) {
    if (!runByCase.has(run.caseId)) runByCase.set(run.caseId, run.id)
  }

  return splitCasesIntoConversationSegments(cases).map((segment) => {
    const segmentMatches = (matchesByChatId?.get(segment.chatId) ?? [])
      .filter((match) => isTimeInsideSegment(match.createdAt, segment))
    const firstCase = segment.cases[0]
    const session: ChatSession = {
      segmentId: segment.segmentId,
      segmentIndex: segment.segmentIndex,
      segmentStartAt: segment.segmentStartAt,
      segmentEndAt: segment.segmentEndAt,
      chatId: segment.chatId,
      userId: firstCase?.userId ?? '',
      cases: [],
      messageCount: segment.messageCount,
      lastActivity: segment.lastActivity,
      hasHumanTask: false,
      ...(segmentMatches.length > 0 ? { matchedMessages: segmentMatches } : {}),
    }

    for (const c of segment.cases) {
      const runId = runByCase.get(c.id) ?? null
      session.cases.push({
        id: runId ?? c.id,
        runId,
        type: c.type,
        status: c.status,
        source: c.source,
        goal: c.goal,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        _count: { messages: segment.messageCountByCaseId.get(c.id) ?? c._count.messages },
      })
      if (c.humanTasks.some((task) => isTimeInsideSegment(task.createdAt, segment))) {
        session.hasHumanTask = true
      }
    }

    return session
  })
}

export const GET = defineRoute({
  method: 'GET',
  inputSchema: ChatsListInput,
  parseQuery: true,
  handler: async ({ input, repo }) => {
    const { limit, offset } = input
    const normalizedQuery = normalizeQuery(input.q)
    const scope = await resolveRequiredAgentCaseScope(repo, input)

    if (normalizedQuery) {
      const search = await searchVisibleMessages(repo, scope, normalizedQuery)
      const metadata = await searchChatMetadata(repo, scope, normalizedQuery)
      const matchedChatIds = [...new Set([...search.matchesByChatId.keys(), ...metadata.matchedChatIds])]
      if (matchedChatIds.length === 0) {
        return apiOk({
          sessions: [],
          total: 0,
          query: { normalizedQuery, searchMode: search.searchMode },
        })
      }

      const cases = await loadCasesWithSegmentActivity(repo, { ...caseIdFilterForScope(scope), chatId: { in: matchedChatIds } })

      const sorted = buildChatSessions(cases, scope, search.matchesByChatId)
        .filter((session) => {
          if (metadata.matchedChatIds.has(session.chatId)) return true
          if (!search.matchesByChatId.has(session.chatId)) return true
          return Boolean(session.matchedMessages?.length)
        })
        .sort((a, b) => {
        const aSort = search.sortByChatId.get(a.chatId) ?? { maxRank: 0, latestMatchAt: a.lastActivity }
        const bSort = search.sortByChatId.get(b.chatId) ?? { maxRank: 0, latestMatchAt: b.lastActivity }
        const aRank = Math.max(aSort.maxRank, metadataScore(a, metadata.matchedChatIds, normalizedQuery))
        const bRank = Math.max(bSort.maxRank, metadataScore(b, metadata.matchedChatIds, normalizedQuery))
        if (bRank !== aRank) return bRank - aRank
        const matchTime = bSort.latestMatchAt.localeCompare(aSort.latestMatchAt)
        if (matchTime !== 0) return matchTime
        return b.lastActivity.localeCompare(a.lastActivity)
      })
      const total = sorted.length
      const page = sorted.slice(offset, offset + limit)

      return apiOk({
        sessions: page,
        total,
        query: { normalizedQuery, searchMode: search.searchMode },
      })
    }

    const cases = await loadCasesWithSegmentActivity(repo, caseIdFilterForScope(scope))

    // Sort sessions by lastActivity descending, then paginate.
    const sorted = buildChatSessions(cases, scope).sort((a, b) =>
      b.lastActivity.localeCompare(a.lastActivity),
    )
    const total = sorted.length
    const page = sorted.slice(offset, offset + limit)

    return apiOk({ sessions: page, total, query: { normalizedQuery: null, searchMode: 'none' } })
  },
})

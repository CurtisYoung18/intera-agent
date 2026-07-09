import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  queryRaw: vi.fn(),
  count: vi.fn(),
  lastQuery: null as any,
}))

vi.mock('@/lib/api/assert-agent-in-org', () => ({
  assertAgentInOrg: vi.fn(async () => {}),
}))

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    const cases = [{ id: 'case-1', orgId, chatId: 'chat-1' }]
    return {
      orgId,
      raw: {
        case: {
          findMany: vi.fn(async () => cases),
        },
        procedureRun: {
          findMany: vi.fn(async () => [{ id: 'run-1', caseId: 'case-1', agentConfigId: 'agent-1' }]),
        },
        actionTrace: {
          count: h.count,
        },
        $queryRaw: h.queryRaw,
      },
      externalConversation: {
        findMany: vi.fn(async () => []),
      },
    } as any
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET } from '../route'

function makeRequest(query = '') {
  return {
    method: 'GET',
    json: async () => ({}),
    nextUrl: new URL(`http://localhost/api/chats/chat-1/traces${query}`),
  } as any
}

function routeCtx() {
  return { params: Promise.resolve({ chatId: 'chat-1' }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.lastQuery = null
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
  h.count.mockResolvedValue(1)
  h.queryRaw.mockImplementation(async (query: any) => {
    h.lastQuery = query
    return [{
      id: 'trace-1',
      orgId: 'default',
      chatId: 'chat-1',
      runId: 'run-1',
      caseId: 'case-1',
      actionType: 'llm_request_start',
      title: 'LLM request: openai/gpt-5.4-mini',
      detail: null,
      payload: JSON.stringify({
        model: 'openai/gpt-5.4-mini',
        messageCount: 4,
        requestPayloadCaptured: true,
        systemPrompt: 'PRIVATE PROMPT',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [
          { name: 'search_knowledge', description: 'full schema', input_schema: { type: 'object', properties: { source: { type: 'string', enum: ['deposit', 'account'] } } } },
          { name: 'get_current_time', description: 'full schema', input_schema: { type: 'object', properties: {} } },
        ],
      }),
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
    }]
  })
})

describe('/api/chats/[chatId]/traces', () => {
  it('returns only safe LLM request payload summaries in summary mode', async () => {
    const res = await GET(makeRequest('?agentId=agent-1&limit=500&payloadMode=summary'), routeCtx())
    const body = await res.json()
    const payload = JSON.parse(body.data.traces[0].payload)

    expect(body.ok).toBe(true)
    expect(body.data.traces).toEqual([
      expect.objectContaining({
        id: 'trace-1',
        actionType: 'llm_request_start',
        payload: expect.any(String),
      }),
    ])
    expect(payload).toMatchObject({
      model: 'openai/gpt-5.4-mini',
      messageCount: 4,
      capturedMessageCount: 1,
      requestPayloadCaptured: true,
      toolSchemaSummary: {
        providerVisibleToolCount: 2,
        knowledgeSchemaUnified: true,
        knowledgeSourceCount: 2,
      },
    })
    expect(payload).not.toHaveProperty('tools')
    expect(payload).not.toHaveProperty('messages')
    expect(payload).not.toHaveProperty('systemPrompt')
  })
})

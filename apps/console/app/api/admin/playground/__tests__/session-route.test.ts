import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetActiveVendor: vi.fn(),
  mockCaseFindFirst: vi.fn(),
  mockCaseDelete: vi.fn(),
  mockMessageFindMany: vi.fn(),
  mockActionTraceFindMany: vi.fn(),
  mockAgentConfigFindFirst: vi.fn(),
  mockToolFindMany: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
  getActiveVendor: h.mockGetActiveVendor,
}))

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg: () => ({
    raw: {
      case: { findFirst: h.mockCaseFindFirst, delete: h.mockCaseDelete },
      message: { findMany: h.mockMessageFindMany },
      actionTrace: { findMany: h.mockActionTraceFindMany },
      agentConfig: { findFirst: h.mockAgentConfigFindFirst },
      tool: { findMany: h.mockToolFindMany },
    },
    orgId: 'org-1',
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET, DELETE } from '@/app/api/admin/playground/sessions/[chatId]/route'

function makeRequest(url = 'http://localhost/api/admin/playground/sessions/pg_agent-1_1_a?configId=agent-1') {
  return {
    method: 'GET',
    nextUrl: new URL(url),
    json: async () => ({}),
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'org-1', role: 'admin', userId: 'user-1' })
  h.mockGetActiveVendor.mockResolvedValue({ isAuthed: true, userId: 'user-1' })
  h.mockCaseFindFirst.mockResolvedValue({ id: 'case-1' })
  h.mockCaseDelete.mockResolvedValue({})
  h.mockActionTraceFindMany.mockResolvedValue([])
  h.mockAgentConfigFindFirst.mockResolvedValue({ id: 'agent-1' })
  h.mockToolFindMany.mockResolvedValue([])
})

describe('GET /api/admin/playground/sessions/[chatId]', () => {
  it('hides internal provider tool_result rows when restoring a session', async () => {
    const createdAt = new Date('2026-06-12T00:00:00.000Z')
    h.mockMessageFindMany.mockResolvedValue([
      {
        id: 'msg-user',
        role: 'user',
        content: 'hello',
        contentBlocks: null,
        providerContent: null,
        providerMeta: null,
        createdAt,
      },
      {
        id: 'msg-assistant-tool-use',
        role: 'assistant',
        content: '',
        contentBlocks: null,
        providerContent: [{ type: 'tool_use', id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } }],
        providerMeta: { protocolVersion: 1, transcriptKind: 'assistant_response', visibility: 'customer', toolUseIds: ['toolu_1'] },
        createdAt,
      },
      {
        id: 'msg-tool-result',
        role: 'user',
        content: '',
        contentBlocks: null,
        providerContent: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'secret result' }],
        providerMeta: { kind: 'tool_result', visibility: 'internal', toolUseIds: ['toolu_1'] },
        createdAt,
      },
      {
        id: 'msg-assistant',
        role: 'assistant',
        content: 'visible answer',
        contentBlocks: null,
        providerContent: [{ type: 'text', text: 'visible answer' }],
        providerMeta: { kind: 'assistant_response', visibility: 'customer' },
        createdAt,
      },
    ])

    const res = await GET(makeRequest(), { params: Promise.resolve({ chatId: 'pg_agent-1_1_a' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(h.mockCaseFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        orgId: 'org-1',
        chatId: 'pg_agent-1_1_a',
        userId: 'user-1',
      },
    }))
    expect(body.ok).toBe(true)
    expect(body.data.messages).toEqual([
      {
        id: 'msg-user',
        role: 'user',
        content: 'hello',
        createdAt: createdAt.toISOString(),
      },
      {
        id: 'msg-assistant',
        role: 'assistant',
        content: 'visible answer',
        createdAt: createdAt.toISOString(),
      },
    ])
  })

  it('loads render hints only from an agent config owned by the current org', async () => {
    h.mockMessageFindMany.mockResolvedValue([])
    h.mockAgentConfigFindFirst.mockResolvedValue({ id: 'agent-1' })
    h.mockToolFindMany.mockResolvedValue([
      { name: 'lookup_deposit', renderHints: '{"type":"card"}' },
    ])

    const res = await GET(makeRequest(), { params: Promise.resolve({ chatId: 'pg_agent-1_1_a' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(h.mockAgentConfigFindFirst).toHaveBeenCalledWith({
      where: { id: 'agent-1', orgId: 'org-1' },
      select: { id: true },
    })
    expect(h.mockToolFindMany).toHaveBeenCalledWith({
      where: { agentConfigId: 'agent-1', renderHints: { not: null } },
      select: { name: true, renderHints: true },
    })
    expect(body.data.renderHintsMap).toEqual({
      lookup_deposit: { type: 'card' },
    })
  })

  it('does not load render hints when the requested agent config is outside the current org', async () => {
    h.mockMessageFindMany.mockResolvedValue([])
    h.mockAgentConfigFindFirst.mockResolvedValue(null)

    const res = await GET(makeRequest(), { params: Promise.resolve({ chatId: 'pg_agent-1_1_a' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(h.mockToolFindMany).not.toHaveBeenCalled()
    expect(body.data.renderHintsMap).toEqual({})
  })

  it('deletes a restored session even after the case type changed away from playground', async () => {
    const res = await DELETE(makeRequest(), { params: Promise.resolve({ chatId: 'pg_agent-1_1_a' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(h.mockCaseFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        orgId: 'org-1',
        chatId: 'pg_agent-1_1_a',
        userId: 'user-1',
      },
    }))
    expect(h.mockCaseDelete).toHaveBeenCalledWith({ where: { id: 'case-1' } })
    expect(body.ok).toBe(true)
  })
})

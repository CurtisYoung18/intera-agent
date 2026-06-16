import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => {
  const repo = {
    agentConfig: { findUnique: vi.fn() },
    case: { findUnique: vi.fn() },
    raw: {
      procedureRun: { findFirst: vi.fn() },
      message: { findMany: vi.fn() },
    },
  }
  return {
    repo,
    getSession: vi.fn(),
    repoForOrg: vi.fn(() => repo),
  }
})

vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/lib/db/repo-for-org', () => ({ repoForOrg: h.repoForOrg }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET } from '@/app/api/cases/[id]/messages/route'

function makeRequest(query = 'limit=1&offset=1&agentId=agent-a') {
  return new NextRequest(`http://localhost/api/cases/case-1/messages?${query}`, {
    method: 'GET',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getSession.mockResolvedValue({ userId: 'staff-1', orgId: 'org-a', role: 'admin' })
  h.repo.agentConfig.findUnique.mockResolvedValue({ id: 'agent-a' })
  h.repo.raw.procedureRun.findFirst.mockResolvedValue({ id: 'run-1' })
  h.repo.case.findUnique.mockResolvedValue({
    type: 'deposit_issue',
    status: 'open',
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
  })
  h.repo.raw.message.findMany.mockResolvedValue([
    {
      id: 'msg-visible-1',
      role: 'user',
      content: 'first visible',
      contentBlocks: null,
      providerContent: null,
      providerMeta: null,
      createdAt: new Date('2026-06-12T00:00:00.000Z'),
    },
    {
      id: 'msg-internal-result',
      role: 'user',
      content: '',
      contentBlocks: null,
      providerContent: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"secret":true}' }],
      providerMeta: { protocolVersion: 1, visibility: 'internal', transcriptKind: 'tool_result' },
      createdAt: new Date('2026-06-12T00:00:01.000Z'),
    },
    {
      id: 'msg-provider-only-tool-use',
      role: 'assistant',
      content: '',
      contentBlocks: null,
      providerContent: [{ type: 'tool_use', id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } }],
      providerMeta: { protocolVersion: 1, visibility: 'customer', transcriptKind: 'assistant_response' },
      createdAt: new Date('2026-06-12T00:00:02.000Z'),
    },
    {
      id: 'msg-visible-2',
      role: 'assistant',
      content: 'second visible',
      contentBlocks: null,
      providerContent: [{ type: 'text', text: 'second visible' }],
      providerMeta: { protocolVersion: 1, visibility: 'customer', transcriptKind: 'assistant_response' },
      createdAt: new Date('2026-06-12T00:00:03.000Z'),
    },
  ])
})

describe('GET /api/cases/[id]/messages', () => {
  it('paginates after filtering internal provider transcript rows', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'case-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.total).toBe(2)
    expect(body.data.messages).toHaveLength(1)
    expect(body.data.messages[0].id).toBe('msg-visible-2')
    expect(body.data.messages[0].content).toBe('second visible')
  })
})

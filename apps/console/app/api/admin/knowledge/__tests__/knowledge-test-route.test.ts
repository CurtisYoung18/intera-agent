import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const mockFindAgent = vi.fn()
  const mockFindSource = vi.fn()
  const mockFindSources = vi.fn()
  const mockFetch = vi.fn()

  return { mockGetSession, mockFindAgent, mockFindSource, mockFindSources, mockFetch }
})

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      agentConfig: {
        findUnique: h.mockFindAgent,
      },
      raw: {
        agentConfig: {
          findUnique: h.mockFindAgent,
        },
        knowledgeSource: {
          findFirst: h.mockFindSource,
          findMany: h.mockFindSources,
        },
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

import { POST } from '../test/route'

function mkReq(body: unknown): Request {
  return new Request('http://localhost/api/admin/knowledge/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  h.mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })
  h.mockFindAgent.mockResolvedValue({ id: 'agent-1', orgId: 'acme', gptbotsApiKey: 'agent-key' })
  h.mockFindSource.mockResolvedValue({
    id: 'source-1',
    agentConfigId: 'agent-1',
    name: 'Deposit FAQ',
    groupIds: '["kb-1"]',
    embeddingRate: 0.8,
    topK: 12,
    rerankVersion: 'BGE-Rerank',
    docCorrelation: 0.35,
  })
  h.mockFindSources.mockResolvedValue([])
  h.mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      list: [{ content: 'Deposit evidence', data_id: 'doc-1', document_name: 'Deposit FAQ', chunk_id: 'chunk-7', score: 0.92 }],
      total: 1,
    }),
  })
  vi.stubGlobal('fetch', h.mockFetch)
})

describe('POST /api/admin/knowledge/test', () => {
  it('returns 401 without session', async () => {
    h.mockGetSession.mockResolvedValue(null)
    const res = await POST(mkReq({ agentConfigId: 'agent-1', query: 'test' }) as any)
    expect(res.status).toBe(401)
  })

  it('requires agentConfigId', async () => {
    const res = await POST(mkReq({ query: 'deposit' }) as any)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.fields.agentConfigId).toBe('agentConfigId is required')
  })

  it('scopes source lookup and GPTBots key by agentConfigId', async () => {
    const res = await POST(mkReq({
      agentConfigId: 'agent-1',
      query: 'deposit not showing',
      sourceId: 'source-1',
      topK: 7,
    }) as any)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(h.mockFindAgent).toHaveBeenCalledWith({ where: { id: 'agent-1' }, select: { gptbotsApiKey: true } })
    expect(h.mockFindSource).toHaveBeenCalledWith({ where: { id: 'source-1', agentConfigId: 'agent-1' } })
    expect(h.mockFetch).toHaveBeenCalledWith('https://api-sg.gptbots.ai/v1/vector/match', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer agent-key', 'Content-Type': 'application/json' },
    }))
    const requestBody = JSON.parse(h.mockFetch.mock.calls[0][1].body)
    expect(requestBody).toEqual(expect.objectContaining({
      prompt: 'deposit not showing',
      top_k: 7,
      group_ids: ['kb-1'],
      embedding_rate: 0.8,
      rerank_version: 'BGE-Rerank',
      doc_correlation: 0.35,
    }))
    expect(body.data).toEqual(expect.objectContaining({
      query: 'deposit not showing',
      topK: 7,
      source: { id: 'source-1', name: 'Deposit FAQ' },
      total: 1,
    }))
    expect(body.data.list[0]).toEqual(expect.objectContaining({
      document_name: 'Deposit FAQ',
      data_id: 'doc-1',
      chunk_id: 'chunk-7',
      score: 0.92,
    }))
  })

  it('returns a clear setup error when the agent has no GPTBots key', async () => {
    h.mockFindAgent.mockResolvedValue({ id: 'agent-1', orgId: 'acme', gptbotsApiKey: null })
    vi.stubEnv('GPTBOTS_API_KEY', '')

    const res = await POST(mkReq({ agentConfigId: 'agent-1', query: 'deposit' }) as any)
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.ok).toBe(false)
    expect(body.error.message).toContain('GPTBots API key is not configured')
  })

  it('rejects a selected source with no bound knowledge base', async () => {
    h.mockFindSource.mockResolvedValue({
      id: 'source-1',
      agentConfigId: 'agent-1',
      name: 'Empty source',
      groupIds: '[]',
      embeddingRate: 0.8,
      topK: 12,
      rerankVersion: 'BGE-Rerank',
      docCorrelation: 0.35,
    })

    const res = await POST(mkReq({
      agentConfigId: 'agent-1',
      query: 'deposit',
      sourceId: 'source-1',
      topK: 7,
    }) as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error.message).toContain('has no GPTBots knowledge base bound')
  })

  it('rejects all-sources retrieval when no enabled source is testable', async () => {
    h.mockFindSources.mockResolvedValue([
      {
        id: 'source-empty',
        agentConfigId: 'agent-1',
        name: 'Empty source',
        groupIds: '[]',
        embeddingRate: 0.9,
        topK: 15,
        rerankVersion: 'BGE-Rerank',
        docCorrelation: 0.3,
      },
    ])

    const res = await POST(mkReq({ agentConfigId: 'agent-1', query: 'deposit' }) as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error.message).toContain('No enabled knowledge source has a GPTBots knowledge base bound')
  })
})

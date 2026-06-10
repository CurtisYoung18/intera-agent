import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  toolFindMany: vi.fn(),
  caseTypeFindMany: vi.fn(),
  knowledgeSourceFindMany: vi.fn(),
  knowledgeSourceFindFirst: vi.fn(),
  knowledgeSourceUpdate: vi.fn(),
  agentConfigFindUnique: vi.fn(),
}))

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    tool: { findMany: h.toolFindMany },
    caseType: { findMany: h.caseTypeFindMany },
    knowledgeSource: {
      findMany: h.knowledgeSourceFindMany,
      findFirst: h.knowledgeSourceFindFirst,
      update: h.knowledgeSourceUpdate,
    },
    agentConfig: { findUnique: h.agentConfigFindUnique },
  },
}))

const sourceDefault = {
  id: 'kb_default_123456',
  name: 'Default',
  description: 'Default knowledge',
  groupIds: JSON.stringify(['group-default']),
  topK: 15,
  embeddingRate: 0.9,
  docCorrelation: 0.3,
  rerankVersion: 'BGE-Rerank',
  modelControlTopK: false,
  enabled: true,
}

const sourceDeposit = {
  id: 'kb_deposit_123456',
  name: 'Deposit Bonus',
  description: 'Deposit knowledge',
  groupIds: JSON.stringify(['group-deposit']),
  topK: 18,
  embeddingRate: 0.8,
  docCorrelation: 0.2,
  rerankVersion: 'BGE-Rerank',
  modelControlTopK: true,
  enabled: true,
}

const sourceChineseName = {
  id: 'kb_cn_abcdef',
  name: '充值',
  description: 'Chinese-name knowledge',
  groupIds: JSON.stringify(['group-cn']),
  topK: 15,
  embeddingRate: 0.9,
  docCorrelation: 0.3,
  rerankVersion: 'BGE-Rerank',
  modelControlTopK: false,
  enabled: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.toolFindMany.mockResolvedValue([])
  h.caseTypeFindMany.mockResolvedValue([])
  h.knowledgeSourceFindMany.mockResolvedValue([sourceDefault, sourceDeposit, sourceChineseName])
  h.knowledgeSourceFindFirst.mockResolvedValue(sourceDefault)
  h.knowledgeSourceUpdate.mockResolvedValue({})
  h.agentConfigFindUnique.mockResolvedValue({ gptbotsApiKey: 'agent-key' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('generated knowledge-search tool names', () => {
  it('exposes provider-safe lowercase tool names for knowledge sources', async () => {
    const { ToolRouter } = await import('../../tools')
    const router = await ToolRouter.create('agent-a', true)
    const names = router.getTools().map((tool) => tool.name)

    expect(names).toContain('kb_search_default')
    expect(names).toContain('kb_search_deposit_bonus')
    expect(names).toContain('kb_search_kb_cn_abcdef')
    expect(names).not.toContain('kb_search_Default')
    expect(names.every((name) => /^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/.test(name))).toBe(true)
    expect(router.getTool('kb_search_default')?.knowledgeSourceId).toBe('kb_default_123456')
  })

  it('executes a sanitized knowledge tool through its source id instead of reverse-parsing the display name', async () => {
    const { ToolRouter } = await import('../../tools')
    const { StreamingToolExecutor } = await import('../../streaming-tool-executor')
    const router = await ToolRouter.create('agent-a', true)
    const definition = router.getTool('kb_search_default')

    expect(definition).toBeDefined()
    h.knowledgeSourceFindFirst.mockResolvedValue(sourceDefault)
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (
      new Response(JSON.stringify({ list: [{ score: 0.1 }, { score: 0.9 }] }), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetchMock)

    const results = await StreamingToolExecutor.executeAll(
      [definition!],
      [{ id: 'tool-1', name: 'kb_search_default', input: { query: 'deposit status' } }],
      undefined,
      false,
      'agent-a',
    )

    expect(results[0]?.output).toMatchObject({ ok: true, output: { list: [{ score: 0.9 }, { score: 0.1 }] } })
    expect(h.knowledgeSourceFindFirst).toHaveBeenCalledWith({
      where: { agentConfigId: 'agent-a', id: 'kb_default_123456', enabled: true },
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      prompt: 'deposit status',
      top_k: 15,
      group_ids: ['group-default'],
      embedding_rate: 0.9,
    })
  })
})

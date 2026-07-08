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

const sourceEmpty = {
  id: 'kb_empty_123456',
  name: 'Empty source',
  description: 'No bound knowledge base',
  groupIds: JSON.stringify([]),
  topK: 15,
  embeddingRate: 0.9,
  docCorrelation: 0.3,
  rerankVersion: 'BGE-Rerank',
  modelControlTopK: false,
  enabled: true,
}

const sourceAccountLowTopK = {
  id: 'kb_account_123456',
  name: 'Account',
  description: 'Account knowledge',
  groupIds: JSON.stringify(['group-account']),
  topK: 6,
  embeddingRate: 0.9,
  docCorrelation: 0.3,
  rerankVersion: 'BGE-Rerank',
  modelControlTopK: false,
  enabled: true,
}

const sourceDuplicateFirst = {
  id: 'kb_duplicate_111111',
  name: 'Duplicate',
  description: 'First duplicate knowledge',
  groupIds: JSON.stringify(['group-first']),
  topK: 7,
  embeddingRate: 0.7,
  docCorrelation: 0.4,
  rerankVersion: 'BGE-Rerank',
  modelControlTopK: false,
  enabled: true,
}

const sourceDuplicateSecond = {
  id: 'kb_duplicate_222222',
  name: 'Duplicate',
  description: 'Second duplicate knowledge',
  groupIds: JSON.stringify(['group-second']),
  topK: 9,
  embeddingRate: 0.6,
  docCorrelation: 0.25,
  rerankVersion: 'BGE-Rerank',
  modelControlTopK: false,
  enabled: true,
}

const sourceJ1BDepositFaq = {
  id: 'kb_j1b_deposit_faq',
  name: 'Deposit FAQ',
  description: 'J1B deposit policy, deposit status, payment method, and missing deposit guidance',
  groupIds: JSON.stringify(['j1b-group-deposit']),
  topK: 8,
  embeddingRate: 0.85,
  docCorrelation: 0.25,
  rerankVersion: 'BGE-Rerank',
  modelControlTopK: true,
  enabled: true,
}

const sourceJ1BPromotionFaq = {
  id: 'kb_j1b_promotion_faq',
  name: 'Promotion FAQ',
  description: 'J1B promotion rules, bonus claim, turnover, and eligibility guidance',
  groupIds: JSON.stringify(['j1b-group-promotion']),
  topK: 12,
  embeddingRate: 0.75,
  docCorrelation: 0.3,
  rerankVersion: 'BGE-Rerank',
  modelControlTopK: false,
  enabled: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.INTERA_UNIFIED_KNOWLEDGE_TOOL
  h.toolFindMany.mockResolvedValue([])
  h.caseTypeFindMany.mockResolvedValue([])
  h.knowledgeSourceFindMany.mockResolvedValue([sourceDefault, sourceDeposit, sourceChineseName, sourceEmpty, sourceAccountLowTopK])
  h.knowledgeSourceFindFirst.mockResolvedValue(sourceDefault)
  h.knowledgeSourceUpdate.mockResolvedValue({})
  h.agentConfigFindUnique.mockResolvedValue({ gptbotsApiKey: 'agent-key' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.INTERA_UNIFIED_KNOWLEDGE_TOOL
})

describe('generated knowledge-search tool names', () => {
  it('exposes provider-safe lowercase tool names for knowledge sources', async () => {
    const { ToolRouter } = await import('../../tools')
    const router = await ToolRouter.create('agent-a', true)
    const names = router.getTools().map((tool) => tool.name)

    expect(names).toContain('kb_search_default')
    expect(names).toContain('kb_search_deposit_bonus')
    expect(names).toContain('kb_search_kb_cn_abcdef')
    expect(names).not.toContain('search_knowledge')
    expect(names).not.toContain('kb_search_empty_source')
    expect(names).not.toContain('kb_search_Default')
    expect(names.every((name) => /^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/.test(name))).toBe(true)
    expect(router.getTool('kb_search_default')?.knowledgeSourceId).toBe('kb_default_123456')
    expect((router.getTool('kb_search_default')?.inputSchema as any)?.properties).not.toHaveProperty('topK')
    expect((router.getTool('kb_search_deposit_bonus')?.inputSchema as any)?.properties).toHaveProperty('topK')
    expect(router.getTool('kb_search_deposit_bonus')?.description).toContain('Number of results to return')
  })

  it('exposes only search_knowledge to providers when the unified knowledge flag is enabled while keeping legacy definitions executable', async () => {
    process.env.INTERA_UNIFIED_KNOWLEDGE_TOOL = 'true'
    const { ToolRouter } = await import('../../tools')
    const { StreamingToolExecutor } = await import('../../streaming-tool-executor')
    const router = await ToolRouter.create('agent-a', true)

    const providerNames = router.getTools().map((tool) => tool.name)
    expect(providerNames).toContain('search_knowledge')
    expect(providerNames).not.toContain('kb_search_default')
    expect(providerNames).not.toContain('kb_search_deposit_bonus')
    expect(router.getProviderVisibleToolDefinitions().map((tool) => tool.name)).toContain('search_knowledge')
    expect(router.getProviderVisibleToolDefinitions().map((tool) => tool.name)).not.toContain('kb_search_default')

    const allNames = router.getToolDefinitions().map((tool) => tool.name)
    expect(allNames).toContain('search_knowledge')
    expect(allNames).toContain('kb_search_default')
    expect(router.getTool('kb_search_default')?.providerHidden).toBe(true)

    const schema = router.getTool('search_knowledge')?.inputSchema as any
    expect(schema.properties).toHaveProperty('query')
    expect(schema.properties).toHaveProperty('source')
    expect(schema.properties).toHaveProperty('topK')
    expect(schema.required).toEqual(['query', 'source'])
    expect(schema.properties.source.enum).toEqual(expect.arrayContaining(['default', 'deposit_bonus', 'account']))
    expect(schema.properties.source.enum).not.toContain('empty_source')
    expect(router.getTool('search_knowledge')?.description).toContain('source="deposit_bonus"')
    expect(router.getTool('search_knowledge')?.description).toContain('Deposit Bonus')

    h.knowledgeSourceFindFirst.mockResolvedValue(sourceDefault)
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => (
      new Response(JSON.stringify({ list: [{ score: 0.2 }, { score: 0.8 }] }), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetchMock)

    const legacyDefinition = router.getTool('kb_search_default')
    const results = await StreamingToolExecutor.executeAll(
      [legacyDefinition!],
      [{ id: 'tool-legacy', name: 'kb_search_default', input: { query: 'deposit status' } }],
      undefined,
      false,
      'agent-a',
    )

    expect(results[0]?.output).toMatchObject({ ok: true, output: { list: [{ score: 0.8 }, { score: 0.2 }] } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

  it('lets model-controlled knowledge sources override topK within the runtime clamp', async () => {
    const { ToolRouter } = await import('../../tools')
    const { StreamingToolExecutor } = await import('../../streaming-tool-executor')
    const router = await ToolRouter.create('agent-a', true)
    const definition = router.getTool('kb_search_deposit_bonus')

    expect(definition).toBeDefined()
    h.knowledgeSourceFindFirst.mockResolvedValue(sourceDeposit)
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (
      new Response(JSON.stringify({ list: [{ score: 0.8 }] }), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetchMock)

    await StreamingToolExecutor.executeAll(
      [definition!],
      [{ id: 'tool-1', name: 'kb_search_deposit_bonus', input: { query: 'deposit status', topK: 4 } }],
      undefined,
      false,
      'agent-a',
    )

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      prompt: 'deposit status',
      top_k: 4,
      group_ids: ['group-deposit'],
      embedding_rate: 0.8,
    })
  })

  it('executes search_knowledge against the selected source with legacy-source compatibility, topK clamp, sorted results, and metadata', async () => {
    process.env.INTERA_UNIFIED_KNOWLEDGE_TOOL = 'true'
    const { ToolRouter } = await import('../../tools')
    const { StreamingToolExecutor } = await import('../../streaming-tool-executor')
    const router = await ToolRouter.create('agent-a', true)
    const definition = router.getTool('search_knowledge')

    expect(definition).toBeDefined()
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => (
      new Response(JSON.stringify({ list: [{ score: 0.3, document_name: 'B' }, { score: 0.95, document_name: 'A' }] }), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetchMock)

    const results = await StreamingToolExecutor.executeAll(
      [definition!],
      [{ id: 'tool-1', name: 'search_knowledge', input: { query: 'deposit bonus', source: 'kb_search_deposit_bonus', topK: 99 } }],
      undefined,
      false,
      'agent-a',
    )

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      prompt: 'deposit bonus',
      top_k: 30,
      group_ids: ['group-deposit'],
      embedding_rate: 0.8,
      rerank_version: 'BGE-Rerank',
      doc_correlation: 0.2,
    })
    expect(results[0]?.output).toMatchObject({
      ok: true,
      output: {
        list: [{ score: 0.95, document_name: 'A' }, { score: 0.3, document_name: 'B' }],
        knowledgeSourceId: 'kb_deposit_123456',
        knowledgeSourceName: 'Deposit Bonus',
        knowledgeProvider: 'gptbots',
        query: 'deposit bonus',
        topK: 30,
        sourceSelection: {
          mode: 'explicit',
          requestedSource: 'kb_search_deposit_bonus',
          source: 'deposit_bonus',
        },
      },
    })
  })

  it('matches duplicate-source suffixed legacy tool names when executing search_knowledge', async () => {
    process.env.INTERA_UNIFIED_KNOWLEDGE_TOOL = 'true'
    h.knowledgeSourceFindMany.mockResolvedValue([sourceDuplicateFirst, sourceDuplicateSecond])
    const { ToolRouter } = await import('../../tools')
    const { StreamingToolExecutor } = await import('../../streaming-tool-executor')
    const router = await ToolRouter.create('agent-a', true)
    const definition = router.getTool('search_knowledge')
    const secondLegacyName = 'kb_search_duplicate_222222'

    expect(definition).toBeDefined()
    expect(router.getTools().map((tool) => tool.name)).toContain('search_knowledge')
    expect(router.getTools().map((tool) => tool.name)).not.toContain(secondLegacyName)
    expect((definition?.inputSchema as any).properties.source.enum).toEqual(['duplicate', 'duplicate_2'])
    expect(definition?.knowledgeSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'kb_duplicate_222222',
        key: 'duplicate_2',
        legacyToolName: secondLegacyName,
      }),
    ]))

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => (
      new Response(JSON.stringify({ list: [{ score: 0.5 }] }), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetchMock)

    const results = await StreamingToolExecutor.executeAll(
      [definition!],
      [{ id: 'tool-1', name: 'search_knowledge', input: { query: 'duplicate policy', source: secondLegacyName } }],
      undefined,
      false,
      'agent-a',
    )

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      prompt: 'duplicate policy',
      top_k: 9,
      group_ids: ['group-second'],
      embedding_rate: 0.6,
      doc_correlation: 0.25,
    })
    expect(results[0]?.output).toMatchObject({
      ok: true,
      output: {
        knowledgeSourceId: 'kb_duplicate_222222',
        knowledgeSourceName: 'Duplicate',
        sourceSelection: {
          requestedSource: secondLegacyName,
          source: 'duplicate_2',
          legacyToolName: secondLegacyName,
        },
      },
    })
  })

  it('runs a J1B-style unified knowledge smoke through search_knowledge with source metadata', async () => {
    process.env.INTERA_UNIFIED_KNOWLEDGE_TOOL = 'true'
    h.knowledgeSourceFindMany.mockResolvedValue([sourceJ1BDepositFaq, sourceJ1BPromotionFaq])
    const { ToolRouter } = await import('../../tools')
    const { StreamingToolExecutor } = await import('../../streaming-tool-executor')
    const router = await ToolRouter.create('agent-j1b', true)
    const definition = router.getTool('search_knowledge')

    expect(definition).toBeDefined()
    expect(router.getTools().map((tool) => tool.name)).toEqual(expect.arrayContaining(['search_knowledge']))
    expect(router.getTools().map((tool) => tool.name)).not.toContain('kb_search_deposit_faq')
    expect((definition?.inputSchema as any).properties.source.enum).toEqual(['deposit_faq', 'promotion_faq'])
    expect(definition?.description).toContain('J1B deposit policy')

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => (
      new Response(JSON.stringify({
        list: [
          { score: 0.41, document_name: 'Slow deposit general' },
          { score: 0.93, document_name: 'Missing deposit escalation' },
        ],
      }), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetchMock)

    const results = await StreamingToolExecutor.executeAll(
      [definition!],
      [{
        id: 'tool-j1b-kb',
        name: 'search_knowledge',
        input: {
          query: 'J1B deposit not credited after bank transfer',
          source: 'deposit_faq',
          topK: 5,
        },
      }],
      undefined,
      false,
      'agent-j1b',
    )

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      prompt: 'J1B deposit not credited after bank transfer',
      top_k: 5,
      group_ids: ['j1b-group-deposit'],
      embedding_rate: 0.85,
      rerank_version: 'BGE-Rerank',
      doc_correlation: 0.25,
    })
    expect(results[0]?.output).toMatchObject({
      ok: true,
      output: {
        list: [
          { score: 0.93, document_name: 'Missing deposit escalation' },
          { score: 0.41, document_name: 'Slow deposit general' },
        ],
        knowledgeSourceId: 'kb_j1b_deposit_faq',
        knowledgeSourceName: 'Deposit FAQ',
        knowledgeSourceKey: 'deposit_faq',
        knowledgeProvider: 'gptbots',
        query: 'J1B deposit not credited after bank transfer',
        topK: 5,
        sourceSelection: {
          mode: 'explicit',
          requestedSource: 'deposit_faq',
          source: 'deposit_faq',
          sourceName: 'Deposit FAQ',
          legacyToolName: 'kb_search_deposit_faq',
        },
      },
    })
  })

  it('returns a recoverable source_required result when search_knowledge has multiple sources and no source', async () => {
    process.env.INTERA_UNIFIED_KNOWLEDGE_TOOL = 'true'
    const { ToolRouter } = await import('../../tools')
    const { StreamingToolExecutor } = await import('../../streaming-tool-executor')
    const router = await ToolRouter.create('agent-a', true)
    const definition = router.getTool('search_knowledge')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const results = await StreamingToolExecutor.executeAll(
      [definition!],
      [{ id: 'tool-1', name: 'search_knowledge', input: { query: 'deposit status' } }],
      undefined,
      false,
      'agent-a',
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(results[0]?.output).toMatchObject({
      ok: true,
      output: {
        recoverable: true,
        errorCode: 'source_required',
        availableSources: expect.arrayContaining([
          expect.objectContaining({ source: 'deposit_bonus', name: 'Deposit Bonus' }),
        ]),
      },
    })
  })

  it('auto-selects the only source when search_knowledge omits source', async () => {
    process.env.INTERA_UNIFIED_KNOWLEDGE_TOOL = 'true'
    h.knowledgeSourceFindMany.mockResolvedValue([sourceDefault])
    const { ToolRouter } = await import('../../tools')
    const { StreamingToolExecutor } = await import('../../streaming-tool-executor')
    const router = await ToolRouter.create('agent-a', true)
    const definition = router.getTool('search_knowledge')

    expect((definition?.inputSchema as any).required).toEqual(['query'])
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => (
      new Response(JSON.stringify({ list: [{ score: 0.6 }] }), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetchMock)

    const results = await StreamingToolExecutor.executeAll(
      [definition!],
      [{ id: 'tool-1', name: 'search_knowledge', input: { query: 'deposit status' } }],
      undefined,
      false,
      'agent-a',
    )

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      prompt: 'deposit status',
      top_k: 15,
      group_ids: ['group-default'],
    })
    expect(results[0]?.output).toMatchObject({
      ok: true,
      output: {
        knowledgeSourceId: 'kb_default_123456',
        knowledgeSourceName: 'Default',
        sourceSelection: {
          mode: 'auto_single_source',
          source: 'default',
        },
      },
    })
  })

  it('preserves a source default topK below 15 in runtime mode without rewriting the row', async () => {
    const { ToolRouter } = await import('../../tools')
    const { StreamingToolExecutor } = await import('../../streaming-tool-executor')
    const router = await ToolRouter.create('agent-a', false)
    const definition = router.getTool('kb_search_account')

    expect(definition).toBeDefined()
    h.knowledgeSourceFindFirst.mockResolvedValue(sourceAccountLowTopK)
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => (
      new Response(JSON.stringify({ list: [{ score: 0.7 }] }), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetchMock)

    await StreamingToolExecutor.executeAll(
      [definition!],
      [{ id: 'tool-1', name: 'kb_search_account', input: { query: 'account locked' } }],
      undefined,
      false,
      'agent-a',
    )

    expect(h.knowledgeSourceUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'kb_account_123456' },
      data: expect.objectContaining({ topK: 15 }),
    }))

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      prompt: 'account locked',
      top_k: 6,
      group_ids: ['group-account'],
      embedding_rate: 0.9,
    })
  })

  it('preserves built-in zod validation when a DB tool overrides ask_user_questions', async () => {
    h.toolFindMany.mockResolvedValue([
      {
        id: 'tool-ask-form',
        agentConfigId: 'agent-a',
        name: 'ask_user_questions',
        description: 'DB override',
        inputSchema: JSON.stringify({
          type: 'object',
          properties: {
            title: { type: 'string' },
            fields: { type: 'array' },
          },
          required: ['title', 'fields'],
        }),
        outputSchema: '{}',
        mode: 'channel',
        endpoint: null,
        httpMethod: 'POST',
        headers: null,
        timeoutMs: 8000,
        mockFixture: null,
        displayVerb: null,
        renderHints: null,
        toolCategory: 'operational',
        isConcurrencySafe: false,
        enabled: true,
      },
    ])
    h.knowledgeSourceFindMany.mockResolvedValue([])

    const { ToolRouter } = await import('../../tools')
    const { StreamingToolExecutor } = await import('../../streaming-tool-executor')
    const router = await ToolRouter.create('agent-a', true)
    const formTool = router.getTool('ask_user_questions')

    expect(formTool?.zodSchema).toBeDefined()

    const results = await StreamingToolExecutor.executeAll(
      router.getToolDefinitions(),
      [{ id: 'tool-1', name: 'ask_user_questions', input: {} }],
    )

    expect(results[0]?.toolUse?.status).toBe('error')
    expect((results[0]?.output as { ok?: boolean; error?: string })?.ok).toBe(false)
    expect((results[0]?.output as { error?: string })?.error).toContain('Input validation failed')
  })
})

import { describe, it, expect, beforeAll } from 'vitest'

// These tests require a live PostgreSQL database and GPTBots API.
// Requires DATABASE_URL and GPTBOTS_API_KEY env vars.
// Skipped in local/CI environments without live service access.

describe.skipIf(!process.env.GPTBOTS_API_KEY)('search_knowledge end-to-end (DB + GPTBots)', () => {
  let ToolRouter: typeof import('../../../agent/tools').ToolRouter
  let StreamingToolExecutor: typeof import('../../../agent/streaming-tool-executor').StreamingToolExecutor

  beforeAll(async () => {
    const toolsMod = await import('../../../agent/tools')
    ToolRouter = toolsMod.ToolRouter
    const execMod = await import('../../../agent/streaming-tool-executor')
    StreamingToolExecutor = execMod.StreamingToolExecutor
  })

  it('ToolRouter.create() exposes search_knowledge and hides legacy kb_search_* provider schemas', async () => {
    const router = await ToolRouter.create('api')
    const tools = router.getTools()
    const kbTools = tools.filter((t: { name: string }) => t.name.startsWith('kb_search_'))
    const searchTool = tools.find((t: { name: string }) => t.name === 'search_knowledge')!
    const sourceEnum = ((searchTool as any).input_schema.properties.source.enum ?? []) as string[]

    expect(kbTools.length).toBe(0)
    expect(searchTool).toBeDefined()
    expect(sourceEnum).toEqual(expect.arrayContaining([
      'deposit',
      'general',
      'game',
      'account',
      'withdraw',
      'promotion',
      'abbreviation_mapping',
    ]))
    expect(searchTool.input_schema).toHaveProperty('properties.query')
    expect(searchTool.input_schema).toHaveProperty('properties.source')
    expect(searchTool.input_schema).toHaveProperty('properties.topK')
  })

  it('ToolRouter.getToolDefinitions() keeps hidden kb_search_* definitions with http config', async () => {
    const router = await ToolRouter.create('api')
    const defs = router.getToolDefinitions()
    const kbDefs = defs.filter((d: { name: string; mode?: string; endpoint?: string; isConcurrencySafe?: boolean; enabled?: boolean }) => d.name.startsWith('kb_search_'))

    for (const d of kbDefs) {
      expect(d.mode).toBe('http')
      expect(d.endpoint).toBe('https://api-sg.gptbots.ai/v1/vector/match')
      expect(d.isConcurrencySafe).toBe(true)
      expect(d.enabled).toBe(true)
      expect((d as { providerHidden?: boolean }).providerHidden).toBe(true)
    }
  })

  it('search_knowledge executes against GPTBots API and returns results', async () => {
    if (!process.env.GPTBOTS_API_KEY) {
      console.warn('GPTBOTS_API_KEY not set — skipping live API test')
      return
    }

    const router = await ToolRouter.create('api')
    const depositDef = router.getTool('search_knowledge')
    expect(depositDef).toBeDefined()

    const executor = new StreamingToolExecutor(
      router.getToolDefinitions(),
      undefined,
      undefined,
      'api',
    )

    // Use executeAll to call the tool synchronously
    const results = await (StreamingToolExecutor as any).executeAll?.(
      router.getToolDefinitions(),
      [{ id: 'tool-1', name: 'search_knowledge', input: { query: 'how to deposit', source: 'deposit' } }],
    )

    // If executeAll doesn't exist, test via the internal http execution path
    if (!results) {
      // Access executeHttp via the private method for testing
      const result = await (executor as any).executeHttp(depositDef!, { query: 'how to deposit', source: 'deposit' })
      expect(result).toBeDefined()
      // GPTBots returns { results: [...], total: number }
      if (result && typeof result === 'object') {
        const r = result as Record<string, unknown>
        expect(r).toHaveProperty('results')
        console.log(`GPTBots returned ${(r.results as Array<unknown>)?.length ?? 0} results for "how to deposit"`)
      }
    }
  }, 15000)

  it('legacy kb_search_* definitions remain executable and concurrency-safe behind runtime compatibility', async () => {
    const router = await ToolRouter.create('api')
    const kbDefs = router.getToolDefinitions().filter((d: { name: string }) => d.name.startsWith('kb_search_'))

    // All kb search tools should be concurrency-safe (parallelizable)
    for (const d of kbDefs) {
      expect(d.isConcurrencySafe).toBe(true)
    }

    // Verify that getTool resolves each
    for (const d of kbDefs) {
      const tool = router.getTool(d.name)
      expect(tool).toBeDefined()
      expect(tool!.name).toBe(d.name)
    }
  })
})

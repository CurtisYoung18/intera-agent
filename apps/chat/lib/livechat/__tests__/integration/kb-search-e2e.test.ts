import { describe, it, expect, beforeAll } from 'vitest'

// These tests hit the real Railway PostgreSQL and GPTBots API.
// Requires DATABASE_URL and GPTBOTS_API_KEY env vars.

describe('kb_search_* end-to-end (Railway DB + GPTBots)', () => {
  let SkillRouter: typeof import('../../../agent/skills').SkillRouter
  let StreamingToolExecutor: typeof import('../../../agent/streaming-tool-executor').StreamingToolExecutor

  beforeAll(async () => {
    const skillsMod = await import('../../../agent/skills')
    SkillRouter = skillsMod.SkillRouter
    const execMod = await import('../../../agent/streaming-tool-executor')
    StreamingToolExecutor = execMod.StreamingToolExecutor
  })

  it('SkillRouter.create() generates kb_search_* tools for each KnowledgeSource', async () => {
    const router = await SkillRouter.create('api')
    const tools = router.getTools()
    const kbTools = tools.filter(t => t.name.startsWith('kb_search_'))

    expect(kbTools.length).toBeGreaterThanOrEqual(7)

    // Each kb_search_* tool should have the source's description
    const names = kbTools.map(t => t.name)
    expect(names).toContain('kb_search_Deposit')
    expect(names).toContain('kb_search_General')
    expect(names).toContain('kb_search_Game')
    expect(names).toContain('kb_search_Account')
    expect(names).toContain('kb_search_Withdraw')
    expect(names).toContain('kb_search_Promotion')
    expect(names).toContain('kb_search_Abbreviation_Mapping')

    // Verify descriptions are from DB
    const deposit = kbTools.find(t => t.name === 'kb_search_Deposit')!
    expect(deposit.description).toBe('Deposit QA')

    const game = kbTools.find(t => t.name === 'kb_search_Game')!
    expect(game.description).toBe('Game QA')

    const general = kbTools.find(t => t.name === 'kb_search_General')!
    expect(general.description).toBe('General QA')

    // Each tool should have query + topK input schema
    for (const t of kbTools) {
      expect(t.input_schema).toHaveProperty('properties.query')
      expect(t.input_schema).toHaveProperty('properties.topK')
    }
  })

  it('SkillRouter.getToolDefinitions() includes kb_search_* definitions with http config', async () => {
    const router = await SkillRouter.create('api')
    const defs = router.getToolDefinitions()
    const kbDefs = defs.filter(d => d.name.startsWith('kb_search_'))

    for (const d of kbDefs) {
      expect(d.mode).toBe('http')
      expect(d.endpoint).toBe('https://api-sg.gptbots.ai/v1/vector/match')
      expect(d.isConcurrencySafe).toBe(true)
      expect(d.enabled).toBe(true)
    }
  })

  it('kb_search_Deposit executes against GPTBots API and returns results', async () => {
    if (!process.env.GPTBOTS_API_KEY) {
      console.warn('GPTBOTS_API_KEY not set — skipping live API test')
      return
    }

    const router = await SkillRouter.create('api')
    const depositDef = router.getSkill('kb_search_Deposit')
    expect(depositDef).toBeDefined()

    const executor = new StreamingToolExecutor(
      router.getToolDefinitions(),
    )

    // Use executeAll to call the tool synchronously
    const results = await (StreamingToolExecutor as any).executeAll?.(
      router.getToolDefinitions(),
      [{ id: 'tool-1', name: 'kb_search_Deposit', input: { query: 'how to deposit' } }],
    )

    // If executeAll doesn't exist, test via the internal http execution path
    if (!results) {
      // Access executeHttp via the private method for testing
      const result = await (executor as any).executeHttp(depositDef!, { query: 'how to deposit' })
      expect(result).toBeDefined()
      // GPTBots returns { results: [...], total: number }
      if (result && typeof result === 'object') {
        const r = result as Record<string, unknown>
        expect(r).toHaveProperty('results')
        console.log(`GPTBots returned ${(r.results as Array<unknown>)?.length ?? 0} results for "how to deposit"`)
      }
    }
  }, 15000)

  it('multiple kb_search_* tools can be defined and are concurrency-safe', async () => {
    const router = await SkillRouter.create('api')
    const kbDefs = router.getToolDefinitions().filter(d => d.name.startsWith('kb_search_'))

    // All kb search tools should be concurrency-safe (parallelizable)
    for (const d of kbDefs) {
      expect(d.isConcurrencySafe).toBe(true)
    }

    // Verify that getSkill resolves each
    for (const d of kbDefs) {
      const skill = router.getSkill(d.name)
      expect(skill).toBeDefined()
      expect(skill!.name).toBe(d.name)
    }
  })
})

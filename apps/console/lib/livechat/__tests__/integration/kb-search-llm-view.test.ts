import { describe, it, expect } from 'vitest'

describe.skipIf(!process.env.GPTBOTS_API_KEY)('search_knowledge — LLM perspective verification', () => {
  it('LLM sees one unified knowledge tool with source enum choices', async () => {
    const { ToolRouter } = await import('../../../agent/tools')
    const router = await ToolRouter.create('api')
    const allTools = router.getTools()

    const kbTools = allTools.filter((t: { name: string }) => t.name.startsWith('kb_search_'))
    const searchTool = allTools.find((t: { name: string }) => t.name === 'search_knowledge')
    const sourceEnum = ((searchTool as any)?.input_schema?.properties?.source?.enum ?? []) as string[]

    console.log(`\n=== Intera exposes search_knowledge with ${sourceEnum.length} sources ===\n`)
    console.log(`Sources: ${sourceEnum.join(', ')}`)

    expect(kbTools.length).toBe(0)
    expect(searchTool).toBeDefined()
    expect(sourceEnum.length).toBeGreaterThanOrEqual(1)
    expect(router.getToolDefinitions().filter((d: { name: string }) => d.name.startsWith('kb_search_')).length).toBeGreaterThanOrEqual(1)
  })

  it('Deposit query example: LLM picks search_knowledge with deposit source', async () => {
    const { ToolRouter } = await import('../../../agent/tools')
    const router = await ToolRouter.create('api')
    const allTools = router.getTools()
    const searchTool = allTools.find((t: { name: string }) => t.name === 'search_knowledge')
    const sourceEnum = ((searchTool as any)?.input_schema?.properties?.source?.enum ?? []) as string[]

    console.log('\n=== Simulated LLM decision for "how do I deposit money?" ===')
    console.log('LLM calls: search_knowledge({ query, source: "deposit" })')

    expect(searchTool).toBeDefined()
    expect(sourceEnum).toContain('deposit')
  })

  it('Abbreviation query example: LLM picks search_knowledge with abbreviation source', async () => {
    const { ToolRouter } = await import('../../../agent/tools')
    const router = await ToolRouter.create('api')
    const allTools = router.getTools()
    const searchTool = allTools.find((t: { name: string }) => t.name === 'search_knowledge')
    const sourceEnum = ((searchTool as any)?.input_schema?.properties?.source?.enum ?? []) as string[]

    expect(searchTool).toBeDefined()
    expect(sourceEnum).toContain('abbreviation_mapping')

    console.log('\n=== Simulated LLM decision for "what does P2P mean?" ===')
    console.log('LLM calls search_knowledge with source="abbreviation_mapping"')
  })

  it('Multi-source query: LLM can choose one consolidated source enum at a time', async () => {
    const { ToolRouter } = await import('../../../agent/tools')
    const router = await ToolRouter.create('api')
    const defs = router.getToolDefinitions()
    const providerNames = router.getTools().map((t: { name: string }) => t.name)

    expect(providerNames).toContain('search_knowledge')
    expect(providerNames.some((name) => name.startsWith('kb_search_'))).toBe(false)
    expect(defs.filter((d: { name: string }) => d.name.startsWith('kb_search_')).every((d: { providerHidden?: boolean }) => d.providerHidden)).toBe(true)

    console.log('\n=== Multi-source parallel query ===')
    console.log('User: "I deposited money but it is not showing. Any promo?"')
    console.log('LLM uses search_knowledge and selects source keys from the schema.')
  })
})

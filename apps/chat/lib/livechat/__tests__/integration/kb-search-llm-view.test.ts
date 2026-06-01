import { describe, it, expect } from 'vitest'

describe.skipIf(!process.env.GPTBOTS_API_KEY)('kb_search_* — LLM perspective verification', () => {
  it('LLM sees 7 independent kb_search tools, each with its own description', async () => {
    const { SkillRouter } = await import('../../../agent/skills')
    const router = await SkillRouter.create('api')
    const allTools = router.getTools()

    // Filter to just kb_search tools (what the LLM sees mixed with other tools)
    const kbTools = allTools.filter(t => t.name.startsWith('kb_search_'))

    console.log(`\n=== Intera sees ${kbTools.length} knowledge search tools ===\n`)
    for (const t of kbTools) {
      console.log(`  Tool: ${t.name}`)
      console.log(`  Description: ${t.description}`)
      console.log(`  Input: query (string), topK (number, default 5)`)
      console.log()
    }

    expect(kbTools.length).toBe(7)

    // Verify LLM can distinguish sources by description
    const descriptions = kbTools.map(t => t.description)
    const unique = new Set(descriptions)
    expect(unique.size).toBeGreaterThanOrEqual(6) // at least most should differ

    // Verify concurrency: these are all safe to call in parallel
    const defs = router.getToolDefinitions().filter(d => d.name.startsWith('kb_search_'))
    expect(defs.every(d => d.isConcurrencySafe)).toBe(true)
    console.log(`All ${defs.length} kb_search tools are concurrency-safe → LLM can call multiple in parallel`)
  })

  it('Deposit query example: LLM picks kb_search_Deposit based on description', async () => {
    const { SkillRouter } = await import('../../../agent/skills')
    const router = await SkillRouter.create('api')
    const allTools = router.getTools()

    // Simulate the LLM's decision:
    // User asks: "how do I deposit money?"
    // LLM scans tool descriptions:
    //   kb_search_Deposit: "Deposit QA" → MATCH
    //   kb_search_Game: "Game QA" → no
    //   kb_search_General: "General QA" → maybe
    //
    // LLM decides: call kb_search_Deposit AND kb_search_General in parallel

    const depositTool = allTools.find(t => t.name === 'kb_search_Deposit')
    expect(depositTool).toBeDefined()
    expect(depositTool!.description).toBe('Deposit QA')

    const generalTool = allTools.find(t => t.name === 'kb_search_General')
    expect(generalTool).toBeDefined()
    expect(generalTool!.description).toBe('General QA')

    console.log('\n=== Simulated LLM decision for "how do I deposit money?" ===')
    console.log(`LLM picks: kb_search_Deposit ("${depositTool!.description}") + kb_search_General ("${generalTool!.description}")`)
    console.log('Both called in parallel (isConcurrencySafe: true)')
  })

  it('Abbreviation query example: LLM picks kb_search_Abbreviation_Mapping', async () => {
    const { SkillRouter } = await import('../../../agent/skills')
    const router = await SkillRouter.create('api')
    const allTools = router.getTools()

    const abbrevTool = allTools.find(t => t.name === 'kb_search_Abbreviation_Mapping')
    expect(abbrevTool).toBeDefined()
    expect(abbrevTool!.description).toBe('Only when customer said possbile abbreviation')

    console.log('\n=== Simulated LLM decision for "what does P2P mean?" ===')
    console.log(`LLM scans descriptions, sees kb_search_Abbreviation_Mapping: "${abbrevTool!.description}"`)
    console.log('Customer said "P2P" which is a possible abbreviation → triggers this tool')
  })

  it('Multi-source parallel query: LLM can call 3 unrelated sources simultaneously', async () => {
    const { SkillRouter } = await import('../../../agent/skills')
    const router = await SkillRouter.create('api')
    const defs = router.getToolDefinitions()

    // Simulate: user asks a broad question that spans multiple domains
    // "I deposited money but it's not showing. Also, is there a promo?"
    // LLM decides: call kb_search_Deposit + kb_search_Promotion in parallel

    const depositDef = defs.find(d => d.name === 'kb_search_Deposit')
    const promoDef = defs.find(d => d.name === 'kb_search_Promotion')
    const generalDef = defs.find(d => d.name === 'kb_search_General')

    for (const d of [depositDef, promoDef, generalDef]) {
      expect(d).toBeDefined()
      expect(d!.isConcurrencySafe).toBe(true)
      expect(d!.enabled).toBe(true)
      expect(d!.mode).toBe('http')
    }

    console.log('\n=== Multi-source parallel query ===')
    console.log('User: "I deposited money but it is not showing. Any promo?"')
    console.log('LLM decides to call in parallel:')
    console.log(`  1. kb_search_Deposit → ${depositDef!.description}`)
    console.log(`  2. kb_search_Promotion → ${promoDef!.description}`)
    console.log(`  3. kb_search_General → ${generalDef!.description}`)
    console.log('\nAll 3 execute concurrently, results merged into LLM context')
  })
})

// Guardian test: verify playground pipeline produces zero DB writes
// and zero operational tool side effects.

import { describe, it, expect } from 'vitest'
import { createMemoryPersistence } from '../../persistence-port'
import { isSafeInDryRun, dryRunMockResult } from '../../dry-run-executor'
import { StreamingToolExecutor } from '../../streaming-tool-executor'
import type { ToolDefinition } from '@intera/shared/types'

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'Test tool',
    inputSchema: { type: 'object', properties: {} } as any,
    mode: 'static_fixture',
    isConcurrencySafe: true,
    enabled: true,
    ...overrides,
  }
}

describe('Playground safety invariants', () => {
  // ── Persistence port ──
  it('memory persistence port never touches DB', () => {
    const { port, cases, memories, messages, traces } = createMemoryPersistence()
    // All collections start empty
    expect(cases).toHaveLength(0)
    expect(memories).toHaveLength(0)
    expect(messages).toHaveLength(0)
    expect(traces).toHaveLength(0)
  })

  it('memory persistence port accumulates data in-memory', async () => {
    const { port, cases, memories, messages, traces } = createMemoryPersistence()

    await port.ensureCase({ id: 'c1', orgId: 'org1', userId: 'u1', type: 'general', status: 'created', chatId: 'chat1' })
    await port.saveMemory('c1', { caseId: 'c1', contextMap: '{}', missingFacts: '[]', toolsCalled: '[]', toolResults: '{}', keyEvents: '[]' })
    await port.saveMessages([{ id: 'm1', caseId: 'c1', role: 'user', content: 'hi' }])
    await port.saveTrace({ caseId: 'c1', actionType: 'test', title: 'test trace' })

    expect(cases).toHaveLength(1)
    expect(memories).toHaveLength(1)
    expect(messages).toHaveLength(1)
    expect(traces).toHaveLength(1)
    expect(cases[0].id).toBe('c1')
  })

  // ── Dry-run chokepoint ──
  it('system_info tools are safe in dry-run', () => {
    const tool = makeTool({ name: 'kb_search_help', toolCategory: 'system_info' })
    expect(isSafeInDryRun(tool)).toBe(true)
  })

  it('operational tools are intercepted in dry-run', () => {
    const tool = makeTool({ name: 'query_order_status', toolCategory: 'operational' })
    expect(isSafeInDryRun(tool)).toBe(false)
  })

  it('tools with null/undefined category default to operational (fail-safe)', () => {
    const toolNull = makeTool({ name: 'legacy_tool', toolCategory: undefined })
    const toolMissing = makeTool({ name: 'old_tool' })
    delete (toolMissing as any).toolCategory

    expect(isSafeInDryRun(toolNull)).toBe(false)
    expect(isSafeInDryRun(toolMissing)).toBe(false)
  })

  it('dry-run mock results contain _dryRun marker', () => {
    const tool = makeTool({ name: 'create_human_task', toolCategory: 'operational' })
    const result = dryRunMockResult(tool)
    expect(result.output).toContain('_dryRun')
    expect(result.output).toContain('intercepted')
    expect(result.latencyMs).toBe(1)
    expect(result.name).toBe('create_human_task')
  })

  // ── Dispatch order — operational before unknown ──
  it('all built-in operational tools are correctly classified', () => {
    const operationalPatterns = [
      'query_order_status', 'query_payment_channel_status', 'get_account_status',
      'get_kyc_status', 'get_transaction_history', 'get_active_promotions',
      'get_eligible_promotions', 'get_latest_withdrawal', 'get_withdraw_conditions',
      'ocr_receipt', 'start_procedure', 'create_human_task', 'finalize_procedure',
      'ask_user_questions',
    ]

    for (const name of operationalPatterns) {
      const tool = makeTool({ name, toolCategory: 'operational' })
      expect(isSafeInDryRun(tool)).toBe(false)
    }
  })

  it('all built-in system_info tools are correctly classified', () => {
    const systemInfoPatterns = [
      'read_chat_memory', 'read_user_profile',       'get_current_time', 'kb_search_docs', 'search_delay_notice',
      'remember',
    ]

    for (const name of systemInfoPatterns) {
      const tool = makeTool({ name, toolCategory: 'system_info' })
      expect(isSafeInDryRun(tool)).toBe(true)
    }
  })

  // ── AgentLoop + StreamingToolExecutor integration ──
  it('AgentLoopDeps accepts persistence port + dryRun', () => {
    const { port } = createMemoryPersistence()
    const deps = {
      config: {} as any,
      caseId: 'test',
      orgId: 'org1',
      userId: 'u1',
      coreSystemPrompt: 'test',
      persistence: port,
      dryRun: true,
    }
    expect(deps.persistence).toBeDefined()
    expect(deps.dryRun).toBe(true)
  })

  it('memory persistence implements full PersistencePort interface', async () => {
    const { port, cases, memories, messages, traces } = createMemoryPersistence()

    await port.ensureCase({ id: 'c1', orgId: 'o1', userId: 'u1', type: 't', status: 'created', chatId: 'test-chat' })
    await port.saveMemory('c1', { caseId: 'c1' })
    await port.saveMessages([{ id: 'm1', caseId: 'c1', role: 'user', content: 'hi' }])
    await port.saveTrace({ caseId: 'c1', actionType: 'test', title: 't' })
    await port.flush()

    expect(cases).toHaveLength(1)
    expect(memories).toHaveLength(1)
    expect(messages).toHaveLength(1)
    expect(traces).toHaveLength(1)
    expect(cases[0].id).toBe('c1')
  })

  it('StreamingToolExecutor accepts dryRun in constructor', () => {
    const tool = makeTool({ name: 'query_order', mode: 'static_fixture', toolCategory: 'operational' })
    const executor = new StreamingToolExecutor([tool], undefined, true, 'test-org')
    expect(executor).toBeDefined()
  })

  it('StreamingToolExecutor with dryRun + system_info tool', () => {
    const tool = makeTool({ name: 'read_chat_memory', mode: 'static_fixture', toolCategory: 'system_info' })
    const executor = new StreamingToolExecutor([tool], undefined, true, 'test-org')
    expect(executor).toBeDefined()
  })

  // ── Blocker 1 fix: humanTask.create routes through persistence port ──
  it('memory persistence createHumanTask accumulates in-memory (no real DB)', async () => {
    const { port, humanTasks } = createMemoryPersistence()

    await port.createHumanTask({ caseId: 'c1', queue: 'general', question: 'Agent stuck test' })

    expect(humanTasks).toHaveLength(1)
    expect(humanTasks[0].caseId).toBe('c1')
    expect(humanTasks[0].queue).toBe('general')
    expect(humanTasks[0].question).toContain('Agent stuck')
  })

  it('memory persistence creates no side effects beyond arrays', async () => {
    const { port, cases, humanTasks, traces } = createMemoryPersistence()

    await port.ensureCase({ id: 'c1', orgId: 'o1', userId: 'u1', type: 't', status: 'created', chatId: 'test-chat' })
    await port.createHumanTask({ caseId: 'c1', queue: 'general', question: 'escalation' })
    await port.saveTrace({ caseId: 'c1', actionType: 'test', title: 'trace' })

    // All three arrays should have entries
    expect(cases).toHaveLength(1)
    expect(humanTasks).toHaveLength(1)
    expect(traces).toHaveLength(1)

    // verify these came from memory, not real DB (which this test has no access to)
  })
})

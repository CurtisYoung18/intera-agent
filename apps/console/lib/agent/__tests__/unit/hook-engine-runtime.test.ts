import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentConfigData, SSEEvent, ToolDefinition } from '@intera/shared/types'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { AgentLoop } from '../../loop'
import { ToolRouter } from '../../tools'
import { HookEngine } from '../../hook-engine'
import { createMemoryPersistence } from '../../persistence-port'
import { mockTextStream, mockToolUseStream } from '../mocks/anthropic'

const h = vi.hoisted(() => ({
  toolFindMany: vi.fn(),
  caseTypeFindUnique: vi.fn(),
  hookBindingFindMany: vi.fn(),
}))

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    tool: { findMany: h.toolFindMany },
    caseType: { findUnique: h.caseTypeFindUnique },
    hookBinding: { findMany: h.hookBindingFindMany },
    chatSession: { upsert: vi.fn() },
    userProfile: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}))

function config(overrides: Partial<AgentConfigData & { maxStopRetries?: number }> = {}): AgentConfigData & { maxStopRetries?: number } {
  return {
    model: 'claude-sonnet-4-20250514',
    temperature: 0,
    thinkingBudget: 1024,
    maxIterations: 5,
    maxOutputTokens: 1024,
    coreSystemPrompt: 'You are a helpful assistant.',
    extendedThinking: false,
    memoryStrategy: {
      ...DEFAULT_MEMORY_STRATEGY,
      enableChatMemory: false,
      enableAutocompact: false,
    },
    ...overrides,
  }
}

function testTool(name = 'test_lookup'): ToolDefinition {
  return {
    name,
    description: 'Test lookup',
    inputSchema: { type: 'object', properties: {}, required: [] },
    mode: 'static',
    mockFixture: { status: 'ok', needsReview: true },
    isConcurrencySafe: true,
    enabled: true,
    toolCategory: 'operational',
  }
}

function makeLoop(engine: HookEngine, streams: unknown[], cfg = config()) {
  const memory = createMemoryPersistence()
  const loop = new AgentLoop({
    config: cfg,
    configId: 'agent_1',
    caseId: 'case_1',
    orgId: 'org_1',
    userId: 'user_1',
    systemPrompt: 'Test system prompt',
    coreSystemPrompt: 'Test core prompt',
    persistence: memory.port,
    dryRun: false,
  })

  const router = new ToolRouter('agent_1')
  router.setTool(testTool())

  const client = {
    messages: {
      stream: vi.fn(),
      create: vi.fn(),
    },
  }
  for (const stream of streams) {
    client.messages.stream.mockResolvedValueOnce(stream)
  }

  ;(loop as unknown as { hookEngine: HookEngine }).hookEngine = engine
  ;(loop as unknown as { toolRouter: ToolRouter }).toolRouter = router
  ;(loop as unknown as { anthropicClient: typeof client }).anthropicClient = client

  const events: SSEEvent[] = []
  const sendEvent = vi.fn((event: SSEEvent) => {
    events.push(event)
  })

  return { loop, memory, events, sendEvent, client }
}

function staticHook(
  name: string,
  checkpoint: 'PreToolUse' | 'PostToolUse' | 'Stop',
  check: Record<string, unknown>,
  effect: Record<string, unknown>,
) {
  return {
    id: name,
    name,
    checkpoint,
    handlerKind: 'declarative' as const,
    handler: JSON.stringify({
      kind: 'declarative',
      check,
      effect,
    }),
    enabled: true,
    severity: 'high',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.toolFindMany.mockResolvedValue([{ id: 'tool_1', name: 'test_lookup' }])
  h.caseTypeFindUnique.mockResolvedValue({ id: 'case_type_1', type: 'deposit_issue' })
  h.hookBindingFindMany.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HookEngine bindings and handlers', () => {
  it('loads active HookBindings from agent, CaseType, ProcedureStep, and Tool scopes', async () => {
    const handler = JSON.stringify({
      kind: 'declarative',
      check: { kind: 'rule', always: true },
      effect: { decision: 'warn', guidance: 'scope active' },
    })
    const hook = (id: string, name: string) => ({
      id,
      name,
      description: name,
      checkpoint: 'PreToolUse',
      handlerKind: 'declarative',
      handler,
      enabled: true,
      severity: 'medium',
    })

    h.hookBindingFindMany.mockResolvedValue([
      { scopeType: 'agent', scopeKey: 'agent', enabled: true, hook: hook('h_agent', 'agent_hook') },
      { scopeType: 'caseType', scopeKey: 'caseType:case_type_1', caseTypeId: 'case_type_1', enabled: true, hook: hook('h_case', 'case_hook') },
      { scopeType: 'procedureStep', scopeKey: 'procedureStep:case_type_1:step_1', procedureStepId: 'step_1', enabled: true, hook: hook('h_step', 'step_hook') },
      { scopeType: 'tool', scopeKey: 'tool:tool_1', toolId: 'tool_1', enabled: true, hook: hook('h_tool', 'tool_hook') },
    ])

    const engine = await HookEngine.create('agent_1', { caseType: { type: 'deposit_issue' } })
    const result = await engine.evaluate('PreToolUse', {
      checkpoint: 'PreToolUse',
      agentConfigId: 'agent_1',
      caseType: { type: 'deposit_issue' },
      procedureStepIds: ['step_1'],
      tool: { name: 'test_lookup', input: {} },
      caseFacts: {},
      missingFacts: [],
      previousToolCalls: [],
      traceSummary: [],
    })

    expect(result.summary).toBe('warn')
    expect(result.results.map((r) => r.hookName).sort()).toEqual([
      'agent_hook',
      'case_hook',
      'step_hook',
      'tool_hook',
    ])
  })

  it('dispatches restricted JavaScript and HTTP Hook handlers', async () => {
    const engine = new HookEngine('agent_1')
    engine.setHook({
      name: 'code_stop',
      checkpoint: 'Stop',
      handler: {
        kind: 'code',
        runtime: 'javascript',
        source: 'async function hook(ctx) { return ctx.replyDraft.includes("bad") ? { action: "block", reason: "bad draft" } : { action: "allow" } }',
      },
    })

    const codeResult = await engine.evaluate('Stop', {
      checkpoint: 'Stop',
      agentConfigId: 'agent_1',
      procedureStepIds: [],
      caseFacts: {},
      missingFacts: [],
      previousToolCalls: [],
      traceSummary: [],
      replyDraft: 'bad draft',
    })
    expect(codeResult.summary).toBe('block')

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ action: 'warn', reason: 'remote warning' }),
    })))

    const httpEngine = new HookEngine('agent_1')
    httpEngine.setHook({
      name: 'http_stop',
      checkpoint: 'Stop',
      handler: {
        kind: 'http',
        endpoint: 'https://rules.example.test/hook',
        method: 'POST',
        timeoutMs: 1000,
      },
    })

    const httpResult = await httpEngine.evaluate('Stop', {
      checkpoint: 'Stop',
      agentConfigId: 'agent_1',
      procedureStepIds: [],
      caseFacts: {},
      missingFacts: [],
      previousToolCalls: [],
      traceSummary: [],
      replyDraft: 'safe draft',
    })
    expect(httpResult.summary).toBe('warn')
    expect(fetch).toHaveBeenCalledWith(
      'https://rules.example.test/hook',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('AgentLoop Hook checkpoints', () => {
  it('PreToolUse block prevents the Tool call', async () => {
    const engine = new HookEngine('agent_1')
    engine.setHook({
      name: 'block_lookup',
      checkpoint: 'PreToolUse',
      handler: {
        kind: 'declarative',
        check: { kind: 'rule', match: { tools: ['test_lookup'] }, denyTools: ['test_lookup'] },
        effect: { decision: 'block', guidance: 'Do not call this lookup.' },
      },
    })
    const { loop, events, sendEvent } = makeLoop(engine, [
      mockToolUseStream('test_lookup', { id: '123' }, 'tool_blocked'),
    ])

    const result = await loop.run('please check this', sendEvent)

    expect(result.transition).toBe('next_turn')
    expect(events.some((e) => e.type === 'tool_executing' && (e.data as { name?: string }).name === 'test_lookup')).toBe(false)
    expect(events.some((e) => e.type === 'policy_blocked')).toBe(true)
  })

  it('PostToolUse can escalate on a Tool result', async () => {
    const engine = new HookEngine('agent_1')
    engine.setHook({
      name: 'review_lookup_result',
      checkpoint: 'PostToolUse',
      handler: {
        kind: 'declarative',
        check: { kind: 'rule', match: { tools: ['test_lookup'] }, always: true, reason: 'Result needs human review.' },
        effect: { decision: 'escalate', tool: 'create_human_task', guidance: 'Escalate this result.' },
      },
    })
    const { loop, memory, events, sendEvent } = makeLoop(engine, [
      mockToolUseStream('test_lookup', { id: '123' }, 'tool_review'),
    ])

    const result = await loop.run('please check this', sendEvent)

    expect(result.transition).toBe('waiting_human')
    expect(memory.humanTasks).toHaveLength(1)
    expect(memory.humanTasks[0].question).toContain('review_lookup_result')
    expect(events.some((e) => e.type === 'tool_executing' && (e.data as { name?: string }).name === 'test_lookup')).toBe(true)
    expect(events.some((e) => e.type === 'escalated')).toBe(true)
  })

  it('Stop block prevents the final answer and retries safely', async () => {
    const engine = new HookEngine('agent_1')
    engine.setHook({
      name: 'no_refund_promise',
      checkpoint: 'Stop',
      handler: {
        kind: 'declarative',
        check: { kind: 'rule', replyContains: ['refund'] },
        effect: { decision: 'block', guidance: 'Do not promise refunds.' },
      },
    })
    const { loop, events, sendEvent } = makeLoop(engine, [
      mockTextStream('I will refund you now.'),
      mockTextStream('I will ask a human specialist to review this safely.'),
    ])

    const result = await loop.run('can you refund me?', sendEvent)
    const streamedText = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => String(e.data))
      .join('')

    expect(result.transition).toBe('next_turn')
    expect(streamedText).not.toContain('I will refund you now.')
    expect(streamedText).toContain('I will ask a human specialist')
    const assistantMessages = result.messages.filter((m) => m.role === 'assistant').map((m) => String(m.content))
    expect(assistantMessages.join('\n')).not.toContain('I will refund you now.')
    expect(result.messages.some((m) => m.role === 'user' && String(m.content).includes('[HOOK: Stop]'))).toBe(true)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentConfigData, SSEEvent, ToolDefinition } from '@intera/shared/types'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { AgentLoop } from '../../loop'
import { ToolRouter } from '../../tools'
import { HookEngine } from '../../hook-engine'
import { createMemoryPersistence } from '../../persistence-port'
import { mockTextStream, mockToolUseStream } from '../mocks/anthropic'
import {
  closeSession,
  recordInitialInputEvent,
  startProcedureRun,
} from '../../session-store'

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
    mode: 'static_fixture',
    mockFixture: { status: 'ok', needsReview: true },
    isConcurrencySafe: true,
    enabled: true,
    toolCategory: 'operational',
  }
}

function makeLoop(engine: HookEngine, streams: unknown[], cfg = config(), caseId = 'case_1') {
  const memory = createMemoryPersistence()
  const loop = new AgentLoop({
    config: cfg,
    configId: 'agent_1',
    caseId,
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

  it('accepts legacy runtime tool names without crashing HookContext evaluation', async () => {
    h.toolFindMany.mockResolvedValue([{ id: 'tool_legacy', name: 'CheckLatestDepositStatus' }])
    h.hookBindingFindMany.mockResolvedValue([
      {
        scopeType: 'tool',
        scopeKey: 'tool:CheckLatestDepositStatus',
        toolId: 'tool_legacy',
        enabled: true,
        hook: staticHook(
          'legacy_tool_hook',
          'PreToolUse',
          { kind: 'rule', always: true },
          { decision: 'warn', guidance: 'legacy tool observed' },
        ),
      },
    ])

    const engine = await HookEngine.create('agent_1')
    const result = await engine.evaluate('PreToolUse', {
      checkpoint: 'PreToolUse',
      agentConfigId: 'agent_1',
      procedureStepIds: [],
      tool: { name: 'CheckLatestDepositStatus', input: { member_id: 'JAYA11A4241' } },
      caseFacts: {},
      missingFacts: [],
      previousToolCalls: [
        { name: 'CheckLatestDepositStatus', output: { ok: true } },
      ],
      traceSummary: [],
    })

    expect(result.summary).toBe('warn')
    expect(result.results[0]).toMatchObject({
      hookName: 'legacy_tool_hook',
      action: 'warn',
    })
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

  it('can express local-support promise blocking as an agent-scoped Stop Hook', async () => {
    const engine = new HookEngine('agent_1')
    engine.setHook({
      name: 'support_promise_requires_handoff',
      checkpoint: 'Stop',
      handler: {
        kind: 'declarative',
        check: {
          kind: 'rule',
          forbiddenPhrases: [
            'sthaniya sahayog ma pathaunchu',
            'forward your concern to local support',
          ],
          reason: 'Reply promises local support handoff without durable handoff evidence.',
        },
        effect: {
          decision: 'block',
          guidance: 'Do not promise local support or department handoff unless create_human_task has created a durable task. Either call create_human_task or revise the answer to say the lookup failed and ask the customer to try again.',
        },
      },
    })

    const result = await engine.evaluate('Stop', {
      checkpoint: 'Stop',
      agentConfigId: 'agent_1',
      procedureStepIds: [],
      caseFacts: {},
      missingFacts: [],
      previousToolCalls: [],
      traceSummary: [],
      replyDraft: 'Tapaiko eSewa transaction history herda technical samasya aayo. Kripaya kehi samaya pachi feri try garnuhos, yo sama ko laagi ma sthaniya sahayog ma pathaunchu.',
    })

    expect(result.summary).toBe('block')
    expect(result.feedbackMessage).toContain('support_promise_requires_handoff')
    expect(result.results[0]).toMatchObject({
      hookName: 'support_promise_requires_handoff',
      action: 'block',
      reason: 'Reply promises local support handoff without durable handoff evidence.',
    })
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
    expect(events.some((e) => e.type === 'hook_blocked')).toBe(true)
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
    expect(events.some((e) => e.type === 'human_task_created')).toBe(true)
    expect(events.some((e) => e.type === 'escalated')).toBe(true)
    expect(memory.traces.some((trace) => trace.actionType === 'escalated')).toBe(true)
  })

  it('explicit create_human_task in general mode creates a durable waiting_human handoff', async () => {
    const engine = new HookEngine('agent_1')
    const { loop, memory, events, sendEvent } = makeLoop(engine, [
      mockToolUseStream('create_human_task', {
        queue: 'general',
        question: 'Customer requested a human specialist.',
      }, 'tool_handoff'),
    ])

    const result = await loop.run('human agent please', sendEvent)

    expect(result.transition).toBe('waiting_human')
    expect(result.caseStatus).toBe('waiting_human')
    expect(result.currentStage).toBe('waiting_human')
    expect(memory.cases).toHaveLength(1)
    expect(memory.cases[0].status).toBe('waiting_human')
    expect(memory.cases[0].blocker).toBe('Waiting for general')
    expect(memory.humanTasks).toHaveLength(1)
    expect(memory.humanTasks[0].queue).toBe('general')
    expect(memory.humanTasks[0].question).toContain('Customer requested a human specialist')
    expect(memory.memories).toHaveLength(1)
    expect(memory.memories[0].humanTaskStatus).toBe('pending')
    expect(events.some((e) => e.type === 'human_task_created')).toBe(true)
    expect(events.some((e) => e.type === 'escalated' && (e.data as { reason?: string }).reason === 'human_task_created')).toBe(true)
    expect(memory.traces.some((trace) => trace.actionType === 'escalated')).toBe(true)
    const streamedText = events
      .filter((event) => event.type === 'text_delta')
      .map((event) => String(event.data))
      .join('')
    expect(streamedText).toContain('human specialist')
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

  it('Stop escalate falls back to human escalation with a safe customer reply', async () => {
    const engine = new HookEngine('agent_1')
    engine.setHook({
      name: 'stop_requires_human',
      checkpoint: 'Stop',
      handler: {
        kind: 'declarative',
        check: { kind: 'rule', always: true, reason: 'Needs human review before sending.' },
        effect: { decision: 'escalate', tool: 'create_human_task', guidance: 'Escalate this reply to a human specialist.' },
      },
    })
    const { loop, memory, events, sendEvent } = makeLoop(engine, [
      mockTextStream('I can solve this immediately without human review.'),
    ], config({ maxStopRetries: 0 }))

    const result = await loop.run('hello', sendEvent)

    expect(result.transition).toBe('waiting_human')
    expect(result.caseStatus).toBe('escalated')
    expect(memory.cases).toHaveLength(1)
    expect(memory.cases[0].status).toBe('escalated')
    expect(memory.cases[0].blocker).toContain('Stop Hook fallback')
    expect(memory.humanTasks).toHaveLength(1)
    expect(memory.humanTasks[0].question).toContain('stop_requires_human:escalate')
    expect(memory.humanTasks[0].status).toBe('pending')
    expect(events.some((event) => event.type === 'human_task_created')).toBe(true)
    expect(memory.traces.some((trace) => trace.actionType === 'loop_decision' && trace.title === 'Stop Hook fallback')).toBe(true)
    expect(memory.traces.some((trace) => trace.actionType === 'escalated')).toBe(true)
    expect(events.some((event) => event.type === 'message_stop' && (event.data as { reason?: string }).reason === 'stop_hook_fallback')).toBe(true)
    expect(events.some((event) => event.type === 'escalated' && (event.data as { reason?: string }).reason === 'stop_hook_fallback')).toBe(true)
    const streamedText = events
      .filter((event) => event.type === 'text_delta')
      .map((event) => String(event.data))
      .join('')
    expect(streamedText).toContain('human specialist')
  })

  it('allows latest-epoch tool calls after newer customer input without a reconcile nudge', async () => {
    const caseId = 'case_new_input_no_reconcile_gate'
    recordInitialInputEvent(caseId, {
      content: '你好',
      source: 'customer_message',
      origin: 'customer',
    })
    startProcedureRun(caseId, {
      procedureId: 'deposit_issue',
      displayName: 'Deposit',
      procedure: {
        version: 'v2',
        whenToUse: 'Use for deposit lookups.',
        overview: 'Verify a deposit.',
        steps: [{
          id: 'lookup',
          title: 'Lookup deposit',
          guidance: 'Check the latest deposit status.',
          actions: [{
            id: 'lookup_latest',
            kind: 'call_tool',
            label: 'Lookup latest deposit',
            toolName: 'get_latest_deposit',
            required: true,
          }],
        }],
      },
      requestId: 'req-1',
    })
    recordInitialInputEvent(caseId, {
      content: '怎么注册',
      source: 'customer_message',
      origin: 'customer',
    })

    const engine = new HookEngine('agent_1')
    const { loop, events, sendEvent, client } = makeLoop(engine, [
      mockToolUseStream('test_lookup', { memberId: 'JAYA11C5184' }, 'tool_lookup'),
      mockTextStream('请访问官网并点击 Sign Up 完成注册。'),
    ], config(), caseId)

    const result = await loop.run('怎么注册', sendEvent)

    expect(result.transition).toBe('next_turn')
    expect(client.messages.stream).toHaveBeenCalledTimes(2)
    expect(events.some((event) =>
      event.type === 'message_stop' &&
      (event.data as { reason?: string }).reason === 'procedure_reconcile_nudge',
    )).toBe(false)
    const streamedText = events
      .filter((event) => event.type === 'text_delta')
      .map((event) => String(event.data))
      .join('')
    expect(streamedText).toContain('Sign Up')

    closeSession(caseId)
  })
})

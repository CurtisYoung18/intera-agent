import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  config: {
    model: 'deepseek-v4-pro',
    temperature: 0.5,
    thinkingBudget: 4096,
    maxIterations: 20,
    maxOutputTokens: 4096,
    extendedThinking: false,
    memoryStrategy: { l1MaxMessages: 10, l2SummaryMaxTokens: 1000 },
    resumePrompt: '',
  },
  mockAgentRun: vi.fn(),
  mockLoadMessages: vi.fn(),
  mockLoadMemory: vi.fn(),
  mockAgentLoopCreate: vi.fn(),
  mockCaseFindFirst: vi.fn(),
  mockCaseFindUnique: vi.fn(),
  mockCaseCount: vi.fn(),
  mockCaseFindMany: vi.fn(),
  mockCaseDeleteMany: vi.fn(),
  mockCaseUpsert: vi.fn(),
  mockProcedureRunFindFirst: vi.fn(),
  mockMessageFindMany: vi.fn(),
  mockMessageUpsert: vi.fn(),
  mockTransaction: vi.fn(),
  mockBuildModePrompt: vi.fn(async () => ({ prompt: 'assembled prompt', basePrompt: 'core prompt' })),
  mockRecordInitialInputEvent: vi.fn(),
  mockGetProcedureRuntime: vi.fn(() => ({
    activeProcedureRun: undefined,
    pausedProcedureRuns: [],
    completedProcedureRuns: [],
  })),
}))

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    case: {
      findFirst: h.mockCaseFindFirst,
      findUnique: h.mockCaseFindUnique,
      count: h.mockCaseCount,
      findMany: h.mockCaseFindMany,
      deleteMany: h.mockCaseDeleteMany,
      upsert: h.mockCaseUpsert,
    },
    procedureRun: {
      findFirst: h.mockProcedureRunFindFirst,
    },
    message: {
      findMany: h.mockMessageFindMany,
      upsert: h.mockMessageUpsert,
    },
    actionTrace: {
      create: vi.fn(async () => ({})),
    },
    chatMemory: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
    chatSession: {
      findUnique: vi.fn(async () => null),
    },
    humanTask: {
      create: vi.fn(async () => ({})),
    },
    tool: {
      findMany: vi.fn(async () => ([
        {
          name: 'query_order_status',
          description: 'Lookup an order',
          inputSchema: '{"type":"object","properties":{"member_id":{"type":"string"}}}',
          outputSchema: null,
          mode: 'http',
          endpoint: 'https://example.com/query-order',
          httpMethod: 'POST',
          headers: null,
          timeoutMs: 1000,
          mockFixture: null,
          displayVerb: null,
          renderHints: null,
          toolCategory: 'operational',
          isConcurrencySafe: true,
          enabled: true,
        },
      ])),
    },
    knowledgeSource: {
      findMany: vi.fn(async () => []),
    },
    agentConfig: {
      findUnique: vi.fn(async () => ({ gptbotsApiKey: null })),
    },
    caseType: {
      findMany: vi.fn(async () => []),
    },
    $transaction: h.mockTransaction,
  },
}))

vi.mock('../../config-loader', () => ({
  loadAgentConfig: vi.fn(async () => h.config),
}))

vi.mock('../../buildModePrompt', () => ({
  buildModePrompt: h.mockBuildModePrompt,
}))

vi.mock('../../loop', () => ({
  AgentLoop: {
    create: h.mockAgentLoopCreate,
  },
}))

vi.mock('../../session-store', () => ({
  getProcedureRuntime: h.mockGetProcedureRuntime,
  recordInitialInputEvent: h.mockRecordInitialInputEvent,
}))

function imageBlock() {
  return {
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: 'image/png', data: 'abc123' },
  }
}

async function collect(input: Parameters<typeof import('../../playground-runner').runPlaygroundTurn>[0]) {
  const { runPlaygroundTurn } = await import('../../playground-runner')
  const events: any[] = []
  for await (const event of runPlaygroundTurn(input)) events.push(event)
  return events
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  h.config = {
    model: 'deepseek-v4-pro',
    temperature: 0.5,
    thinkingBudget: 4096,
    maxIterations: 20,
    maxOutputTokens: 4096,
    extendedThinking: false,
    memoryStrategy: { l1MaxMessages: 10, l2SummaryMaxTokens: 1000 },
    resumePrompt: '',
  }
  h.mockAgentRun.mockImplementation(async (_message: string, sendEvent: (event: any) => void) => {
    sendEvent({ type: 'text_delta', data: 'ok', timestamp: '2026-06-10T00:00:00.000Z' })
  })
  h.mockAgentLoopCreate.mockResolvedValue({
    loadMemory: h.mockLoadMemory,
    loadMessages: h.mockLoadMessages,
    run: h.mockAgentRun,
  })
  h.mockCaseFindFirst.mockResolvedValue(null)
  h.mockCaseFindUnique.mockResolvedValue(null)
  h.mockCaseCount.mockResolvedValue(0)
  h.mockCaseFindMany.mockResolvedValue([])
  h.mockCaseDeleteMany.mockResolvedValue({ count: 0 })
  h.mockCaseUpsert.mockResolvedValue({})
  h.mockProcedureRunFindFirst.mockResolvedValue(null)
  h.mockMessageFindMany.mockResolvedValue([])
  h.mockMessageUpsert.mockResolvedValue({})
  h.mockTransaction.mockImplementation(async (calls: Promise<unknown>[]) => Promise.all(calls))
  h.mockRecordInitialInputEvent.mockReset()
  h.mockGetProcedureRuntime.mockReturnValue({
    activeProcedureRun: undefined,
    pausedProcedureRuns: [],
    completedProcedureRuns: [],
  })
})

describe('runPlaygroundTurn vision handling', () => {
  it('rejects image content for a non-vision model with a typed error event', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'mock-key')

    const events = await collect({
      orgId: 'org-1',
      message: 'inspect this',
      playgroundConfig: { debug: false },
      configId: 'agent-1',
      userId: 'user-1',
      contentBlocks: [imageBlock()],
    })

    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: { code: 'unsupported_media', message: '当前模型不支持图片，请切换 vision-capable model。' },
    }))
    const traceEvent = events.find((event) => event.type === 'trace')
    expect(traceEvent?.data?.trace?.[0]?.runtimeTruth?.imageSupport.status).toBe('unsupported')
    expect(h.mockAgentRun).not.toHaveBeenCalled()
  })

  it('treats missing model metadata as unknown image support instead of claiming unsupported', async () => {
    h.config = { ...h.config, model: 'custom/experimental-model' }

    const events = await collect({
      orgId: 'org-1',
      message: 'inspect this',
      playgroundConfig: { debug: false },
      configId: 'agent-1',
      userId: 'user-1',
      contentBlocks: [imageBlock()],
    })

    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: { code: 'unsupported_media', message: '当前模型的图片能力未确认或未接入，请切换到明确支持 vision 的模型。' },
    }))
    const traceEvent = events.find((event) => event.type === 'trace')
    expect(traceEvent?.data?.trace?.[0]?.runtimeTruth?.imageSupport.status).toBe('unknown')
    expect(h.mockAgentRun).not.toHaveBeenCalled()
  })

  it('passes image content blocks into AgentLoop for a vision model', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'mock-key')
    h.config = { ...h.config, model: 'openai/gpt-4o' }
    const contentBlocks = [imageBlock()]

    const events = await collect({
      orgId: 'org-1',
      message: 'inspect this',
      playgroundConfig: { debug: false },
      configId: 'agent-1',
      userId: 'user-1',
      contentBlocks,
    })

    expect(h.mockAgentRun).toHaveBeenCalledWith('inspect this', expect.any(Function), contentBlocks)
    const traceEvent = events.find((event) => event.type === 'trace')
    expect(traceEvent).toBeTruthy()
    expect(traceEvent?.data?.trace?.[0]?.runtimeTruth?.imageSupport.status).toBe('supported')
    expect(traceEvent?.data?.trace?.[0]?.runtimeTruth?.executionSurface.mode).toBe('runtime_only')
    expect(h.mockAgentLoopCreate).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: false,
      persistRuntimeMemory: true,
    }))
  })

  it('only switches operational tools to dry-run when requested', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'mock-key')
    h.config = { ...h.config, model: 'openai/gpt-4o' }

    const events = await collect({
      orgId: 'org-1',
      message: 'inspect this',
      playgroundConfig: { debug: false, toolExecutionMode: 'dry_run' },
      configId: 'agent-1',
      userId: 'user-1',
    })

    expect(h.mockAgentRun).toHaveBeenCalled()
    expect(h.mockAgentLoopCreate).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: true,
      persistRuntimeMemory: true,
    }))
    const traceEvent = events.find((event) => event.type === 'trace')
    expect(traceEvent?.data?.trace?.[0]?.runtimeTruth?.executionSurface.mode).toBe('dry_run_mixed')
  })

  it('passes active ToolRouter definitions into Playground prompt assembly', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'mock-key')
    h.config = { ...h.config, model: 'openai/gpt-4o' }

    await collect({
      orgId: 'org-1',
      message: 'hello',
      playgroundConfig: { debug: false },
      configId: 'agent-1',
      userId: 'user-1',
    })

    expect(h.mockBuildModePrompt).toHaveBeenCalledWith(expect.objectContaining({
      availableTools: expect.arrayContaining([
        expect.objectContaining({
          name: 'query_order_status',
          description: 'Lookup an order',
          needsMemberId: true,
        }),
      ]),
    }))
  })

  it('restores a provided chatId inside the current org and user boundary even after the case type changes', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'mock-key')
    h.config = { ...h.config, model: 'openai/gpt-4o' }
    h.mockCaseFindFirst.mockResolvedValue({ id: 'case-existing' })

    await collect({
      orgId: 'org-1',
      message: 'continue',
      playgroundConfig: { debug: false },
      configId: 'agent-1',
      userId: 'user-1',
      chatId: 'pg_agent-1_1_a',
    })

    expect(h.mockCaseFindFirst).toHaveBeenCalledWith({
      where: {
        orgId: 'org-1',
        chatId: 'pg_agent-1_1_a',
        userId: 'user-1',
      },
      select: { id: true },
    })
    expect(h.mockAgentLoopCreate).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-existing',
      chatId: 'pg_agent-1_1_a',
      bootstrapNewCase: false,
    }))
  })

  it('mints a new chatId instead of reusing a provided chatId outside the current boundary', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'mock-key')
    h.config = { ...h.config, model: 'openai/gpt-4o' }
    h.mockCaseFindFirst.mockResolvedValue(null)

    const events = await collect({
      orgId: 'org-1',
      message: 'continue',
      playgroundConfig: { debug: false },
      configId: 'agent-1',
      userId: 'user-1',
      chatId: 'pg_agent-1_foreign_x',
    })
    const sessionInit = events.find((event) => event.type === 'session_init')

    expect(sessionInit?.data?.chatId).toMatch(/^pg_agent-1_\d+_[a-z0-9]+$/)
    expect(sessionInit?.data?.chatId).not.toBe('pg_agent-1_foreign_x')
    expect(h.mockAgentLoopCreate).toHaveBeenCalledWith(expect.objectContaining({
      caseId: sessionInit?.data?.chatId,
      chatId: sessionInit?.data?.chatId,
      bootstrapNewCase: true,
    }))
  })

  it('applies the playground session cap only within the current org and user', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'mock-key')
    h.config = { ...h.config, model: 'openai/gpt-4o' }

    await collect({
      orgId: 'org-1',
      message: 'start',
      playgroundConfig: { debug: false },
      configId: 'agent-1',
      userId: 'user-1',
    })

    expect(h.mockCaseCount).toHaveBeenCalledWith({
      where: { orgId: 'org-1', userId: 'user-1', chatId: { startsWith: 'pg_' } },
    })
  })

  it('records structured formResult turns as customer_form_result runtime input', async () => {
    const formResult = {
      answers: {
        member_id: 'JAYA113C88F',
        amount: '500',
        payment_channel: '银行转账',
      },
    }

    await collect({
      orgId: 'org-1',
      message: '',
      formResult,
      playgroundConfig: { debug: false },
      configId: 'agent-1',
      userId: 'user-1',
      chatId: 'pg_agent-1_form_x',
    })

    expect(h.mockRecordInitialInputEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        source: 'customer_form_result',
        formAnswers: formResult.answers,
        content: 'Tool ask_user_questions result: {"member_id":"JAYA113C88F","amount":"500","payment_channel":"银行转账"}',
      }),
    )
    expect(h.mockAgentRun.mock.calls[0]?.[0]).toBe(
      'Tool ask_user_questions result: {"member_id":"JAYA113C88F","amount":"500","payment_channel":"银行转账"}',
    )
  })
})

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
  mockTransaction: vi.fn(),
}))

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    case: {
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
    message: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => ({})),
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
          inputSchema: '{}',
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
  buildModePrompt: vi.fn(async () => ({ prompt: 'assembled prompt', basePrompt: 'core prompt' })),
}))

vi.mock('../../loop', () => ({
  AgentLoop: {
    create: h.mockAgentLoopCreate,
  },
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
  h.mockTransaction.mockImplementation(async (calls: Promise<unknown>[]) => Promise.all(calls))
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
})

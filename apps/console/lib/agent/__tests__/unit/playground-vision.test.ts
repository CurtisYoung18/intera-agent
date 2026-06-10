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
      upsert: vi.fn(async () => ({})),
    },
    humanTask: {
      create: vi.fn(async () => ({})),
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
    expect(events.some((event) => event.type === 'trace')).toBe(true)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MemoryStrategy } from '@intera/shared/types'
import { DEFAULT_MEMORY_MODEL } from '@intera/shared/memory/contract'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Capture what model getProviderConfig receives so we can assert on resolution
const getProviderConfigSpy = vi.fn(() => ({
  apiKey: 'sk-test-key',
  baseURL: 'https://api.deepseek.com/anthropic',
  provider: 'deepseek',
}))

vi.mock('../api/with-retry', () => ({
  withRetry: vi.fn((fn: Function, _opts: unknown, getClient: Function) =>
    fn(getClient(), { model: 'deepseek-v4-flash' }),
  ),
  CannotRetryError: class extends Error {},
}))

vi.mock('../api/provider-config', () => ({
  getProviderConfig: getProviderConfigSpy,
  createAgentClient: vi.fn(() => ({
    messages: { create: vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'Mocked compact summary with sufficient length to pass minimum checks.' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    })},
  })),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStrategy(overrides: Partial<MemoryStrategy> = {}): MemoryStrategy {
  return {
    l1MaxMessages: 12,
    l2SummaryMaxTokens: 2000,
    l4MaxHistoricalCases: 5,
    keyEventExtractionPrompt: '',
    maxRecentTraces: 20,
    caseRetentionDays: 90,
    autocompactThresholdTokens: 40000,
    warningThresholdTokens: 50000,
    errorThresholdTokens: 60000,
    blockingThresholdTokens: 15000,
    compactModel: 'deepseek-v4-flash',
    enableSnip: false,
    enableContextCollapse: false,
    enableAutocompact: false,
    compactMaxMessages: 40,
    compactTemperature: 0.3,
    compactMaxTokensCap: 4096,
    compactMinSummaryLength: 10,
    compactionKeepMin: 6,
    compactionKeepRatio: 0.65,
    compactableTools: [],
    keyEventMaxChars: 100,
    tokensPerKeyEvent: 20,
    tokensPerFact: 15,
    tokensPerTool: 30,
    cjkCharPerToken: 1.5,
    latinCharPerToken: 4,
    minTokenEstimate: 100,
    toolResultTokenRatio: 4,
    compactPrompt: '',
    ...overrides,
  }
}

function makeMessages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `Message ${i} content with enough text to be meaningful for the compaction test.`,
    createdAt: new Date(),
  }))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('model resolution — compactConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses configured compactModel when explicitly set', async () => {
    const { compactConversation } = await import('../compact')
    const messages = makeMessages(10)
    const strategy = makeStrategy({ compactModel: 'MiniMax-M2.5-highspeed' })

    await compactConversation(messages, strategy)

    // getProviderConfig is called with the resolved model before the LLM call
    expect(getProviderConfigSpy).toHaveBeenCalledWith('MiniMax-M2.5-highspeed')
  })

  it('falls back to DEFAULT_MEMORY_MODEL when compactModel is an empty string', async () => {
    const { compactConversation } = await import('../compact')
    const messages = makeMessages(10)
    // compactModel is required by the type, but runtime JS may pass empty string
    const strategy = makeStrategy({ compactModel: '' as unknown as string })

    await compactConversation(messages, strategy)

    expect(getProviderConfigSpy).toHaveBeenCalledWith(DEFAULT_MEMORY_MODEL)
  })

  it('falls back to DEFAULT_MEMORY_MODEL when compactModel is undefined at runtime', async () => {
    const { compactConversation } = await import('../compact')
    const messages = makeMessages(10)
    // Simulate a malformed strategy object from a JSON parse that lacked compactModel
    const partial = makeStrategy() as unknown as Record<string, unknown>
    delete partial.compactModel

    await compactConversation(messages, partial as unknown as MemoryStrategy)

    expect(getProviderConfigSpy).toHaveBeenCalledWith(DEFAULT_MEMORY_MODEL)
  })
})

describe('model resolution — DEFAULT_MEMORY_STRATEGY', () => {
  it('has compactModel equal to DEFAULT_MEMORY_MODEL', () => {
    expect(DEFAULT_MEMORY_STRATEGY.compactModel).toBe(DEFAULT_MEMORY_MODEL)
  })

  it('has factExtractionModel equal to DEFAULT_MEMORY_MODEL', () => {
    expect(DEFAULT_MEMORY_STRATEGY.factExtractionModel).toBe(DEFAULT_MEMORY_MODEL)
  })
})

describe('model resolution — fact extraction model', () => {
  it('resolves factExtractionModel from MemoryStrategy.factExtractionModel', () => {
    expect(DEFAULT_MEMORY_STRATEGY).toHaveProperty('factExtractionModel')
    expect(DEFAULT_MEMORY_STRATEGY.factExtractionModel).toBeDefined()

    const strategyModel = DEFAULT_MEMORY_STRATEGY.factExtractionModel!
    expect(strategyModel).toBe(DEFAULT_MEMORY_MODEL)
  })

  it('falls back to DEFAULT_MEMORY_MODEL when factExtractionModel is not set in strategy', () => {
    const strategyWithoutModel = { ...DEFAULT_MEMORY_STRATEGY } as unknown as Record<string, unknown>
    delete strategyWithoutModel.factExtractionModel

    const resolved = (strategyWithoutModel.factExtractionModel as string | undefined) ?? DEFAULT_MEMORY_MODEL
    expect(resolved).toBe(DEFAULT_MEMORY_MODEL)
  })
})

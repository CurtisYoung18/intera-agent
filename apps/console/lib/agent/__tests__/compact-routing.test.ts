import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CASE_COMPACT_PROMPT } from '../case-compact-prompt'
import { PROFILE_COMPACT_PROMPT } from '../profile-compact-prompt'
import type { Message, MemoryStrategy } from '@intera/shared/types'

// Mock the API dependencies so compactConversation doesn't actually make
// network calls. We capture the prompt passed into the LLM.
const mockCreate = vi.fn()
const mockClient = { messages: { create: mockCreate } }

vi.mock('../api/with-retry', () => ({
  withRetry: vi.fn((fn: Function, opts?: { model?: string }) =>
    fn(mockClient, { model: opts?.model || 'deepseek-v4-flash' }),
  ),
  CannotRetryError: class extends Error {},
}))

vi.mock('../api/provider-config', () => ({
  getProviderConfig: vi.fn(() => ({
    apiKey: 'sk-test-key',
    baseURL: 'https://api.deepseek.com/anthropic',
    provider: 'deepseek',
  })),
  createAgentClient: vi.fn(() => mockClient),
}))

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

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `Message ${i} content with enough text to be meaningful for the compaction test.`,
    createdAt: new Date(),
  }))
}

describe('compactConversation routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock: return a valid summary so the function doesn't error out
    mockCreate.mockResolvedValue({
      content: [{ type: 'text' as const, text: 'Mocked compact summary with sufficient length to pass minimum checks.' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    })
  })

  it('uses CASE_COMPACT_PROMPT when purpose is "case"', async () => {
    const { compactConversation } = await import('../compact')
    const messages = makeMessages(10)
    const strategy = makeStrategy()

    await compactConversation(messages, strategy, { purpose: 'case' })

    const systemArg = mockCreate.mock.calls[0][0].system
    expect(systemArg).toBe(CASE_COMPACT_PROMPT)
  })

  it('uses PROFILE_COMPACT_PROMPT when purpose is "profile"', async () => {
    const { compactConversation } = await import('../compact')
    const messages = makeMessages(10)
    const strategy = makeStrategy()

    await compactConversation(messages, strategy, { purpose: 'profile' })

    const systemArg = mockCreate.mock.calls[0][0].system
    expect(systemArg).toBe(PROFILE_COMPACT_PROMPT)
  })

  it('defaults to CASE_COMPACT_PROMPT when no purpose is given', async () => {
    const { compactConversation } = await import('../compact')
    const messages = makeMessages(10)
    const strategy = makeStrategy()

    await compactConversation(messages, strategy)

    const systemArg = mockCreate.mock.calls[0][0].system
    expect(systemArg).toBe(CASE_COMPACT_PROMPT)
  })

  it('still respects custom compactPrompt when provided', async () => {
    const { compactConversation } = await import('../compact')
    const messages = makeMessages(10)
    const customPrompt = 'Custom compact instructions here.'
    const strategy = makeStrategy({ compactPrompt: customPrompt })

    await compactConversation(messages, strategy, { purpose: 'case' })

    const systemArg = mockCreate.mock.calls[0][0].system
    expect(systemArg).toBe(customPrompt)
  })

  it('custom compactPrompt overrides purpose-based prompt selection', async () => {
    const { compactConversation } = await import('../compact')
    const messages = makeMessages(10)
    const customPrompt = 'Custom profile prompt override.'
    const strategy = makeStrategy({ compactPrompt: customPrompt })

    await compactConversation(messages, strategy, { purpose: 'profile' })

    const systemArg = mockCreate.mock.calls[0][0].system
    expect(systemArg).toBe(customPrompt)
  })

  it('uses profileModel when purpose is "profile" and profileModel is set', async () => {
    const { compactConversation } = await import('../compact')
    const messages = makeMessages(10)
    const strategy = makeStrategy({ profileModel: 'MiniMax-M2.5-highspeed' })

    await compactConversation(messages, strategy, { purpose: 'profile' })

    const modelArg = mockCreate.mock.calls[0][0].model
    expect(modelArg).toBe('MiniMax-M2.5-highspeed')
  })

  it('falls back to compactModel when profileModel is unset', async () => {
    const { compactConversation } = await import('../compact')
    const messages = makeMessages(10)
    const strategy = makeStrategy({ compactModel: 'deepseek-v4-flash' })
    // profileModel is not set

    await compactConversation(messages, strategy, { purpose: 'profile' })

    const modelArg = mockCreate.mock.calls[0][0].model
    expect(modelArg).toBe('deepseek-v4-flash')
  })
})

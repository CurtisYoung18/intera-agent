import { vi } from 'vitest'
import type { AgentConfigData, CaseSchemaConfig, SSEEvent } from '@intera/shared/types'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { AgentLoop, type AgentLoopDeps } from '../../loop'
import { mockAnthropicClient } from '../mocks/anthropic'

export function makeDefaultConfig(overrides?: Partial<AgentConfigData>): AgentConfigData {
  return {
    model: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    thinkingBudget: 4096,
    maxIterations: 10,
    maxOutputTokens: 4096,
    coreSystemPrompt: 'You are a helpful assistant.',
    extendedThinking: false,
    memoryStrategy: DEFAULT_MEMORY_STRATEGY,
    
    ...overrides,
  }
}

export function makeCaseSchema(overrides?: Partial<CaseSchemaConfig>): CaseSchemaConfig {
  return {
    id: 'test_case_type',
    name: 'test_case',
    executionMode: 'cc',
    stages: ['created', 'collecting', 'investigating'],
    stageConfigs: [],
    ...overrides,
  } as CaseSchemaConfig
}

export function makeAgentLoopDeps(overrides?: Partial<AgentLoopDeps>): AgentLoopDeps {
  const config = makeDefaultConfig()
  return {
    config,
    configId: 'test-agent',
    caseId: 'test-case-001',
    orgId: 'test-customer',
    userId: 'test-user',
    systemPrompt: 'You are a helpful assistant for testing.',
    coreSystemPrompt: 'You are a helpful assistant.',
    caseSchema: null,
    chatId: null,
    ...overrides,
  }
}

/**
 * Create an AgentLoop with mocked external dependencies.
 * Replaces the Anthropic client with a mock so no real API calls are made.
 * Prisma calls will still be attempted — mock at module level if needed.
 */
export function createTestAgentLoop(overrides?: Partial<AgentLoopDeps>) {
  const deps = makeAgentLoopDeps(overrides)

  const events: SSEEvent[] = []
  const sendEvent = vi.fn((event: SSEEvent) => {
    events.push(event)
  })

  const loop = new AgentLoop(deps)

  // Replace Anthropic client with mock to prevent real API calls
  const mockClient = mockAnthropicClient()
  ;(loop as any).anthropicClient = mockClient

  return {
    loop,
    deps,
    events,
    sendEvent,
    mockClient,
  }
}

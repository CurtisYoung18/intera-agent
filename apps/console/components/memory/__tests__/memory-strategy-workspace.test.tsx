// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockApiClient = vi.fn()
const mockBustConfigCache = vi.fn(async (_orgId: string, _agentConfigId?: string) => {})
const mockEmitAgentConfigUpdated = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: any[]) => mockApiClient(...args),
  bustConfigCache: (orgId: string, agentConfigId?: string) => mockBustConfigCache(orgId, agentConfigId),
}))

vi.mock('@/lib/agent-config-events', () => ({
  emitAgentConfigUpdated: (agentId: string) => mockEmitAgentConfigUpdated(agentId),
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  useSelectedAgentId: vi.fn(() => 'agent_default_v1'),
}))

vi.mock('@/lib/hooks/use-session', () => ({
  useSession: vi.fn(() => ({ orgId: 'default' })),
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: vi.fn(() => ({ locale: 'en', t: (key: string) => key })),
}))

const models = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    supportsVision: false,
    supportsThinking: false,
  },
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 mini',
    provider: 'openai',
    providerLabel: 'OpenAI',
    supportsVision: true,
    supportsThinking: false,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockApiClient.mockImplementation(async (url: string, options?: any) => {
    if (url.startsWith('/api/admin/agent?') && options?.method === 'PUT') {
      return { data: { config: { memoryStrategy: options.body.memoryStrategy } } }
    }
    if (url.startsWith('/api/admin/agent?')) {
      return { data: { config: { memoryStrategy: '{}' } } }
    }
    if (url === '/api/admin/models') {
      return { data: { models } }
    }
    return { data: {} }
  })
})

afterEach(() => {
  cleanup()
})

async function renderWorkspace() {
  const { default: MemoryStrategyWorkspace } = await import('../memory-strategy-workspace')
  await act(async () => {
    render(<MemoryStrategyWorkspace />)
  })
  await screen.findByText('Memory strategy')
}

describe('MemoryStrategyWorkspace', () => {
  it('lets delivery staff choose Short mode and save memoryStrategy', async () => {
    await renderWorkspace()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Short/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save draft/ }))
    })

    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url.startsWith('/api/admin/agent?') && options?.method === 'PUT')).toBe(true)
    })
    const saveCall = mockApiClient.mock.calls.find(([url, options]) => url.startsWith('/api/admin/agent?') && options?.method === 'PUT')
    expect(saveCall).toBeDefined()
    const savedStrategy = JSON.parse(saveCall?.[1].body.memoryStrategy)
    expect(savedStrategy.autocompactThresholdTokens).toBe(20000)
    expect(savedStrategy.compactionKeepMin).toBe(10)
    expect(savedStrategy.l1MaxMessages).toBe(10)
    expect(mockBustConfigCache).toHaveBeenCalledWith('default', 'agent_default_v1')
    expect(mockEmitAgentConfigUpdated).toHaveBeenCalledWith('agent_default_v1')
  })

  it('keeps raw engineering parameters hidden until Advanced is opened', async () => {
    await renderWorkspace()

    expect(screen.queryByText('Warning threshold')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Advanced engineering parameters/ }))
    })

    expect(screen.getByText('Warning threshold')).toBeDefined()
    expect(screen.getByText('Compact temperature')).toBeDefined()
    expect(screen.getByText('Circuit breaker failures')).toBeDefined()
  })

  it('removes fake profile and compact-test sections', async () => {
    await renderWorkspace()

    expect(screen.queryByText('Profile promotion rules')).toBeNull()
    expect(screen.queryByRole('button', { name: /Run compact test/ })).toBeNull()
    expect(screen.queryByText('Preserve rules')).toBeNull()
  })

  it('shows preset summary metrics on each memory mode card', async () => {
    await renderWorkspace()

    expect(screen.getByText('20k tokens')).toBeDefined()
    expect(screen.getByText('10 messages / approx 5 turns')).toBeDefined()
    expect(screen.getByText('24 messages / approx 12 turns')).toBeDefined()
    expect(screen.getAllByText('Keep at least').length).toBe(4)
  })
})

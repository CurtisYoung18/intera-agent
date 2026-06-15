// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '@/components/locale-provider'

const mockApiClient = vi.fn()
const mockBustConfigCache = vi.fn(async (_orgId: string, _agentConfigId?: string) => {})
const mockEmitAgentConfigUpdated = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: (url: string, options?: any) => mockApiClient(url, options),
  bustConfigCache: (orgId: string, agentConfigId?: string) => mockBustConfigCache(orgId, agentConfigId),
}))

vi.mock('@/lib/agent-config-events', () => ({
  emitAgentConfigUpdated: (agentId: string) => mockEmitAgentConfigUpdated(agentId),
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  useSelectedAgentId: vi.fn(() => 'agent-1'),
}))

vi.mock('@/lib/hooks/use-session', () => ({
  useSession: vi.fn(() => ({ orgId: 'default' })),
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
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openrouter',
    providerLabel: 'OpenRouter',
    supportsVision: true,
    supportsThinking: false,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockApiClient.mockImplementation(async (url: string, options?: any) => {
    if (url === '/api/admin/models') {
      return { data: { models } }
    }
    if (url === '/api/admin/agent?agentId=agent-1' && options?.body) {
      return { data: { config: options.body } }
    }
    if (url === '/api/admin/agent?agentId=agent-1') {
      return {
        data: {
          config: {
            model: 'deepseek-v4-flash',
            temperature: 0.5,
            thinkingBudget: 4096,
            maxIterations: 20,
            maxOutputTokens: 4096,
            coreSystemPrompt: 'Core prompt',
            extendedThinking: false,
            resumePrompt: '',
          },
        },
      }
    }
    if (url === '/api/admin/agent/assembled-prompt?agentId=agent-1') {
      return { data: { discovery: 'Prompt preview' } }
    }
    return { data: {} }
  })
})

afterEach(() => {
  cleanup()
})

describe('ModelWorkspace', () => {
  it('saves the selected model and notifies Playground to refresh', async () => {
    const { default: ModelWorkspace } = await import('../model-workspace')

    await act(async () => {
      render(
        <LocaleProvider>
          <ModelWorkspace />
        </LocaleProvider>,
      )
    })

    await screen.findByText('Model configuration')

    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'openai/gpt-4o' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Save draft/i }))

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith('/api/admin/agent?agentId=agent-1', expect.objectContaining({
        body: expect.objectContaining({ model: 'openai/gpt-4o' }),
      }))
      expect(mockBustConfigCache).toHaveBeenCalledWith('default', 'agent-1')
      expect(mockEmitAgentConfigUpdated).toHaveBeenCalledWith('agent-1')
    })
  })
})

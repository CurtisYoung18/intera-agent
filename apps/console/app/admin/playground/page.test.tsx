// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_CONFIG_UPDATED_EVENT } from '@/lib/agent-config-events'
import { LocaleProvider } from '@/components/locale-provider'

const mockApiClient = vi.fn()
const mockSelectAgent = vi.fn()

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/playground',
}))

vi.mock('@/lib/api/client', () => ({
  apiClient: (url: string, options?: any) => mockApiClient(url, options),
}))

vi.mock('@/lib/agent/agent-context', () => ({
  useAgentContext: () => ({
    selectedAgentId: 'agent-1',
    selectAgent: mockSelectAgent,
  }),
}))

vi.mock('@/lib/hooks/use-session', () => ({
  useSession: () => ({
    userId: 'user-1',
    orgId: 'default',
  }),
}))

vi.mock('@/components/admin/agent-version-picker', () => ({
  default: () => <div data-testid="agent-version-picker">Agent picker</div>,
}))

vi.mock('@intera/shared/ui/organic-loader', () => ({
  default: () => <div data-testid="organic-loader" />,
}))

vi.mock('@/components/ui/copy-button', () => ({
  default: ({ label }: { label: string }) => <button type="button">{label}</button>,
}))

vi.mock('@/components/chat/message-content', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('@/components/chat/render-hint-card', () => ({
  default: () => null,
}))

vi.mock('@/components/chat/status-accents', () => ({
  StatusDot: () => <span data-testid="status-dot" />,
  statusColor: () => '#999999',
}))

vi.mock('@/components/playground/trace-sidebar', () => ({
  default: () => null,
}))

vi.mock('@/lib/agent/trace-aggregator', () => ({
  aggregateTraces: () => [],
}))

const models = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    supportsVision: false,
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    providerLabel: 'OpenAI',
    supportsVision: true,
  },
]

const balancedMemory = JSON.stringify({
  autocompactThresholdTokens: 40000,
  compactionKeepMin: 20,
  l1MaxMessages: 20,
  compactMaxMessages: 40,
})

const shortMemory = JSON.stringify({
  autocompactThresholdTokens: 20000,
  compactionKeepMin: 10,
  l1MaxMessages: 10,
  compactMaxMessages: 24,
})

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response
}

let currentAgentPayload: any
let currentHooksPayload: any
let failHooksRequest = false

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  localStorage.clear()
  failHooksRequest = false
  currentAgentPayload = {
    data: {
      resolvedModel: 'deepseek-v4-flash',
      config: {
        name: 'Gaming Support Draft',
        model: 'deepseek-v4-flash',
        temperature: 0.5,
        memoryStrategy: balancedMemory,
        coreSystemPrompt: 'Initial core prompt',
      },
    },
  }
  currentHooksPayload = {
    data: {
      hooks: [{ id: 'hook-1', enabled: true }],
    },
  }
  mockApiClient.mockImplementation(async (url: string) => {
    if (url === '/api/admin/agent?agentId=agent-1') return currentAgentPayload
    if (url === '/api/admin/hooks?agentConfigId=agent-1') {
      if (failHooksRequest) throw new Error('hooks unavailable')
      return currentHooksPayload
    }
    throw new Error(`Unexpected apiClient call: ${url}`)
  })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url === '/api/admin/agent-configs') {
      return jsonResponse({
        data: {
          configs: [{ id: 'agent-1', name: 'Gaming Support Draft', version: 3, isActive: false }],
        },
      })
    }
    if (url === '/api/admin/models') {
      return jsonResponse({
        data: {
          models,
        },
      })
    }
    if (url === '/api/admin/playground/sessions?configId=agent-1') {
      return jsonResponse({
        data: {
          sessions: [],
        },
      })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }))
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderPage() {
  const { default: PlaygroundPage } = await import('./page')
  await act(async () => {
    render(
      <LocaleProvider>
        <PlaygroundPage />
      </LocaleProvider>,
    )
  })
}

describe('PlaygroundPage snapshot truth', () => {
  it('refreshes model, memory, prompt, and hook summary after agent config updates', async () => {
    await renderPage()

    expect(screen.getByText(/Compatibility route only/i)).toBeDefined()
    await screen.findByText('DeepSeek V4 Flash')
    expect(screen.getByText('0.5')).toBeDefined()
    expect(screen.getByText('Balanced')).toBeDefined()
    expect(screen.getByText('1 enabled')).toBeDefined()
    expect(screen.getAllByText('Not supported').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Initial core prompt').length).toBeGreaterThan(0)

    currentAgentPayload = {
      data: {
        resolvedModel: 'openai/gpt-4o',
        config: {
          name: 'Gaming Support Draft',
          model: 'openai/gpt-4o',
          temperature: 0.2,
          memoryStrategy: shortMemory,
          coreSystemPrompt: 'Updated prompt from Brain and Memory',
        },
      },
    }
    currentHooksPayload = {
      data: {
        hooks: [
          { id: 'hook-1', enabled: true },
          { id: 'hook-2', enabled: true },
        ],
      },
    }

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(AGENT_CONFIG_UPDATED_EVENT, {
          detail: { agentId: 'agent-1' },
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByText('GPT-4o')).toBeDefined()
      expect(screen.getByText('0.2')).toBeDefined()
      expect(screen.getByText('Short')).toBeDefined()
      expect(screen.getByText('2 enabled')).toBeDefined()
      expect(screen.getAllByText('Supported').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Updated prompt from Brain and Memory').length).toBeGreaterThan(0)
    })
  })

  it('uses coreSystemPrompt for the preview and hides the hook pill when hook data is unavailable', async () => {
    failHooksRequest = true
    currentAgentPayload = {
      data: {
        resolvedModel: 'deepseek-v4-flash',
        config: {
          name: 'Gaming Support Draft',
          model: 'deepseek-v4-flash',
          temperature: 0.5,
          memoryStrategy: balancedMemory,
          systemPrompt: 'Obsolete prompt field',
          coreSystemPrompt: 'Real saved core prompt',
        },
      },
    }

    await renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('Real saved core prompt').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Obsolete prompt field')).toBeNull()
    expect(screen.getByText('Unknown')).toBeDefined()
    expect(screen.queryByText(/rule/i)).toBeNull()
  })
})

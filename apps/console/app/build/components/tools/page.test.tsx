// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockApiClient = vi.fn()
const mockBustConfigCache = vi.fn(async (_orgId: string, _agentConfigId?: string) => {})

vi.mock('@/lib/api/client', () => ({
  apiClient: (url: string, options?: any) => mockApiClient(url, options),
  bustConfigCache: (orgId: string, agentConfigId?: string) => mockBustConfigCache(orgId, agentConfigId),
  ApiClientError: class ApiClientError extends Error {
    constructor(public envelope: any) {
      super(envelope.error.message)
    }
  },
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  default: () => null,
  useSelectedAgentId: vi.fn(() => 'agent-1'),
}))

vi.mock('@/lib/hooks/use-session', () => ({
  useSession: vi.fn(() => ({ orgId: 'default' })),
}))

vi.mock('@/components/admin/tool-render-hints-editor', () => ({
  default: () => <div data-testid="render-hints-editor">render hints</div>,
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: () => ({
    locale: 'en',
    toggleLocale: vi.fn(),
    t: (key: string) =>
      ({
        'sidebar.build': 'Build',
        'sidebar.components': 'Components',
        'sidebar.brain': 'Brain',
        'sidebar.procedures': 'Procedures',
        'sidebar.tools': 'Tools',
        'sidebar.hooks': 'Hooks',
        'sidebar.knowledge': 'Knowledge',
        'sidebar.integrations': 'Integrations',
        'common.cancel': 'Cancel',
        'common.delete': 'Delete',
      })[key] ?? key,
  }),
}))

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation')
  return {
    ...actual,
    usePathname: () => '/build/components/tools',
  }
})

const tools = [
  {
    id: 'tool-system-1',
    name: 'start_procedure',
    description: 'Start procedure runtime.',
    mode: 'system_managed',
    enabled: true,
    isConcurrencySafe: false,
    inputSchema: '{}',
    outputSchema: '{}',
    headers: '{}',
    mockFixture: '{}',
    renderHints: '{}',
    isSystem: true,
    isChannel: false,
    isSpecial: false,
  },
  {
    id: 'tool-channel-1',
    name: 'create_human_task',
    description: 'Create a human task.',
    mode: 'channel',
    enabled: true,
    isConcurrencySafe: false,
    inputSchema: '{}',
    outputSchema: '{}',
    headers: '{}',
    mockFixture: '{}',
    renderHints: '{}',
    isSystem: false,
    isChannel: true,
    isSpecial: false,
  },
  {
    id: 'tool-custom-1',
    name: 'lookup_balance',
    description: 'Lookup a customer balance.',
    mode: 'http',
    endpoint: 'https://example.com/balance',
    httpMethod: 'POST',
    timeoutMs: 8000,
    enabled: true,
    isConcurrencySafe: true,
    inputSchema: '{}',
    outputSchema: '{}',
    headers: '{}',
    mockFixture: '{"status":"ok"}',
    renderHints: '{}',
    isSystem: false,
    isChannel: false,
    isSpecial: false,
  },
] as any[]

const knowledgeSources = [
  {
    id: 'kb-1',
    name: 'account',
    description: 'Account knowledge',
    groupIds: '["group-account"]',
    enabled: true,
    topK: 15,
    rerankVersion: 'BGE-v1',
  },
  {
    id: 'kb-2',
    name: 'deposit',
    description: 'Deposit knowledge',
    groupIds: '["group-deposit"]',
    enabled: true,
    topK: 15,
    rerankVersion: 'BGE-v1',
  },
  {
    id: 'kb-3',
    name: 'empty',
    description: 'Should not generate a tool',
    groupIds: '[]',
    enabled: true,
    topK: 15,
    rerankVersion: 'BGE-v1',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockApiClient.mockImplementation(async (url: string, options?: any) => {
    if (url.startsWith('/api/admin/tools?agentConfigId=')) {
      return { data: { tools } }
    }
    if (url.startsWith('/api/admin/knowledge/sources?agentConfigId=')) {
      return { data: { sources: knowledgeSources } }
    }
    if (url === '/api/admin/tools' && options?.method === 'POST') {
      return { data: { tool: { id: 'tool-custom-2', ...options.body } } }
    }
    if (url === '/api/admin/tools/test' && options?.method === 'POST') {
      return { data: { ok: true, status: 200, latencyMs: 123, body: { ok: true } } }
    }
    if (url.startsWith('/api/admin/tools/') && options?.method === 'PUT') {
      return { data: { tool: { id: 'updated-tool', ...options.body } } }
    }
    if (url.startsWith('/api/admin/tools/') && options?.method === 'DELETE') {
      return { data: { success: true } }
    }
    if (url.startsWith('/api/admin/knowledge/sources/') && options?.method === 'PUT') {
      return { data: { success: true } }
    }
    return { data: {} }
  })
})

afterEach(() => {
  cleanup()
})

async function renderPage() {
  const { default: BuildToolsPage } = await import('./page')
  await act(async () => {
    render(<BuildToolsPage />)
  })
  await screen.findByText('Runtime-managed tools')
}

describe('BuildToolsPage', () => {
  it('shows runtime-managed tools outside the custom tools section', async () => {
    await renderPage()

    const runtimeSection = screen.getByTestId('runtime-tools-section')
    const customSection = screen.getByTestId('custom-tools-section')
    const channelSection = screen.getByTestId('channel-tools-section')

    expect(within(runtimeSection).getByText('start_procedure')).toBeDefined()
    expect(within(customSection).queryByText('start_procedure')).toBeNull()
    expect(within(channelSection).getByText('Channel tools').parentElement?.textContent ?? '').toContain('Channel-managed')
    expect(screen.getByText('Custom tools')).toBeDefined()
    expect(screen.queryByText('Business tools')).toBeNull()
  })

  it('filters generated knowledge search tools with the main search box', async () => {
    await renderPage()

    const search = screen.getByPlaceholderText('Search tools...')
    fireEvent.change(search, { target: { value: '__missing_tool__' } })

    await waitFor(() => {
      expect(screen.getByText('No tools match the current search.')).toBeDefined()
    })
    expect(screen.queryByText('search_knowledge · Account')).toBeNull()
    expect(screen.queryByText('search_knowledge · Deposit')).toBeNull()

    fireEvent.change(search, { target: { value: 'deposit' } })

    await waitFor(() => {
      expect(screen.getByText('search_knowledge · Deposit')).toBeDefined()
    })
    expect(screen.queryByText('search_knowledge · Account')).toBeNull()
    expect(screen.queryByText('search_knowledge · Empty')).toBeNull()
  })

  it('hides enabled knowledge sources that are not bound to any knowledge base', async () => {
    await renderPage()

    expect(screen.getByText('search_knowledge · Account')).toBeDefined()
    expect(screen.getByText('search_knowledge · Deposit')).toBeDefined()
    expect(screen.queryByText('search_knowledge · Empty')).toBeNull()
  })

  it('routes toggles and endpoint tests through backend APIs', async () => {
    await renderPage()

    const customToggle = screen.getByRole('button', { name: 'Disable lookup_balance' })
    expect(customToggle.closest('[role="button"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Disable create_human_task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disable search_knowledge · Account' }))

    fireEvent.click(screen.getByLabelText('Edit lookup_balance'))
    await screen.findByText('Edit Tool')
    fireEvent.click(screen.getByRole('button', { name: 'Test endpoint' }))

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith('/api/admin/tools/create_human_task', expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({ agentConfigId: 'agent-1', enabled: false }),
      }))
      expect(mockApiClient).toHaveBeenCalledWith('/api/admin/knowledge/sources/kb-1', expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({ agentConfigId: 'agent-1', enabled: false }),
      }))
      expect(mockApiClient).toHaveBeenCalledWith('/api/admin/tools/test', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ endpoint: 'https://example.com/balance' }),
      }))
    })
  })

  it('creates, updates, and deletes custom tools through CRUD routes', async () => {
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'New Tool' }))
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'collect_receipt' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Collect receipt details.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith('/api/admin/tools', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          agentConfigId: 'agent-1',
          name: 'collect_receipt',
          description: 'Collect receipt details.',
        }),
      }))
    })

    fireEvent.click(screen.getByLabelText('Edit lookup_balance'))
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated balance lookup.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith('/api/admin/tools/lookup_balance', expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({
          agentConfigId: 'agent-1',
          name: 'lookup_balance',
          description: 'Updated balance lookup.',
        }),
      }))
    })

    fireEvent.click(screen.getByLabelText('Edit lookup_balance'))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith('/api/admin/tools/lookup_balance?agentConfigId=agent-1', expect.objectContaining({
        method: 'DELETE',
      }))
    })
  })
})

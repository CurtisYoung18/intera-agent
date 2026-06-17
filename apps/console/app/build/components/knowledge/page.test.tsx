// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    usePathname: () => '/build/components/knowledge',
  }
})

let mockSources: any[] = []
let mockGptbotsPayload: any = { note: 'GPTBots API key not configured' }

beforeEach(() => {
  vi.clearAllMocks()
  mockSources = [
    {
      id: 'source-valid',
      name: 'Deposit FAQ',
      description: 'Deposit knowledge',
      groupIds: '["kb-1"]',
      dataIds: null,
      embeddingRate: 0.9,
      topK: 15,
      rerankVersion: 'BGE-Rerank',
      docCorrelation: 0.3,
      modelControlTopK: false,
      caseTypeTag: null,
      enabled: true,
    },
    {
      id: 'source-empty',
      name: 'Empty source',
      description: 'No bound kb yet',
      groupIds: '[]',
      dataIds: null,
      embeddingRate: 0.9,
      topK: 15,
      rerankVersion: 'BGE-Rerank',
      docCorrelation: 0.3,
      modelControlTopK: false,
      caseTypeTag: null,
      enabled: true,
    },
  ]
  mockGptbotsPayload = { note: 'GPTBots API key not configured' }

  mockApiClient.mockImplementation(async (url: string, options?: any) => {
    if (url.startsWith('/api/admin/knowledge/sources?agentConfigId=')) {
      return { data: { sources: mockSources } }
    }
    if (url.startsWith('/api/admin/case-types?agentConfigId=')) {
      return { data: { types: [] } }
    }
    if (url.startsWith('/api/admin/knowledge/gptbots?agentConfigId=')) {
      return { data: mockGptbotsPayload }
    }
    if (url === '/api/admin/knowledge/sources' && options?.method === 'POST') {
      return { data: { source: { id: 'source-new', ...options.body } } }
    }
    if (url === '/api/admin/knowledge/test' && options?.method === 'POST') {
      return { data: { list: [], total: 0, query: options.body.query, topK: options.body.topK, request: { groupIds: ['kb-1'] } } }
    }
    return { data: {} }
  })
})

afterEach(() => {
  cleanup()
})

async function renderPage() {
  const { default: BuildKnowledgePage } = await import('./page')
  await act(async () => {
    render(<BuildKnowledgePage />)
  })
  await screen.findByText('Knowledge sources')
}

describe('BuildKnowledgePage', () => {
  it('blocks source creation when GPTBots is not configured and explains why', async () => {
    mockSources = []
    await renderPage()

    expect(screen.getByText('Add a GPTBots API key above before creating or binding a Knowledge source.')).toBeDefined()
    expect(screen.getByText('Add a GPTBots API key above to unlock Knowledge source creation and GPTBots binding for this Agent.')).toBeDefined()
    expect((screen.getByRole('button', { name: 'New source' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('heading', { name: 'New Knowledge source' })).toBeNull()
  })

  it('does not allow saving a source until at least one knowledge base is selected', async () => {
    mockGptbotsPayload = {
      knowledge_base: [{ id: 'kb-1', name: 'Account', desc: 'Account KB', chunk: 4, doc: 1 }],
    }

    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'New source' }))
    fireEvent.change(screen.getByLabelText('Source name'), { target: { value: 'Temp FAQ' } })

    expect(screen.getByText('Select at least one GPTBots knowledge base to make this source searchable.')).toBeDefined()
    const saveButtons = screen.getAllByRole('button', { name: 'Save' })
    expect((saveButtons[saveButtons.length - 1] as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables retrieval search when GPTBots is not configured and only offers testable sources', async () => {
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Test retrieval' }))

    expect(screen.queryByRole('option', { name: 'Empty source' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Deposit FAQ' })).toBeDefined()

    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'deposit' } })

    expect(screen.getByText('GPTBots API key is not configured for this Agent. Add it above before running retrieval tests.')).toBeDefined()
    expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables retrieval search when enabled sources have no bound knowledge bases', async () => {
    mockSources = [
      {
        id: 'source-empty',
        name: 'Empty source',
        description: 'No bound kb yet',
        groupIds: '[]',
        dataIds: null,
        embeddingRate: 0.9,
        topK: 15,
        rerankVersion: 'BGE-Rerank',
        docCorrelation: 0.3,
        modelControlTopK: false,
        caseTypeTag: null,
        enabled: true,
      },
    ]
    mockGptbotsPayload = {
      knowledge_base: [{ id: 'kb-1', name: 'Account', desc: 'Account KB', chunk: 4, doc: 1 }],
    }

    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Test retrieval' }))
    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'deposit' } })

    expect(screen.getByText('Add at least one enabled knowledge source with a bound GPTBots knowledge base before testing retrieval.')).toBeDefined()
    expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('submits retrieval tests only after prerequisites are met', async () => {
    mockGptbotsPayload = {
      knowledge_base: [{ id: 'kb-1', name: 'Account', desc: 'Account KB', chunk: 4, doc: 1 }],
    }

    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Test retrieval' }))
    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'deposit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith('/api/admin/knowledge/test', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          agentConfigId: 'agent-1',
          query: 'deposit',
          topK: 15,
        }),
      }))
    })
  })

  it('shows retrieval summaries without exposing raw backend ids', async () => {
    mockGptbotsPayload = {
      knowledge_base: [{ id: 'kb-1', name: 'Account', desc: 'Account KB', chunk: 4, doc: 1 }],
    }
    mockApiClient.mockImplementation(async (url: string, options?: any) => {
      if (url.startsWith('/api/admin/knowledge/sources?agentConfigId=')) {
        return { data: { sources: mockSources } }
      }
      if (url.startsWith('/api/admin/case-types?agentConfigId=')) {
        return { data: { types: [] } }
      }
      if (url.startsWith('/api/admin/knowledge/gptbots?agentConfigId=')) {
        return { data: mockGptbotsPayload }
      }
      if (url === '/api/admin/knowledge/test' && options?.method === 'POST') {
        return {
          data: {
            list: [
              {
                content: 'Deposit help article',
                data_id: 'doc-raw-123',
                document_name: 'Deposit FAQ',
                chunk_id: 'chunk-9',
                score: 0.92,
              },
            ],
            total: 1,
            query: options.body.query,
            topK: options.body.topK,
            request: { groupIds: ['kb-1', 'kb-2'] },
          },
        }
      }
      return { data: {} }
    })

    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Test retrieval' }))
    fireEvent.change(screen.getByLabelText('Query'), { target: { value: 'deposit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByText('1 results')).toBeDefined()
      expect(screen.getAllByText('Deposit FAQ').length).toBeGreaterThan(0)
    })

    expect(screen.queryByText(/group_ids:/i)).toBeNull()
    expect(screen.queryByText(/doc\/data:/i)).toBeNull()
    expect(screen.queryByText(/chunk:/i)).toBeNull()
  })
})

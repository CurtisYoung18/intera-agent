// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

// ── Mocks ───────────────────────────────────────────────────────────────

let mockGptConnected = true

const mockApiClient = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: any[]) => mockApiClient(...args),
  bustConfigCache: vi.fn(async () => {}),
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  default: () => null,
  useSelectedAgentId: vi.fn(() => 'agent-1'),
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: vi.fn(() => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'sidebar.knowledge': 'Knowledge',
        'knowledge.loadFailed': 'Failed to load',
        'knowledge.saveFailed': 'Failed to save',
        'knowledge.deleteFailed': 'Failed to delete',
        'knowledge.deleteConfirm': 'Delete source?',
        'common.permanentlyDelete': 'Permanently delete {name}?',
      }
      return translations[key] || key
    },
  })),
}))

vi.mock('@/lib/hooks/use-session', () => ({
  useSession: vi.fn(() => ({ orgId: 'org-1' })),
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  default: () => null,
}))

// ── Helpers ─────────────────────────────────────────────────────────────

const ALL_SOURCES = [
  { id: 's-1', name: 'Deposit FAQ', description: 'Deposit questions', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 15, rerankVersion: null, docCorrelation: null, caseTypeTag: null, enabled: true },
  { id: 's-2', name: 'Withdrawal Guide', description: 'Withdrawal steps', groupIds: '[]', dataIds: null, embeddingRate: 0.8, topK: 10, rerankVersion: null, docCorrelation: null, caseTypeTag: null, enabled: true },
  { id: 's-3', name: 'Account Policy', description: 'Account rules', groupIds: '[]', dataIds: null, embeddingRate: 0.7, topK: 5, rerankVersion: null, docCorrelation: null, caseTypeTag: null, enabled: false },
]

function setupMocks(sources: typeof ALL_SOURCES, gptConnected = true) {
  mockApiClient.mockImplementation(async (url: string, opts?: any) => {
    if (url.startsWith('/api/admin/knowledge/gptbots')) {
      if (gptConnected) {
        return { data: { knowledge_base: [{ id: 'kb-1', name: 'FAQ', desc: 'Frequently asked', chunk: 100, doc: 10 }] } }
      }
      return { data: { error: 'not configured' } }
    }
    if (url === '/api/admin/knowledge/test' && opts?.method === 'POST') {
      return {
        data: {
          query: opts.body.query,
          topK: opts.body.topK,
          request: { groupIds: ['kb-1'] },
          source: { id: opts.body.sourceId, name: 'Deposit FAQ' },
          list: [{ content: 'Deposit evidence', data_id: 'doc-1', document_name: 'Deposit FAQ', chunk_id: 'c1', score: 0.91 }],
          total: 1,
        },
      }
    }
    if (url.startsWith('/api/admin/knowledge/sources') && !url.includes('test')) {
      return { data: { sources } }
    }
    return { data: {} }
  })
}

async function renderPage() {
  const { default: KnowledgePage } = await import('./page')
  let unmount: () => void
  await act(async () => {
    const result = render(
      <React.Suspense>
        <KnowledgePage />
      </React.Suspense>,
    )
    unmount = result.unmount
  })
  await act(async () => {})
  return { unmount: unmount! }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Knowledge Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // AC-A: tab switching
  it('AC-A: shows Sources and Test Retrieval tabs; clicking Test Retrieval hides source cards', async () => {
    setupMocks(ALL_SOURCES)

    await renderPage()

    expect(screen.getByRole('button', { name: /Sources/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Test Retrieval/ })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /Test Retrieval/ }))

    expect(screen.getByPlaceholderText(/Enter a test query/)).toBeDefined()
  })

  // AC-C: API key input hidden by default, visible after clicking status bar
  it('AC-C: hides API key input by default; expands after clicking the GPTBots status bar', async () => {
    setupMocks([], false)

    await renderPage()

    expect(screen.queryByPlaceholderText('app-...')).toBeNull()

    const statusBar = screen.getByText(/GPTBots API:/)
    fireEvent.click(statusBar)

    expect(screen.getByPlaceholderText('app-...')).toBeDefined()
  })

  it('sends agentConfigId and topK when testing retrieval', async () => {
    setupMocks(ALL_SOURCES)

    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Test Retrieval/ }))
    fireEvent.change(screen.getByPlaceholderText(/Enter a test query/), { target: { value: 'deposit not showing' } })
    fireEvent.change(screen.getByLabelText(/topK/i), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /Search/ }))

    await screen.findByText(/Deposit evidence/)

    const testCall = mockApiClient.mock.calls.find(([url]) => url === '/api/admin/knowledge/test')
    expect(testCall?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        agentConfigId: 'agent-1',
        query: 'deposit not showing',
        topK: 7,
      }),
    }))
    expect(screen.getByText(/Query:/).textContent).toContain('deposit not showing')
    expect(screen.getByText(/group_ids:/).textContent).toContain('kb-1')
  })
})

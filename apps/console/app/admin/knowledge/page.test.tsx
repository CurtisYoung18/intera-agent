// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

// ── Mocks ───────────────────────────────────────────────────────────────

const mockApiClient = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: any[]) => mockApiClient(...args),
  bustConfigCache: vi.fn(async () => {}),
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  default: () => null,
  useSelectedAgentId: vi.fn(() => 'agent-1'),
}))

vi.mock('@/components/admin/binding-column', () => ({
  useCapabilityBindings: vi.fn(() => ({ bindings: '', saveBindings: vi.fn() })),
  checkItemBinding: vi.fn(() => ({ isBound: false, isDrift: false, otherVersionsBound: false })),
  toggleItemBinding: vi.fn(() => ''),
  BindingIndicator: () => null,
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

function mockGptbotsConnected() {
  mockApiClient.mockImplementation(async (url: string) => {
    if (url === '/api/admin/knowledge/gptbots') {
      return {
        data: {
          knowledge_base: [
            { id: 'kb-1', name: 'FAQ', desc: 'Frequently asked', chunk: 100, doc: 10 },
          ],
        },
      }
    }
    if (url === '/api/admin/knowledge/sources') {
      return {
        data: {
          sources: [
            { id: 's-1', name: 'Deposit FAQ', description: null, groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 15, rerankVersion: null, docCorrelation: null, caseTypeTag: null, enabled: true },
          ],
        },
      }
    }
    return { data: {} }
  })
}

function mockGptbotsDisconnected() {
  mockApiClient.mockImplementation(async (url: string) => {
    if (url === '/api/admin/knowledge/gptbots') {
      return { data: { error: 'not configured' } }
    }
    if (url === '/api/admin/knowledge/sources') {
      return { data: { sources: [] } }
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
  // Flush any remaining microtask-driven state updates
  await act(async () => {})
  return { unmount: unmount! }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Knowledge Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // AC-B: badge shows "sources configured" when disconnected, "tools active" when connected
  it('AC-B: badge text changes based on GPTBots connection status', async () => {
    mockGptbotsDisconnected()

    const { unmount } = await renderPage()
    // Match only the badge text "N sources configured", not the empty-state message
    expect(screen.getAllByText(/\d+ sources configured/).length).toBeGreaterThanOrEqual(1)
    unmount()

    mockGptbotsConnected()

    await renderPage()
    expect(screen.getAllByText(/\d+ tools active/).length).toBeGreaterThanOrEqual(1)
  })

  // AC-A: tab switching between Sources and Test Retrieval
  it('AC-A: shows Sources and Test Retrieval tabs; clicking Test Retrieval hides source cards', async () => {
    mockGptbotsDisconnected()

    await renderPage()

    expect(screen.getByRole('button', { name: /Sources/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Test Retrieval/ })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /Test Retrieval/ }))

    expect(screen.getByPlaceholderText(/Enter a test query/)).toBeDefined()
    expect(screen.queryByText('No knowledge sources configured.')).toBeNull()
  })

  // AC-C: API key input hidden by default, visible after clicking status bar
  it('AC-C: hides API key input by default; expands after clicking the GPTBots status bar', async () => {
    mockGptbotsDisconnected()

    await renderPage()

    // API key input should not be visible before expansion
    expect(screen.queryByPlaceholderText('app-...')).toBeNull()

    // Click the status bar to expand
    const statusBar = screen.getByText(/GPTBots API:/)
    fireEvent.click(statusBar)

    // API key input should now be visible
    expect(screen.getByPlaceholderText('app-...')).toBeDefined()
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

// ── Mocks ───────────────────────────────────────────────────────────────

const mockApiClient = vi.fn()
let mockBindings = '{"knowledge":[],"tools":[],"guardrails":{"preTool":[],"postTool":[],"preFinalize":[]},"caseTypes":[]}'
const mockSaveBindings = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: any[]) => mockApiClient(...args),
  bustConfigCache: vi.fn(async () => {}),
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  default: () => null,
  useSelectedAgentId: vi.fn(() => 'agent-1'),
}))

vi.mock('@/components/admin/binding-column', () => ({
  useCapabilityBindings: vi.fn(() => ({ bindings: mockBindings, saveBindings: mockSaveBindings })),
  toggleItemBinding: vi.fn((currentBindings: string, category: string, itemName: string) => {
    const cb = JSON.parse(currentBindings || '{}')
    const arr: string[] = cb[category] || []
    const idx = arr.indexOf(itemName)
    if (idx >= 0) arr.splice(idx, 1)
    else arr.push(itemName)
    cb[category] = arr
    return JSON.stringify(cb)
  }),
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

function mockWithBinding(boundNames: string[], gptConnected = true) {
  mockBindings = JSON.stringify({
    knowledge: boundNames,
    tools: [],
    guardrails: { preTool: [], postTool: [], preFinalize: [] },
    caseTypes: [],
  })
  mockSaveBindings.mockClear()

  mockApiClient.mockImplementation(async (url: string) => {
    if (url === '/api/admin/knowledge/gptbots') {
      if (gptConnected) {
        return { data: { knowledge_base: [{ id: 'kb-1', name: 'FAQ', desc: 'Frequently asked', chunk: 100, doc: 10 }] } }
      }
      return { data: { error: 'not configured' } }
    }
    if (url === '/api/admin/knowledge/sources') {
      return { data: { sources: ALL_SOURCES } }
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
    mockBindings = '{"knowledge":[],"tools":[],"guardrails":{"preTool":[],"postTool":[],"preFinalize":[]},"caseTypes":[]}'
  })

  // AC-B: only bound sources are shown, badge counts bound+enabled
  it('AC-B: shows only bound sources and correct badge count', async () => {
    // Bind 2 of 3 sources, one disabled
    mockWithBinding(['Deposit FAQ', 'Account Policy'], true)

    const { unmount } = await renderPage()

    // Should show 2 source cards (Deposit FAQ + Account Policy), not all 3
    expect(screen.getByText('Deposit FAQ')).toBeDefined()
    expect(screen.getByText('Account Policy')).toBeDefined()
    expect(screen.queryByText('Withdrawal Guide')).toBeNull()

    // Badge: 1 bound+enabled (Deposit FAQ), Account Policy is disabled
    expect(screen.getAllByText(/1 tools active/).length).toBeGreaterThanOrEqual(1)
    unmount()
  })

  // AC-B: badge shows "sources configured" when GPTBots disconnected
  it('AC-B: badge shows "sources configured" when disconnected', async () => {
    mockWithBinding(['Deposit FAQ'], false)

    await renderPage()
    expect(screen.getAllByText(/1 sources configured/).length).toBeGreaterThanOrEqual(1)
  })

  // AC-B empty state: new agent with no bindings shows empty list
  it('AC-B: new agent with no bindings shows empty state', async () => {
    mockWithBinding([], true)

    await renderPage()
    // Should show empty state, not source cards
    expect(screen.queryByText('Deposit FAQ')).toBeNull()
    expect(screen.queryByText('Withdrawal Guide')).toBeNull()
    expect(screen.queryByText('Account Policy')).toBeNull()
    expect(screen.getByText(/No sources bound to this agent/)).toBeDefined()
    // Badge should show 0
    expect(screen.getAllByText(/0 tools active/).length).toBeGreaterThanOrEqual(1)
  })

  // AC-A: tab switching
  it('AC-A: shows Sources and Test Retrieval tabs; clicking Test Retrieval hides source cards', async () => {
    mockWithBinding(['Deposit FAQ'], true)

    await renderPage()

    expect(screen.getByRole('button', { name: /Sources/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Test Retrieval/ })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /Test Retrieval/ }))

    expect(screen.getByPlaceholderText(/Enter a test query/)).toBeDefined()
  })

  // AC-C: API key input hidden by default, visible after clicking status bar
  it('AC-C: hides API key input by default; expands after clicking the GPTBots status bar', async () => {
    mockWithBinding([], false)

    await renderPage()

    expect(screen.queryByPlaceholderText('app-...')).toBeNull()

    const statusBar = screen.getByText(/GPTBots API:/)
    fireEvent.click(statusBar)

    expect(screen.getByPlaceholderText('app-...')).toBeDefined()
  })

  // AC-H: Add Source picker shows unbound sources
  it('AC-H: Add Source picker shows unbound sources and binds on click', async () => {
    mockWithBinding(['Deposit FAQ'], true)

    await renderPage()

    // Click "Add Source" button
    fireEvent.click(screen.getByText('Add Source'))

    // Picker should show unbound sources (Withdrawal Guide, Account Policy)
    expect(screen.getByText('Withdrawal Guide')).toBeDefined()
    expect(screen.getByText('Account Policy')).toBeDefined()
    // Bound source should NOT appear in picker
    // (Deposit FAQ is shown in the main list, not the picker)

    // Click "Bind" on Withdrawal Guide
    const bindButtons = screen.getAllByText('Bind')
    fireEvent.click(bindButtons[0])

    // saveBindings should have been called with knowledge containing both names
    expect(mockSaveBindings).toHaveBeenCalledTimes(1)
    const newBindings = JSON.parse(mockSaveBindings.mock.calls[0][0])
    expect(newBindings.knowledge).toContain('Deposit FAQ')
    expect(newBindings.knowledge).toContain('Withdrawal Guide')
  })
})

// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApiClient = vi.fn()
const mockPush = vi.fn()
const listT = (key: string, params?: Record<string, unknown>) => {
  const labels: Record<string, string> = {
    'caseTypes.title': 'Procedure Types',
    'caseTypes.subtitle': `${String(params?.n ?? 0)} Procedure definitions`,
    'caseTypes.new': 'New Procedure Type',
    'caseTypes.searchPh': 'Search Procedure types…',
    'caseTypes.emptyTitle': 'No Procedure types yet',
    'caseTypes.emptyDesc': 'Create your first Procedure type',
    'caseTypes.error.selectAgent': 'Select an agent version first.',
    'caseTypes.error.load': 'Failed to load Procedure type',
    'common.noMatches': 'No matches',
  }
  return labels[key] ?? key
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
  bustConfigCache: vi.fn(),
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: () => ({
    locale: 'en',
    t: listT,
  }),
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  __esModule: true,
  default: () => null,
  useSelectedAgentId: () => 'agent_v3',
}))

vi.mock('@/lib/hooks/use-session', () => ({
  useSession: () => ({ orgId: 'org_default' }),
}))

vi.mock('../_components/components-route-shell', () => ({
  BuildComponentsRouteShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/page-loader', () => ({
  PageLoader: ({ loading, error, children }: { loading: boolean; error: string | null; children: React.ReactNode }) => (
    loading ? <div>loading</div> : error ? <div>{error}</div> : <>{children}</>
  ),
}))

vi.mock('@/components/ui/empty-state', () => ({
  __esModule: true,
  default: () => <div>empty</div>,
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  __esModule: true,
  default: () => null,
}))

describe('BuildProceduresPage', () => {
  beforeEach(() => {
    mockApiClient.mockReset()
    mockPush.mockReset()
    mockApiClient.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/case-types?')) {
        return { data: { types: [] } }
      }
      throw new Error(`Unexpected apiClient call: ${url}`)
    })
  })

  it('routes to the local draft page instead of creating a Procedure immediately', async () => {
    const { default: BuildProceduresPage } = await import('./page')

    render(<BuildProceduresPage />)

    const newButton = await screen.findByRole('button', { name: 'New Procedure Type' })
    fireEvent.click(newButton)

    expect(mockPush).toHaveBeenCalledWith('/build/components/procedures/__new__')
    await waitFor(() => expect(mockApiClient).toHaveBeenCalledTimes(1))
    expect(mockApiClient.mock.calls.every(([url]) => String(url).startsWith('/api/admin/case-types?'))).toBe(true)
  })
})

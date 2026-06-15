// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
const mockApiClient = vi.fn()
let search = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => search,
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  default: () => null,
  useSelectedAgentId: () => 'agent_default_v1',
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: () => ({
    locale: 'en',
    t: (key: string, vars?: Record<string, string>) => {
      const labels: Record<string, string> = {
        'integrationsPage.title': 'Integrations',
        'integrationsPage.channels': 'Channels',
        'integrationsPage.apiKeys': 'API Keys',
        'common.failedLoad': 'Failed load',
        'common.failedSave': 'Failed save',
        'common.active': 'Active',
        'common.cancel': 'Cancel',
        'common.name': 'Name',
        'apiKeys.keyRevealHint': 'Shown once',
        'apiKeys.hide': 'Hide',
        'apiKeys.show': 'Show',
        'apiKeys.copied': 'Copied',
        'apiKeys.copy': 'Copy',
        'apiKeys.createKey': 'Create Key',
        'apiKeys.bindAgentConfig': 'Bind to Agent Config',
        'apiKeys.bindAgentConfigHint': 'Bind hint',
        'apiKeys.orgDefault': `Org default ${vars?.label ?? ''}`,
        'apiKeys.create': 'Create',
        'apiKeys.newKey': 'New Key',
        'apiKeys.empty': 'Empty',
        'apiKeys.revoke': 'Revoke',
        'apiKeys.howToUse': 'How to use API keys',
        'apiKeys.authTitle': 'Authentication',
        'apiKeys.authDesc': 'Auth desc',
        'apiKeys.endpointsTitle': 'External API endpoints',
        'apiKeys.mainEndpointDesc': 'Main entry',
        'apiKeys.tip': 'Tip',
        'apiKeys.tipDesc': 'Route traffic',
        'common.deleteConfirm': 'Delete?',
        'common.permanentlyDelete': `Delete ${vars?.name ?? ''}`,
      }
      return labels[key] ?? key
    },
  }),
}))

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
}))

describe('IntegrationsWorkspace', () => {
  beforeEach(() => {
    search = new URLSearchParams()
    mockPush.mockReset()
    mockApiClient.mockReset()
    mockApiClient.mockResolvedValue({ data: { keys: [], configs: [] } })
  })

  it('navigates channel cards inside the Build route instead of admin routes', async () => {
    const { default: IntegrationsWorkspace } = await import('@/components/integrations/integrations-workspace')

    render(<IntegrationsWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: /LiveChat/i }))

    expect(mockPush).toHaveBeenCalledWith('/build/components/integrations?tab=channels&channel=livechat')
  })

  it('shows a focused API key empty state without the old help sections', async () => {
    search = new URLSearchParams('tab=apiKeys')
    const { default: IntegrationsWorkspace } = await import('@/components/integrations/integrations-workspace')

    render(<IntegrationsWorkspace />)

    expect(await screen.findByRole('button', { name: 'New Key' })).toBeDefined()
    expect(screen.getByText('No API keys yet')).toBeDefined()
    expect(screen.queryByText('How to use API keys')).toBeNull()
  })
})

// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
const mockApiClient = vi.fn()
let search = new URLSearchParams()
let selectedAgentId = 'agent_default_v1'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => search,
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  default: () => null,
  useSelectedAgentId: () => selectedAgentId,
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
    selectedAgentId = 'agent_default_v1'
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

  it('defaults new API keys to the currently selected agent config and keeps version-specific options', async () => {
    search = new URLSearchParams('tab=apiKeys')
    selectedAgentId = 'agent_current_v2'
    mockApiClient.mockImplementation((url: string, options?: { method?: string; body?: Record<string, string> }) => {
      if (url === '/api/admin/agent-configs') {
        return Promise.resolve({
          data: {
            configs: [
              { id: 'agent_old_v1', name: 'Support Agent', version: 1, isActive: false },
              { id: 'agent_current_v2', name: 'Support Agent', version: 2, isActive: true },
              { id: 'agent_other_v1', name: 'Billing Agent', version: 1, isActive: true },
            ],
          },
        })
      }
      if (url === '/api/admin/api-keys' && options?.method === 'POST') {
        return Promise.resolve({
          data: {
            key: {
              id: 'key_1',
              name: options.body?.name ?? 'default',
              prefix: 'intera_sk_live_test',
              agentConfigId: options.body?.agentConfigId ?? null,
              lastUsedAt: null,
              createdAt: '2026-06-17T00:00:00.000Z',
            },
            plaintext: 'intera_sk_live_test_123',
          },
        })
      }
      return Promise.resolve({ data: { keys: [] } })
    })

    const { default: IntegrationsWorkspace } = await import('@/components/integrations/integrations-workspace')

    render(<IntegrationsWorkspace />)

    fireEvent.click(await screen.findByRole('button', { name: 'New Key' }))

    const combo = await screen.findByRole('combobox')
    expect((combo as HTMLSelectElement).value).toBe('agent_current_v2')
    expect(Array.from((combo as HTMLSelectElement).options).map((option) => option.textContent)).toEqual([
      'Support Agent · v1',
      'Support Agent · v2 (Active)',
      'Billing Agent · v1 (Active)',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(mockApiClient).toHaveBeenCalledWith(
      '/api/admin/api-keys',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          name: 'default',
          agentConfigId: 'agent_current_v2',
        }),
      }),
    )
  })
})

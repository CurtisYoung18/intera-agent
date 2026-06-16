// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApiClient = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: () => ({
    locale: 'en',
    t: (key: string) => {
      const labels: Record<string, string> = {
        'livechat.loading': 'Loading…',
        'livechat.back': 'Back',
        'livechat.subtitle': 'Configure routing, rendering, escalation, and webhook delivery.',
        'livechat.stateUnconfigured': 'Not configured',
        'livechat.stateDisabled': 'Disabled',
        'livechat.stateConnecting': 'Connecting...',
        'livechat.stateConnected': 'Connected',
        'livechat.stateFailed': 'Connection failed',
        'livechat.tab.connection': 'Connection',
        'livechat.tab.rendering': 'Rendering',
        'livechat.webhookRouteNotePerAgent': 'Keep this webhook URL fixed in LiveChat. Publish/version changes should continue routing through this same URL.',
      }
      return labels[key] ?? key
    },
  }),
}))

vi.mock('@/lib/hooks/use-session', () => ({
  useSession: () => ({ orgId: 'org_default' }),
}))

describe('LiveChatChannelWorkspace', () => {
  beforeEach(() => {
    mockApiClient.mockReset()
    mockApiClient.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/livechat/config?')) {
        return {
          data: {
            config: {
              agentConfigId: 'agent_v2',
              webhookAgentConfigId: 'agent_root_v1',
              botAccessToken: '',
              licenseId: '',
              showSkillStatus: true,
              enabled: false,
              webhookSecret: '',
              region: 'dal',
              authType: 'auto',
              accountId: '',
              agentAccountId: '',
            },
          },
        }
      }
      if (url.startsWith('/api/admin/livechat/groups?')) {
        return { data: { groups: [] } }
      }
      throw new Error(`Unexpected apiClient call: ${url}`)
    })
  })

  it('shows the stable family webhook URL and keeps password fields inside a form', async () => {
    const { default: LiveChatChannelWorkspace } = await import('@/components/integrations/livechat-channel-workspace')

    const { container } = render(<LiveChatChannelWorkspace agentConfigId="agent_v2" onBack={() => {}} />)

    expect(await screen.findByText(/\/api\/livechat\/webhook\/org_default\/agent_root_v1$/)).toBeDefined()
    expect(screen.getByText('Keep this webhook URL fixed in LiveChat. Publish/version changes should continue routing through this same URL.')).toBeDefined()
    expect(screen.queryByText('Bound to the current Agent version')).toBeNull()

    const passwordFields = Array.from(container.querySelectorAll('input[type="password"]'))
    expect(passwordFields.length).toBeGreaterThan(0)
    expect(passwordFields.every((field) => field.closest('form'))).toBe(true)
  })
})

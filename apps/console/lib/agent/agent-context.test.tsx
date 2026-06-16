// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentProvider, useAgentContext } from './agent-context'

vi.mock('next/navigation', () => ({
  usePathname: () => '/operate/handoff',
}))

function SelectedAgentProbe() {
  const { selectedAgentId } = useAgentContext()
  return <div data-testid="selected-agent">{selectedAgentId ?? 'none'}</div>
}

function mockAgentConfigFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      data: {
        configs: [
          { id: 'agent-a', name: 'J1B', version: 1, isActive: true },
          { id: 'agent-b', name: 'J1N', version: 1, isActive: false },
        ],
      },
    }),
  })))
}

describe('AgentProvider URL synchronization', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    window.history.pushState(null, '', '/operate/handoff?agentId=agent-a')
    mockAgentConfigFetch()
  })

  it('syncs selected agent from browser back/forward popstate URL changes', async () => {
    render(
      <AgentProvider>
        <SelectedAgentProbe />
      </AgentProvider>,
    )

    await screen.findByText('agent-a')

    act(() => {
      window.history.pushState(null, '', '/operate/handoff?agentId=agent-b')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    await screen.findByText('agent-b')
    expect(window.localStorage.getItem('intera-agent-id')).toBe('agent-b')
  })

  it('rejects invalid popstate agent IDs and restores the current selected agent in the URL', async () => {
    render(
      <AgentProvider>
        <SelectedAgentProbe />
      </AgentProvider>,
    )

    await screen.findByText('agent-a')

    act(() => {
      window.history.pushState(null, '', '/operate/handoff?agentId=unknown-agent')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('selected-agent').textContent).toBe('agent-a')
      expect(window.location.search).toBe('?agentId=agent-a')
    })
  })
})

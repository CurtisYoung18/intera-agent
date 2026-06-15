// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/build/pilot-lab',
}))

vi.mock('@/lib/agent/agent-context', () => ({
  useAgentContext: () => ({
    selectedAgentId: 'agent-1',
    selectAgent: vi.fn(),
    refreshConfigs: vi.fn(),
    agentConfigs: [
      { id: 'agent-1', name: 'J1B', version: 1, isActive: true },
    ],
  }),
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: () => ({
    locale: 'en',
    toggleLocale: vi.fn(),
    t: (key: string) => {
      const labels: Record<string, string> = {
        'sidebar.build': 'Build',
        'sidebar.operate': 'Operate',
        'sidebar.settings': 'Settings',
        'sidebar.release': 'Release',
        'sidebar.pilotLab': 'Pilot Lab',
        'sidebar.components': 'Components',
        'sidebar.conversations': 'Conversations',
        'sidebar.procedureMetrics': 'Procedure Metrics',
        'sidebar.handoff': 'Human Handoff',
        'sidebar.organization': 'Organization',
        'sidebar.expandAria': 'Expand sidebar',
        'sidebar.collapseAria': 'Collapse sidebar',
        'sidebar.openAgents': 'Manage agents',
        'sidebar.language': 'Language',
        'sidebar.switchToZh': '中文',
        'sidebar.switchToEn': 'English',
        'sidebar.switchProject': 'Switch Project',
        'sidebar.signOut': 'Sign Out',
        'shell.version': 'v-test',
      }
      return labels[key] ?? key
    },
  }),
}))

vi.mock('@intera/shared/ui/intera-logo', () => ({
  default: () => <div>Intera</div>,
}))

vi.mock('@/components/admin/agent-management-drawer', () => ({
  default: () => null,
}))

vi.mock('@/components/admin/agent-version-picker', () => ({
  default: () => <div>AgentVersionPicker</div>,
}))

import ConsoleSidebar from './console-sidebar'

describe('ConsoleSidebar', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ data: { customerName: 'Test', isAuthenticated: true } }),
    })))
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows only approved first-level Build destinations', async () => {
    let container: HTMLElement
    await act(async () => {
      const rendered = render(<ConsoleSidebar />)
      container = rendered.container
      await Promise.resolve()
    })

    const nav = container!.querySelector('nav')
    expect(nav?.querySelector('a[href="/build/pilot-lab"]')?.getAttribute('data-active')).toBe('true')
    expect(nav?.querySelector('a[href="/build/release"]')).toBeTruthy()
    expect(nav?.querySelector('a[href="/build/components"]')).toBeTruthy()
    expect(screen.queryByText('Preview & Debug')).toBeNull()
    expect(container!.querySelector('a[href="/build/playground"]')).toBeNull()
  })

  it('opens the identity menu from the shared avatar control', async () => {
    await act(async () => {
      render(<ConsoleSidebar />)
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Test' }))

    expect(screen.getByRole('button', { name: /Sign Out/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /Switch Project/i })).toBeDefined()
  })

  it('starts collapsed on narrow viewports and exposes the expand control', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    await act(async () => {
      render(<ConsoleSidebar />)
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: /Expand sidebar/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /Manage agents/i }).textContent).toContain('J1B')
  })
})

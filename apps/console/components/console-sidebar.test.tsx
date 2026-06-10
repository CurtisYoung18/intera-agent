// @vitest-environment jsdom
import React from 'react'
import { act, render, screen } from '@testing-library/react'
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
        'sidebar.handoff': 'Human Handoff',
        'sidebar.organization': 'Organization',
        'sidebar.expandAria': 'Expand sidebar',
        'sidebar.collapseAria': 'Collapse sidebar',
        'sidebar.openAgents': 'Manage agents',
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

    expect(screen.getByRole('link', { name: /Pilot Lab/i }).getAttribute('href')).toBe('/build/pilot-lab')
    expect(screen.getByRole('link', { name: /Release/i }).getAttribute('href')).toBe('/build/release')
    expect(screen.getByRole('link', { name: /Components/i }).getAttribute('href')).toBe('/build/components')
    expect(screen.queryByText('Preview & Debug')).toBeNull()
    expect(container!.querySelector('a[href="/build/playground"]')).toBeNull()
  })
})

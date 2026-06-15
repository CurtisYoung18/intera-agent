// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mockUsePathname = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

vi.mock('@intera/shared/ui/liquid-glass-bg', () => ({
  default: () => <div data-testid="liquid-bg" />,
}))

vi.mock('./console-sidebar', () => ({
  default: () => <nav>Sidebar</nav>,
}))

vi.mock('@/lib/agent/agent-context', () => ({
  AgentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/admin/agent-onboarding', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/console-back-to-top', () => ({
  default: () => <div>BackToTop</div>,
}))

import ConsoleShell from './console-shell'

describe('ConsoleShell', () => {
  it('renders org-picker without sidebar chrome', () => {
    mockUsePathname.mockReturnValue('/org-picker')

    render(
      <ConsoleShell>
        <div>Org picker page</div>
      </ConsoleShell>,
    )

    expect(screen.getByText('Org picker page')).not.toBeNull()
    expect(screen.queryByText('Sidebar')).toBeNull()
    expect(screen.queryByTestId('liquid-bg')).toBeNull()
  })

  it('renders livechat widget without console chrome', () => {
    mockUsePathname.mockReturnValue('/livechat-widget')

    render(
      <ConsoleShell>
        <div>LiveChat widget</div>
      </ConsoleShell>,
    )

    expect(screen.getByText('LiveChat widget')).not.toBeNull()
    expect(screen.queryByText('Sidebar')).toBeNull()
    expect(screen.queryByTestId('liquid-bg')).toBeNull()
  })
})

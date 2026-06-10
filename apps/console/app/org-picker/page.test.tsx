// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApiClient = vi.fn()

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: () => ({
    locale: 'en',
    toggleLocale: vi.fn(),
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/auth/console-auth-shell', () => ({
  ConsoleAuthShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import OrgPickerPage from './page'

describe('OrgPickerPage', () => {
  beforeEach(() => {
    mockApiClient.mockReset()

    Reflect.deleteProperty(window, 'location')
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/org-picker' },
    })
  })

  it('loads memberships and switches to the selected organization', async () => {
    mockApiClient.mockImplementation(async (url: string) => {
      if (url === '/api/auth/memberships') {
        return {
          data: {
            orgs: [
              { orgId: 'org-1', role: 'admin', name: 'Acme Support' },
              { orgId: 'org-2', role: 'viewer', name: 'Staging Ops' },
            ],
          },
        }
      }

      if (url === '/api/auth/switch-org') {
        return { data: { ok: true } }
      }

      throw new Error(`Unexpected url ${url}`)
    })

    await act(async () => {
      render(<OrgPickerPage />)
    })

    fireEvent.click(await screen.findByRole('button', { name: /Acme Support/i }))

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith('/api/auth/switch-org', {
        method: 'POST',
        body: { orgId: 'org-1' },
      })
    })

    expect(window.location.href).toBe('/build/pilot-lab')
  })
})

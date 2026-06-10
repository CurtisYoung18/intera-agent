// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
const mockApiClient = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/organization',
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const labels: Record<string, string> = {
        'organization.title': 'Organization',
        'organization.general': 'General',
        'organization.members': 'Members',
        'organization.permissions': 'Permissions',
        'organization.nameLabel': 'Organization Name',
        'common.loading': 'Loading',
        'common.save': 'Save',
        'common.saving': 'Saving',
        'organization.nameSaved': 'Name updated',
      }

      if (key === 'organization.memberCount' && vars) {
        return `${vars.n} members · ${vars.m} pending invitation`
      }

      return labels[key] ?? key
    },
  }),
}))

vi.mock('@/lib/hooks/use-session', () => ({
  useSession: () => ({
    orgId: 'org-1',
    userId: 'user-1',
    loading: false,
  }),
}))

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
  ApiClientError: class ApiClientError extends Error {
    constructor(public envelope: any) {
      super(envelope.error.message)
    }
  },
}))

import OrganizationPage from './page'

describe('OrganizationPage', () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockApiClient.mockReset()
    mockApiClient.mockResolvedValue({ data: { organization: { name: 'Acme Support' } } })
  })

  it('keeps tab navigation on the current settings route', async () => {
    await act(async () => {
      render(<OrganizationPage />)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Members' }))

    expect(mockPush).toHaveBeenCalledWith('/settings/organization?tab=members')
  })
})

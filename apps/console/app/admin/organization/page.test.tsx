import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`)
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

import AdminOrganizationRedirectPage from './page'

describe('AdminOrganizationRedirectPage', () => {
  beforeEach(() => {
    mockRedirect.mockClear()
  })

  it('redirects to the native organization settings route', () => {
    expect(() => AdminOrganizationRedirectPage()).toThrow('REDIRECT:/settings/organization')
  })
})

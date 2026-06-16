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

  it('redirects to the native organization settings route', async () => {
    await expect(AdminOrganizationRedirectPage({})).rejects.toThrow('REDIRECT:/settings/organization')
  })

  it('preserves agent selection in the redirect URL', async () => {
    await expect(AdminOrganizationRedirectPage({
      searchParams: Promise.resolve({ agentId: 'agent-a' }),
    })).rejects.toThrow('REDIRECT:/settings/organization?agentId=agent-a')
  })
})

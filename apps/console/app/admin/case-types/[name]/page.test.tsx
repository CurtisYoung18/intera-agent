import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`)
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

import AdminCaseTypeDetailRedirectPage from './page'

describe('AdminCaseTypeDetailRedirectPage', () => {
  beforeEach(() => {
    mockRedirect.mockClear()
  })

  it('redirects to the native procedure detail route', async () => {
    await expect(
      AdminCaseTypeDetailRedirectPage({
        params: Promise.resolve({ name: 'refund_case' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('REDIRECT:/build/components/procedures/refund_case')
  })

  it('preserves search params when redirecting', async () => {
    await expect(
      AdminCaseTypeDetailRedirectPage({
        params: Promise.resolve({ name: 'refund_case' }),
        searchParams: Promise.resolve({
          agentConfigId: 'agent-1',
          foo: 'bar',
        }),
      }),
    ).rejects.toThrow(
      'REDIRECT:/build/components/procedures/refund_case?agentConfigId=agent-1&foo=bar',
    )
  })

  it('encodes the procedure name segment', async () => {
    await expect(
      AdminCaseTypeDetailRedirectPage({
        params: Promise.resolve({ name: 'refund case/中文' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(
      'REDIRECT:/build/components/procedures/refund%20case%2F%E4%B8%AD%E6%96%87',
    )
  })
})

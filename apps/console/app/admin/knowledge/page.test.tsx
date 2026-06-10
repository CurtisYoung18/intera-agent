import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`)
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

import AdminKnowledgeRedirectPage from './page'

describe('AdminKnowledgeRedirectPage', () => {
  beforeEach(() => {
    mockRedirect.mockClear()
  })

  it('redirects to the native knowledge workspace', () => {
    expect(() => AdminKnowledgeRedirectPage()).toThrow('REDIRECT:/build/components/knowledge')
  })
})

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

  it('redirects to the native knowledge workspace', async () => {
    await expect(AdminKnowledgeRedirectPage({})).rejects.toThrow('REDIRECT:/build/components/knowledge')
  })

  it('preserves agent selection in the redirect URL', async () => {
    await expect(AdminKnowledgeRedirectPage({
      searchParams: Promise.resolve({ agentId: 'agent-a' }),
    })).rejects.toThrow('REDIRECT:/build/components/knowledge?agentId=agent-a')
  })
})

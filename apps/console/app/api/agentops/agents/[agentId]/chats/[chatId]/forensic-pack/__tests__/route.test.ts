import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  repo: { orgId: 'org-1' },
  repoForOrg: vi.fn(),
  assertAgentInOrg: vi.fn(async () => {}),
  buildChatForensicPack: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: h.getSession,
}))

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg: h.repoForOrg,
}))

vi.mock('@/lib/api/assert-agent-in-org', () => ({
  assertAgentInOrg: h.assertAgentInOrg,
}))

vi.mock('@/lib/agentops/forensic-pack', () => ({
  buildChatForensicPack: h.buildChatForensicPack,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { NotFoundError } from '@/lib/api/define-route'
import { GET } from '../route'

function req(url = 'http://localhost/api/agentops/agents/agent-1/chats/chat-1/forensic-pack') {
  return new NextRequest(url)
}

function ctx(agentId = 'agent-1', chatId = 'chat-1') {
  return { params: Promise.resolve({ agentId, chatId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.repoForOrg.mockReturnValue(h.repo)
  h.getSession.mockResolvedValue({ orgId: 'org-1', role: 'admin', userId: 'user-1' })
  h.buildChatForensicPack.mockResolvedValue({
    schemaVersion: 'agentops.forensic-pack.v1',
    generatedAt: '2026-06-26T00:00:00.000Z',
    agentId: 'agent-1',
    chatId: 'chat-1',
  })
})

describe('GET /api/agentops/agents/[agentId]/chats/[chatId]/forensic-pack', () => {
  it('requires path agent scope before building the pack', async () => {
    const res = await GET(req('http://localhost/api/agentops/agents/agent-1/chats/chat-1/forensic-pack?translate=zh'), ctx())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(h.assertAgentInOrg).toHaveBeenCalledWith(h.repo, 'agent-1')
    expect(h.buildChatForensicPack).toHaveBeenCalledWith({
      repo: h.repo,
      agentId: 'agent-1',
      chatId: 'chat-1',
      translate: 'zh',
    })
  })

  it('returns 401 without a session', async () => {
    h.getSession.mockResolvedValue(null)

    const res = await GET(req(), ctx())

    expect(res.status).toBe(401)
    expect(h.buildChatForensicPack).not.toHaveBeenCalled()
  })

  it('does not build the pack when the path agent is outside the org scope', async () => {
    h.assertAgentInOrg.mockRejectedValueOnce(new NotFoundError('Agent config not found'))

    const res = await GET(req(), ctx('foreign-agent', 'chat-1'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error).toMatchObject({
      code: 'not_found',
      message: 'Agent config not found',
    })
    expect(h.assertAgentInOrg).toHaveBeenCalledWith(h.repo, 'foreign-agent')
    expect(h.buildChatForensicPack).not.toHaveBeenCalled()
  })
})

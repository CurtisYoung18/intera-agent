import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const repo = {
    orgId: 'org-1',
    raw: {
      case: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      externalConversation: {
        deleteMany: vi.fn(),
      },
      chatSession: {
        deleteMany: vi.fn(),
      },
    },
  }

  return {
    repo,
    mockGetSession: vi.fn(),
    mockResolveRequiredAgentCaseScope: vi.fn(),
    mockCaseIdFilterForScope: vi.fn(),
    mockUpsertUserProfile: vi.fn(),
    mockDeleteUserProfile: vi.fn(),
    mockReadUserProfile: vi.fn(),
    mockGetUserProfileStorageScope: vi.fn(),
    mockMergeProfile: vi.fn(),
  }
})

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg: vi.fn(() => h.repo),
}))

vi.mock('@/app/api/_agent-scope', () => ({
  resolveRequiredAgentCaseScope: h.mockResolveRequiredAgentCaseScope,
  caseIdFilterForScope: h.mockCaseIdFilterForScope,
}))

vi.mock('@/lib/db/user-profiles', () => ({
  readUserProfile: h.mockReadUserProfile,
  upsertUserProfile: h.mockUpsertUserProfile,
  deleteUserProfile: h.mockDeleteUserProfile,
  getUserProfileStorageScope: h.mockGetUserProfileStorageScope,
}))

vi.mock('@intera/shared/memory/mergeProfile', () => ({
  mergeProfile: h.mockMergeProfile,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { DELETE, PUT } from '../route'

function putRequest(userId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/users/${encodeURIComponent(userId)}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(userId: string, agentConfigId = 'agent-a') {
  return new NextRequest(`http://localhost/api/users/${encodeURIComponent(userId)}/profile?agentConfigId=${agentConfigId}`, {
    method: 'DELETE',
  })
}

function routeCtx(userId: string) {
  return { params: Promise.resolve({ userId: encodeURIComponent(userId) }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ userId: 'admin-1', orgId: 'org-1', role: 'admin' })
  h.mockResolveRequiredAgentCaseScope.mockResolvedValue({ agentConfigId: 'agent-a' })
  h.mockCaseIdFilterForScope.mockReturnValue({})
  h.mockGetUserProfileStorageScope.mockResolvedValue('agent_config_profile')
  h.mockMergeProfile.mockReturnValue({ profile: '# Profile', sections: '{"identity":[]}' })
  h.mockUpsertUserProfile.mockResolvedValue({ userId: 'user:alice', profile: '', sections: '{}' })
  h.mockDeleteUserProfile.mockResolvedValue(1)
  h.repo.raw.case.findMany.mockResolvedValue([])
  h.repo.raw.case.deleteMany.mockResolvedValue({ count: 0 })
  h.repo.raw.externalConversation.deleteMany.mockResolvedValue({ count: 0 })
  h.repo.raw.chatSession.deleteMany.mockResolvedValue({ count: 0 })
})

describe('PUT /api/users/[userId]/profile', () => {
  it('clears structured sections when the profile is cleared', async () => {
    const res = await PUT(putRequest('user:alice', { profile: '', agentConfigId: 'agent-a' }), routeCtx('user:alice'))

    expect(res.status).toBe(200)
    expect(h.mockMergeProfile).not.toHaveBeenCalled()
    expect(h.mockUpsertUserProfile).toHaveBeenCalledWith(h.repo.raw, {
      orgId: 'org-1',
      userId: 'user:alice',
      agentConfigId: 'agent-a',
      patch: { profile: '', sections: '{}' },
    })
  })

  it('rebuilds structured sections from edited profile markdown', async () => {
    const res = await PUT(putRequest('user:alice', { profile: '# Profile\n- member_id: JAYA113C88F', agentConfigId: 'agent-a' }), routeCtx('user:alice'))

    expect(res.status).toBe(200)
    expect(h.mockMergeProfile).toHaveBeenCalledWith('', '# Profile\n- member_id: JAYA113C88F', 4000)
    expect(h.mockUpsertUserProfile).toHaveBeenCalledWith(h.repo.raw, expect.objectContaining({
      patch: { profile: '# Profile\n- member_id: JAYA113C88F', sections: '{"identity":[]}' },
    }))
  })
})

describe('DELETE /api/users/[userId]/profile', () => {
  it('deletes the UserProfile row and related chat sessions', async () => {
    h.repo.raw.case.findMany.mockResolvedValue([
      { id: 'case-1', chatId: 'chat-1' },
      { id: 'case-2', chatId: 'chat-1' },
      { id: 'case-3', chatId: 'chat-2' },
    ])
    h.repo.raw.chatSession.deleteMany.mockResolvedValue({ count: 2 })

    const res = await DELETE(deleteRequest('user:alice'), routeCtx('user:alice'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(h.mockDeleteUserProfile).toHaveBeenCalledWith(h.repo.raw, {
      orgId: 'org-1',
      userId: 'user:alice',
      agentConfigId: 'agent-a',
    })
    expect(h.repo.raw.case.deleteMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1', userId: 'alice' },
    })
    expect(h.repo.raw.externalConversation.deleteMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1', internalCaseId: { in: ['case-1', 'case-2', 'case-3'] } },
    })
    expect(h.repo.raw.chatSession.deleteMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1', chatId: { in: ['chat-1', 'chat-2'] } },
    })
    expect(body.data.profileDeleted).toBe(true)
    expect(body.data.deletedProfiles).toBe(1)
    expect(body.data.deletedChatSessions).toBe(2)
  })
})

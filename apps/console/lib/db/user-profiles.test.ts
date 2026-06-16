import { describe, expect, it, vi } from 'vitest'

function makeDb() {
  return {
    $queryRaw: vi.fn(async () => [{ exists: true }]),
    userProfile: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ id: 'profile-1' })),
    },
  }
}

describe('user profile storage', () => {
  it('uses the agent-scoped compound key for current UserProfile schema reads and writes', async () => {
    vi.resetModules()
    const { readUserProfile, upsertUserProfile } = await import('@/lib/db/user-profiles')
    const db = makeDb()

    await readUserProfile(db as any, {
      orgId: 'default',
      agentConfigId: 'agent-j1b',
      userId: 'user-1',
    })

    expect(db.userProfile.findUnique).toHaveBeenCalledWith({
      where: {
        orgId_agentConfigId_userId: {
          orgId: 'default',
          agentConfigId: 'agent-j1b',
          userId: 'user-1',
        },
      },
    })

    await upsertUserProfile(db as any, {
      orgId: 'default',
      agentConfigId: 'agent-j1b',
      userId: 'user-1',
      patch: { profile: '# User Profile' },
    })

    expect(db.userProfile.upsert).toHaveBeenCalledWith({
      where: {
        orgId_agentConfigId_userId: {
          orgId: 'default',
          agentConfigId: 'agent-j1b',
          userId: 'user-1',
        },
      },
      create: {
        userId: 'user-1',
        orgId: 'default',
        agentConfigId: 'agent-j1b',
        profile: '# User Profile',
      },
      update: { profile: '# User Profile' },
    })
  })
})

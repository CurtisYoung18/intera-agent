import { Prisma } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

type MockDbOptions = {
  hasAgentConfigColumn?: boolean
  prismaSupportsAgentConfig?: boolean
}

function makeRow() {
  return {
    id: 'profile-raw',
    orgId: 'default',
    userId: 'user-1',
    agentConfigId: 'agent-j1b',
    profile: '# User Profile',
    sections: '{}',
    totalChats: 1,
    totalCases: 1,
    resolvedCases: 1,
    escalatedCases: 0,
    lastCaseType: 'general',
    firstSeenAt: null,
    lastSeenAt: null,
    createdAt: new Date('2026-06-17T00:00:00Z'),
    updatedAt: new Date('2026-06-17T00:00:00Z'),
  }
}

function makeDb(options: MockDbOptions = {}) {
  const row = makeRow()
  const $queryRaw = vi.fn(async () => {
    const callIndex = $queryRaw.mock.calls.length
    if (callIndex === 1) return [{ exists: options.hasAgentConfigColumn ?? false }]
    return [row]
  })

  const findUnique = options.prismaSupportsAgentConfig === false
    ? vi.fn(async () => { throw new Error('Unknown argument orgId_agentConfigId_userId') })
    : vi.fn(async () => null)

  const upsert = options.prismaSupportsAgentConfig === false
    ? vi.fn(async () => { throw new Error('Unknown argument orgId_agentConfigId_userId') })
    : vi.fn(async () => ({ id: 'profile-1' }))

  return {
    $queryRaw,
    userProfile: {
      findUnique,
      findMany: vi.fn(async () => []),
      upsert,
    },
  }
}

const userProfileModel = Prisma.dmmf.datamodel.models.find((model) => model.name === 'UserProfile')
const originalUserProfileFields = userProfileModel?.fields.map((field) => ({ ...field })) ?? []
const originalUserProfileUniqueFields = (userProfileModel?.uniqueFields ?? []).map((fieldSet) => [...fieldSet])

afterEach(() => {
  if (!userProfileModel) return
  ;(userProfileModel as any).fields = originalUserProfileFields.map((field) => ({ ...field }))
  ;(userProfileModel as any).uniqueFields = originalUserProfileUniqueFields.map((fieldSet) => [...fieldSet])
})

describe('user profile storage', () => {
  it('uses the orgId_userId key for the current Prisma UserProfile schema', async () => {
    vi.resetModules()
    const {
      readUserProfile,
      upsertUserProfile,
      resetUserProfileStorageScopeCacheForTests,
    } = await import('@/lib/db/user-profiles')
    resetUserProfileStorageScopeCacheForTests()
    const db = makeDb({ hasAgentConfigColumn: false })

    await readUserProfile(db as any, {
      orgId: 'default',
      agentConfigId: 'agent-j1b',
      userId: 'user-1',
    })

    expect(db.userProfile.findUnique).toHaveBeenCalledWith({
      where: {
        orgId_userId: {
          orgId: 'default',
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
        orgId_userId: {
          orgId: 'default',
          userId: 'user-1',
        },
      },
      create: {
        userId: 'user-1',
        orgId: 'default',
        profile: '# User Profile',
      },
      update: { profile: '# User Profile' },
    })
  })

  it('falls back to raw agent-scoped reads and writes when the DB still has agent_config_id but the Prisma client no longer exposes that unique key', async () => {
    vi.resetModules()
    const {
      readUserProfile,
      upsertUserProfile,
      resetUserProfileStorageScopeCacheForTests,
    } = await import('@/lib/db/user-profiles')
    if (!userProfileModel) throw new Error('UserProfile model missing from Prisma.dmmf')
    ;(userProfileModel as any).fields = userProfileModel.fields.filter((field) => field.name !== 'agentConfigId')
    ;(userProfileModel as any).uniqueFields = [['orgId', 'userId']]
    resetUserProfileStorageScopeCacheForTests()
    const db = makeDb({ hasAgentConfigColumn: true, prismaSupportsAgentConfig: false })

    const readRow = await readUserProfile(db as any, {
      orgId: 'default',
      agentConfigId: 'agent-j1b',
      userId: 'user-1',
    })

    expect(readRow?.agentConfigId).toBe('agent-j1b')
    expect(db.$queryRaw).toHaveBeenCalledTimes(2)

    resetUserProfileStorageScopeCacheForTests()
    db.$queryRaw.mockClear()

    const writtenRow = await upsertUserProfile(db as any, {
      orgId: 'default',
      agentConfigId: 'agent-j1b',
      userId: 'user-1',
      patch: { profile: '# User Profile' },
    })

    expect(writtenRow.agentConfigId).toBe('agent-j1b')
    expect(db.userProfile.upsert).not.toHaveBeenCalled()
    expect(db.$queryRaw).toHaveBeenCalled()
  })
})

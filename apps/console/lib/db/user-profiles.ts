import { randomUUID } from 'node:crypto'
import type { PrismaClient, UserProfile } from '@prisma/client'
import { Prisma } from '@prisma/client'

type QueryablePrisma = Pick<PrismaClient, '$queryRaw'> & Partial<Pick<PrismaClient, '$executeRaw'>> & {
  userProfile: {
    findUnique: (args: unknown) => Promise<UserProfile | null>
    findMany: (args: unknown) => Promise<UserProfile[]>
    upsert: (args: unknown) => Promise<UserProfile>
    deleteMany?: (args: unknown) => Promise<{ count: number }>
  }
}

export type UserProfileStorageScope = 'legacy_org_profile' | 'agent_config_profile'

type UserProfilePatch = {
  profile?: string
  sections?: string
  totalChats?: number
  totalCases?: number
  resolvedCases?: number
  escalatedCases?: number
  lastCaseType?: string | null
  firstSeenAt?: Date | null
  lastSeenAt?: Date | null
}

type UserProfileRow = UserProfile & {
  agentConfigId?: string | null
}

let scopePromise: Promise<UserProfileStorageScope> | null = null
let prismaAgentConfigScopeSupported: boolean | null = null

async function detectUserProfileStorageScope(db: QueryablePrisma): Promise<UserProfileStorageScope> {
  if (typeof db.$queryRaw !== 'function') return 'legacy_org_profile'
  if (!scopePromise) {
    scopePromise = db.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'user_profiles'
          and column_name = 'agent_config_id'
      ) as "exists"
    `)
      .then((rows) => (rows[0]?.exists ? 'agent_config_profile' : 'legacy_org_profile'))
      .catch(() => 'legacy_org_profile')
  }
  return scopePromise
}

function supportsAgentConfigScopedPrismaClient(): boolean {
  if (prismaAgentConfigScopeSupported != null) return prismaAgentConfigScopeSupported

  const userProfileModel = Prisma.dmmf?.datamodel?.models?.find((model) => model.name === 'UserProfile')
  const hasAgentConfigField = Boolean(userProfileModel?.fields?.some((field) => field.name === 'agentConfigId'))
  const hasCompoundUnique = Boolean(
    userProfileModel?.uniqueFields?.some((fields) =>
      fields.length === 3 &&
      fields[0] === 'orgId' &&
      fields[1] === 'agentConfigId' &&
      fields[2] === 'userId',
    ),
  )

  prismaAgentConfigScopeSupported = hasAgentConfigField && hasCompoundUnique
  return prismaAgentConfigScopeSupported
}

function normalizedAgentConfigId(agentConfigId?: string | null): string {
  return typeof agentConfigId === 'string' ? agentConfigId : ''
}

function agentConfigIdPredicate(scope: UserProfileStorageScope, agentConfigId?: string | null) {
  if (scope !== 'agent_config_profile') return Prisma.empty
  return Prisma.sql` and agent_config_id = ${normalizedAgentConfigId(agentConfigId)}`
}

function selectColumns(scope: UserProfileStorageScope) {
  const agentConfigIdColumn = scope === 'agent_config_profile'
    ? Prisma.sql`, agent_config_id as "agentConfigId"`
    : Prisma.empty

  return Prisma.sql`
    id,
    "userId",
    "orgId"
    ${agentConfigIdColumn},
    profile,
    sections,
    "totalChats",
    "totalCases",
    "resolvedCases",
    "escalatedCases",
    "lastCaseType",
    "firstSeenAt",
    "lastSeenAt",
    "createdAt",
    "updatedAt"
  `
}

async function readUserProfileRaw(
  db: QueryablePrisma,
  input: { orgId: string; userId: string; agentConfigId?: string | null },
): Promise<UserProfileRow | null> {
  const scope = await detectUserProfileStorageScope(db)
  const rows = await db.$queryRaw<UserProfileRow[]>(Prisma.sql`
    select ${selectColumns(scope)}
    from user_profiles
    where "orgId" = ${input.orgId}
      and "userId" = ${input.userId}
      ${agentConfigIdPredicate(scope, input.agentConfigId)}
    order by "updatedAt" desc
    limit 1
  `)
  return rows[0] ?? null
}

async function upsertUserProfileRaw(
  db: QueryablePrisma,
  scope: UserProfileStorageScope,
  input: {
    orgId: string
    userId: string
    agentConfigId?: string | null
    patch: UserProfilePatch
  },
): Promise<UserProfileRow> {
  const existing = await readUserProfileRaw(db, input)
  const now = new Date()
  const next: UserProfileRow = {
    id: existing?.id ?? randomUUID(),
    userId: input.userId,
    orgId: input.orgId,
    profile: input.patch.profile ?? existing?.profile ?? '',
    sections: input.patch.sections ?? existing?.sections ?? '{}',
    totalChats: input.patch.totalChats ?? existing?.totalChats ?? 0,
    totalCases: input.patch.totalCases ?? existing?.totalCases ?? 0,
    resolvedCases: input.patch.resolvedCases ?? existing?.resolvedCases ?? 0,
    escalatedCases: input.patch.escalatedCases ?? existing?.escalatedCases ?? 0,
    lastCaseType: input.patch.lastCaseType ?? existing?.lastCaseType ?? null,
    firstSeenAt: input.patch.firstSeenAt ?? existing?.firstSeenAt ?? null,
    lastSeenAt: input.patch.lastSeenAt ?? existing?.lastSeenAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    agentConfigId: scope === 'agent_config_profile' ? normalizedAgentConfigId(input.agentConfigId) : '',
  }

  if (scope === 'agent_config_profile') {
    const rows = await db.$queryRaw<UserProfileRow[]>(Prisma.sql`
      insert into user_profiles (
        id,
        "orgId",
        agent_config_id,
        "userId",
        profile,
        sections,
        "totalChats",
        "totalCases",
        "resolvedCases",
        "escalatedCases",
        "lastCaseType",
        "firstSeenAt",
        "lastSeenAt",
        "createdAt",
        "updatedAt"
      )
      values (
        ${next.id},
        ${next.orgId},
        ${next.agentConfigId ?? ''},
        ${next.userId},
        ${next.profile},
        ${next.sections},
        ${next.totalChats},
        ${next.totalCases},
        ${next.resolvedCases},
        ${next.escalatedCases},
        ${next.lastCaseType},
        ${next.firstSeenAt},
        ${next.lastSeenAt},
        ${next.createdAt},
        ${next.updatedAt}
      )
      on conflict ("orgId", agent_config_id, "userId")
      do update set
        profile = excluded.profile,
        sections = excluded.sections,
        "totalChats" = excluded."totalChats",
        "totalCases" = excluded."totalCases",
        "resolvedCases" = excluded."resolvedCases",
        "escalatedCases" = excluded."escalatedCases",
        "lastCaseType" = excluded."lastCaseType",
        "firstSeenAt" = excluded."firstSeenAt",
        "lastSeenAt" = excluded."lastSeenAt",
        "updatedAt" = excluded."updatedAt"
      returning ${selectColumns(scope)}
    `)
    return rows[0]!
  }

  const rows = await db.$queryRaw<UserProfileRow[]>(Prisma.sql`
    insert into user_profiles (
      id,
      "orgId",
      "userId",
      profile,
      sections,
      "totalChats",
      "totalCases",
      "resolvedCases",
      "escalatedCases",
      "lastCaseType",
      "firstSeenAt",
      "lastSeenAt",
      "createdAt",
      "updatedAt"
    )
    values (
      ${next.id},
      ${next.orgId},
      ${next.userId},
      ${next.profile},
      ${next.sections},
      ${next.totalChats},
      ${next.totalCases},
      ${next.resolvedCases},
      ${next.escalatedCases},
      ${next.lastCaseType},
      ${next.firstSeenAt},
      ${next.lastSeenAt},
      ${next.createdAt},
      ${next.updatedAt}
    )
    on conflict ("orgId", "userId")
    do update set
      profile = excluded.profile,
      sections = excluded.sections,
      "totalChats" = excluded."totalChats",
      "totalCases" = excluded."totalCases",
      "resolvedCases" = excluded."resolvedCases",
      "escalatedCases" = excluded."escalatedCases",
      "lastCaseType" = excluded."lastCaseType",
      "firstSeenAt" = excluded."firstSeenAt",
      "lastSeenAt" = excluded."lastSeenAt",
      "updatedAt" = excluded."updatedAt"
    returning ${selectColumns(scope)}
  `)
  return rows[0]!
}

async function deleteUserProfileRaw(
  db: QueryablePrisma,
  scope: UserProfileStorageScope,
  input: { orgId: string; userId: string; agentConfigId?: string | null },
): Promise<number> {
  if (typeof db.$executeRaw !== 'function') {
    throw new Error('deleteUserProfile requires Prisma $executeRaw for raw scoped deletes')
  }

  if (scope === 'agent_config_profile') {
    return Number(await db.$executeRaw(Prisma.sql`
      delete from user_profiles
      where "orgId" = ${input.orgId}
        and "userId" = ${input.userId}
        and agent_config_id = ${normalizedAgentConfigId(input.agentConfigId)}
    `))
  }

  return Number(await db.$executeRaw(Prisma.sql`
    delete from user_profiles
    where "orgId" = ${input.orgId}
      and "userId" = ${input.userId}
  `))
}

export async function getUserProfileStorageScope(db: QueryablePrisma): Promise<UserProfileStorageScope> {
  return detectUserProfileStorageScope(db)
}

export async function readUserProfile(
  db: QueryablePrisma,
  input: { orgId: string; userId: string; agentConfigId?: string | null },
): Promise<UserProfileRow | null> {
  const scope = await detectUserProfileStorageScope(db)
  if (scope === 'agent_config_profile') {
    if (!supportsAgentConfigScopedPrismaClient()) {
      return readUserProfileRaw(db, input)
    }
    try {
      return await db.userProfile.findUnique({
        where: {
          orgId_agentConfigId_userId: {
            orgId: input.orgId,
            agentConfigId: normalizedAgentConfigId(input.agentConfigId),
            userId: input.userId,
          },
        },
      }) as UserProfileRow | null
    } catch {
      return readUserProfileRaw(db, input)
    }
  }

  try {
    return await db.userProfile.findUnique({
      where: { orgId_userId: { orgId: input.orgId, userId: input.userId } },
    }) as UserProfile | null
  } catch {
    return readUserProfileRaw(db, input)
  }
}

export async function listUserProfilesByKeys(
  db: QueryablePrisma,
  input: { orgId: string; userIds: string[]; agentConfigId?: string | null },
): Promise<UserProfileRow[]> {
  if (input.userIds.length === 0) return []

  const scope = await detectUserProfileStorageScope(db)
  if (scope === 'legacy_org_profile') {
    return db.userProfile.findMany({
      where: { orgId: input.orgId, userId: { in: input.userIds } },
      select: { userId: true, profile: true, updatedAt: true },
    }) as Promise<UserProfileRow[]>
  }

  return db.$queryRaw<UserProfileRow[]>(Prisma.sql`
    select ${selectColumns(scope)}
    from user_profiles
    where "orgId" = ${input.orgId}
      and "userId" in (${Prisma.join(input.userIds)})
      ${agentConfigIdPredicate(scope, input.agentConfigId)}
    order by "updatedAt" desc
  `)
}

export async function upsertUserProfile(
  db: QueryablePrisma,
  input: {
    orgId: string
    userId: string
    agentConfigId?: string | null
    patch: UserProfilePatch
  },
): Promise<UserProfileRow> {
  const scope = await detectUserProfileStorageScope(db)
  if (scope === 'agent_config_profile') {
    if (!supportsAgentConfigScopedPrismaClient()) {
      return upsertUserProfileRaw(db, scope, input)
    }
    try {
      return await db.userProfile.upsert({
        where: {
          orgId_agentConfigId_userId: {
            orgId: input.orgId,
            agentConfigId: normalizedAgentConfigId(input.agentConfigId),
            userId: input.userId,
          },
        },
        create: {
          userId: input.userId,
          orgId: input.orgId,
          agentConfigId: normalizedAgentConfigId(input.agentConfigId),
          ...input.patch,
        },
        update: input.patch,
      }) as UserProfileRow
    } catch {
      return upsertUserProfileRaw(db, scope, input)
    }
  }

  try {
    return await db.userProfile.upsert({
      where: { orgId_userId: { orgId: input.orgId, userId: input.userId } },
      create: { userId: input.userId, orgId: input.orgId, ...input.patch },
      update: input.patch,
    }) as UserProfile
  } catch {
    return upsertUserProfileRaw(db, scope, input)
  }
}

export async function deleteUserProfile(
  db: QueryablePrisma,
  input: { orgId: string; userId: string; agentConfigId?: string | null },
): Promise<number> {
  const scope = await detectUserProfileStorageScope(db)
  if (scope === 'agent_config_profile') {
    if (!supportsAgentConfigScopedPrismaClient()) {
      return deleteUserProfileRaw(db, scope, input)
    }
    try {
      const result = await db.userProfile.deleteMany?.({
        where: {
          orgId: input.orgId,
          agentConfigId: normalizedAgentConfigId(input.agentConfigId),
          userId: input.userId,
        },
      })
      if (result) return result.count
    } catch {
      return deleteUserProfileRaw(db, scope, input)
    }
    return deleteUserProfileRaw(db, scope, input)
  }

  try {
    const result = await db.userProfile.deleteMany?.({
      where: { orgId: input.orgId, userId: input.userId },
    })
    if (result) return result.count
  } catch {
    return deleteUserProfileRaw(db, scope, input)
  }
  return deleteUserProfileRaw(db, scope, input)
}

export function resetUserProfileStorageScopeCacheForTests(): void {
  scopePromise = null
  prismaAgentConfigScopeSupported = null
}

// apps/console/lib/livechat/config-store.ts
// Reads LiveChatConfig from channel_bindings. TTL cache keyed by (agentConfigId).
// Scoped by agentConfigId (not orgId + agentName).

import { prisma } from '@intera/shared/prisma'
import type { LiveChatConfig } from './types'

interface CacheEntry {
  config: LiveChatConfig
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = 30_000
const FAMILY_LINEAGE_DEPTH_LIMIT = 16

function cacheKey(agentConfigId: string): string {
  return agentConfigId
}

function hasRequiredLiveChatCredentials(config: Pick<LiveChatConfig, 'botAccessToken' | 'licenseId'>): boolean {
  return Boolean(config.botAccessToken.trim() && config.licenseId.trim())
}

export function invalidateLiveChatConfig(agentConfigId: string): void {
  cache.delete(cacheKey(agentConfigId))
}

type AgentConfigLineageRow = {
  id: string
  parentId: string | null
}

function hydrateFromChannelBinding(row: {
  orgId?: string | null
  agentConfigId: string
  enabled: boolean
  credentials: string
  botAccessToken?: string | null
  licenseId?: string | null
}): LiveChatConfig {
  let creds: Record<string, unknown> = {}
  try { creds = JSON.parse(row.credentials) } catch { /* keep empty */ }

  const config: LiveChatConfig = {
    orgId: row.orgId ?? row.agentConfigId,
    botAccessToken: (row.botAccessToken ?? (creds.botAccessToken as string) ?? '') as string,
    licenseId: (row.licenseId ?? (creds.licenseId as string) ?? '') as string,
    webhookSecret: creds.webhookSecret as string | undefined,
    region: creds.region as string | undefined,
    authType: creds.authType as LiveChatConfig['authType'] | undefined,
    accountId: creds.accountId as string | undefined,
    agentAccountId: creds.agentAccountId as string | undefined,
    showSkillStatus: (creds.showSkillStatus as boolean) ?? true,
    enabled: row.enabled,
    transferGroupId: creds.transferGroupId as number | undefined,
    transferMessage: creds.transferMessage as string | undefined,
  }

  if (config.enabled && !hasRequiredLiveChatCredentials(config)) {
    return { ...config, enabled: false }
  }

  return config
}

export async function getLiveChatConfig(
  agentConfigId: string,
): Promise<LiveChatConfig | null> {
  const key = cacheKey(agentConfigId)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.config

  try {
    const cbRow = await prisma.channelBinding.findFirst({
      where: { agentConfigId, channel: 'livechat' },
    })

    if (cbRow && cbRow.enabled) {
      const config = hydrateFromChannelBinding({
        agentConfigId: cbRow.agentConfigId,
        enabled: cbRow.enabled,
        credentials: cbRow.credentials,
        botAccessToken: cbRow.botAccessToken,
        licenseId: cbRow.licenseId,
      })
      cache.set(key, { config, expiresAt: Date.now() + TTL_MS })
      return config
    }

    return null
  } catch (err) {
    console.error('[LiveChat] Failed to load config:', err)
    return null
  }
}

export async function resolveLiveChatFamilyAnchorId(agentConfigId: string): Promise<string> {
  try {
    let current = await prisma.agentConfig.findUnique({
      where: { id: agentConfigId },
      select: { id: true, parentId: true },
    }) as AgentConfigLineageRow | null
    if (!current) return agentConfigId

    const seen = new Set<string>([current.id])
    let depth = 0

    while (current.parentId && depth < FAMILY_LINEAGE_DEPTH_LIMIT) {
      const parent = await prisma.agentConfig.findUnique({
        where: { id: current.parentId },
        select: { id: true, parentId: true },
      }) as AgentConfigLineageRow | null
      if (!parent || seen.has(parent.id)) break
      current = parent
      seen.add(parent.id)
      depth += 1
    }

    return current.id
  } catch (err) {
    console.error('[LiveChat] Failed to resolve family anchor:', err)
    return agentConfigId
  }
}

export async function getLiveChatConfigForFamily(
  agentConfigId: string,
): Promise<LiveChatConfig | null> {
  const familyAnchorId = await resolveLiveChatFamilyAnchorId(agentConfigId)
  const candidateIds = familyAnchorId === agentConfigId
    ? [familyAnchorId]
    : [familyAnchorId, agentConfigId]

  for (const candidateId of candidateIds) {
    const config = await getLiveChatConfig(candidateId)
    if (config) return config
  }

  return null
}

export async function resolveLiveChatAgentConfigIdForOrg(orgId: string): Promise<string | null> {
  try {
    const agent = await prisma.agentConfig.findFirst({
      where: {
        orgId,
        isActive: true,
        channelBindings: {
          some: {
            channel: 'livechat',
            enabled: true,
          },
        },
      },
      orderBy: [
        { updatedAt: 'desc' },
        { id: 'asc' },
      ],
      select: { id: true },
    })

    return agent?.id ?? null
  } catch (err) {
    console.error('[LiveChat] Failed to resolve org-scoped binding:', err)
    return null
  }
}

export async function getLiveChatConfigForOrg(
  orgId: string,
): Promise<{ agentConfigId: string; config: LiveChatConfig } | null> {
  const agentConfigId = await resolveLiveChatAgentConfigIdForOrg(orgId)
  if (!agentConfigId) return null

  const config = await getLiveChatConfigForFamily(agentConfigId)
  if (!config) return null

  return { agentConfigId, config }
}

export async function upsertLiveChatConfig(
  agentConfigId: string,
  data: Omit<LiveChatConfig, 'orgId'>,
): Promise<void> {
  const credentials = JSON.stringify({
    webhookSecret: data.webhookSecret,
    region: data.region,
    authType: data.authType,
    accountId: data.accountId,
    agentAccountId: data.agentAccountId,
    showSkillStatus: data.showSkillStatus,
    transferGroupId: data.transferGroupId,
    transferMessage: data.transferMessage,
  })

  // Upsert channel_bindings row by agentConfigId + channel
  const existing = await prisma.channelBinding.findFirst({
    where: { agentConfigId, channel: 'livechat' },
  })

  if (existing) {
    await prisma.channelBinding.update({
      where: { id: existing.id },
      data: {
        enabled: data.enabled,
        botAccessToken: data.botAccessToken,
        licenseId: data.licenseId,
        credentials,
      },
    })
  } else {
    await prisma.channelBinding.create({
      data: {
        agentConfigId,
        channel: 'livechat',
        enabled: data.enabled,
        botAccessToken: data.botAccessToken,
        licenseId: data.licenseId,
        credentials,
      },
    })
  }

  invalidateLiveChatConfig(agentConfigId)
}

export async function upsertLiveChatConfigForFamily(
  agentConfigId: string,
  data: Omit<LiveChatConfig, 'orgId'>,
): Promise<string> {
  const familyAnchorId = await resolveLiveChatFamilyAnchorId(agentConfigId)
  await upsertLiveChatConfig(familyAnchorId, data)
  if (familyAnchorId !== agentConfigId) invalidateLiveChatConfig(agentConfigId)
  return familyAnchorId
}

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

function cacheKey(agentConfigId: string): string {
  return agentConfigId
}

export function invalidateLiveChatConfig(agentConfigId: string): void {
  cache.delete(cacheKey(agentConfigId))
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

  return {
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

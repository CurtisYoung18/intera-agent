// apps/console/lib/livechat/config-store.ts
// Reads LiveChatConfig from channel_bindings. TTL cache keyed by (orgId, agentName?).

import { prisma } from '@intera/shared/prisma'
import type { LiveChatConfig } from './types'

interface CacheEntry {
  config: LiveChatConfig
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = 30_000

function cacheKey(orgId: string, agentName?: string | null): string {
  return agentName ? `${orgId}:${agentName}` : orgId
}

export function invalidateLiveChatConfig(orgId: string, agentName?: string | null): void {
  cache.delete(cacheKey(orgId, agentName))
  // Also invalidate org-level cache entries when per-agent changes
  if (agentName) cache.delete(orgId)
}

function hydrateFromChannelBinding(row: {
  orgId: string
  enabled: boolean
  credentials: string
  botAccessToken?: string | null
  licenseId?: string | null
}): LiveChatConfig {
  let creds: Record<string, unknown> = {}
  try { creds = JSON.parse(row.credentials) } catch { /* keep empty */ }

  return {
    orgId: row.orgId,
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
  orgId: string,
  agentName?: string | null,
  fallbackToOrgDefault = true,
): Promise<LiveChatConfig | null> {
  const key = cacheKey(orgId, agentName)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.config

  try {
    // 1. Per-agent binding (when agentName provided)
    if (agentName) {
      const cbRow = await prisma.channelBinding.findFirst({
        where: { orgId, channel: 'livechat', agentName },
      })
      if (cbRow) {
        const config = hydrateFromChannelBinding({
          orgId: cbRow.orgId,
          enabled: cbRow.enabled,
          credentials: cbRow.credentials,
          botAccessToken: cbRow.botAccessToken,
          licenseId: cbRow.licenseId,
        })
        cache.set(key, { config, expiresAt: Date.now() + TTL_MS })
        return config
      }
      // Strict mode: no per-agent binding → null, never fall back
      if (!fallbackToOrgDefault) return null
    }

    // 2. Org-default binding (agent_name IS NULL)
    const cbRow = await prisma.channelBinding.findFirst({
      where: { orgId, channel: 'livechat', agentName: null },
    })

    if (cbRow && cbRow.enabled) {
      const config = hydrateFromChannelBinding({
        orgId: cbRow.orgId,
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
  orgId: string,
  data: Omit<LiveChatConfig, 'orgId'>,
  agentName?: string | null,
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

  // Upsert channel_bindings row
  const existing = await prisma.channelBinding.findFirst({
    where: { orgId, channel: 'livechat', agentName: agentName ?? null },
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
        orgId,
        agentName: agentName ?? null,
        channel: 'livechat',
        enabled: data.enabled,
        botAccessToken: data.botAccessToken,
        licenseId: data.licenseId,
        credentials,
      },
    })
  }

  invalidateLiveChatConfig(orgId, agentName)
}

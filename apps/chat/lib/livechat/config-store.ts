// apps/chat/lib/livechat/config-store.ts
// Reads LiveChatConfig from Prisma with a 30-second TTL cache.

import { prisma } from '@intera/shared/prisma'
import type { LiveChatConfig } from './types'

interface CacheEntry {
  config: LiveChatConfig
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = 30_000

export function invalidateLiveChatConfig(vendorId: string): void {
  cache.delete(vendorId)
}

export async function getLiveChatConfig(vendorId: string): Promise<LiveChatConfig | null> {
  const cached = cache.get(vendorId)
  if (cached && cached.expiresAt > Date.now()) return cached.config

  try {
    const row = await prisma.liveChatConfig.findUnique({ where: { vendorId } })
    if (!row || !row.enabled) return null

    const config: LiveChatConfig = {
      vendorId: vendorId,
      botAccessToken: row.botAccessToken,
      licenseId: row.licenseId,
      webhookSecret: row.webhookSecret ?? undefined,
      region: row.region ?? undefined,
      authType: (row.authType as LiveChatConfig['authType']) ?? undefined,
      accountId: row.accountId ?? undefined,
      agentAccountId: row.agentAccountId ?? undefined,
      showSkillStatus: row.showSkillStatus,
      enabled: row.enabled,
    }
    cache.set(vendorId, { config, expiresAt: Date.now() + TTL_MS })
    return config
  } catch (err) {
    console.error('[LiveChat] Failed to load config:', err)
    return null
  }
}

export async function upsertLiveChatConfig(
  vendorId: string,
  data: Omit<LiveChatConfig, 'vendorId'>,
): Promise<void> {
  await prisma.liveChatConfig.upsert({
    where: { vendorId },
    update: data,
    create: { vendorId, ...data },
  })
  invalidateLiveChatConfig(vendorId)
}

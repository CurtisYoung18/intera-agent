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

export function invalidateLiveChatConfig(customerId: string): void {
  cache.delete(customerId)
}

export async function getLiveChatConfig(customerId: string): Promise<LiveChatConfig | null> {
  const cached = cache.get(customerId)
  if (cached && cached.expiresAt > Date.now()) return cached.config

  try {
    const row = await prisma.liveChatConfig.findUnique({ where: { customerId } })
    if (!row || !row.enabled) return null

    const config: LiveChatConfig = {
      customerId: row.customerId,
      botAccessToken: row.botAccessToken,
      licenseId: row.licenseId,
      showSkillStatus: row.showSkillStatus,
      enabled: row.enabled,
    }
    cache.set(customerId, { config, expiresAt: Date.now() + TTL_MS })
    return config
  } catch (err) {
    console.error('[LiveChat] Failed to load config:', err)
    return null
  }
}

export async function upsertLiveChatConfig(
  customerId: string,
  data: Omit<LiveChatConfig, 'customerId'>,
): Promise<void> {
  await prisma.liveChatConfig.upsert({
    where: { customerId },
    update: data,
    create: { customerId, ...data },
  })
  invalidateLiveChatConfig(customerId)
}

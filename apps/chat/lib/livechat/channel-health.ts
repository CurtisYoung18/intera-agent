// apps/chat/lib/livechat/channel-health.ts
// Monitors LiveChat token health and reports status to Console.

import { prisma } from '@intera/shared/prisma'

export type HealthStatus = 'healthy' | 'token_expired' | 'rate_limited' | 'unreachable'

export async function markChannelUnhealthy(
  customerId: string,
  channel: string,
  status: HealthStatus,
  error?: string,
): Promise<void> {
  await prisma.channelHealth.upsert({
    where: { customerId_channel: { customerId, channel } },
    update: { status, lastError: error, lastChecked: new Date() },
    create: {
      customerId,
      channel,
      status,
      lastError: error,
      lastChecked: new Date(),
    },
  })
}

export async function markChannelHealthy(customerId: string, channel: string): Promise<void> {
  await prisma.channelHealth.upsert({
    where: { customerId_channel: { customerId, channel } },
    update: { status: 'healthy', lastError: null, lastChecked: new Date() },
    create: {
      customerId,
      channel: 'livechat',
      status: 'healthy' as HealthStatus,
      lastChecked: new Date(),
    },
  })
}

export async function getChannelHealth(customerId: string, channel: string): Promise<{
  status: HealthStatus
  lastChecked: Date
  lastError: string | null
} | null> {
  const row = await prisma.channelHealth.findUnique({
    where: { customerId_channel: { customerId, channel } },
  })
  if (!row) return null
  return { status: row.status as HealthStatus, lastChecked: row.lastChecked, lastError: row.lastError }
}

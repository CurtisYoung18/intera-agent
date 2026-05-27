// apps/chat/lib/livechat/webhook-dedup.ts
// Webhook idempotency — prevents duplicate event processing on LiveChat retry.

import { prisma } from '@intera/shared/prisma'

export async function isDuplicateWebhook(eventId: string): Promise<boolean> {
  const result = await prisma.webhookEvent.create({
    data: { id: eventId, platform: 'livechat', processedAt: new Date() },
  }).catch((err: unknown) => {
    if ((err as { code?: string })?.code === 'P2002') return null
    throw err
  })
  return result === null
}

export async function pruneOldWebhookEvents(days = 30): Promise<void> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  await prisma.webhookEvent.deleteMany({ where: { processedAt: { lt: cutoff } } })
}

// apps/chat/lib/livechat/retry-queue.ts
// Failed bridge events are enqueued for retry with exponential backoff.

import { prisma } from '@intera/shared/prisma'
import { getLiveChatConfig } from './config-store'
import { handleIncomingEvent } from './bridge'
import type { IncomingEvent } from './types'

const MAX_RETRIES = 4
const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000] // 30s, 2m, 10m, 30m

setInterval(() => {
  processRetryQueue().catch(err => console.error('[RetryQueue] cron error:', err))
}, 30_000)

export async function enqueueRetry(
  chatId: string,
  customerId: string,
  userId: string,
  event: IncomingEvent,
  error: string,
): Promise<void> {
  try {
    await prisma.liveChatPendingEvent.create({
      data: {
        chatId,
        customerId,
        payload: { userId, event } as never,
        attempt: 0,
        lastError: error,
        nextRetryAt: new Date(Date.now() + BACKOFF_MS[0]),
      },
    })
  } catch (err) {
    console.error('[RetryQueue] Failed to enqueue:', err)
  }
}

export async function processRetryQueue(): Promise<number> {
  const now = new Date()
  const items = await prisma.liveChatPendingEvent.findMany({
    where: { nextRetryAt: { lte: now }, attempt: { lt: MAX_RETRIES } },
    orderBy: { nextRetryAt: 'asc' },
    take: 10,
  })

  let processed = 0
  for (const item of items) {
    try {
      const config = await getLiveChatConfig(item.customerId)
      if (!config?.enabled) {
        await prisma.liveChatPendingEvent.delete({ where: { id: item.id } })
        continue
      }

      const payload = item.payload as Record<string, unknown>
      const userId = payload.userId as string
      const event = payload.event as IncomingEvent

      await handleIncomingEvent(item.chatId, item.customerId, userId, event, config)
      await prisma.liveChatPendingEvent.delete({ where: { id: item.id } })
      processed++
    } catch (err) {
      const nextAttempt = item.attempt + 1
      const errMsg = err instanceof Error ? err.message : String(err)

      if (nextAttempt >= MAX_RETRIES) {
        console.error(`[RetryQueue] Dead letter: ${item.id}, error: ${errMsg}`)
        await prisma.liveChatPendingEvent.update({
          where: { id: item.id },
          data: { attempt: nextAttempt, lastError: errMsg },
        })
      } else {
        await prisma.liveChatPendingEvent.update({
          where: { id: item.id },
          data: {
            attempt: nextAttempt,
            lastError: errMsg,
            nextRetryAt: new Date(Date.now() + BACKOFF_MS[nextAttempt]!),
          },
        })
      }
    }
  }
  return processed
}

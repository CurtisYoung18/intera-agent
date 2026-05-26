// apps/chat/lib/livechat/session-store.ts
// Manages LiveChatSession rows in Prisma.
// chatId is the LiveChat chat_id — globally unique per conversation.

import { prisma } from '@intera/shared/prisma'
import { Prisma } from '@prisma/client'
import type { BridgeSession, BridgeState } from './types'

export async function getSession(chatId: string): Promise<BridgeSession | null> {
  try {
    const row = await prisma.liveChatSession.findUnique({ where: { chatId } })
    if (!row) return null
    return {
      chatId: row.chatId,
      customerId: row.customerId,
      userId: row.userId,
      caseId: row.caseId,
      state: row.state as BridgeState,
      textBuffer: row.textBuffer,
    }
  } catch (err) {
    console.error('[LiveChat] getSession failed:', err)
    return null
  }
}

export async function upsertSession(session: BridgeSession): Promise<void> {
  await prisma.liveChatSession.upsert({
    where: { chatId: session.chatId },
    update: {
      customerId: session.customerId,
      userId: session.userId,
      caseId: session.caseId,
      state: session.state,
      textBuffer: session.textBuffer,
    },
    create: {
      chatId: session.chatId,
      customerId: session.customerId,
      userId: session.userId,
      caseId: session.caseId,
      state: session.state,
      textBuffer: session.textBuffer,
    },
  })
}

export async function updateSessionState(chatId: string, state: BridgeState): Promise<void> {
  try {
    await prisma.liveChatSession.update({
      where: { chatId },
      data: { state },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return
    }
    throw err
  }
}

export async function appendTextBuffer(chatId: string, delta: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE livechat_sessions SET "textBuffer" = "textBuffer" || ${delta} WHERE "chatId" = ${chatId}
  `
}

/** Returns the buffered text and resets the buffer to empty. */
export async function flushTextBuffer(chatId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ textBuffer: string }>>`
      SELECT "textBuffer" FROM livechat_sessions WHERE "chatId" = ${chatId} FOR UPDATE
    `
    const text = rows[0]?.textBuffer ?? ''
    if (text) {
      await tx.$executeRaw`
        UPDATE livechat_sessions SET "textBuffer" = '' WHERE "chatId" = ${chatId}
      `
    }
    return text
  })
}

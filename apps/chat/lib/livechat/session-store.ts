// apps/chat/lib/livechat/session-store.ts
// Manages LiveChatSession rows in Prisma.
// chatId is the LiveChat chat_id — globally unique per conversation.

import { prisma } from '@intera/shared/prisma'
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
  await prisma.liveChatSession.update({
    where: { chatId },
    data: { state },
  })
}

export async function appendTextBuffer(chatId: string, delta: string): Promise<void> {
  const current = await prisma.liveChatSession.findUnique({
    where: { chatId },
    select: { textBuffer: true },
  })
  await prisma.liveChatSession.update({
    where: { chatId },
    data: { textBuffer: (current?.textBuffer ?? '') + delta },
  })
}

/** Returns the buffered text and resets the buffer to empty. */
export async function flushTextBuffer(chatId: string): Promise<string> {
  const row = await prisma.liveChatSession.findUnique({
    where: { chatId },
    select: { textBuffer: true },
  })
  const text = row?.textBuffer ?? ''
  if (text) {
    await prisma.liveChatSession.update({
      where: { chatId },
      data: { textBuffer: '' },
    })
  }
  return text
}

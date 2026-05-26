// apps/chat/lib/livechat/session-store.ts
// Manages Bridge session state via ExternalConversation.
// externalChatId is the LiveChat chat_id — globally unique per conversation,
// scoped by platform='livechat'.

import { prisma } from '@intera/shared/prisma'
import { Prisma } from '@prisma/client'
import type { BridgeState } from './types'

export interface BridgeSessionRow {
  chatId: string
  customerId: string
  userId: string
  caseId: string
  state: BridgeState
  textBuffer: string
}

const PLATFORM = 'livechat'

function toRow(chatId: string, customerId: string, userId: string, caseId: string, state: BridgeState, textBuffer: string): BridgeSessionRow {
  return { chatId, customerId, userId, caseId, state, textBuffer }
}

export async function getSession(chatId: string): Promise<BridgeSessionRow | null> {
  try {
    const row = await prisma.externalConversation.findUnique({
      where: { platform_externalChatId: { platform: PLATFORM, externalChatId: chatId } },
    })
    if (!row) return null
    return toRow(
      row.externalChatId,
      row.customerId,
      (row.metadata as Record<string, unknown> | null)?.userId as string ?? 'anonymous',
      row.internalCaseId ?? '',
      (row.bridgeState as BridgeState) ?? 'idle',
      row.textBuffer,
    )
  } catch (err) {
    console.error('[LiveChat] getSession failed:', err)
    return null
  }
}

export async function upsertSession(session: BridgeSessionRow): Promise<void> {
  await prisma.externalConversation.upsert({
    where: { platform_externalChatId: { platform: PLATFORM, externalChatId: session.chatId } },
    update: {
      customerId: session.customerId,
      internalCaseId: session.caseId,
      bridgeState: session.state,
      textBuffer: session.textBuffer,
      metadata: { userId: session.userId },
    },
    create: {
      platform: PLATFORM,
      externalChatId: session.chatId,
      customerId: session.customerId,
      internalCaseId: session.caseId,
      bridgeState: session.state,
      textBuffer: session.textBuffer,
      status: 'active',
      metadata: { userId: session.userId },
    },
  })
}

export async function updateSessionState(chatId: string, state: BridgeState): Promise<void> {
  try {
    await prisma.externalConversation.update({
      where: { platform_externalChatId: { platform: PLATFORM, externalChatId: chatId } },
      data: { bridgeState: state },
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
    UPDATE external_conversations
    SET "textBuffer" = "textBuffer" || ${delta}
    WHERE "platform" = ${PLATFORM} AND "externalChatId" = ${chatId}
  `
}

/** Returns the buffered text and resets the buffer to empty. */
export async function flushTextBuffer(chatId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ textBuffer: string }>>`
      SELECT "textBuffer" FROM external_conversations
      WHERE "platform" = ${PLATFORM} AND "externalChatId" = ${chatId}
      FOR UPDATE
    `
    const text = rows[0]?.textBuffer ?? ''
    if (text) {
      await tx.$executeRaw`
        UPDATE external_conversations SET "textBuffer" = ''
        WHERE "platform" = ${PLATFORM} AND "externalChatId" = ${chatId}
      `
    }
    return text
  })
}

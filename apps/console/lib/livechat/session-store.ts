// apps/chat/lib/livechat/session-store.ts
// Manages Bridge session state via ExternalConversation.
// externalChatId is the LiveChat chat_id — globally unique per conversation,
// scoped by platform='livechat'.

import { prisma } from '@intera/shared/prisma'
import { Prisma } from '@prisma/client'
import type { BridgeState } from './types'
import { decodeLivechatTextBuffer, encodeLivechatTextBuffer } from './text-buffer-codec'

export interface BridgeSessionRow {
  chatId: string
  orgId: string
  userId: string
  caseId: string
  agentConfigId?: string
  state: BridgeState
  textBuffer: string
}

const PLATFORM = 'livechat'

function toRow(chatId: string, orgId: string, userId: string, caseId: string, agentConfigId: string | undefined, state: BridgeState, textBuffer: string): BridgeSessionRow {
  return { chatId, orgId, userId, caseId, agentConfigId, state, textBuffer }
}

export async function getSession(chatId: string): Promise<BridgeSessionRow | null> {
  try {
    const row = await prisma.externalConversation.findUnique({
      where: { platform_externalChatId: { platform: PLATFORM, externalChatId: chatId } },
    })
    if (!row) return null
    return toRow(
      row.externalChatId,
      row.orgId,
      (row.metadata as Record<string, unknown> | null)?.userId as string ?? 'anonymous',
      row.internalCaseId ?? '',
      (row.metadata as Record<string, unknown> | null)?.agentConfigId as string | undefined,
      (row.bridgeState as BridgeState) ?? 'idle',
      decodeLivechatTextBuffer(row.textBuffer),
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
      orgId: session.orgId,
      internalCaseId: session.caseId,
      status: 'active',
      bridgeState: session.state,
      textBuffer: encodeLivechatTextBuffer(session.textBuffer),
      metadata: {
        userId: session.userId,
        ...(session.agentConfigId ? { agentConfigId: session.agentConfigId } : {}),
      },
    },
    create: {
      platform: PLATFORM,
      externalChatId: session.chatId,
      orgId: session.orgId,
      internalCaseId: session.caseId,
      bridgeState: session.state,
      textBuffer: encodeLivechatTextBuffer(session.textBuffer),
      status: 'active',
      metadata: {
        userId: session.userId,
        ...(session.agentConfigId ? { agentConfigId: session.agentConfigId } : {}),
      },
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
  await prisma.$transaction(async (tx) => {
    const row = await tx.externalConversation.findUnique({
      where: { platform_externalChatId: { platform: PLATFORM, externalChatId: chatId } },
      select: { textBuffer: true },
    })
    if (!row) return
    const nextBuffer = decodeLivechatTextBuffer(row.textBuffer) + delta
    await tx.externalConversation.update({
      where: { platform_externalChatId: { platform: PLATFORM, externalChatId: chatId } },
      data: { textBuffer: encodeLivechatTextBuffer(nextBuffer) },
    })
  })
}

export async function closeSession(chatId: string, reason: string): Promise<void> {
  try {
    await prisma.externalConversation.update({
      where: { platform_externalChatId: { platform: PLATFORM, externalChatId: chatId } },
      data: { status: 'archived', bridgeState: 'idle' },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return
    }
    throw err
  }
}

/** Rotates the internal case binding while keeping the external chat alive. */
export async function rotateSessionCase(chatId: string, nextCaseId: string): Promise<void> {
  try {
    await prisma.externalConversation.update({
      where: { platform_externalChatId: { platform: PLATFORM, externalChatId: chatId } },
      data: {
        internalCaseId: nextCaseId,
        bridgeState: 'idle',
        textBuffer: '',
        status: 'active',
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return
    }
    throw err
  }
}

/** Returns the buffered text and resets the buffer to empty. */
export async function flushTextBuffer(chatId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.externalConversation.findUnique({
      where: { platform_externalChatId: { platform: PLATFORM, externalChatId: chatId } },
      select: { textBuffer: true },
    })
    const text = decodeLivechatTextBuffer(row?.textBuffer ?? '')
    if (row?.textBuffer) {
      await tx.externalConversation.update({
        where: { platform_externalChatId: { platform: PLATFORM, externalChatId: chatId } },
        data: { textBuffer: '' },
      })
    }
    return text
  })
}

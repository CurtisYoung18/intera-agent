// Recompute all UserProfile stats from live DB (used by appendToUserProfile + compact route).

import type { PrismaClient } from '@prisma/client'

export interface ProfileStats {
  totalChats: number
  totalCases: number
  resolvedCases: number
  escalatedCases: number
  lastCaseType: string | null
  firstSeenAt: Date | null
  lastSeenAt: Date | null
}

/**
 * Recompute profile stats for a given profile key by scanning all cases
 * belonging to the identity. The key maps to:
 *   `user:<id>` → userId match
 *   `chat:<id>` → chatId match
 * Falls back to empty stats on error.
 */
export async function recomputeProfileStats(
  prisma: PrismaClient,
  profileKeyStr: string,
  orgId?: string,
  agentConfigId?: string,
): Promise<ProfileStats> {
  const empty: ProfileStats = {
    totalChats: 0, totalCases: 0, resolvedCases: 0, escalatedCases: 0,
    lastCaseType: null, firstSeenAt: null, lastSeenAt: null,
  }

  try {
    const isUser = profileKeyStr.startsWith('user:')
    const isChat = profileKeyStr.startsWith('chat:')
    const rawId = profileKeyStr.slice(5) // after 'user:' or 'chat:'

    if (!isUser && !isChat) return empty

    const agentScopedCaseIds = agentConfigId
      ? (await (prisma as any).procedureRun.findMany({
          where: {
            agentConfigId,
            ...(orgId ? { orgId } : {}),
          },
          select: { caseId: true },
        })).map((run: { caseId: string }) => run.caseId)
      : null

    if (agentScopedCaseIds && agentScopedCaseIds.length === 0) return empty

    const where = {
      ...(isUser ? { userId: rawId } : { chatId: rawId }),
      ...(orgId ? { orgId } : {}),
      ...(agentScopedCaseIds ? { id: { in: agentScopedCaseIds } } : {}),
    }

    const cases = await (prisma as any).case.findMany({
      where,
      select: { id: true, status: true, chatId: true, type: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    if (cases.length === 0) return empty

    const chatSet = new Set<string>()
    for (const c of cases) {
      if (c.chatId) chatSet.add(c.chatId)
    }

    return {
      totalChats: chatSet.size,
      totalCases: cases.length,
      resolvedCases: cases.filter((c: any) => c.status === 'resolved').length,
      escalatedCases: cases.filter((c: any) => c.status === 'escalated').length,
      lastCaseType: cases[0]?.type ?? null,
      firstSeenAt: cases[cases.length - 1]?.createdAt ?? null,
      lastSeenAt: cases[0]?.createdAt ?? null,
    }
  } catch {
    return empty
  }
}

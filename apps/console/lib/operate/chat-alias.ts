import type { RepoForOrg } from '@/lib/db/repo-for-org'

export interface ResolvedChatAlias {
  requestedChatId: string
  resolvedChatId: string
  externalChatId?: string
  matchedBy: 'internal' | 'external' | 'none'
}

export async function resolveChatAlias(
  repo: RepoForOrg,
  requestedChatId: string,
): Promise<ResolvedChatAlias> {
  const internalCases = await repo.raw.case.findMany({
    where: { orgId: repo.orgId, chatId: requestedChatId },
    select: { id: true },
    take: 1,
  })
  if (internalCases.length > 0) {
    return {
      requestedChatId,
      resolvedChatId: requestedChatId,
      matchedBy: 'internal',
    }
  }

  const external = await repo.externalConversation.findFirst({
    where: { platform: 'livechat', externalChatId: requestedChatId },
    select: { externalChatId: true, internalCaseId: true },
  })
  if (!external?.internalCaseId) {
    return {
      requestedChatId,
      resolvedChatId: requestedChatId,
      matchedBy: 'none',
    }
  }

  const linkedCase = await repo.raw.case.findFirst({
    where: { orgId: repo.orgId, id: external.internalCaseId },
    select: { chatId: true },
  })
  if (!linkedCase?.chatId) {
    return {
      requestedChatId,
      resolvedChatId: requestedChatId,
      externalChatId: external.externalChatId,
      matchedBy: 'none',
    }
  }

  return {
    requestedChatId,
    resolvedChatId: linkedCase.chatId,
    externalChatId: external.externalChatId,
    matchedBy: 'external',
  }
}

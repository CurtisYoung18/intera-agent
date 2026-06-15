// DELETE /api/chats/[chatId] — Removes every case in a chat session.
// Migrated to defineRoute + repoForOrg (Wave 1 G1/G2/G3).

import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

export const DELETE = defineRoute<void, { chatId: string }>({
  method: 'DELETE',
  async handler({ params, repo, audit }) {
    const decoded = decodeURIComponent(params.chatId)

    const cases = await repo.case.findMany({
      where: { chatId: decoded },
      select: { id: true },
    })

    const caseIds: string[] = cases.map((c: { id: string }) => c.id)

    if (caseIds.length === 0) {
      throw new NotFoundError('Chat not found')
    }

    // Clean up dependents via raw prisma (belt-and-suspenders with onDelete: Cascade)
    await repo.raw.humanTask.deleteMany({ where: { orgId: repo.orgId, chatId: decoded } })
    await repo.raw.actionTrace.deleteMany({ where: { orgId: repo.orgId, chatId: decoded } })
    await repo.raw.message.deleteMany({ where: { orgId: repo.orgId, chatId: decoded } })
    await repo.raw.chatMemory.deleteMany({ where: { orgId: repo.orgId, chatId: decoded } })
    await repo.case.deleteMany({ where: { id: { in: caseIds } } })

    await audit({
      action: 'chat.delete',
      target: `chat:${decoded}`,
      before: { caseIds },
    })

    return apiOk({ ok: true, deleted: caseIds.length })
  },
})

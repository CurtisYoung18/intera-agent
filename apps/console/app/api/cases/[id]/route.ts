// GET + DELETE /api/cases/[id] — Case detail and deletion.
// Migrated to defineRoute + repoForOrg (Wave 1 G1/G2/G3).

import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { z } from 'zod'

const paramsSchema = z.object({ id: z.string().min(1) })

export const GET = defineRoute<void, { id: string }>({
  method: 'GET',
  async handler({ params, repo }) {
    const c = await repo.case.findFirst({
      where: { id: params.id },
    })

    if (!c) throw new NotFoundError('ProcedureRun not found')

    // Fetch related data via raw prisma (these models aren't org-scoped)
    const [memory, humanTasks, msgCount, traceCount] = await Promise.all([
      repo.raw.chatMemory.findUnique({ where: { caseId: params.id } }),
      repo.raw.humanTask.findMany({ where: { caseId: params.id }, orderBy: { createdAt: 'desc' } }),
      repo.raw.message.count({ where: { caseId: params.id } }),
      repo.raw.actionTrace.count({ where: { caseId: params.id } }),
    ])

    return apiOk({ case: { ...c, memory, humanTasks, _count: { messages: msgCount, traces: traceCount } } })
  },
})

export const DELETE = defineRoute<void, { id: string }>({
  method: 'DELETE',
  async handler({ params, repo, audit }) {
    const existing = await repo.case.findFirst({
      where: { id: params.id },
    })
    if (!existing) throw new NotFoundError('ProcedureRun not found')

    // Clean up dependents via raw prisma (belt-and-suspenders with onDelete: Cascade)
    await repo.raw.humanTask.deleteMany({ where: { caseId: params.id } })
    await repo.raw.actionTrace.deleteMany({ where: { caseId: params.id } })
    await repo.raw.message.deleteMany({ where: { caseId: params.id } })
    await repo.raw.chatMemory.deleteMany({ where: { caseId: params.id } })
    await repo.case.delete({ where: { id: params.id } })

    await audit({
      action: 'case.delete',
      target: `case:${params.id}`,
      before: { type: (existing as any).type, status: (existing as any).status },
    })

    return apiOk({ ok: true })
  },
})

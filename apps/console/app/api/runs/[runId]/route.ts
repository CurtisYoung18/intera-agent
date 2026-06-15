// GET /api/runs/[runId] — ProcedureRun detail by runId.

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { resolveProcedureRun } from '../_lib'

export const GET = defineRoute<void, { runId: string }>({
  method: 'GET',
  async handler({ params, repo }) {
    const { run, caseData } = await resolveProcedureRun(repo, params.runId)

    const [memory, humanTasks, msgCount, traceCount] = await Promise.all([
      repo.raw.chatMemory.findFirst({ where: { orgId: repo.orgId, runId: run.id } }),
      repo.raw.humanTask.findMany({ where: { orgId: repo.orgId, runId: run.id }, orderBy: { createdAt: 'desc' } }),
      repo.raw.message.count({ where: { orgId: repo.orgId, runId: run.id } }),
      repo.raw.actionTrace.count({ where: { orgId: repo.orgId, runId: run.id } }),
    ])

    return apiOk({
      case: {
        ...caseData,
        id: run.id,
        runId: run.id,
        memory,
        humanTasks,
        _count: { messages: msgCount, traces: traceCount },
      },
    })
  },
})

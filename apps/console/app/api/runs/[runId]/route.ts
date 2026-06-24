// GET /api/runs/[runId] — ProcedureRun detail by runId.

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { resolveProcedureRun } from '../_lib'
import { requireSelectedAgentFromInput } from '@/app/api/_agent-scope'
import { z } from 'zod'

const querySchema = z.object({
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>, { runId: string }>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const { run, caseData } = await resolveProcedureRun(repo, params.runId, requireSelectedAgentFromInput(input))

    const [memory, humanTasks, msgCount, traceCount] = await Promise.all([
      repo.raw.chatMemory.findFirst({ where: { orgId: repo.orgId, runId: run.id } }),
      repo.raw.humanTask.findMany({
        where: {
          orgId: repo.orgId,
          caseId: run.caseId,
          OR: [
            { runId: run.id },
            { runId: null },
          ],
        },
        orderBy: { createdAt: 'desc' },
      }),
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

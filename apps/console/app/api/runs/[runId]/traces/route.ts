// GET /api/runs/[runId]/traces — ProcedureRun trace timeline.

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { resolveProcedureRun } from '../../_lib'
import { requireSelectedAgentFromInput } from '@/app/api/_agent-scope'

const querySchema = z.object({
  limit: z.string().optional().default('100'),
  offset: z.string().optional().default('0'),
  actionType: z.string().optional(),
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>, { runId: string }>({
  method: 'GET',
  parseQuery: true,
  inputSchema: querySchema,
  async handler({ input, params, repo }) {
    const limit = Math.min(parseInt(input.limit), 500)
    const offset = parseInt(input.offset)
    const { run } = await resolveProcedureRun(repo, params.runId, requireSelectedAgentFromInput(input))

    const where: Record<string, unknown> = {
      orgId: repo.orgId,
      OR: [{ runId: run.id }, { caseId: run.caseId }],
    }
    if (input.actionType) where.actionType = input.actionType

    const [traces, total] = await Promise.all([
      repo.raw.actionTrace.findMany({ where, orderBy: { createdAt: 'asc' }, take: limit, skip: offset }),
      repo.raw.actionTrace.count({ where }),
    ])

    return apiOk({
      traces: traces.map(({ caseId: _caseId, ...trace }) => trace),
      total,
    })
  },
})

import { AgentOpsMetricsQuerySchema, type AgentOpsMetricsQuery } from '@intera/shared/contracts/agentops/metrics'
import { apiOk } from '@intera/shared/contracts/envelope'
import { resolveAgentCaseScope } from '@/app/api/_agent-scope'
import { defineRoute } from '@/lib/api/define-route'
import { getAgentOpsMetrics } from '@/lib/agentops/metrics'

interface AgentOpsMetricsParams {
  agentId: string
}

export const GET = defineRoute<AgentOpsMetricsQuery, AgentOpsMetricsParams>({
  method: 'GET',
  inputSchema: AgentOpsMetricsQuerySchema,
  parseQuery: true,
  scope: 'agent',
  handler: async ({ input, params, repo }) => {
    const scope = await resolveAgentCaseScope(repo, params.agentId)
    const metrics = await getAgentOpsMetrics({
      repo,
      agentId: params.agentId,
      scope,
      query: input,
    })

    return apiOk(metrics)
  },
})

import { apiOk } from '@intera/shared/contracts/envelope'
import { defineRoute } from '@/lib/api/define-route'
import {
  agentOpsConfigPilotProposalCreateRequestSchema,
  createAgentOpsDraftProposal,
  type AgentOpsConfigPilotProposalCreateRequest,
} from '@/lib/agentops/proposals'

interface Params {
  agentId: string
}

export const POST = defineRoute<AgentOpsConfigPilotProposalCreateRequest, Params>({
  method: 'POST',
  inputSchema: agentOpsConfigPilotProposalCreateRequestSchema,
  scope: 'agent',
  requireRole: ['owner', 'admin'],
  async handler({ input, params, repo, session, audit }) {
    const result = await createAgentOpsDraftProposal({
      repo,
      session,
      pathAgentId: decodeURIComponent(params.agentId),
      input,
      audit,
    })
    return apiOk(result)
  },
})

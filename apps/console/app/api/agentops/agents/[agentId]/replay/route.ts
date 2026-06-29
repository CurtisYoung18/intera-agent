import {
  AgentOpsReplayRequestSchema,
  type AgentOpsReplayRequest,
} from '@intera/shared/contracts/agentops/replay'
import { apiOk } from '@intera/shared/contracts/envelope'
import type { SavedScenario } from '@intera/shared/contracts/scenarios'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { defineRoute, ForbiddenError, NotFoundError } from '@/lib/api/define-route'
import { buildAgentOpsReplayReceipt } from '@/lib/agentops/replay'
import { getScenario } from '@/lib/scenarios/store'

interface AgentOpsReplayParams {
  agentId: string
}

export const POST = defineRoute<AgentOpsReplayRequest, AgentOpsReplayParams>({
  method: 'POST',
  inputSchema: AgentOpsReplayRequestSchema,
  requireRole: ['owner', 'admin'],
  scope: 'agent',
  async handler({ input, params, repo }) {
    assertLocalDryRunReplayAllowed()

    const agentId = decodeURIComponent(params.agentId)
    const draftAgentConfigId = input.draftAgentConfigId
    await assertAgentInOrg(repo, draftAgentConfigId)
    const scenario = await resolveReplayScenario(input, draftAgentConfigId)
    const receipt = buildAgentOpsReplayReceipt({
      agentId,
      draftAgentConfigId,
      request: input,
      scenario,
    })

    return apiOk(receipt)
  },
})

async function resolveReplayScenario(
  input: AgentOpsReplayRequest,
  draftAgentConfigId: string,
): Promise<SavedScenario | undefined> {
  if (input.source.type !== 'scenario') return undefined

  const scenario = await getScenario(draftAgentConfigId, input.source.name)
  if (!scenario) throw new NotFoundError(`Scenario "${input.source.name}" not found`)
  return scenario
}

function assertLocalDryRunReplayAllowed(): void {
  if (process.env.NODE_ENV !== 'production') return
  throw new ForbiddenError('AgentOps local replay is disabled in production runtime.')
}

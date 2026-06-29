import {
  AgentOpsSimulationRequestSchema,
  type AgentOpsSimulationRequest,
} from '@intera/shared/contracts/agentops/simulation'
import { apiOk } from '@intera/shared/contracts/envelope'
import type { SavedScenario } from '@intera/shared/contracts/scenarios'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { defineRoute, ForbiddenError, NotFoundError } from '@/lib/api/define-route'
import { runAgentOpsSimulation } from '@/lib/agentops/simulation'
import { getScenario } from '@/lib/scenarios/store'

interface AgentOpsSimulationParams {
  agentId: string
}

export const POST = defineRoute<AgentOpsSimulationRequest, AgentOpsSimulationParams>({
  method: 'POST',
  inputSchema: AgentOpsSimulationRequestSchema,
  requireRole: ['owner', 'admin'],
  scope: 'agent',
  async handler({ input, params, repo }) {
    assertLocalSimulationAllowed()

    const agentId = decodeURIComponent(params.agentId)
    const draftAgentConfigId = input.draftAgentConfigId ?? agentId
    await assertAgentInOrg(repo, draftAgentConfigId)
    const scenario = await resolveSimulationScenario(input, draftAgentConfigId)
    const receipt = await runAgentOpsSimulation({
      orgId: repo.orgId,
      agentId,
      request: input,
      scenario,
    })

    return apiOk(receipt)
  },
})

async function resolveSimulationScenario(
  input: AgentOpsSimulationRequest,
  draftAgentConfigId: string,
): Promise<SavedScenario | undefined> {
  if (input.source.type !== 'scenario') return undefined

  const scenario = await getScenario(draftAgentConfigId, input.source.name)
  if (!scenario) throw new NotFoundError(`Scenario "${input.source.name}" not found`)
  return scenario
}

function assertLocalSimulationAllowed(): void {
  if (process.env.NODE_ENV !== 'production') return
  throw new ForbiddenError('AgentOps local runtime simulation is disabled in production runtime.')
}

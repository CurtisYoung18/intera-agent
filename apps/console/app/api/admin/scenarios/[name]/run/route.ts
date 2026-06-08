// POST /api/admin/scenarios/[name]/run — deterministic Scenario receipt runner.

import { z } from 'zod'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiOk } from '@intera/shared/contracts/envelope'
import { scenarioRunRequestSchema } from '@intera/shared/contracts/scenarios'
import { runScenarioHarness } from '@/lib/scenarios/runner'
import { appendScenarioReceipt, getScenario, getScenarioValidationSummary } from '@/lib/scenarios/store'

interface ScenarioParams {
  name: string
}

const postBodySchema = scenarioRunRequestSchema.extend({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
})
type PostInput = z.infer<typeof postBodySchema>

export const POST = defineRoute<PostInput, ScenarioParams>({
  method: 'POST',
  inputSchema: postBodySchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo, audit }) {
    const { agentConfigId, observed } = input
    await assertAgentInOrg(repo, agentConfigId)
    const scenario = await getScenario(agentConfigId, params.name)
    if (!scenario) throw new NotFoundError(`Scenario "${params.name}" not found`)
    const receipt = runScenarioHarness(scenario, observed)
    const savedReceipt = await appendScenarioReceipt(agentConfigId, receipt)
    const validation = await getScenarioValidationSummary(agentConfigId)
    await audit({
      action: 'scenario.run',
      target: `scenario:${scenario.name}`,
      after: { runId: savedReceipt.runId, status: savedReceipt.status },
    })
    return apiOk({ receipt: savedReceipt, validation })
  },
})

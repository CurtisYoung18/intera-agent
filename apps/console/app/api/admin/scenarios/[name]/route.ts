// GET + PUT + DELETE /api/admin/scenarios/[name]

import { z } from 'zod'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiOk } from '@intera/shared/contracts/envelope'
import { scenarioUpdateRequestSchema } from '@intera/shared/contracts/scenarios'
import { deleteScenario, getScenario, updateScenario } from '@/lib/scenarios/store'

interface ScenarioParams {
  name: string
}

const getQuerySchema = z.object({ agentConfigId: z.string().min(1, 'agentConfigId is required') })

export const GET = defineRoute<z.infer<typeof getQuerySchema>, ScenarioParams>({
  method: 'GET',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const { agentConfigId } = input
    await assertAgentInOrg(repo, agentConfigId)
    const scenario = await getScenario(agentConfigId, params.name)
    if (!scenario) throw new NotFoundError(`Scenario "${params.name}" not found`)
    return apiOk({ scenario })
  },
})

const putBodySchema = scenarioUpdateRequestSchema.extend({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
})
type PutInput = z.infer<typeof putBodySchema>

export const PUT = defineRoute<PutInput, ScenarioParams>({
  method: 'PUT',
  inputSchema: putBodySchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo, audit }) {
    const { agentConfigId, ...scenarioInput } = input
    await assertAgentInOrg(repo, agentConfigId)
    const before = await getScenario(agentConfigId, params.name)
    if (!before) throw new NotFoundError(`Scenario "${params.name}" not found`)
    const scenario = await updateScenario(agentConfigId, params.name, scenarioInput)
    if (!scenario) throw new NotFoundError(`Scenario "${params.name}" not found`)
    await audit({
      action: 'scenario.update',
      target: `scenario:${scenario.name}`,
      before: before as Record<string, unknown>,
      after: scenario as Record<string, unknown>,
    })
    return apiOk({ scenario })
  },
})

export const DELETE = defineRoute<z.infer<typeof getQuerySchema>, ScenarioParams>({
  method: 'DELETE',
  inputSchema: getQuerySchema,
  parseQuery: true,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo, audit }) {
    const { agentConfigId } = input
    await assertAgentInOrg(repo, agentConfigId)
    const existing = await getScenario(agentConfigId, params.name)
    if (!existing) throw new NotFoundError(`Scenario "${params.name}" not found`)
    const deleted = await deleteScenario(agentConfigId, params.name)
    if (!deleted) throw new NotFoundError(`Scenario "${params.name}" not found`)
    await audit({ action: 'scenario.delete', target: `scenario:${params.name}`, before: existing as Record<string, unknown> })
    return apiOk({ success: true })
  },
})

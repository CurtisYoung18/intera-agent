// GET + POST /api/admin/scenarios — JSON-backed Scenario Lab first slice.
// Scoped by agentConfigId, with org ownership enforced before store access.

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiCreated, apiOk } from '@intera/shared/contracts/envelope'
import {
  scenarioCreateRequestSchema,
  scenarioValidationSummarySchema,
} from '@intera/shared/contracts/scenarios'
import { listScenarios, saveScenario } from '@/lib/scenarios/store'

const getQuerySchema = z.object({ agentConfigId: z.string().min(1, 'agentConfigId is required') })

export const GET = defineRoute<z.infer<typeof getQuerySchema>>({
  method: 'GET',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, repo }) {
    const { agentConfigId } = input
    await assertAgentInOrg(repo, agentConfigId)
    const result = await listScenarios(agentConfigId)
    const validation = scenarioValidationSummarySchema.parse({
      state: result.validationState,
      changedAt: result.changedAt,
      lastValidatedAt: result.lastValidatedAt,
      lastReceiptId: result.lastReceiptId,
      lastReceiptStatus: result.lastReceiptStatus,
      lastReceiptExecutionMode: result.lastReceiptExecutionMode,
      runtimeValidated: result.runtimeValidated,
      runtimeValidatedAt: result.runtimeValidatedAt,
      lastRuntimeReceiptId: result.lastRuntimeReceiptId,
      overrideRequired: result.overrideRequired,
    })
    return apiOk({
      scenarios: result.scenarios,
      receipts: result.receipts,
      validation,
    })
  },
})

const postBodySchema = scenarioCreateRequestSchema.extend({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
})
type PostInput = z.infer<typeof postBodySchema>

export const POST = defineRoute<PostInput>({
  method: 'POST',
  inputSchema: postBodySchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, repo, audit }) {
    const { agentConfigId, ...scenarioInput } = input
    await assertAgentInOrg(repo, agentConfigId)
    const scenario = await saveScenario(agentConfigId, scenarioInput)
    await audit({ action: 'scenario.upsert', target: `scenario:${scenario.name}`, after: scenario as Record<string, unknown> })
    return apiCreated({ scenario })
  },
})

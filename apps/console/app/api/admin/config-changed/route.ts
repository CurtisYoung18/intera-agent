// POST /api/admin/config-changed — Invalidate AgentConfig cache
// Migrated to defineRoute (G1 contract seam).

import { z } from 'zod'
import { clearConfigCache } from '@/lib/agent/config-cache'
import { defineRoute } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { markScenarioValidationChanged } from '@/lib/scenarios/store'
import { apiOk } from '@intera/shared/contracts/envelope'

const bodySchema = z.object({
  agentConfigId: z.string().min(1).optional(),
  orgId: z.string().optional(),
}).default({})

export const POST = defineRoute<z.infer<typeof bodySchema>>({
  method: 'POST',
  inputSchema: bodySchema,
  async handler({ input, repo }) {
    const agentConfigId = input.agentConfigId
    clearConfigCache(agentConfigId)
    let markedAgentConfigIds: string[] = []
    if (agentConfigId) {
      await assertAgentInOrg(repo, agentConfigId)
      markedAgentConfigIds = [agentConfigId]
    } else {
      const configs = await repo.agentConfig.findMany({ select: { id: true } })
      markedAgentConfigIds = configs.map((config: { id: string }) => config.id)
    }
    await markScenarioValidationChanged(markedAgentConfigIds)
    return apiOk({ success: true, validationMarked: markedAgentConfigIds })
  },
})

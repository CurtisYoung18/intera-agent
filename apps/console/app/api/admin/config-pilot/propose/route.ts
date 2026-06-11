// POST /api/admin/config-pilot/propose

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  configPilotProposeRequestSchema,
  type ConfigPilotProposeRequest,
} from '@/lib/config-pilot/contracts'
import { getConfigPilotContext } from '@/lib/config-pilot/context'
import { proposeConfigPilotChange } from '@/lib/config-pilot/model'
import { persistConfigPilotProposal } from '@/lib/pilot/persistence'

export const POST = defineRoute<ConfigPilotProposeRequest>({
  method: 'POST',
  inputSchema: configPilotProposeRequestSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, repo, session, audit }) {
    const context = await getConfigPilotContext(repo, session, input.agentConfigId)
    const result = await proposeConfigPilotChange(input, context)
    const stored = await persistConfigPilotProposal(repo, session, input, result.proposal, context.draftFingerprint)
    result.proposal.pilotProposalId = stored.id
    result.proposal.baseDraftFingerprint = stored.baseDraftFingerprint
    await audit({
      action: 'configpilot.propose',
      target: `agent_config:${input.agentConfigId}`,
      after: {
        proposalId: result.proposal.id,
        pilotProposalId: stored.id,
        modelUsed: result.modelUsed,
        promptVersion: result.promptVersion,
        targetSurface: result.proposal.targetSurface,
        patchCount: result.proposal.patches.length,
      },
    })
    return apiOk(result)
  },
})

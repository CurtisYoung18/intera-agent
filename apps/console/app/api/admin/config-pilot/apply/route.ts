// POST /api/admin/config-pilot/apply

import { defineRoute } from '@/lib/api/define-route'
import {
  configPilotApplyRequestSchema,
  type ConfigPilotApplyRequest,
} from '@/lib/config-pilot/contracts'
import { applyConfigPilotProposalEnvelope } from '@/lib/config-pilot/apply'
import { applyAcceptedPilotProposal } from '@/lib/pilot/persistence'
import { apiOk } from '@intera/shared/contracts/envelope'

export const POST = defineRoute<ConfigPilotApplyRequest>({
  method: 'POST',
  inputSchema: configPilotApplyRequestSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, repo, session, audit }) {
    if (input.proposal.pilotProposalId) {
      const result = await applyAcceptedPilotProposal(repo, session, audit, input.proposal.pilotProposalId)
      if (result.apply) return apiOk(result.apply)
      return apiOk({
        appliedPatches: [],
        draftAgentConfigId: result.proposal.appliedDraftAgentConfigId ?? input.agentConfigId,
        createdDraft: false,
        validation: {
          state: 'Changed since last validation',
          runtimeValidated: false,
          overrideRequired: true,
        },
        artifacts: { scenarios: [] },
      })
    }
    return applyConfigPilotProposalEnvelope(input, repo, audit)
  },
})

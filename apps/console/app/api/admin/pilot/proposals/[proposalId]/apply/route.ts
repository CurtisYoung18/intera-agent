// POST /api/admin/pilot/proposals/[proposalId]/apply

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotApplyProposalRequestSchema,
  type PilotApplyProposalRequest,
} from '@intera/shared/contracts/pilot'
import { applyAcceptedPilotProposal } from '@/lib/pilot/persistence'

interface Params {
  proposalId: string
}

export const POST = defineRoute<PilotApplyProposalRequest, Params>({
  method: 'POST',
  inputSchema: pilotApplyProposalRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ params, repo, session, audit }) {
    const result = await applyAcceptedPilotProposal(repo, session, audit, params.proposalId)
    return apiOk(result)
  },
})

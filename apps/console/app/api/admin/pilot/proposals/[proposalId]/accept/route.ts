// POST /api/admin/pilot/proposals/[proposalId]/accept

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotAcceptProposalRequestSchema,
  type PilotAcceptProposalRequest,
} from '@intera/shared/contracts/pilot'
import { acceptPilotProposal } from '@/lib/pilot/persistence'

interface Params {
  proposalId: string
}

export const POST = defineRoute<PilotAcceptProposalRequest, Params>({
  method: 'POST',
  inputSchema: pilotAcceptProposalRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, params, repo, session }) {
    const proposal = await acceptPilotProposal(repo, session, params.proposalId, input.reason)
    return apiOk({ proposal })
  },
})

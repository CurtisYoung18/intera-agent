// POST /api/admin/pilot/build-briefs/confirm

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotConfirmBriefRequestSchema,
  type PilotConfirmBriefRequest,
} from '@intera/shared/contracts/pilot'
import { confirmAgentBuildBrief } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotConfirmBriefRequest>({
  method: 'POST',
  inputSchema: pilotConfirmBriefRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const brief = await confirmAgentBuildBrief(repo, session, input)
    return apiOk({ brief })
  },
})

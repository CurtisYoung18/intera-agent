// POST /api/admin/pilot/build-briefs

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotBuildBriefUpsertRequestSchema,
  type PilotBuildBriefUpsertRequest,
} from '@intera/shared/contracts/pilot'
import { upsertAgentBuildBrief } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotBuildBriefUpsertRequest>({
  method: 'POST',
  inputSchema: pilotBuildBriefUpsertRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const brief = await upsertAgentBuildBrief(repo, session, input)
    return apiOk({ brief })
  },
})

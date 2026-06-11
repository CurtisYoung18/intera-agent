// POST /api/admin/pilot/scratch-build-plans

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotCreateScratchBuildPlanRequestSchema,
  type PilotCreateScratchBuildPlanRequest,
} from '@intera/shared/contracts/pilot'
import { createScratchBuildPlan } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotCreateScratchBuildPlanRequest>({
  method: 'POST',
  inputSchema: pilotCreateScratchBuildPlanRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const plan = await createScratchBuildPlan(repo, session, input)
    return apiOk({ plan })
  },
})

// POST /api/admin/pilot/todo-plans/promote

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotPromotePlanningGroupsRequestSchema,
  type PilotPromotePlanningGroupsRequest,
} from '@intera/shared/contracts/pilot'
import { promotePlanningGroupsToTodoPlan } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotPromotePlanningGroupsRequest>({
  method: 'POST',
  inputSchema: pilotPromotePlanningGroupsRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const plan = await promotePlanningGroupsToTodoPlan(repo, session, input)
    return apiOk({ plan })
  },
})

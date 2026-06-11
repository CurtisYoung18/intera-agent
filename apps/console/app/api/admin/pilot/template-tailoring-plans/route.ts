// POST /api/admin/pilot/template-tailoring-plans

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotCreateTemplateTailoringPlanRequestSchema,
  type PilotCreateTemplateTailoringPlanRequest,
} from '@intera/shared/contracts/pilot'
import { createTemplateTailoringPlan } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotCreateTemplateTailoringPlanRequest>({
  method: 'POST',
  inputSchema: pilotCreateTemplateTailoringPlanRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const plan = await createTemplateTailoringPlan(repo, session, input)
    return apiOk({ plan })
  },
})

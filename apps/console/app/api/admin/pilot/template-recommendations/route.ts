// POST /api/admin/pilot/template-recommendations

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotCreateTemplateRecommendationRequestSchema,
  type PilotCreateTemplateRecommendationRequest,
} from '@intera/shared/contracts/pilot'
import { createTemplateRecommendation } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotCreateTemplateRecommendationRequest>({
  method: 'POST',
  inputSchema: pilotCreateTemplateRecommendationRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const recommendation = await createTemplateRecommendation(repo, session, input)
    return apiOk({ recommendation })
  },
})

// POST /api/admin/pilot/handoffs

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotGenerateHandoffRequestSchema,
  type PilotGenerateHandoffRequest,
} from '@intera/shared/contracts/pilot'
import { generatePilotHandoff } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotGenerateHandoffRequest>({
  method: 'POST',
  inputSchema: pilotGenerateHandoffRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const handoff = await generatePilotHandoff(repo, session, input)
    return apiOk({ handoff })
  },
})

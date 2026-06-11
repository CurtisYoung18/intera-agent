// POST /api/admin/pilot/sessions/takeover

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotTakeoverSessionRequestSchema,
  type PilotTakeoverSessionRequest,
} from '@intera/shared/contracts/pilot'
import { takeOverPilotSession } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotTakeoverSessionRequest>({
  method: 'POST',
  inputSchema: pilotTakeoverSessionRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const pilotSession = await takeOverPilotSession(repo, session, input)
    return apiOk({ session: pilotSession })
  },
})

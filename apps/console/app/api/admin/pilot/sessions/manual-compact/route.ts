// POST /api/admin/pilot/sessions/manual-compact

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotManualCompactRequestSchema,
  type PilotManualCompactRequest,
} from '@intera/shared/contracts/pilot'
import { manualCompactPilotSession } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotManualCompactRequest>({
  method: 'POST',
  inputSchema: pilotManualCompactRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const pilotSession = await manualCompactPilotSession(repo, session, input)
    return apiOk({ session: pilotSession })
  },
})

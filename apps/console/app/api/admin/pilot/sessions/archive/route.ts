// POST /api/admin/pilot/sessions/archive

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotArchiveSessionRequestSchema,
  type PilotArchiveSessionRequest,
} from '@intera/shared/contracts/pilot'
import { archivePilotSession } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotArchiveSessionRequest>({
  method: 'POST',
  inputSchema: pilotArchiveSessionRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const pilotSession = await archivePilotSession(repo, session, input)
    return apiOk({ session: pilotSession })
  },
})

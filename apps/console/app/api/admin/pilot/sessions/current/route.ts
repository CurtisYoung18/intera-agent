// GET/POST /api/admin/pilot/sessions/current
// Durable current Pilot session for a draft Agent version.

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotCurrentSessionRequestSchema,
  type PilotCurrentSessionRequest,
} from '@intera/shared/contracts/pilot'
import { getPilotSessionSnapshot } from '@/lib/pilot/persistence'

export const GET = defineRoute<PilotCurrentSessionRequest>({
  method: 'GET',
  inputSchema: pilotCurrentSessionRequestSchema,
  parseQuery: true,
  requireRole: ['owner', 'admin', 'operator'],
  async handler({ input, repo, session }) {
    const snapshot = await getPilotSessionSnapshot(repo, session, input)
    return apiOk(snapshot)
  },
})

export const POST = defineRoute<PilotCurrentSessionRequest>({
  method: 'POST',
  inputSchema: pilotCurrentSessionRequestSchema,
  requireRole: ['owner', 'admin', 'operator'],
  async handler({ input, repo, session }) {
    const snapshot = await getPilotSessionSnapshot(repo, session, input)
    return apiOk(snapshot)
  },
})

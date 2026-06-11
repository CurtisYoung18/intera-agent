// POST /api/admin/pilot/release-handoffs/generate
// Generates a Release-review handoff from current durable Pilot artifacts.

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotGenerateReleaseHandoffRequestSchema,
  type PilotGenerateReleaseHandoffRequest,
} from '@intera/shared/contracts/pilot'
import { generatePilotReleaseHandoffFromState } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotGenerateReleaseHandoffRequest>({
  method: 'POST',
  inputSchema: pilotGenerateReleaseHandoffRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const handoff = await generatePilotReleaseHandoffFromState(repo, session, input)
    return apiOk({ handoff })
  },
})

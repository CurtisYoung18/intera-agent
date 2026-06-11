// POST /api/admin/pilot/validation/run-scenario
// Runs an existing named Scenario through the Pilot workflow and links the receipt to session state.

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotRunScenarioRequestSchema,
  type PilotRunScenarioRequest,
} from '@intera/shared/contracts/pilot'
import { runPilotScenarioValidation } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotRunScenarioRequest>({
  method: 'POST',
  inputSchema: pilotRunScenarioRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const result = await runPilotScenarioValidation(repo, session, input)
    return apiOk(result)
  },
})

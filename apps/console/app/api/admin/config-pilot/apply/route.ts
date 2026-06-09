// POST /api/admin/config-pilot/apply

import { defineRoute } from '@/lib/api/define-route'
import {
  configPilotApplyRequestSchema,
  type ConfigPilotApplyRequest,
} from '@/lib/config-pilot/contracts'
import { applyConfigPilotProposalEnvelope } from '@/lib/config-pilot/apply'

export const POST = defineRoute<ConfigPilotApplyRequest>({
  method: 'POST',
  inputSchema: configPilotApplyRequestSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, repo, audit }) {
    return applyConfigPilotProposalEnvelope(input, repo, audit)
  },
})

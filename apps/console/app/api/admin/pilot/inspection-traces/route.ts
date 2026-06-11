// POST /api/admin/pilot/inspection-traces

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotRecordInspectionTraceRequestSchema,
  type PilotRecordInspectionTraceRequest,
} from '@intera/shared/contracts/pilot'
import { recordPilotInspectionTrace } from '@/lib/pilot/persistence'

export const POST = defineRoute<PilotRecordInspectionTraceRequest>({
  method: 'POST',
  inputSchema: pilotRecordInspectionTraceRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session }) {
    const trace = await recordPilotInspectionTrace(repo, session, input)
    return apiOk({ trace })
  },
})

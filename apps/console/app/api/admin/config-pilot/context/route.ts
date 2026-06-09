// GET /api/admin/config-pilot/context?agentConfigId=...

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  configPilotContextQuerySchema,
  type ConfigPilotContextQuery,
} from '@/lib/config-pilot/contracts'
import { getConfigPilotContext } from '@/lib/config-pilot/context'

export const GET = defineRoute<ConfigPilotContextQuery>({
  method: 'GET',
  inputSchema: configPilotContextQuerySchema,
  parseQuery: true,
  async handler({ input, repo, session }) {
    const context = await getConfigPilotContext(repo, session, input.agentConfigId)
    return apiOk(context)
  },
})

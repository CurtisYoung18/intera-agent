// GET /api/admin/livechat/groups — Gated admin route.
// Scoped by agentConfigId from query param.
// Replaces the old orgId + agentName scoping with agentConfigId.

import { NextRequest } from 'next/server'
import { defineRoute } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiOk } from '@intera/shared/contracts/envelope'
import { getLiveChatConfigForFamily } from '@/lib/livechat/config-store'
import { listGroups } from '@/lib/livechat/livechat-api'

export async function GET(request: NextRequest) {
  const agentConfigId = request.nextUrl.searchParams.get('agentConfigId')

  return defineRoute({
    method: 'GET',
    async handler({ repo }) {
      if (!agentConfigId) {
        return apiOk({ groups: [], error: 'agentConfigId query param is required', code: 'missing_param' })
      }

      await assertAgentInOrg(repo, agentConfigId)

      try {
        const config = await getLiveChatConfigForFamily(agentConfigId)
        if (!config) {
          return apiOk({ groups: [] })
        }

        const groups = await listGroups(
          config.botAccessToken,
          config.licenseId,
          config.region,
          config.authType,
          config.accountId,
        )
        return apiOk({ groups })
      } catch (err) {
        const msg = String((err as Error)?.message ?? String(err) ?? '').toLowerCase()
        const status =
          (err as { status?: number })?.status ??
          (err as { statusCode?: number })?.statusCode

        if (status === 401) return apiOk({ groups: [], error: 'credentials', code: 'credentials' })
        if (status === 403) return apiOk({ groups: [], error: 'permission', code: 'permission' })
        if (msg.includes('region') || msg.includes('fra') || msg.includes('dal'))
          return apiOk({ groups: [], error: 'region', code: 'region' })
        if (msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network') || msg.includes('timeout') || msg.includes('abort'))
          return apiOk({ groups: [], error: 'network', code: 'network' })

        return apiOk({ groups: [], error: 'unknown', code: 'unknown' })
      }
    },
  })(request)
}

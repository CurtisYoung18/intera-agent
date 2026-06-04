// GET /api/admin/livechat/groups — Gated admin route.
// orgId is STRICTLY from the verified session.

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { listGroups } from '@/lib/livechat/livechat-api'

export const GET = defineRoute({
  method: 'GET',
  async handler({ session }) {
    try {
      const config = await getLiveChatConfig(session.orgId)
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
})

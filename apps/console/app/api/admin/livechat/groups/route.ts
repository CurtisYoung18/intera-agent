// GET /api/admin/livechat/groups — Gated admin route.
// orgId is STRICTLY from the verified session.
// Optional ?agentName=<name> scopes to a specific agent's LiveChat config.

import { NextRequest } from 'next/server'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { listGroups } from '@/lib/livechat/livechat-api'

export async function GET(request: NextRequest) {
  const agentName = request.nextUrl.searchParams.get('agentName') ?? undefined

  return defineRoute({
    method: 'GET',
    async handler({ session, repo }) {
      // Resolve agentName to verify agent exists (optional)
      let resolvedName: string | null = null
      if (agentName) {
        const agentConfig = await repo.agentConfig.findFirst({
          where: { name: agentName, isActive: true },
          select: { name: true },
        })
        resolvedName = agentConfig?.name ?? null
      }

      try {
        const config = await getLiveChatConfig(session.orgId, resolvedName)
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

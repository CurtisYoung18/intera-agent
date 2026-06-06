// POST /api/admin/config-changed — Invalidate AgentConfig cache
// Migrated to defineRoute (G1 contract seam).

import { clearConfigCache } from '@/lib/agent/config-cache'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

export const POST = defineRoute({
  method: 'POST',
  async handler({ input }) {
    const body = input as Record<string, unknown> | undefined
    const agentConfigId = (body?.agentConfigId as string) || undefined
    clearConfigCache(agentConfigId)
    return apiOk({ success: true })
  },
})

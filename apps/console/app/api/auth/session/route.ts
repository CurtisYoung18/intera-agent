// GET /api/auth/session — Current Console session
// Migrated to defineRoute (G1 contract seam).

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

export const GET = defineRoute({
  method: 'GET',
  async handler({ session, repo }) {
    const org = await repo.raw.organization.findUnique({ where: { id: session.orgId } })
    return apiOk({
      isAuthenticated: true,
      userId: session.userId,
      role: session.role,
      canSwitch: true,
      orgId: session.orgId,
      customerName: org?.name ?? null,
    })
  },
})

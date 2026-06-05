// GET /api/auth/memberships — List org memberships for current user
// Migrated to defineRoute (G1 contract seam).

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

export const GET = defineRoute({
  method: 'GET',
  async handler({ session, repo }) {
    const orgs = await repo.raw.membership.findMany({
      where: { userId: session.userId },
      include: { org: { select: { id: true, name: true } } },
    })
    return apiOk({ orgs: orgs.map(m => ({ orgId: m.orgId, role: m.role, name: m.org.name })) })
  },
})

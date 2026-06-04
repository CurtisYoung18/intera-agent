// GET /api/admin/customers — List customers the current user can access
// Auto-seeds built-in customers on first access.
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

const BUILT_IN_CUSTOMERS = [
  { id: 'default', name: 'Test', password: null },
  { id: 'demo', name: 'Demo', password: null },
]

export const GET = defineRoute({
  method: 'GET',
  async handler({ session, repo }) {
    // Auto-seed/update built-in customers
    for (const c of BUILT_IN_CUSTOMERS) {
      await repo.raw.organization.upsert({
        where: { id: c.id },
        update: { name: c.name, password: c.password },
        create: c,
      })
    }

    // Only return orgs the current user has a membership in
    const memberships = await repo.raw.membership.findMany({
      where: { userId: session.userId },
      include: { org: { select: { id: true, name: true, password: true, apiKey: true } } },
      orderBy: { org: { name: 'asc' } },
    })

    return apiOk({
      customers: memberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        hasPassword: m.org.password != null,
        hasApiKey: m.org.apiKey != null,
      })),
    })
  },
})

// Legacy Policy admin API retired by Foundation Reset F4.
// Use /api/admin/hooks instead.

import { defineRoute, RouteError } from '@/lib/api/define-route'

function policiesGone(): never {
  throw new RouteError('not_found', 'Policies are retired. Use /api/admin/hooks.', undefined, 410)
}

export const GET = defineRoute({
  method: 'GET',
  async handler() {
    return policiesGone()
  },
})

export const PUT = defineRoute({
  method: 'PUT',
  requireRole: ['admin', 'owner'],
  async handler() {
    return policiesGone()
  },
})

export const DELETE = defineRoute({
  method: 'DELETE',
  requireRole: ['admin', 'owner'],
  async handler() {
    return policiesGone()
  },
})

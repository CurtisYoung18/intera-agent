// DELETE /api/admin/api-keys/[id] — Revoke an API key
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

export const DELETE = defineRoute<void, { id: string }>({
  method: 'DELETE',
  requireRole: ['admin', 'owner'],
  async handler({ params, repo, audit }) {
    const key = await repo.apiKey.findUnique({ where: { id: params.id } })
    if (!key) throw new NotFoundError('Key not found')

    await repo.apiKey.update({
      where: { id: params.id },
      data: { revokedAt: new Date() },
    })
    await audit({ action: 'api_key.revoke', target: `api_key:${key.id}`, before: { prefix: key.prefix, name: key.name } as Record<string, unknown> })
    return apiOk({ ok: true })
  },
})

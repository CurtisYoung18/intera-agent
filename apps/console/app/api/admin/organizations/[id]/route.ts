// GET + PUT /api/admin/organizations/[id] — Organization settings
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute, NotFoundError, RouteError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

export const GET = defineRoute<void, { id: string }>({
  method: 'GET',
  async handler({ params, repo }) {
    const org = await repo.raw.organization.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    })
    if (!org) throw new NotFoundError('Organization not found')
    return apiOk({ organization: org })
  },
})

const putSchema = z.object({
  name: z.string().trim().min(1, 'name required').max(100, 'max 100 chars'),
})

export const PUT = defineRoute<z.infer<typeof putSchema>, { id: string }>({
  method: 'PUT',
  inputSchema: putSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo, audit }) {
    const existing = await repo.raw.organization.findUnique({ where: { id: params.id } })
    if (!existing) throw new NotFoundError('Organization not found')

    await repo.raw.organization.update({
      where: { id: params.id },
      data: { name: input.name },
    })
    await audit({ action: 'organization.update', target: `organization:${params.id}`, before: { name: existing.name }, after: { name: input.name } })
    return apiOk({ ok: true })
  },
})

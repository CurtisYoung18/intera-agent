// GET + PUT + DELETE /api/admin/policies/[name]
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping + G3 audit).

import { z } from 'zod'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

interface PolicyParams { name: string }

export const GET = defineRoute<void, PolicyParams>({
  method: 'GET',
  async handler({ params, repo }) {
    const policy = await repo.policy.findUnique({ where: { orgId_name: { orgId: repo.orgId, name: params.name } } })
    if (!policy) throw new NotFoundError(`Policy "${params.name}" not found`)
    return apiOk({ policy })
  },
})

const updateSchema = z.object({
  name: z.string().optional(), description: z.string().nullable().optional(), hook: z.string().optional(),
  rule: z.union([z.string(), z.record(z.unknown())]).optional(), guardrailConfig: z.union([z.string(), z.record(z.unknown())]).nullable().optional(), enabled: z.boolean().optional(),
})
type UpdateInput = z.infer<typeof updateSchema>

export const PUT = defineRoute<UpdateInput, PolicyParams>({
  method: 'PUT', inputSchema: updateSchema,
  async handler({ input, params, repo, audit }) {
    const existing = await repo.policy.findUnique({ where: { orgId_name: { orgId: repo.orgId, name: params.name } } })
    if (!existing) throw new NotFoundError(`Policy "${params.name}" not found`)
    const data: Record<string, unknown> = {}
    if (input.description !== undefined) data.description = input.description
    if (input.hook !== undefined) data.hook = input.hook
    if (input.enabled !== undefined) data.enabled = input.enabled
    if (input.name !== undefined) data.name = input.name
    if (input.rule !== undefined) data.rule = typeof input.rule === 'string' ? input.rule : JSON.stringify(input.rule)
    if (input.guardrailConfig !== undefined) data.guardrailConfig = input.guardrailConfig === null ? null : (typeof input.guardrailConfig === 'string' ? input.guardrailConfig : JSON.stringify(input.guardrailConfig))
    const policy = await repo.policy.update({ where: { orgId_name: { orgId: repo.orgId, name: params.name } }, data })
    await audit({ action: 'policy.update', target: `policy:${policy.name}`, before: existing as Record<string, unknown>, after: policy as Record<string, unknown> })
    return apiOk({ policy })
  },
})

export const DELETE = defineRoute<void, PolicyParams>({
  method: 'DELETE',
  async handler({ params, repo, audit }) {
    const existing = await repo.policy.findUnique({ where: { orgId_name: { orgId: repo.orgId, name: params.name } } })
    if (!existing) throw new NotFoundError(`Policy "${params.name}" not found`)
    await repo.policy.delete({ where: { orgId_name: { orgId: repo.orgId, name: params.name } } })
    await audit({ action: 'policy.delete', target: `policy:${params.name}`, before: existing as Record<string, unknown> })
    return apiOk({ success: true })
  },
})

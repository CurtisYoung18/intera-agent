// GET + PUT + DELETE /api/admin/policies/[name]
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping + G3 audit).
// Scoped by agentConfigId (not orgId).

import { z } from 'zod'
import { ConflictError, defineRoute, NotFoundError } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiOk } from '@intera/shared/contracts/envelope'
import { parseGuardrails } from '@intera/shared/contracts/case-types'

interface PolicyParams { name: string }

const getQuerySchema = z.object({ agentConfigId: z.string().min(1, 'agentConfigId is required') })

export const GET = defineRoute<z.infer<typeof getQuerySchema>, PolicyParams>({
  method: 'GET',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const { agentConfigId } = input
    await assertAgentInOrg(repo, agentConfigId)
    const policy = await repo.raw.policy.findUnique({
      where: { agentConfigId_name: { agentConfigId, name: params.name } },
    })
    if (!policy) throw new NotFoundError(`Policy "${params.name}" not found`)
    return apiOk({ policy })
  },
})

const updateSchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  hook: z.string().optional(),
  rule: z.union([z.string(), z.record(z.unknown())]).optional(),
  guardrailConfig: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  enabled: z.boolean().optional(),
})
type UpdateInput = z.infer<typeof updateSchema>

export const PUT = defineRoute<UpdateInput, PolicyParams>({
  method: 'PUT',
  inputSchema: updateSchema,
  async handler({ input, params, repo, audit }) {
    const { agentConfigId, ...fields } = input
    await assertAgentInOrg(repo, agentConfigId)
    const existing = await repo.raw.policy.findUnique({
      where: { agentConfigId_name: { agentConfigId, name: params.name } },
    })
    if (!existing) throw new NotFoundError(`Policy "${params.name}" not found`)
    const data: Record<string, unknown> = {}
    if (fields.description !== undefined) data.description = fields.description
    if (fields.hook !== undefined) data.hook = fields.hook
    if (fields.enabled !== undefined) data.enabled = fields.enabled
    if (fields.name !== undefined) data.name = fields.name
    if (fields.rule !== undefined) data.rule = typeof fields.rule === 'string' ? fields.rule : JSON.stringify(fields.rule)
    if (fields.guardrailConfig !== undefined) data.guardrailConfig = fields.guardrailConfig === null ? null : (typeof fields.guardrailConfig === 'string' ? fields.guardrailConfig : JSON.stringify(fields.guardrailConfig))
    const policy = await repo.raw.policy.update({
      where: { agentConfigId_name: { agentConfigId, name: params.name } },
      data,
    })
    await audit({ action: 'policy.update', target: `policy:${policy.name}`, before: existing as Record<string, unknown>, after: policy as Record<string, unknown> })
    return apiOk({ policy })
  },
})

export const DELETE = defineRoute<z.infer<typeof getQuerySchema>, PolicyParams>({
  method: 'DELETE',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, params, repo, audit }) {
    const { agentConfigId } = input
    await assertAgentInOrg(repo, agentConfigId)
    const existing = await repo.raw.policy.findUnique({
      where: { agentConfigId_name: { agentConfigId, name: params.name } },
    })
    if (!existing) throw new NotFoundError(`Policy "${params.name}" not found`)
    const caseTypes = await repo.raw.caseType.findMany({
      where: { agentConfigId },
      select: { type: true, displayName: true, guardrails: true },
    })
    const referencingCaseTypes = caseTypes.filter((ct: { guardrails?: string | null }) =>
      parseGuardrails(ct.guardrails).includes(params.name),
    )
    if (referencingCaseTypes.length > 0) {
      const refs = referencingCaseTypes
        .map((ct: { type: string; displayName?: string | null }) => ct.type || ct.displayName || 'unknown')
        .join(', ')
      throw new ConflictError(`Policy "${params.name}" is activated by case type(s): ${refs}`)
    }
    await repo.raw.policy.delete({
      where: { agentConfigId_name: { agentConfigId, name: params.name } },
    })
    await audit({ action: 'policy.delete', target: `policy:${params.name}`, before: existing as Record<string, unknown> })
    return apiOk({ success: true })
  },
})

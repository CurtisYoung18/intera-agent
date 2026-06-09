// GET + PUT + DELETE /api/admin/case-types/[name]
// Migrated to defineRoute (G1 contract seam + G3 audit).
// Scoped by agentConfigId (not orgId).

import { z } from 'zod'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiOk } from '@intera/shared/contracts/envelope'
import { procedureSchema } from '@intera/shared/contracts/case-types'

interface CaseTypeParams { name: string }

const stringifyMaybe = (val: unknown): string => {
  if (typeof val === 'string') return val
  return JSON.stringify(val ?? '')
}

const getQuerySchema = z.object({ agentConfigId: z.string().min(1, 'agentConfigId is required') })

export const GET = defineRoute<z.infer<typeof getQuerySchema>, CaseTypeParams>({
  method: 'GET',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const { agentConfigId } = input
    await assertAgentInOrg(repo, agentConfigId)
    const ct = await repo.raw.caseType.findUnique({
      where: { agentConfigId_type: { agentConfigId, type: params.name } },
    })
    if (!ct) throw new NotFoundError(`Case type "${params.name}" not found`)
    return apiOk({ caseType: ct })
  },
})

const updateSchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
  type: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().nullable().optional(),
  icon: z.string().optional(),
  requiredFacts: z.union([z.string(), z.array(z.string())]).optional(),
  defaultGoal: z.string().optional(),
  escalateOn: z.union([z.string(), z.array(z.string())]).optional(),
  autoCloseConditions: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  enabled: z.boolean().optional(),
  procedure: z.union([z.string(), procedureSchema]).nullable().optional(),
  maxAutoTurns: z.number().optional(),
})
type UpdateInput = z.infer<typeof updateSchema>

export const PUT = defineRoute<UpdateInput, CaseTypeParams>({
  method: 'PUT',
  inputSchema: updateSchema,
  async handler({ input, params, repo, audit }) {
    const { agentConfigId, ...fields } = input
    await assertAgentInOrg(repo, agentConfigId)
    const existing = await repo.raw.caseType.findUnique({
      where: { agentConfigId_type: { agentConfigId, type: params.name } },
    })
    if (!existing) throw new NotFoundError(`Case type "${params.name}" not found`)
    const data: Record<string, unknown> = {}
    const strFields = ['type', 'displayName', 'description', 'icon', 'defaultGoal']
    for (const f of strFields) { const v = (fields as Record<string, unknown>)[f]; if (v !== undefined) data[f] = v }
    if (fields.enabled !== undefined) data.enabled = fields.enabled !== false
    for (const f of ['requiredFacts', 'escalateOn', 'autoCloseConditions']) {
      const v = (fields as Record<string, unknown>)[f]; if (v !== undefined) data[f] = stringifyMaybe(v)
    }
    if (fields.procedure !== undefined) {
      data.procedure = fields.procedure ? stringifyMaybe(fields.procedure) : null
    }
    if (fields.maxAutoTurns !== undefined) data.maxAutoTurns = Math.max(1, Math.min(50, Number(fields.maxAutoTurns) || 10))
    const ct = await repo.raw.caseType.update({
      where: { agentConfigId_type: { agentConfigId, type: params.name } },
      data,
    })
    await audit({ action: 'case_type.update', target: `case_type:${ct.type}`, before: existing as Record<string, unknown>, after: ct as Record<string, unknown> })
    return apiOk({ caseType: ct })
  },
})

export const DELETE = defineRoute<z.infer<typeof getQuerySchema>, CaseTypeParams>({
  method: 'DELETE',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, params, repo, audit }) {
    const { agentConfigId } = input
    await assertAgentInOrg(repo, agentConfigId)
    const existing = await repo.raw.caseType.findUnique({
      where: { agentConfigId_type: { agentConfigId, type: params.name } },
    })
    if (!existing) throw new NotFoundError(`Case type "${params.name}" not found`)
    await repo.raw.caseType.delete({
      where: { agentConfigId_type: { agentConfigId, type: params.name } },
    })
    await audit({ action: 'case_type.delete', target: `case_type:${params.name}`, before: existing as Record<string, unknown> })
    return apiOk({ success: true })
  },
})

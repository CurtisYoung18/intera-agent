// GET + PUT + DELETE /api/admin/case-types/[name]
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping + G3 audit).

import { z } from 'zod'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

interface CaseTypeParams { name: string }

const stringifyMaybe = (val: unknown): string => {
  if (typeof val === 'string') return val
  return JSON.stringify(val ?? '')
}

export const GET = defineRoute<void, CaseTypeParams>({
  method: 'GET',
  async handler({ params, repo }) {
    const ct = await repo.caseType.findUnique({ where: { orgId_type: { orgId: repo.orgId, type: params.name } } })
    if (!ct) throw new NotFoundError(`Case type "${params.name}" not found`)
    return apiOk({ caseType: ct })
  },
})

const updateSchema = z.object({
  type: z.string().optional(), displayName: z.string().optional(), description: z.string().nullable().optional(), icon: z.string().optional(),
  requiredFacts: z.union([z.string(), z.array(z.string())]).optional(), stages: z.union([z.string(), z.array(z.string())]).optional(),
  stageConfigs: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  orchestratorConfig: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  defaultGoal: z.string().optional(), escalateOn: z.union([z.string(), z.array(z.string())]).optional(),
  autoCloseConditions: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  enabled: z.boolean().optional(), requireHumanReview: z.boolean().optional(), executionMode: z.string().optional(),
  sop: z.string().nullable().optional(), sopMaxAutoTurns: z.number().optional(),
})
type UpdateInput = z.infer<typeof updateSchema>

export const PUT = defineRoute<UpdateInput, CaseTypeParams>({
  method: 'PUT', inputSchema: updateSchema,
  async handler({ input, params, repo, audit }) {
    const existing = await repo.caseType.findUnique({ where: { orgId_type: { orgId: repo.orgId, type: params.name } } })
    if (!existing) throw new NotFoundError(`Case type "${params.name}" not found`)
    const data: Record<string, unknown> = {}
    const strFields = ['type', 'displayName', 'description', 'icon', 'defaultGoal']
    for (const f of strFields) { const v = (input as Record<string, unknown>)[f]; if (v !== undefined) data[f] = v }
    if (input.enabled !== undefined) data.enabled = input.enabled !== false
    if (input.requireHumanReview !== undefined) data.requireHumanReview = input.requireHumanReview === true
    for (const f of ['requiredFacts', 'stages', 'escalateOn', 'autoCloseConditions', 'stageConfigs', 'orchestratorConfig']) {
      const v = (input as Record<string, unknown>)[f]; if (v !== undefined) data[f] = stringifyMaybe(v)
    }
    if (input.executionMode !== undefined) data.executionMode = input.executionMode === 'cc' ? 'cc' : 'stage'
    if (input.sop !== undefined) data.sop = input.sop || null
    if (input.sopMaxAutoTurns !== undefined) data.sopMaxAutoTurns = Math.max(1, Math.min(50, Number(input.sopMaxAutoTurns) || 10))
    const ct = await repo.caseType.update({ where: { orgId_type: { orgId: repo.orgId, type: params.name } }, data })
    await audit({ action: 'case_type.update', target: `case_type:${ct.type}`, before: existing as Record<string, unknown>, after: ct as Record<string, unknown> })
    return apiOk({ caseType: ct })
  },
})

export const DELETE = defineRoute<void, CaseTypeParams>({
  method: 'DELETE',
  async handler({ params, repo, audit }) {
    const existing = await repo.caseType.findUnique({ where: { orgId_type: { orgId: repo.orgId, type: params.name } } })
    if (!existing) throw new NotFoundError(`Case type "${params.name}" not found`)
    await repo.caseType.delete({ where: { orgId_type: { orgId: repo.orgId, type: params.name } } })
    await audit({ action: 'case_type.delete', target: `case_type:${params.name}`, before: existing as Record<string, unknown> })
    return apiOk({ success: true })
  },
})

// GET + POST /api/admin/case-types — List and create case types
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping + G3 audit).

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'
import { DEFAULT_CASE_TYPES } from '@intera/shared/defaults'

const stringifyMaybe = (val: unknown): string => {
  if (typeof val === 'string') return val
  return JSON.stringify(val ?? '')
}

export const GET = defineRoute({
  method: 'GET',
  async handler({ repo }) {
    let types = await repo.caseType.findMany({ orderBy: { type: 'asc' } })
    const existingTypes = new Set(types.map((t) => t.type))
    const missing = DEFAULT_CASE_TYPES.filter((ct) => !existingTypes.has(ct.type))
    if (missing.length > 0) {
      await repo.raw.organization.upsert({ where: { id: repo.orgId }, update: {}, create: { id: repo.orgId, name: 'Demo Org' } })
      const { DEFAULT_STAGE_CONFIGS, DEFAULT_ORCHESTRATOR_CONFIG } = await import('@intera/shared/defaults')
      for (const ct of missing) {
        const stageConfigs = (DEFAULT_STAGE_CONFIGS as Record<string, unknown>)[ct.type] || null
        await repo.caseType.create({
          data: { type: ct.type, displayName: ct.displayName, description: ct.description, icon: ct.icon, requiredFacts: ct.requiredFacts, stages: ct.stages, stageConfigs: stageConfigs ? JSON.stringify(stageConfigs) : null, orchestratorConfig: JSON.stringify(DEFAULT_ORCHESTRATOR_CONFIG), defaultGoal: ct.defaultGoal, escalateOn: ct.escalateOn, enabled: ct.enabled ?? true, requireHumanReview: ct.requireHumanReview ?? false },
        })
      }
      types = await repo.caseType.findMany({ orderBy: { type: 'asc' } })
    }
    return apiOk({ types })
  },
})

const createSchema = z.object({
  type: z.string().min(1, 'Type is required'), displayName: z.string().optional(), description: z.string().nullable().optional(),
  icon: z.string().optional().default('\u{1F4CB}'), requiredFacts: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  stages: z.union([z.string(), z.array(z.string())]).optional().default('["created","investigating","resolved"]'),
  stageConfigs: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  orchestratorConfig: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  defaultGoal: z.string().optional().default(''), escalateOn: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  autoCloseConditions: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  enabled: z.boolean().optional().default(true), requireHumanReview: z.boolean().optional().default(false),
  executionMode: z.string().optional().default('stage'), sop: z.string().nullable().optional(), sopMaxAutoTurns: z.number().optional().default(10),
})
type CreateInput = z.infer<typeof createSchema>

export const POST = defineRoute<CreateInput>({
  method: 'POST', inputSchema: createSchema,
  async handler({ input, repo, audit }) {
    await repo.raw.organization.upsert({ where: { id: repo.orgId }, update: {}, create: { id: repo.orgId, name: 'Demo Org' } })
    const ct = await repo.caseType.create({
      data: { type: input.type, displayName: input.displayName || input.type, description: input.description ?? null, icon: input.icon ?? '\u{1F4CB}', requiredFacts: stringifyMaybe(input.requiredFacts), stages: stringifyMaybe(input.stages), stageConfigs: input.stageConfigs ? stringifyMaybe(input.stageConfigs) : null, orchestratorConfig: input.orchestratorConfig ? stringifyMaybe(input.orchestratorConfig) : null, defaultGoal: input.defaultGoal ?? '', escalateOn: stringifyMaybe(input.escalateOn), autoCloseConditions: input.autoCloseConditions ? stringifyMaybe(input.autoCloseConditions) : null, enabled: input.enabled !== false, requireHumanReview: input.requireHumanReview === true, executionMode: input.executionMode === 'cc' ? 'cc' : 'stage', sop: input.sop ?? null, sopMaxAutoTurns: Math.max(1, Math.min(50, Number(input.sopMaxAutoTurns) || 10)) },
    })
    await audit({ action: 'case_type.create', target: `case_type:${ct.type}`, after: ct as Record<string, unknown> })
    return apiCreated({ caseType: ct })
  },
})

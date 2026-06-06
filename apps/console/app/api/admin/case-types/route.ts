// GET + POST /api/admin/case-types — List and create case types
// Migrated to defineRoute (G1 contract seam + G3 audit).
// Scoped by agentConfigId (not orgId).

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'

const stringifyMaybe = (val: unknown): string => {
  if (typeof val === 'string') return val
  return JSON.stringify(val ?? '')
}

const getQuerySchema = z.object({ agentConfigId: z.string().min(1, 'agentConfigId is required') })

export const GET = defineRoute<z.infer<typeof getQuerySchema>>({
  method: 'GET',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, repo }) {
    const { agentConfigId } = input

    const types = await repo.raw.caseType.findMany({
      where: { agentConfigId },
      orderBy: { type: 'asc' },
    })
    return apiOk({ types })
  },
})

const createSchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
  type: z.string().min(1, 'Type is required'),
  displayName: z.string().optional(),
  description: z.string().nullable().optional(),
  icon: z.string().optional().default('\u{1F4CB}'),
  requiredFacts: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  stages: z.union([z.string(), z.array(z.string())]).optional().default('["created","investigating","resolved"]'),
  stageConfigs: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  orchestratorConfig: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  defaultGoal: z.string().optional().default(''),
  escalateOn: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  autoCloseConditions: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  enabled: z.boolean().optional().default(true),
  requireHumanReview: z.boolean().optional().default(false),
  executionMode: z.string().optional().default('stage'),
  sop: z.string().nullable().optional(),
  sopMaxAutoTurns: z.number().optional().default(10),
})
type CreateInput = z.infer<typeof createSchema>

export const POST = defineRoute<CreateInput>({
  method: 'POST',
  inputSchema: createSchema,
  async handler({ input, repo, audit }) {
    const { agentConfigId, ...fields } = input
    const ct = await repo.raw.caseType.create({
      data: {
        agentConfigId,
        type: fields.type,
        displayName: fields.displayName || fields.type,
        description: fields.description ?? null,
        icon: fields.icon ?? '\u{1F4CB}',
        requiredFacts: stringifyMaybe(fields.requiredFacts),
        stages: stringifyMaybe(fields.stages),
        stageConfigs: fields.stageConfigs ? stringifyMaybe(fields.stageConfigs) : null,
        orchestratorConfig: fields.orchestratorConfig ? stringifyMaybe(fields.orchestratorConfig) : null,
        defaultGoal: fields.defaultGoal ?? '',
        escalateOn: stringifyMaybe(fields.escalateOn),
        autoCloseConditions: fields.autoCloseConditions ? stringifyMaybe(fields.autoCloseConditions) : null,
        enabled: fields.enabled !== false,
        requireHumanReview: fields.requireHumanReview === true,
        executionMode: fields.executionMode === 'cc' ? 'cc' : 'stage',
        sop: fields.sop ?? null,
        sopMaxAutoTurns: Math.max(1, Math.min(50, Number(fields.sopMaxAutoTurns) || 10)),
      },
    })
    await audit({ action: 'case_type.create', target: `case_type:${ct.type}`, after: ct as Record<string, unknown> })
    return apiCreated({ caseType: ct })
  },
})

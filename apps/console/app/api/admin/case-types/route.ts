// GET + POST /api/admin/case-types — List and create case types
// Migrated to defineRoute (G1 contract seam + G3 audit).
// Scoped by agentConfigId (not orgId).

import { z } from 'zod'
import { defineRoute, ValidationError } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'
import {
  BUILT_IN_GUARDRAIL_NAMES,
  findOrphanGuardrails,
  parseGuardrails,
  procedureSchema,
} from '@intera/shared/contracts/case-types'

const stringifyMaybe = (val: unknown): string => {
  if (typeof val === 'string') return val
  return JSON.stringify(val ?? '')
}

const normalizeGuardrailInput = (val: string | string[] | undefined): string[] => {
  if (Array.isArray(val)) return val
  return parseGuardrails(val)
}

async function validateGuardrailRefs(
  repo: any,
  agentConfigId: string,
  input: string | string[] | undefined,
): Promise<string[]> {
  const names = normalizeGuardrailInput(input)
  const policies = await repo.raw.policy.findMany({
    where: { agentConfigId },
    select: { name: true },
  })
  const knownNames = [
    ...policies.map((p: { name: string }) => p.name),
    ...BUILT_IN_GUARDRAIL_NAMES,
  ]
  const orphanNames = findOrphanGuardrails(names, knownNames)
  if (orphanNames.length > 0) {
    throw new ValidationError(`Unknown guardrail(s): ${orphanNames.join(', ')}`, {
      guardrails: `Unknown guardrail(s): ${orphanNames.join(', ')}`,
    })
  }
  return names
}

const getQuerySchema = z.object({ agentConfigId: z.string().min(1, 'agentConfigId is required') })

export const GET = defineRoute<z.infer<typeof getQuerySchema>>({
  method: 'GET',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, repo }) {
    const { agentConfigId } = input
    await assertAgentInOrg(repo, agentConfigId)

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
  // ── Procedure refactor (Phase 2, additive) ──
  procedure: z.union([z.string(), procedureSchema]).nullable().optional(),
  guardrails: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  maxAutoTurns: z.number().optional().default(10),
})
type CreateInput = z.infer<typeof createSchema>

export const POST = defineRoute<CreateInput>({
  method: 'POST',
  inputSchema: createSchema,
  async handler({ input, repo, audit }) {
    const { agentConfigId, ...fields } = input
    await assertAgentInOrg(repo, agentConfigId)
    const guardrails = await validateGuardrailRefs(repo, agentConfigId, fields.guardrails)
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
        // A typed Procedure runs the structured single-agent path → store as 'cc'.
        executionMode: fields.procedure ? 'cc' : fields.executionMode === 'cc' ? 'cc' : 'stage',
        sop: fields.sop ?? null,
        sopMaxAutoTurns: Math.max(1, Math.min(50, Number(fields.sopMaxAutoTurns) || 10)),
        procedure: fields.procedure ? stringifyMaybe(fields.procedure) : null,
        guardrails: JSON.stringify(guardrails),
        maxAutoTurns: Math.max(1, Math.min(50, Number(fields.maxAutoTurns) || 10)),
      },
    })
    await audit({ action: 'case_type.create', target: `case_type:${ct.type}`, after: ct as Record<string, unknown> })
    return apiCreated({ caseType: ct })
  },
})

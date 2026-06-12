// GET + POST /api/admin/case-types — List and create case types
// Migrated to defineRoute (G1 contract seam + G3 audit).
// Scoped by agentConfigId (not orgId).

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'
import { procedureDefinitionSchema } from '@intera/shared/contracts/case-types'

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
  defaultGoal: z.string().optional().default(''),
  escalateOn: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  autoCloseConditions: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  enabled: z.boolean().optional().default(true),
  procedure: z.union([z.string(), procedureDefinitionSchema]).nullable().optional(),
  maxAutoTurns: z.number().optional().default(10),
})
type CreateInput = z.infer<typeof createSchema>

export const POST = defineRoute<CreateInput>({
  method: 'POST',
  inputSchema: createSchema,
  async handler({ input, repo, audit }) {
    const { agentConfigId, ...fields } = input
    await assertAgentInOrg(repo, agentConfigId)
    const ct = await repo.raw.caseType.create({
      data: {
        agentConfigId,
        type: fields.type,
        displayName: fields.displayName || fields.type,
        description: fields.description ?? null,
        icon: fields.icon ?? '\u{1F4CB}',
        requiredFacts: stringifyMaybe(fields.requiredFacts),
        defaultGoal: fields.defaultGoal ?? '',
        escalateOn: stringifyMaybe(fields.escalateOn),
        autoCloseConditions: fields.autoCloseConditions ? stringifyMaybe(fields.autoCloseConditions) : null,
        enabled: fields.enabled !== false,
        procedure: fields.procedure ? stringifyMaybe(fields.procedure) : null,
        maxAutoTurns: Math.max(1, Math.min(50, Number(fields.maxAutoTurns) || 10)),
      },
    })
    await audit({ action: 'case_type.create', target: `case_type:${ct.type}`, after: ct as Record<string, unknown> })
    return apiCreated({ caseType: ct })
  },
})

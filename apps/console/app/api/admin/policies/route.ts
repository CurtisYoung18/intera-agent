// GET + POST /api/admin/policies — List and create policies
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping + G3 audit).
// Scoped by agentConfigId (not orgId).

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'

const getQuerySchema = z.object({ agentConfigId: z.string().min(1, 'agentConfigId is required') })

export const GET = defineRoute<z.infer<typeof getQuerySchema>>({
  method: 'GET',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, repo }) {
    const { agentConfigId } = input
    await assertAgentInOrg(repo, agentConfigId)

    const policies = await repo.raw.policy.findMany({
      where: { agentConfigId },
      orderBy: { name: 'asc' },
    })
    return apiOk({ policies })
  },
})

const createSchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullable().optional(),
  hook: z.string().optional().default('preTool'),
  rule: z.union([z.string(), z.record(z.unknown())]).optional().default('{}'),
  guardrailConfig: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  enabled: z.boolean().optional().default(true),
})
type CreateInput = z.infer<typeof createSchema>

export const POST = defineRoute<CreateInput>({
  method: 'POST',
  inputSchema: createSchema,
  async handler({ input, repo, audit }) {
    const { agentConfigId, ...fields } = input
    await assertAgentInOrg(repo, agentConfigId)
    const guardrailConfigStr = fields.guardrailConfig
      ? (typeof fields.guardrailConfig === 'string' ? fields.guardrailConfig : JSON.stringify(fields.guardrailConfig))
      : null
    const policy = await repo.raw.policy.create({
      data: {
        agentConfigId,
        name: fields.name,
        description: fields.description ?? null,
        hook: fields.hook ?? 'preTool',
        rule: typeof fields.rule === 'string' ? fields.rule : JSON.stringify(fields.rule ?? {}),
        guardrailConfig: guardrailConfigStr,
        enabled: fields.enabled ?? true,
      },
    })
    await audit({ action: 'policy.create', target: `policy:${policy.name}`, after: policy as Record<string, unknown> })
    return apiCreated({ policy })
  },
})

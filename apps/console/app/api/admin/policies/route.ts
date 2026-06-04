// GET + POST /api/admin/policies — List and create policies
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping + G3 audit).

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'
import { DEFAULT_POLICIES } from '@intera/shared/defaults'

export const GET = defineRoute({
  method: 'GET',
  async handler({ repo }) {
    let policies = await repo.policy.findMany({ orderBy: { name: 'asc' } })
    const existingNames = new Set(policies.map((p) => p.name))
    const missing = DEFAULT_POLICIES.filter((p) => !existingNames.has(p.name))
    if (missing.length > 0) {
      await repo.raw.organization.upsert({ where: { id: repo.orgId }, update: {}, create: { id: repo.orgId, name: 'Demo Org' } })
      for (const p of missing) {
        await repo.policy.create({ data: { name: p.name, description: p.description, hook: p.hook, rule: p.rule, guardrailConfig: p.guardrailConfig ?? null, enabled: true } })
      }
      policies = await repo.policy.findMany({ orderBy: { name: 'asc' } })
    }
    return apiOk({ policies })
  },
})

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullable().optional(),
  hook: z.string().optional().default('preTool'),
  rule: z.union([z.string(), z.record(z.unknown())]).optional().default('{}'),
  guardrailConfig: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  enabled: z.boolean().optional().default(true),
})
type CreateInput = z.infer<typeof createSchema>

export const POST = defineRoute<CreateInput>({
  method: 'POST', inputSchema: createSchema,
  async handler({ input, repo, audit }) {
    await repo.raw.organization.upsert({ where: { id: repo.orgId }, update: {}, create: { id: repo.orgId, name: 'Demo Org' } })
    const guardrailConfigStr = input.guardrailConfig
      ? (typeof input.guardrailConfig === 'string' ? input.guardrailConfig : JSON.stringify(input.guardrailConfig))
      : null
    const policy = await repo.policy.create({
      data: { name: input.name, description: input.description ?? null, hook: input.hook ?? 'preTool', rule: typeof input.rule === 'string' ? input.rule : JSON.stringify(input.rule ?? {}), guardrailConfig: guardrailConfigStr, enabled: input.enabled ?? true },
    })
    await audit({ action: 'policy.create', target: `policy:${policy.name}`, after: policy as Record<string, unknown> })
    return apiCreated({ policy })
  },
})

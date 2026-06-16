// GET + POST /api/admin/api-keys — List and create API keys
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'
import { generateApiKey } from '@/lib/api-auth'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'

const KEY_SELECT = {
  id: true,
  name: true,
  prefix: true,
  agentConfigId: true,
  lastUsedAt: true,
  createdAt: true,
} as const

export const GET = defineRoute({
  method: 'GET',
  async handler({ repo }) {
    const keys = await repo.apiKey.findMany({
      where: { revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: KEY_SELECT,
    })
    return apiOk({ keys })
  },
})

const createSchema = z.object({
  name: z.string().trim().optional().default('default'),
  agentConfigId: z.string().trim().min(1, 'agentConfigId is required'),
})
type CreateInput = z.infer<typeof createSchema>

export const POST = defineRoute<CreateInput>({
  method: 'POST',
  inputSchema: createSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, session, repo, audit }) {
    await assertAgentInOrg(repo, input.agentConfigId)
    const { plaintext, hash, prefix } = generateApiKey()
    const key = await repo.apiKey.create({
      data: {
        name: input.name,
        hash,
        prefix,
        agentConfigId: input.agentConfigId,
      } as any, // orgId auto-injected by repo proxy at runtime
      select: KEY_SELECT,
    })
    await audit({ action: 'api_key.create', target: `api_key:${key.id}`, after: key as Record<string, unknown> })
    return apiCreated({ key, plaintext })
  },
})

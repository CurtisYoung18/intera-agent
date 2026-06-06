// GET + POST /api/admin/tools — List and create tools
// Migrated to defineRoute (G1 contract seam + G3 RBAC + audit).
// Scoped by agentConfigId (not orgId).

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'
import {
  skillCreateRequestSchema,
  type SkillCreateRequest,
} from '@intera/shared/contracts/tools'
import { SYSTEM_SKILL_NAMES, SPECIAL_SKILL_NAMES, CHANNEL_SKILL_NAMES } from '@/lib/skill-classifications'

const getQuerySchema = z.object({ agentConfigId: z.string().min(1, 'agentConfigId is required') })

// ── GET ──
export const GET = defineRoute<z.infer<typeof getQuerySchema>>({
  method: 'GET',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, repo }) {
    const { agentConfigId } = input

    const tools = await repo.raw.tool.findMany({
      where: { agentConfigId },
      orderBy: { name: 'asc' },
    })

    const enriched = tools.map((t: { name: string; [k: string]: unknown }) => ({
      ...t,
      isSystem: SYSTEM_SKILL_NAMES.has(t.name),
      isChannel: CHANNEL_SKILL_NAMES.has(t.name),
      isSpecial: SPECIAL_SKILL_NAMES.has(t.name),
    }))

    return apiOk({ tools: enriched })
  },
})

// ── POST ──
const postBodySchema = skillCreateRequestSchema.extend({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
})
type PostInput = z.infer<typeof postBodySchema>

export const POST = defineRoute<PostInput>({
  method: 'POST',
  inputSchema: postBodySchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, repo, audit }) {
    const { agentConfigId, ...fields } = input

    const stringifyField = (val: unknown): string | null => {
      if (val === null || val === undefined) return null
      return typeof val === 'string' ? val : JSON.stringify(val)
    }

    const tool = await repo.raw.tool.create({
      data: {
        agentConfigId,
        name: fields.name,
        description: fields.description ?? '',
        inputSchema: stringifyField(fields.inputSchema) ?? '{}',
        outputSchema: stringifyField(fields.outputSchema) ?? '{}',
        mode: fields.mode ?? 'mock',
        endpoint: fields.endpoint ?? null,
        httpMethod: fields.httpMethod ?? 'POST',
        headers: stringifyField(fields.headers),
        timeoutMs: fields.timeoutMs ?? 8000,
        mockFixture: stringifyField(fields.mockFixture),
        guardPhase: fields.guardPhase ?? 'post',
        displayVerb: stringifyField(fields.displayVerb),
        renderHints: stringifyField(fields.renderHints),
        isConcurrencySafe: fields.isConcurrencySafe ?? true,
        enabled: fields.enabled ?? true,
        toolCategory: fields.toolCategory ?? null,
      },
    })

    await audit({ action: 'tool.create', target: `tool:${tool.name}`, after: tool as Record<string, unknown> })

    return apiCreated({ tool })
  },
})

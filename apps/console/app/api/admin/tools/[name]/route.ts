// GET + PUT + DELETE /api/admin/tools/[name]
// Migrated to defineRoute (G1 contract seam + G3 RBAC + audit).
// Scoped by agentConfigId (not orgId).

import { z } from 'zod'
import { defineRoute, ForbiddenError, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  toolUpdateRequestSchema,
  type ToolUpdateRequest,
} from '@intera/shared/contracts/tools'
import { SYSTEM_TOOL_NAMES, SPECIAL_TOOL_NAMES, CHANNEL_TOOL_NAMES } from '@/lib/tool-classifications'

// ── Route params ──
interface ToolParams {
  name: string
}

function isProtected(name: string): boolean {
  return SYSTEM_TOOL_NAMES.has(name) || SPECIAL_TOOL_NAMES.has(name) || CHANNEL_TOOL_NAMES.has(name)
}

function isMutationAllowed(name: string, body: Record<string, unknown>): boolean {
  if (!isProtected(name)) return true
  const keys = Object.keys(body).filter((k) => k !== 'enabled')
  return keys.length === 0
}

// ── GET ──
const getQuerySchema = z.object({ agentConfigId: z.string().min(1, 'agentConfigId is required') })

export const GET = defineRoute<z.infer<typeof getQuerySchema>, ToolParams>({
  method: 'GET',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const { agentConfigId } = input
    const tool = await repo.raw.tool.findUnique({
      where: { agentConfigId_name: { agentConfigId, name: params.name } },
    })
    if (!tool) throw new NotFoundError(`Tool "${params.name}" not found`)
    return apiOk({ tool })
  },
})

// ── PUT ──
const putBodySchema = toolUpdateRequestSchema.extend({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
})
type PutInput = z.infer<typeof putBodySchema>

export const PUT = defineRoute<PutInput, ToolParams>({
  method: 'PUT',
  inputSchema: putBodySchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo, audit }) {
    const { agentConfigId, ...fields } = input

    const existing = await repo.raw.tool.findUnique({
      where: { agentConfigId_name: { agentConfigId, name: params.name } },
    })
    if (!existing) throw new NotFoundError(`Tool "${params.name}" not found`)

    if (!isMutationAllowed(params.name, fields as Record<string, unknown>)) {
      throw new ForbiddenError(
        `Tool "${params.name}" is protected. Only the 'enabled' field can be changed.`,
      )
    }

    const stringifyField = (val: unknown): string | undefined | null => {
      if (val === undefined) return undefined
      if (val === null) return null
      return typeof val === 'string' ? val : JSON.stringify(val)
    }

    const data: Record<string, unknown> = {}
    const strFields = ['name', 'description', 'mode', 'endpoint', 'httpMethod', 'guardPhase', 'toolCategory']
    for (const f of strFields) {
      const v = (fields as Record<string, unknown>)[f]
      if (v !== undefined) data[f] = v
    }
    if (fields.timeoutMs !== undefined) data.timeoutMs = fields.timeoutMs
    if (fields.isConcurrencySafe !== undefined) data.isConcurrencySafe = fields.isConcurrencySafe
    if (fields.enabled !== undefined) data.enabled = fields.enabled
    for (const f of ['inputSchema', 'outputSchema', 'headers', 'mockFixture', 'displayVerb', 'renderHints']) {
      const v = (fields as Record<string, unknown>)[f]
      if (v !== undefined) data[f] = stringifyField(v)
    }

    const tool = await repo.raw.tool.update({
      where: { agentConfigId_name: { agentConfigId, name: params.name } },
      data,
    })

    await audit({ action: 'tool.update', target: `tool:${tool.name}`, before: existing as Record<string, unknown>, after: tool as Record<string, unknown> })

    return apiOk({ tool })
  },
})

// ── DELETE ──
export const DELETE = defineRoute<z.infer<typeof getQuerySchema>, ToolParams>({
  method: 'DELETE',
  inputSchema: getQuerySchema,
  parseQuery: true,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo, audit }) {
    const { agentConfigId } = input
    if (isProtected(params.name)) {
      throw new ForbiddenError(`Cannot delete protected tool "${params.name}"`)
    }
    const existing = await repo.raw.tool.findUnique({
      where: { agentConfigId_name: { agentConfigId, name: params.name } },
    })
    if (!existing) throw new NotFoundError(`Tool "${params.name}" not found`)

    await repo.raw.tool.delete({
      where: { agentConfigId_name: { agentConfigId, name: params.name } },
    })

    await audit({ action: 'tool.delete', target: `tool:${params.name}`, before: existing as Record<string, unknown> })

    return apiOk({ success: true })
  },
})

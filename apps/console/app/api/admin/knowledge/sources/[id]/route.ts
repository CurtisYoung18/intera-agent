// GET + PUT + DELETE /api/admin/knowledge/sources/[id]
// Migrated to defineRoute (G1 contract seam + G3 audit).
// Scoped by agentConfigId (not orgId).

import { z } from 'zod'
import { defineRoute, NotFoundError, ValidationError } from '@/lib/api/define-route'
import { parseKnowledgeSourceGroupIds } from '@/lib/knowledge/source-groups'
import { apiOk } from '@intera/shared/contracts/envelope'

interface KnowledgeSourceParams { id: string }

const stringifyMaybe = (val: unknown): string => {
  if (typeof val === 'string') return val
  return JSON.stringify(val ?? '')
}

const getQuerySchema = z.object({ agentConfigId: z.string().min(1, 'agentConfigId is required') })

export const GET = defineRoute<z.infer<typeof getQuerySchema>, KnowledgeSourceParams>({
  method: 'GET',
  scope: 'agent',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const { agentConfigId } = input
    const source = await repo.raw.knowledgeSource.findFirst({
      where: { id: params.id, agentConfigId },
    })
    if (!source) throw new NotFoundError('Knowledge source not found')
    return apiOk({ source })
  },
})

const updateSchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  groupIds: z.union([z.string(), z.array(z.string())]).optional(),
  dataIds: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  embeddingRate: z.number().optional(),
  topK: z.number().optional(),
  rerankVersion: z.string().nullable().optional(),
  docCorrelation: z.number().nullable().optional(),
  modelControlTopK: z.boolean().optional(),
  caseTypeTag: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
})
type UpdateInput = z.infer<typeof updateSchema>

export const PUT = defineRoute<UpdateInput, KnowledgeSourceParams>({
  method: 'PUT',
  scope: 'agent',
  inputSchema: updateSchema,
  async handler({ input, params, repo, audit }) {
    const { agentConfigId, ...fields } = input
    const { id } = params
    const existing = await repo.raw.knowledgeSource.findFirst({
      where: { id, agentConfigId },
    })
    if (!existing) throw new NotFoundError('Knowledge source not found')
    const updateData: Record<string, unknown> = {}
    if (fields.name !== undefined) updateData.name = fields.name
    if (fields.description !== undefined) updateData.description = fields.description
    if (fields.groupIds !== undefined) {
      const groupIds = parseKnowledgeSourceGroupIds(fields.groupIds)
      if (groupIds.length === 0) {
        throw new ValidationError('Select at least one GPTBots knowledge base before saving this source.', {
          groupIds: 'Select at least one knowledge base',
        })
      }
      updateData.groupIds = stringifyMaybe(groupIds)
    }
    if (fields.dataIds !== undefined) updateData.dataIds = fields.dataIds ? stringifyMaybe(fields.dataIds) : null
    if (fields.embeddingRate !== undefined) updateData.embeddingRate = fields.embeddingRate
    if (fields.topK !== undefined) updateData.topK = fields.topK
    if (fields.rerankVersion !== undefined) updateData.rerankVersion = fields.rerankVersion
    if (fields.docCorrelation !== undefined) updateData.docCorrelation = fields.docCorrelation
    if (fields.modelControlTopK !== undefined) updateData.modelControlTopK = fields.modelControlTopK
    if (fields.caseTypeTag !== undefined) updateData.caseTypeTag = fields.caseTypeTag
    if (fields.enabled !== undefined) updateData.enabled = fields.enabled
    const result = await repo.raw.knowledgeSource.updateMany({
      where: { id, agentConfigId },
      data: updateData,
    })
    if (result.count === 0) throw new NotFoundError('Knowledge source not found')
    const updated = await repo.raw.knowledgeSource.findFirst({ where: { id, agentConfigId } })
    await audit({ action: 'knowledge_source.update', target: `knowledge_source:${id}`, before: existing as Record<string, unknown>, after: updated as Record<string, unknown> })
    return apiOk({ source: updated })
  },
})

export const DELETE = defineRoute<z.infer<typeof getQuerySchema>, KnowledgeSourceParams>({
  method: 'DELETE',
  scope: 'agent',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, params, repo, audit }) {
    const { agentConfigId } = input
    const { id } = params
    const existing = await repo.raw.knowledgeSource.findFirst({
      where: { id, agentConfigId },
    })
    if (!existing) throw new NotFoundError('Knowledge source not found')
    const result = await repo.raw.knowledgeSource.deleteMany({
      where: { id, agentConfigId },
    })
    if (result.count === 0) throw new NotFoundError('Knowledge source not found')
    await audit({ action: 'knowledge_source.delete', target: `knowledge_source:${id}`, before: existing as Record<string, unknown> })
    return apiOk({ ok: true })
  },
})

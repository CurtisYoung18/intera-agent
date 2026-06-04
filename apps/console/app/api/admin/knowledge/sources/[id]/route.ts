// GET + PUT + DELETE /api/admin/knowledge/sources/[id]
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping + G3 audit).

import { z } from 'zod'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

interface KnowledgeSourceParams { id: string }

const stringifyMaybe = (val: unknown): string => {
  if (typeof val === 'string') return val
  return JSON.stringify(val ?? '')
}

export const GET = defineRoute<void, KnowledgeSourceParams>({
  method: 'GET',
  async handler({ params, repo }) {
    const source = await repo.knowledgeSource.findFirst({ where: { id: params.id } })
    if (!source) throw new NotFoundError('Knowledge source not found')
    return apiOk({ source })
  },
})

const updateSchema = z.object({
  name: z.string().optional(), description: z.string().nullable().optional(),
  groupIds: z.union([z.string(), z.array(z.string())]).optional(),
  dataIds: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  embeddingRate: z.number().optional(), topK: z.number().optional(), rerankVersion: z.string().nullable().optional(),
  docCorrelation: z.number().nullable().optional(), caseTypeTag: z.string().nullable().optional(), enabled: z.boolean().optional(),
})
type UpdateInput = z.infer<typeof updateSchema>

export const PUT = defineRoute<UpdateInput, KnowledgeSourceParams>({
  method: 'PUT', inputSchema: updateSchema,
  async handler({ input, params, repo, audit }) {
    const { id } = params
    const existing = await repo.knowledgeSource.findFirst({ where: { id } })
    if (!existing) throw new NotFoundError('Knowledge source not found')
    const updateData: Record<string, unknown> = {}
    if (input.name !== undefined) updateData.name = input.name
    if (input.description !== undefined) updateData.description = input.description
    if (input.groupIds !== undefined) updateData.groupIds = stringifyMaybe(input.groupIds)
    if (input.dataIds !== undefined) updateData.dataIds = input.dataIds ? stringifyMaybe(input.dataIds) : null
    if (input.embeddingRate !== undefined) updateData.embeddingRate = input.embeddingRate
    if (input.topK !== undefined) updateData.topK = input.topK
    if (input.rerankVersion !== undefined) updateData.rerankVersion = input.rerankVersion
    if (input.docCorrelation !== undefined) updateData.docCorrelation = input.docCorrelation
    if (input.caseTypeTag !== undefined) updateData.caseTypeTag = input.caseTypeTag
    if (input.enabled !== undefined) updateData.enabled = input.enabled
    const result = await repo.knowledgeSource.updateMany({ where: { id }, data: updateData })
    if (result.count === 0) throw new NotFoundError('Knowledge source not found')
    const updated = await repo.knowledgeSource.findFirst({ where: { id } })
    await audit({ action: 'knowledge_source.update', target: `knowledge_source:${id}`, before: existing as Record<string, unknown>, after: updated as Record<string, unknown> })
    return apiOk({ source: updated })
  },
})

export const DELETE = defineRoute<void, KnowledgeSourceParams>({
  method: 'DELETE',
  async handler({ params, repo, audit }) {
    const { id } = params
    const existing = await repo.knowledgeSource.findFirst({ where: { id } })
    if (!existing) throw new NotFoundError('Knowledge source not found')
    const result = await repo.knowledgeSource.deleteMany({ where: { id } })
    if (result.count === 0) throw new NotFoundError('Knowledge source not found')
    await audit({ action: 'knowledge_source.delete', target: `knowledge_source:${id}`, before: existing as Record<string, unknown> })
    return apiOk({ ok: true })
  },
})

// GET + POST /api/admin/knowledge/sources — List and create knowledge sources
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping + G3 audit).

import { z } from 'zod'
import { defineRoute, ConflictError } from '@/lib/api/define-route'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'

const stringifyMaybe = (val: unknown): string => {
  if (typeof val === 'string') return val
  return JSON.stringify(val ?? '')
}

export const GET = defineRoute({
  method: 'GET',
  async handler({ repo }) {
    const sources = await repo.knowledgeSource.findMany({ orderBy: { name: 'asc' } })
    return apiOk({ sources })
  },
})

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'), description: z.string().nullable().optional(),
  groupIds: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  dataIds: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  embeddingRate: z.number().optional().default(0.9), topK: z.number().optional().default(15),
  rerankVersion: z.string().nullable().optional(), docCorrelation: z.number().optional().default(0.3),
  caseTypeTag: z.string().nullable().optional(), enabled: z.boolean().optional().default(true),
})
type CreateInput = z.infer<typeof createSchema>

export const POST = defineRoute<CreateInput>({
  method: 'POST', inputSchema: createSchema,
  async handler({ input, repo, audit }) {
    try {
      const source = await repo.knowledgeSource.create({
        data: { name: input.name, description: input.description ?? null, groupIds: stringifyMaybe(input.groupIds), dataIds: input.dataIds ? stringifyMaybe(input.dataIds) : null, embeddingRate: input.embeddingRate ?? 0.9, topK: input.topK ?? 15, rerankVersion: input.rerankVersion ?? 'BGE-Rerank', docCorrelation: input.docCorrelation ?? 0.3, caseTypeTag: input.caseTypeTag ?? null, enabled: input.enabled ?? true },
      })
      await audit({ action: 'knowledge_source.create', target: `knowledge_source:${source.name}`, after: source as Record<string, unknown> })
      return apiCreated({ source })
    } catch (err: unknown) {
      if ((err as any)?.code === 'P2002') throw new ConflictError('A knowledge source with this name already exists')
      throw err
    }
  },
})

// GET + POST /api/admin/knowledge/sources — List and create knowledge sources
// Migrated to defineRoute (G1 contract seam + G3 audit).
// Scoped by agentConfigId (not orgId).

import { z } from 'zod'
import { defineRoute, ConflictError } from '@/lib/api/define-route'
import { apiOk, apiCreated } from '@intera/shared/contracts/envelope'

const stringifyMaybe = (val: unknown): string => {
  if (typeof val === 'string') return val
  return JSON.stringify(val ?? '')
}

const getQuerySchema = z.object({ agentConfigId: z.string().min(1, 'agentConfigId is required') })

export const GET = defineRoute<z.infer<typeof getQuerySchema>>({
  method: 'GET',
  scope: 'agent',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, repo }) {
    const { agentConfigId } = input
    const sources = await repo.raw.knowledgeSource.findMany({
      where: { agentConfigId },
      orderBy: { name: 'asc' },
    })
    return apiOk({ sources })
  },
})

const createSchema = z.object({
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullable().optional(),
  groupIds: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  dataIds: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  embeddingRate: z.number().optional().default(0.9),
  topK: z.number().optional().default(15),
  rerankVersion: z.string().nullable().optional(),
  docCorrelation: z.number().optional().default(0.3),
  modelControlTopK: z.boolean().optional().default(false),
  caseTypeTag: z.string().nullable().optional(),
  enabled: z.boolean().optional().default(true),
})
type CreateInput = z.infer<typeof createSchema>

export const POST = defineRoute<CreateInput>({
  method: 'POST',
  scope: 'agent',
  inputSchema: createSchema,
  async handler({ input, repo, audit }) {
    const { agentConfigId, ...fields } = input
    try {
      const source = await repo.raw.knowledgeSource.create({
        data: {
          agentConfigId,
          name: fields.name,
          description: fields.description ?? null,
          groupIds: stringifyMaybe(fields.groupIds),
          dataIds: fields.dataIds ? stringifyMaybe(fields.dataIds) : null,
          embeddingRate: fields.embeddingRate ?? 0.9,
          topK: fields.topK ?? 15,
          rerankVersion: fields.rerankVersion ?? 'BGE-Rerank',
          docCorrelation: fields.docCorrelation ?? 0.3,
          modelControlTopK: fields.modelControlTopK ?? false,
          caseTypeTag: fields.caseTypeTag ?? null,
          enabled: fields.enabled ?? true,
        },
      })
      await audit({ action: 'knowledge_source.create', target: `knowledge_source:${source.name}`, after: source as Record<string, unknown> })
      return apiCreated({ source })
    } catch (err: unknown) {
      if ((err as any)?.code === 'P2002') throw new ConflictError('A knowledge source with this name already exists')
      throw err
    }
  },
})

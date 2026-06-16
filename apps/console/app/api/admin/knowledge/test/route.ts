// POST /api/admin/knowledge/test — Test GPTBots retrieval preview
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute, NotFoundError, RouteError, ValidationError } from '@/lib/api/define-route'
import { parseKnowledgeSourceGroupIds } from '@/lib/knowledge/source-groups'
import { apiOk } from '@intera/shared/contracts/envelope'

const GPTBOTS_API = 'https://api-sg.gptbots.ai/v1/vector/match'

const testSchema = z.object({
  agentConfigId: z.preprocess((value) => value ?? '', z.string().min(1, 'agentConfigId is required')),
  query: z.string().min(1, 'query is required'),
  sourceId: z.string().optional(),
  topK: z.number().optional().default(5),
})
type TestInput = z.infer<typeof testSchema>

async function getApiKey(repo: any, agentConfigId: string): Promise<string | null> {
  try {
    const config = await repo.raw.agentConfig.findUnique({ where: { id: agentConfigId }, select: { gptbotsApiKey: true } })
    if (config?.gptbotsApiKey) return config.gptbotsApiKey
  } catch { /* DB not ready */ }
  return process.env.GPTBOTS_API_KEY ?? null
}

function normalizeMatch(item: any) {
  return {
    ...item,
    content: item.content ?? item.text ?? item.chunk_content ?? '',
    data_id: item.data_id ?? item.dataId ?? item.document_id ?? item.documentId ?? '',
    document_name: item.document_name ?? item.documentName ?? item.doc_name ?? item.docName ?? '',
    chunk_id: item.chunk_id ?? item.chunkId ?? item.chunk_no ?? item.chunkNo ?? null,
    score: Number(item.score ?? item.similarity ?? item.relevance ?? 0),
  }
}

export const POST = defineRoute<TestInput>({
  method: 'POST',
  scope: 'agent',
  inputSchema: testSchema,
  async handler({ input, repo }) {
    const apiKey = await getApiKey(repo, input.agentConfigId)
    if (!apiKey) {
      throw new RouteError('internal', 'GPTBots API key is not configured for this Agent. Add it in Knowledge -> GPTBots API.', undefined, 503)
    }

    const gptBody: Record<string, unknown> = {
      prompt: input.query,
      top_k: input.topK,
    }
    let selectedSource: { id: string; name: string } | null = null

    if (input.sourceId) {
      const source = await repo.raw.knowledgeSource.findFirst({ where: { id: input.sourceId, agentConfigId: input.agentConfigId } })
      if (!source) throw new NotFoundError('Source not found')
      const groupIds = parseKnowledgeSourceGroupIds(source.groupIds)
      if (groupIds.length === 0) {
        throw new ValidationError(`Knowledge source "${source.name}" has no GPTBots knowledge base bound. Add one in Knowledge -> Sources.`, {
          sourceId: 'Source has no bound knowledge base',
        })
      }
      selectedSource = { id: source.id, name: source.name }
      gptBody.group_ids = groupIds
      gptBody.embedding_rate = source.embeddingRate
      if (source.rerankVersion) gptBody.rerank_version = source.rerankVersion
      if (source.docCorrelation != null) gptBody.doc_correlation = source.docCorrelation
    } else {
      const sources = await repo.raw.knowledgeSource.findMany({ where: { agentConfigId: input.agentConfigId, enabled: true } })
      if (sources.length > 0) {
        const validSources = sources
          .map((source) => ({ source, groupIds: parseKnowledgeSourceGroupIds(source.groupIds) }))
          .filter((entry) => entry.groupIds.length > 0)
        if (validSources.length === 0) {
          throw new ValidationError('No enabled knowledge source has a GPTBots knowledge base bound. Add one in Knowledge -> Sources.', {
            sourceId: 'No enabled source has a bound knowledge base',
          })
        }
        const allGroupIds: string[] = []
        let avgRate = 0.9
        let minCorr: number | undefined
        for (const entry of validSources) {
          allGroupIds.push(...entry.groupIds)
          avgRate = entry.source.embeddingRate
          if (entry.source.docCorrelation != null && (minCorr == null || entry.source.docCorrelation < minCorr)) {
            minCorr = entry.source.docCorrelation
          }
        }
        gptBody.group_ids = [...new Set(allGroupIds)]
        gptBody.embedding_rate = avgRate
        if (validSources[0]?.source.rerankVersion) gptBody.rerank_version = validSources[0].source.rerankVersion
        if (minCorr != null) gptBody.doc_correlation = minCorr
      }
    }

    const response = await fetch(GPTBOTS_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(gptBody),
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new RouteError('internal', `GPTBots API error: ${response.status}`, { detail: errText }, 502)
    }

    const data = await response.json()
    const list = Array.isArray(data?.list) ? data.list.map(normalizeMatch) : []
    return apiOk({
      ...data,
      query: input.query,
      topK: input.topK,
      source: selectedSource,
      request: {
        topK: input.topK,
        groupIds: gptBody.group_ids ?? [],
        embeddingRate: gptBody.embedding_rate ?? null,
        rerankVersion: gptBody.rerank_version ?? null,
        docCorrelation: gptBody.doc_correlation ?? null,
      },
      list,
      total: data?.total ?? list.length,
    })
  },
})

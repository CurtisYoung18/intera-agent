// POST /api/admin/knowledge/test — Test GPTBots retrieval preview
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute, NotFoundError, RouteError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

const GPTBOTS_API = 'https://api-sg.gptbots.ai/v1/vector/match'

const testSchema = z.object({
  query: z.string().min(1, 'query is required'),
  sourceId: z.string().optional(),
  topK: z.number().optional().default(5),
})
type TestInput = z.infer<typeof testSchema>

async function getApiKey(orgId: string, repo: any): Promise<string | null> {
  try {
    const config = await repo.agentConfig.findFirst({ where: { isActive: true }, select: { gptbotsApiKey: true } })
    if (config?.gptbotsApiKey) return config.gptbotsApiKey
  } catch { /* DB not ready */ }
  return process.env.GPTBOTS_API_KEY ?? null
}

export const POST = defineRoute<TestInput>({
  method: 'POST',
  inputSchema: testSchema,
  async handler({ input, repo }) {
    const apiKey = await getApiKey(repo.orgId, repo)
    if (!apiKey) throw new RouteError('internal', 'GPTBOTS_API_KEY not configured', undefined, 503)

    const gptBody: Record<string, unknown> = {
      prompt: input.query,
      top_k: input.topK,
    }

    if (input.sourceId) {
      const source = await repo.knowledgeSource.findFirst({ where: { id: input.sourceId } })
      if (!source) throw new NotFoundError('Source not found')
      gptBody.group_ids = JSON.parse(source.groupIds)
      gptBody.embedding_rate = source.embeddingRate
      if (source.rerankVersion) gptBody.rerank_version = source.rerankVersion
      if (source.docCorrelation != null) gptBody.doc_correlation = source.docCorrelation
    } else {
      const sources = await repo.knowledgeSource.findMany({ where: { enabled: true } })
      if (sources.length > 0) {
        const allGroupIds: string[] = []
        let avgRate = 0.9
        let minCorr: number | undefined
        for (const s of sources) {
          allGroupIds.push(...(JSON.parse(s.groupIds) as string[]))
          avgRate = s.embeddingRate
          if (s.docCorrelation != null && (minCorr == null || s.docCorrelation < minCorr)) {
            minCorr = s.docCorrelation
          }
        }
        gptBody.group_ids = [...new Set(allGroupIds)]
        gptBody.embedding_rate = avgRate
        if (sources[0]?.rerankVersion) gptBody.rerank_version = sources[0].rerankVersion
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
    return apiOk(data)
  },
})

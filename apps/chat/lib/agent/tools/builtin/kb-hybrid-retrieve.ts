// Intera Harness - kb_hybrid_retrieve (Built-in Tool, S4 spec)
// Ported from streaming-tool-executor.ts inline handling + skills.ts definition.
// Queries the GPTBots vector/match API. When KnowledgeSource config is available
// in the DB it merges group_ids, rerank_version, doc_correlation etc. into the
// request body. Falls back to a plain { prompt, top_k } payload when no sources
// are configured (or the DB is unreachable).

import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import { registerBuiltin } from '@intera/shared/tools/tool'

// ── Input schema ───────────────────────────────────────────────────────────

const inputSchema = z.object({
  query: z.string().describe('Search query in the user\'s language'),
  topK: z.number().int().min(1).max(50).optional()
    .describe('Number of results to return (1-50). Default 5.'),
  sourceName: z.string().optional()
    .describe('Optional: name of a specific knowledge source to search. Omit to search all enabled sources.'),
})

type Input = z.infer<typeof inputSchema>

// ── Tool definition ────────────────────────────────────────────────────────

export const kbHybridRetrieveTool: Tool<Input, unknown> = {
  name: 'kb_hybrid_retrieve',
  source: 'builtin',
  guardPhase: 'post',
  isEnabled() { return true },
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  displayVerb: { text: 'Searching knowledge base', icon: 'dots' },
  inputSchema,

  async prompt(_ctx: ToolContext): Promise<string> {
    return (
      'Search the knowledge base for answers. Call when the user asks "how to...", ' +
      '"what is...", policy questions, or needs reference information. ' +
      'Returns matched content chunks with relevance scores from GPTBots. ' +
      'Use the [KB:data_id] citation tag in replies for auditability. ' +
      'If all results have score < 0.4, tell the user no relevant info was found.'
    )
  },

  async call(input: Input, ctx: ToolContext): Promise<unknown> {
    const apiKey =
      process.env.GPTBOTS_API_KEY ??
      process.env.GPTBOTS_API_KEY ??
      ''

    // ── Build request body ──────────────────────────────────────────────────
    let body: Record<string, unknown>

    try {
      const { prisma } = await import('@intera/shared/prisma')

      // If a specific sourceName is requested, filter to that source only;
      // otherwise fetch all enabled sources for the default customer.
      const where: Record<string, unknown> = {
        vendorId: 'default',
        enabled: true,
      }
      if (input.sourceName) {
        where.name = input.sourceName
      }

      const sources = await prisma.knowledgeSource.findMany({ where })

      if (sources.length > 0) {
        const allGroupIds: string[] = []
        let maxTopK = 5
        let embeddingRateSum = 0
        let minDocCorrelation: number | undefined

        for (const s of sources) {
          const ids = JSON.parse(s.groupIds) as string[]
          allGroupIds.push(...ids)
          if (s.topK > maxTopK) maxTopK = s.topK
          embeddingRateSum += s.embeddingRate
          if (s.docCorrelation != null) {
            if (minDocCorrelation == null || s.docCorrelation < minDocCorrelation) {
              minDocCorrelation = s.docCorrelation
            }
          }
        }

        const avgEmbeddingRate = embeddingRateSum / sources.length
        body = {
          prompt: input.query,
          top_k: (input.topK as number) ?? maxTopK,
          group_ids: [...new Set(allGroupIds)],
          embedding_rate: avgEmbeddingRate,
          ...(sources[0]?.rerankVersion && { rerank_version: sources[0].rerankVersion }),
          ...(minDocCorrelation != null && { doc_correlation: minDocCorrelation }),
        }
      } else {
        body = {
          prompt: input.query,
          top_k: input.topK ?? 5,
        }
      }
    } catch {
      // DB not available (e.g. build time) — fall back to simple payload
      body = {
        prompt: input.query,
        top_k: input.topK ?? 5,
      }
    }

    // ── Call GPTBots API ────────────────────────────────────────────────────
    const response = await fetch('https://api-sg.gptbots.ai/v1/vector/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      throw new Error(`GPTBots API error: HTTP ${response.status} ${response.statusText}`)
    }

    return response.json()
  },
}

registerBuiltin(kbHybridRetrieveTool)

// POST /api/admin/knowledge/test — Test GPTBots retrieval preview

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

const CUSTOMER_ID = 'default'
const GPTBOTS_API = 'https://api-sg.gptbots.ai/v1/vector/match'
const API_KEY = process.env.GPTBOTS_API_KEY

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { query, sourceId } = body

    if (!query) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 })
    }

    if (!API_KEY) {
      return NextResponse.json({ error: 'GPTBOTS_API_KEY not configured on server' }, { status: 503 })
    }

    // Build GPTBots request
    const gptBody: Record<string, unknown> = {
      prompt: query,
      top_k: body.topK ?? 5,
    }

    // If a specific source is selected, use its config
    if (sourceId) {
      const source = await prisma.knowledgeSource.findFirst({
        where: { id: sourceId, customerId: CUSTOMER_ID },
      })
      if (!source) {
        return NextResponse.json({ error: 'Source not found' }, { status: 404 })
      }
      gptBody.group_ids = JSON.parse(source.groupIds)
      gptBody.embedding_rate = source.embeddingRate
      if (source.rerankVersion) gptBody.rerank_version = source.rerankVersion
      if (source.docCorrelation != null) gptBody.doc_correlation = source.docCorrelation
    } else {
      // Merge all enabled sources
      const sources = await prisma.knowledgeSource.findMany({
        where: { customerId: CUSTOMER_ID, enabled: true },
      })
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
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(gptBody),
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      const errText = await response.text()
      return NextResponse.json(
        { error: `GPTBots API error: ${response.status}`, detail: errText },
        { status: 502 },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (err) {
    console.error('[Admin] POST knowledge test:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// GET + POST /api/admin/knowledge/sources — List and create knowledge sources

import { NextRequest, NextResponse } from 'next/server'
import { prisma, ensureDefaultOrg } from '@intera/shared/prisma'
import { DEFAULT_KNOWLEDGE_SOURCES } from '@intera/shared/defaults'

import { getActiveOrgId } from '@/lib/auth'

export async function GET() {
  try {
    const ORG_ID = await getActiveOrgId()

    // Auto-seed: create default knowledge sources if missing
    const sources = await prisma.knowledgeSource.findMany({
      where: { orgId: ORG_ID },
      orderBy: { name: 'asc' },
    })
    if (sources.length === 0) {
      await ensureDefaultOrg(ORG_ID)
      for (const ks of DEFAULT_KNOWLEDGE_SOURCES) {
        await prisma.knowledgeSource.create({
          data: {
            orgId: ORG_ID,
            name: ks.name,
            description: ks.description,
            groupIds: ks.groupIds,
            embeddingRate: ks.embeddingRate,
            topK: ks.topK,
            rerankVersion: ks.rerankVersion,
            docCorrelation: ks.docCorrelation,
            enabled: true,
          },
        })
      }
      const seeded = await prisma.knowledgeSource.findMany({
        where: { orgId: ORG_ID },
        orderBy: { name: 'asc' },
      })
      return NextResponse.json({ sources: seeded })
    }
    const healOps: Promise<unknown>[] = []
    for (const ks of sources) {
      const patches: Record<string, unknown> = {}
      if (!ks.rerankVersion || ks.rerankVersion === 'Jina-reranker-v2-base-multilingual') {
        patches.rerankVersion = 'BGE-Rerank'
      }
      if (ks.topK < 15) patches.topK = 15
      if (ks.docCorrelation === 0.5) patches.docCorrelation = 0.3
      if (Object.keys(patches).length > 0) {
        healOps.push(prisma.knowledgeSource.update({ where: { id: ks.id }, data: patches }))
      }
    }
    if (healOps.length > 0) {
      await Promise.allSettled(healOps)
      // Re-fetch with updated values
      const updated = await prisma.knowledgeSource.findMany({
        where: { orgId: ORG_ID },
        orderBy: { name: 'asc' },
      })
      return NextResponse.json({ sources: updated })
    }

    return NextResponse.json({ sources })
  } catch (err) {
    console.error('[Admin] GET knowledge sources:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const ORG_ID = await getActiveOrgId()
    await ensureDefaultOrg(ORG_ID)
    const body = await req.json()

    const source = await prisma.knowledgeSource.create({
      data: {
        orgId: ORG_ID,
        name: body.name,
        description: body.description ?? null,
        groupIds: typeof body.groupIds === 'string' ? body.groupIds : JSON.stringify(body.groupIds || []),
        dataIds: body.dataIds ? (typeof body.dataIds === 'string' ? body.dataIds : JSON.stringify(body.dataIds)) : null,
        embeddingRate: body.embeddingRate ?? 0.9,
        topK: body.topK ?? 15,
        rerankVersion: body.rerankVersion ?? 'BGE-Rerank',
        docCorrelation: body.docCorrelation ?? 0.3,
        caseTypeTag: body.caseTypeTag ?? null,
        enabled: body.enabled ?? true,
      },
    })
    return NextResponse.json({ source }, { status: 201 })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'A knowledge source with this name already exists' }, { status: 409 })
    }
    console.error('[Admin] POST knowledge source:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// GET + POST /api/admin/knowledge/sources — List and create knowledge sources

import { NextRequest, NextResponse } from 'next/server'
import { prisma, ensureDefaultVendor } from '@intera/shared/prisma'

import { getActiveVendorId } from '@/lib/auth'

export async function GET() {
  try {
    const VENDOR_ID = await getActiveVendorId()
    const sources = await prisma.knowledgeSource.findMany({
      where: { vendorId: VENDOR_ID },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json({ sources })
  } catch (err) {
    console.error('[Admin] GET knowledge sources:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const VENDOR_ID = await getActiveVendorId()
    await ensureDefaultVendor(VENDOR_ID)
    const body = await req.json()

    const source = await prisma.knowledgeSource.create({
      data: {
        vendorId: VENDOR_ID,
        name: body.name,
        description: body.description ?? null,
        groupIds: typeof body.groupIds === 'string' ? body.groupIds : JSON.stringify(body.groupIds || []),
        dataIds: body.dataIds ? (typeof body.dataIds === 'string' ? body.dataIds : JSON.stringify(body.dataIds)) : null,
        embeddingRate: body.embeddingRate ?? 0.9,
        topK: body.topK ?? 5,
        rerankVersion: body.rerankVersion ?? null,
        docCorrelation: body.docCorrelation ?? null,
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

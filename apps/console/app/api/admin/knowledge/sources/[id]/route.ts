// GET + PUT + DELETE /api/admin/knowledge/sources/[id]

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

const CUSTOMER_ID = 'default'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const source = await prisma.knowledgeSource.findFirst({
      where: { id, customerId: CUSTOMER_ID },
    })
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ source })
  } catch (err) {
    console.error('[Admin] GET knowledge source:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json()

    const updateData: Record<string, unknown> = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.description !== undefined) updateData.description = body.description
    if (body.groupIds !== undefined) {
      updateData.groupIds = typeof body.groupIds === 'string' ? body.groupIds : JSON.stringify(body.groupIds)
    }
    if (body.dataIds !== undefined) {
      updateData.dataIds = typeof body.dataIds === 'string' ? body.dataIds : JSON.stringify(body.dataIds)
    }
    if (body.embeddingRate !== undefined) updateData.embeddingRate = body.embeddingRate
    if (body.topK !== undefined) updateData.topK = body.topK
    if (body.rerankVersion !== undefined) updateData.rerankVersion = body.rerankVersion
    if (body.docCorrelation !== undefined) updateData.docCorrelation = body.docCorrelation
    if (body.caseTypeTag !== undefined) updateData.caseTypeTag = body.caseTypeTag
    if (body.enabled !== undefined) updateData.enabled = body.enabled

    const source = await prisma.knowledgeSource.updateMany({
      where: { id, customerId: CUSTOMER_ID },
      data: updateData,
    })

    if (source.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const updated = await prisma.knowledgeSource.findUnique({ where: { id } })
    return NextResponse.json({ source: updated })
  } catch (err) {
    console.error('[Admin] PUT knowledge source:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const result = await prisma.knowledgeSource.deleteMany({
      where: { id, customerId: CUSTOMER_ID },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Admin] DELETE knowledge source:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

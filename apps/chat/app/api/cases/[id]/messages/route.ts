import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const limit = 100

  try {
    const [caseData, messages] = await Promise.all([
      prisma.case.findUnique({ where: { id }, select: { type: true, status: true, createdAt: true } }),
      prisma.message.findMany({
        where: { caseId: id },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { id: true, role: true, content: true, createdAt: true },
      }),
    ])

    if (!caseData) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    return NextResponse.json({
      caseType: caseData.type,
      status: caseData.status,
      createdAt: caseData.createdAt,
      messages,
    })
  } catch (err) {
    console.error('[Chat Case Messages API] Error:', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

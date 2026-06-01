// GET /api/cases/[id]/messages — Case conversation history
// Merged: case metadata (from Chat) + pagination (from Console)
// Query: ?limit=100&offset=0

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
  const offset = parseInt(searchParams.get('offset') || '0')

  try {
    const [caseData, messages, total] = await Promise.all([
      prisma.case.findUnique({
        where: { id },
        select: { type: true, status: true, createdAt: true },
      }),
      prisma.message.findMany({
        where: { caseId: id },
        orderBy: { createdAt: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.message.count({ where: { caseId: id } }),
    ])

    if (!caseData) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    return NextResponse.json({
      caseType: caseData.type,
      status: caseData.status,
      createdAt: caseData.createdAt,
      messages,
      total,
    })
  } catch (err) {
    console.error('[API] Failed to get messages:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const caseId = url.searchParams.get('caseId')
  if (!caseId) {
    return NextResponse.json({ tasks: [] })
  }

  try {
    const tasks = await prisma.humanTask.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, status: true, queue: true, question: true, verdict: true, notes: true, createdAt: true, resolvedAt: true },
    })
    return NextResponse.json({ tasks })
  } catch (err) {
    console.error('[Chat Human Tasks API] Error:', err)
    return NextResponse.json({ tasks: [] }, { status: 500 })
  }
}

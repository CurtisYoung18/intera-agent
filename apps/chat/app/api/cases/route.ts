import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const userId = url.searchParams.get('userId') || 'anonymous'
  const customerId = url.searchParams.get('customerId') || 'default'
  const chatId = url.searchParams.get('chatId') || null
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50)

  try {
    const cases = await prisma.case.findMany({
      where: {
        customerId,
        userId,
        ...(chatId ? { chatId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        status: true,
        goal: true,
        createdAt: true,
        updatedAt: true,
        memory: {
          select: {
            summary: true,
            skillsCalled: true,
          },
        },
        _count: { select: { messages: true } },
      },
    })

    const result = cases.map((c) => ({
      id: c.id,
      type: c.type,
      status: c.status,
      goal: c.goal,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      summary: c.memory?.summary?.slice(0, 200) || null,
      skillsCalled: c.memory?.skillsCalled ? JSON.parse(c.memory.skillsCalled) : [],
      messageCount: c._count.messages,
    }))

    return NextResponse.json({ cases: result })
  } catch (err) {
    console.error('[Chat Cases API] Error:', err)
    return NextResponse.json({ cases: [], error: 'Failed to load cases' }, { status: 500 })
  }
}

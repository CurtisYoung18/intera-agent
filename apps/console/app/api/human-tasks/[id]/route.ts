// GET /api/human-tasks/[id] — single task with case details

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const task = await prisma.humanTask.findUnique({
    where: { id },
    include: {
      case: {
        include: {
          memory: true,
          traces: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
      },
    },
  })

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  return NextResponse.json({ task })
}

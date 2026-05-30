// GET /api/human-tasks/[id] — single task with case details

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId } from '@/lib/auth'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ORG_ID = await getActiveOrgId()
  const { id } = await params

  const task = await prisma.humanTask.findFirst({
    where: { id, case: { orgId: ORG_ID } },
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

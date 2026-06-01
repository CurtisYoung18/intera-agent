// GET /api/human-tasks — list human tasks
// Agent view: ?caseId=xxx (no auth, returns slim task fields)
// Ops view: no params (org auth, returns full task objects with case)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const caseId = searchParams.get('caseId')

  // ── Agent/runtime view: list tasks for a specific case ──
  if (caseId) {
    try {
      const tasks = await prisma.humanTask.findMany({
        where: { caseId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          queue: true,
          question: true,
          verdict: true,
          notes: true,
          createdAt: true,
          resolvedAt: true,
        },
      })
      return NextResponse.json({ tasks })
    } catch (err) {
      console.error('[Human Tasks API] Error:', err)
      return NextResponse.json({ tasks: [] }, { status: 500 })
    }
  }

  // ── Ops view: list all tasks for the active org ──
  const ORG_ID = await getActiveOrgId()
  const tasks = await prisma.humanTask.findMany({
    where: { case: { orgId: ORG_ID } },
    orderBy: { createdAt: 'desc' },
    include: { case: true },
  })

  return NextResponse.json({ tasks })
}

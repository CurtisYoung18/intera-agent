// GET /api/human-tasks — list human tasks
// Agent view: ?caseId=xxx (API key / internal auth, returns slim task fields)
// Ops view: no params (cookie auth, returns full task objects with case)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId } from '@/lib/auth'
import { resolveOrgFromApiKey, isTrustedInternalCall } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const caseId = searchParams.get('caseId')

  // ── Agent/runtime view: list tasks for a specific case ──
  if (caseId) {
    // ── Auth gate ──
    const authOrgId = await resolveOrgFromApiKey(request)
    if (!authOrgId && !isTrustedInternalCall(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Verify the case belongs to the authenticated org
    if (authOrgId) {
      const c = await prisma.case.findUnique({ where: { id: caseId }, select: { orgId: true } })
      if (!c || c.orgId !== authOrgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

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

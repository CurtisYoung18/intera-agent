import { NextRequest, NextResponse } from 'next/server'

import { closeSession } from '@/lib/agent/session-store'
import { isTrustedInternalCall } from '@/lib/api-auth'
import { prisma } from '@intera/shared/prisma'

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ caseId: string }> },
) {
  if (!isTrustedInternalCall(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { caseId } = await ctx.params
  const orgId = request.headers.get('x-intera-org')
  if (!orgId) {
    return NextResponse.json({ error: 'Missing x-intera-org header' }, { status: 400 })
  }

  const existingCase = await prisma.case.findUnique({
    where: { id: caseId },
    select: { orgId: true },
  })

  if (existingCase && existingCase.orgId !== orgId) {
    return NextResponse.json({ error: 'Case not found for this organization' }, { status: 404 })
  }

  await closeSession(caseId)
  return NextResponse.json({ ok: true, caseId })
}

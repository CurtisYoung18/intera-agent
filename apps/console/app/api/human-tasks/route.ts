// GET /api/human-tasks — list all human tasks for the active customer

import { NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId } from '@/lib/auth'

export async function GET() {
  const ORG_ID = await getActiveOrgId()
  const tasks = await prisma.humanTask.findMany({
    where: { case: { orgId: ORG_ID } },
    orderBy: { createdAt: 'desc' },
    include: { case: true },
  })

  return NextResponse.json({ tasks })
}

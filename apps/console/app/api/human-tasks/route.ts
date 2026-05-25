// GET /api/human-tasks — list all human tasks for the active customer

import { NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveCustomerId } from '@/lib/auth'

export async function GET() {
  const CUSTOMER_ID = await getActiveCustomerId()
  const tasks = await prisma.humanTask.findMany({
    where: { case: { customerId: CUSTOMER_ID } },
    orderBy: { createdAt: 'desc' },
    include: { case: true },
  })

  return NextResponse.json({ tasks })
}

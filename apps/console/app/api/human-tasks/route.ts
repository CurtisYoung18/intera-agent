// GET /api/human-tasks — list all human tasks
// [MOCK] Returns mock data. Production reads from DB via Prisma.

import { NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET() {
  // [MOCK] Production uses prisma queries:
  //   const tasks = await prisma.humanTask.findMany({
  //     where: { status: { not: 'resolved' } },
  //     orderBy: { createdAt: 'desc' },
  //     include: { case: true },
  //   })
  const tasks = await prisma.humanTask.findMany({
    where: { status: { not: 'resolved' } },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ tasks })
}

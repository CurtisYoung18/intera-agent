// GET /api/human-tasks — list all human tasks (including resolved)

import { NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET() {
  const tasks = await prisma.humanTask.findMany({
    orderBy: { createdAt: 'desc' },
    include: { case: true },
  })

  return NextResponse.json({ tasks })
}

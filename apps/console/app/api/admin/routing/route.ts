// GET + POST /api/admin/routing

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

const CUSTOMER_ID = 'default'

export async function GET() {
  try {
    const routes = await prisma.routing.findMany({
      where: { customerId: CUSTOMER_ID },
      orderBy: { priority: 'asc' },
    })
    return NextResponse.json({ routes })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const route = await prisma.routing.create({
      data: {
        customerId: CUSTOMER_ID,
        queue: body.queue,
        description: body.description || null,
        skillsAllowed: typeof body.skillsAllowed === 'string' ? body.skillsAllowed : JSON.stringify(body.skillsAllowed || []),
        priority: body.priority ?? 0,
        autoAssign: body.autoAssign ?? true,
        maxWaitingTime: body.maxWaitingTime ?? 300,
      },
    })
    return NextResponse.json({ route }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

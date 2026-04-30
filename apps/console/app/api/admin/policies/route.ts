// GET + POST /api/admin/policies

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

const CUSTOMER_ID = 'default'

export async function GET() {
  try {
    const policies = await prisma.policy.findMany({
      where: { customerId: CUSTOMER_ID },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json({ policies })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const policy = await prisma.policy.create({
      data: {
        customerId: CUSTOMER_ID,
        name: body.name,
        description: body.description || null,
        hook: body.hook || 'preTool',
        rule: typeof body.rule === 'string' ? body.rule : JSON.stringify(body.rule || {}),
        enabled: body.enabled ?? true,
      },
    })
    return NextResponse.json({ policy }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

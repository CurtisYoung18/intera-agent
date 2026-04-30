// GET + POST /api/admin/case-types

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

const CUSTOMER_ID = 'default'

export async function GET() {
  try {
    const types = await prisma.caseType.findMany({
      where: { customerId: CUSTOMER_ID },
      orderBy: { type: 'asc' },
    })
    return NextResponse.json({ types })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const ct = await prisma.caseType.create({
      data: {
        customerId: CUSTOMER_ID,
        type: body.type,
        displayName: body.displayName || body.type,
        description: body.description || null,
        icon: body.icon || '📋',
        requiredFacts: typeof body.requiredFacts === 'string' ? body.requiredFacts : JSON.stringify(body.requiredFacts || []),
        stages: typeof body.stages === 'string' ? body.stages : JSON.stringify(body.stages || ['created', 'investigating', 'resolved']),
        defaultGoal: body.defaultGoal || '',
        escalateOn: typeof body.escalateOn === 'string' ? body.escalateOn : JSON.stringify(body.escalateOn || []),
        autoCloseConditions: body.autoCloseConditions ? (typeof body.autoCloseConditions === 'string' ? body.autoCloseConditions : JSON.stringify(body.autoCloseConditions)) : null,
      },
    })
    return NextResponse.json({ caseType: ct }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

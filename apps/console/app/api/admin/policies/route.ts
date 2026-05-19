// GET + POST /api/admin/policies

import { NextRequest, NextResponse } from 'next/server'
import { prisma, ensureDefaultCustomer } from '@intera/shared/prisma'
import { DEFAULT_POLICIES } from '@intera/shared/defaults'

const CUSTOMER_ID = 'default'

export async function GET() {
  try {
    let policies = await prisma.policy.findMany({
      where: { customerId: CUSTOMER_ID },
      orderBy: { name: 'asc' },
    })

    // Ensure all default policies exist (insert missing, skip existing)
    const existingNames = new Set(policies.map((p) => p.name))
    const missing = DEFAULT_POLICIES.filter((p) => !existingNames.has(p.name))

    if (missing.length > 0) {
      await ensureDefaultCustomer(CUSTOMER_ID)
      for (const p of missing) {
        await prisma.policy.create({
          data: {
            customerId: CUSTOMER_ID,
            name: p.name,
            description: p.description,
            hook: p.hook,
            rule: p.rule,
            enabled: true,
          },
        })
      }
      policies = await prisma.policy.findMany({
        where: { customerId: CUSTOMER_ID },
        orderBy: { name: 'asc' },
      })
    }

    return NextResponse.json({ policies })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureDefaultCustomer(CUSTOMER_ID)
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

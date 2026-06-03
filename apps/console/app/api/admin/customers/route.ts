// GET /api/admin/customers — List all customers (for sidebar switcher)
// Auto-seeds the two built-in customers on first access.

import { NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

const BUILT_IN_CUSTOMERS = [
  { id: 'default', name: 'Demo Org', password: null },
]

export async function GET() {
  try {
    // Auto-seed/update built-in customers
    for (const c of BUILT_IN_CUSTOMERS) {
      await prisma.organization.upsert({
        where: { id: c.id },
        update: { name: c.name, password: c.password },
        create: c,
      })
    }

    const customers = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        password: true,
        apiKey: true,
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        hasPassword: c.password != null,
        hasApiKey: c.apiKey != null,
      })),
    })
  } catch (err) {
    console.error('[Admin] GET customers:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

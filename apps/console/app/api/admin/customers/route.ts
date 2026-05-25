// GET /api/admin/customers — List all customers (for sidebar switcher)

import { NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET() {
  try {
    const customers = await prisma.customer.findMany({
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

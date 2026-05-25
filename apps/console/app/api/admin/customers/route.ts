// GET /api/admin/customers — List all customers (for sidebar switcher)
// Auto-seeds the two built-in customers on first access.

import { NextResponse } from 'next/server'
import { hashSync } from 'bcryptjs'
import { prisma } from '@intera/shared/prisma'

const BUILT_IN_CUSTOMERS = [
  { id: 'default', name: 'Demo Vendor', password: null },
  { id: 'api', name: 'API Vendor', password: hashSync('0000', 10) },
]

export async function GET() {
  try {
    // Auto-seed built-in customers if they don't exist
    const existing = await prisma.customer.findMany({ select: { id: true } })
    const existingIds = new Set(existing.map((c) => c.id))
    for (const c of BUILT_IN_CUSTOMERS) {
      if (!existingIds.has(c.id)) {
        await prisma.customer.create({ data: c })
      }
    }

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

// GET /api/admin/customers — List customers the current user can access (for sidebar switcher)
// Auto-seeds the two built-in customers on first access.

import { NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getSession } from '@/lib/auth'

const BUILT_IN_CUSTOMERS = [
  { id: 'default', name: 'Test', password: null },
  { id: 'demo', name: 'Demo', password: null },
]

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Auto-seed/update built-in customers
    for (const c of BUILT_IN_CUSTOMERS) {
      await prisma.organization.upsert({
        where: { id: c.id },
        update: { name: c.name, password: c.password },
        create: c,
      })
    }

    // Only return orgs the current user has a membership in
    const memberships = await prisma.membership.findMany({
      where: { userId: session.userId },
      include: { org: { select: { id: true, name: true, password: true, apiKey: true } } },
      orderBy: { org: { name: 'asc' } },
    })

    return NextResponse.json({
      customers: memberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        hasPassword: m.org.password != null,
        hasApiKey: m.org.apiKey != null,
      })),
    })
  } catch (err) {
    console.error('[Admin] GET customers:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

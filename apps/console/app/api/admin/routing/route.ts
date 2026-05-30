// GET + POST /api/admin/routing

import { NextRequest, NextResponse } from 'next/server'
import { prisma, ensureDefaultOrg } from '@intera/shared/prisma'
import { DEFAULT_ROUTING } from '@intera/shared/defaults'

import { getActiveOrgId } from '@/lib/auth'

export async function GET() {
  try {
    const ORG_ID = await getActiveOrgId()
    let routes = await prisma.routing.findMany({
      where: { orgId: ORG_ID },
      orderBy: { priority: 'asc' },
    })

    // Ensure all default routes exist (insert missing, skip existing)
    const existingQueues = new Set(routes.map((r) => r.queue))
    const missing = DEFAULT_ROUTING.filter((r) => !existingQueues.has(r.queue))

    if (missing.length > 0) {
      await ensureDefaultOrg(ORG_ID)
      for (const r of missing) {
        await prisma.routing.create({
          data: {
            orgId: ORG_ID,
            queue: r.queue,
            description: r.description,
            skillsAllowed: r.skillsAllowed,
            priority: r.priority,
          },
        })
      }
      routes = await prisma.routing.findMany({
        where: { orgId: ORG_ID },
        orderBy: { priority: 'asc' },
      })
    }

    return NextResponse.json({ routes })
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const ORG_ID = await getActiveOrgId()
    await ensureDefaultOrg(ORG_ID)
    const body = await req.json()
    const route = await prisma.routing.create({
      data: {
        orgId: ORG_ID,
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

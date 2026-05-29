// GET + POST /api/admin/policies

import { NextRequest, NextResponse } from 'next/server'
import { prisma, ensureDefaultVendor } from '@intera/shared/prisma'
import { DEFAULT_POLICIES } from '@intera/shared/defaults'

import { getActiveVendorId } from '@/lib/auth'

export async function GET() {
  try {
    const VENDOR_ID = await getActiveVendorId()
    let policies = await prisma.policy.findMany({
      where: { vendorId: VENDOR_ID },
      orderBy: { name: 'asc' },
    })

    // Ensure all default policies exist (insert missing, skip existing)
    const existingNames = new Set(policies.map((p) => p.name))
    const missing = DEFAULT_POLICIES.filter((p) => !existingNames.has(p.name))

    if (missing.length > 0) {
      await ensureDefaultVendor(VENDOR_ID)
      for (const p of missing) {
        await prisma.policy.create({
          data: {
            vendorId: VENDOR_ID,
            name: p.name,
            description: p.description,
            hook: p.hook,
            rule: p.rule,
            enabled: true,
          },
        })
      }
      policies = await prisma.policy.findMany({
        where: { vendorId: VENDOR_ID },
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
    const VENDOR_ID = await getActiveVendorId()
    await ensureDefaultVendor(VENDOR_ID)
    const body = await req.json()
    const policy = await prisma.policy.create({
      data: {
        vendorId: VENDOR_ID,
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

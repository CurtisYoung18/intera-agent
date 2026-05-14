// GET + PUT + DELETE /api/admin/case-types/[name]

import { NextRequest, NextResponse } from 'next/server'
import { prisma, ensureSqliteSchemaCompat } from '@intera/shared/prisma'

const CUSTOMER_ID = 'default'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    await ensureSqliteSchemaCompat(prisma)
    const ct = await prisma.caseType.findUnique({ where: { customerId_type: { customerId: CUSTOMER_ID, type: name } } })
    if (!ct) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ caseType: ct })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    await ensureSqliteSchemaCompat(prisma)
    const body = await req.json()
    const data: Record<string, unknown> = {}
    const strFields = ['type', 'displayName', 'description', 'icon', 'defaultGoal']
    for (const f of strFields) if (body[f] !== undefined) data[f] = body[f]
    if (body.enabled !== undefined)
      data.enabled = body.enabled !== false && body.enabled !== 0 && body.enabled !== 'false'
    for (const f of ['requiredFacts', 'stages', 'escalateOn', 'autoCloseConditions', 'stageConfigs', 'orchestratorConfig']) {
      if (body[f] !== undefined) data[f] = typeof body[f] === 'string' ? body[f] : JSON.stringify(body[f])
    }
    const ct = await prisma.caseType.update({ where: { customerId_type: { customerId: CUSTOMER_ID, type: name } }, data })
    return NextResponse.json({ caseType: ct })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    await ensureSqliteSchemaCompat(prisma)
    await prisma.caseType.delete({ where: { customerId_type: { customerId: CUSTOMER_ID, type: name } } })
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}

// GET + PUT + DELETE /api/admin/case-types/[name]

import { NextRequest, NextResponse } from 'next/server'
import { prisma, ensureSqliteSchemaCompat } from '@intera/shared/prisma'

import { getActiveVendorId } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    const VENDOR_ID = await getActiveVendorId()
    await ensureSqliteSchemaCompat(prisma)
    const ct = await prisma.caseType.findUnique({ where: { vendorId_type: { vendorId: VENDOR_ID, type: name } } })
    if (!ct) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ caseType: ct })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    const VENDOR_ID = await getActiveVendorId()
    await ensureSqliteSchemaCompat(prisma)
    const body = await req.json()
    const data: Record<string, unknown> = {}
    const strFields = ['type', 'displayName', 'description', 'icon', 'defaultGoal']
    for (const f of strFields) if (body[f] !== undefined) data[f] = body[f]
    if (body.enabled !== undefined)
      data.enabled = body.enabled !== false && body.enabled !== 0 && body.enabled !== 'false'
    if (body.requireHumanReview !== undefined)
      data.requireHumanReview = body.requireHumanReview === true || body.requireHumanReview === 'true'
    for (const f of ['requiredFacts', 'stages', 'escalateOn', 'autoCloseConditions', 'stageConfigs', 'orchestratorConfig']) {
      if (body[f] !== undefined) data[f] = typeof body[f] === 'string' ? body[f] : JSON.stringify(body[f])
    }
    if (body.executionMode !== undefined) data.executionMode = body.executionMode === 'cc' ? 'cc' : 'stage'
    if (body.sop !== undefined) data.sop = body.sop || null
    if (body.sopMaxAutoTurns !== undefined) data.sopMaxAutoTurns = Math.max(1, Math.min(50, Number(body.sopMaxAutoTurns) || 10))
    const ct = await prisma.caseType.update({ where: { vendorId_type: { vendorId: VENDOR_ID, type: name } }, data })
    return NextResponse.json({ caseType: ct })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  try {
    const VENDOR_ID = await getActiveVendorId()
    await ensureSqliteSchemaCompat(prisma)
    await prisma.caseType.delete({ where: { vendorId_type: { vendorId: VENDOR_ID, type: name } } })
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ error: 'Internal error' }, { status: 500 }) }
}

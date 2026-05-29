// GET /api/cases/[id] — Case detail with memory, tasks, and message count

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveVendorId } from '@/lib/auth'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const VENDOR_ID = await getActiveVendorId()
  const { id } = await params

  try {
    const c = await prisma.case.findFirst({
      where: { id, vendorId: VENDOR_ID },
      include: {
        memory: true,
        humanTasks: { orderBy: { createdAt: 'desc' } },
        _count: { select: { messages: true, traces: true } },
      },
    })

    if (!c) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ case: c })
  } catch (err) {
    console.error('[API] Failed to get case:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/** DELETE — remove case and all dependent rows (messages, traces, memory, human tasks). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const VENDOR_ID = await getActiveVendorId()
  const { id } = await params

  try {
    const existing = await prisma.case.findFirst({
      where: { id, vendorId: VENDOR_ID },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.humanTask.deleteMany({ where: { caseId: id } })
    await prisma.actionTrace.deleteMany({ where: { caseId: id } })
    await prisma.message.deleteMany({ where: { caseId: id } })
    await prisma.chatMemory.deleteMany({ where: { caseId: id } })
    await prisma.case.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[API] Failed to delete case:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

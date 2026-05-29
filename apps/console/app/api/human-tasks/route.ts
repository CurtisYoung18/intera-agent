// GET /api/human-tasks — list all human tasks for the active customer

import { NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveVendorId } from '@/lib/auth'

export async function GET() {
  const VENDOR_ID = await getActiveVendorId()
  const tasks = await prisma.humanTask.findMany({
    where: { case: { vendorId: VENDOR_ID } },
    orderBy: { createdAt: 'desc' },
    include: { case: true },
  })

  return NextResponse.json({ tasks })
}

// POST /api/admin/config-changed — Invalidate AgentConfig cache
// Called by Console admin after saving config, so changes take effect immediately.

import { NextRequest, NextResponse } from 'next/server'
import { clearConfigCache } from '@/lib/agent/config-cache'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const customerId = body.customerId || undefined
    clearConfigCache(customerId)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

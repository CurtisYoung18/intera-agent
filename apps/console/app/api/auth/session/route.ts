// GET /api/auth/session — Get current Console session

import { NextResponse } from 'next/server'
import { getActiveVendor } from '@/lib/auth'

export async function GET() {
  try {
    const customer = await getActiveVendor()
    if (!customer) {
      return NextResponse.json({ orgId: 'default', customerName: 'Demo Org', isAuthenticated: false })
    }
    return NextResponse.json({
      orgId: customer.id,
      customerName: customer.name,
      isAuthenticated: customer.isAuthed,
    })
  } catch (err) {
    console.error('[Auth] session error:', err)
    return NextResponse.json({ orgId: 'default', customerName: 'Demo Org', isAuthenticated: false })
  }
}

// GET /api/auth/session — current Console session (from the verified signed cookie)

import { NextResponse } from 'next/server'
import { getActiveVendor } from '@/lib/auth'

export async function GET() {
  try {
    const vendor = await getActiveVendor()
    if (!vendor || !vendor.isAuthed) {
      return NextResponse.json({ isAuthenticated: false, role: null, orgId: null, customerName: null })
    }
    return NextResponse.json({
      isAuthenticated: true,
      role: vendor.role,
      canSwitch: vendor.role === 'staff',
      orgId: vendor.id,
      customerName: vendor.name,
    })
  } catch (err) {
    console.error('[Auth] session error:', err)
    return NextResponse.json({ isAuthenticated: false, role: null, orgId: null, customerName: null })
  }
}

// POST /api/auth/logout — Clear Console session
// Migrated to defineRoute (G1 contract seam).

import { NextResponse } from 'next/server'
import { defineRoute } from '@/lib/api/define-route'
import { SESSION_COOKIE } from '@/lib/session'

export const POST = defineRoute({
  method: 'POST',
  async handler() {
    const res = NextResponse.json({ ok: true })
    res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
    res.cookies.set('intera_org_id', '', { path: '/', maxAge: 0 })
    res.cookies.set('intera_auth', '', { path: '/', maxAge: 0 })
    return res
  },
})

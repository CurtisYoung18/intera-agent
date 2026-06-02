// POST /api/auth/logout — Clear Console session

import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/session'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
  // Clear legacy plaintext cookies too.
  res.cookies.set('intera_org_id', '', { path: '/', maxAge: 0 })
  res.cookies.set('intera_auth', '', { path: '/', maxAge: 0 })
  return res
}

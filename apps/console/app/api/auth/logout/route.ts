// POST /api/auth/logout — Clear Console session

import { NextResponse } from 'next/server'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('intera_customer_id', '', { path: '/', maxAge: 0 })
  res.cookies.set('intera_auth', '', { path: '/', maxAge: 0 })
  return res
}

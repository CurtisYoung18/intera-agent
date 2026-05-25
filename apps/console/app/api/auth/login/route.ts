// POST /api/auth/login — Console customer login

import { NextRequest, NextResponse } from 'next/server'
import { compareSync } from 'bcryptjs'
import { prisma } from '@intera/shared/prisma'

export async function POST(req: NextRequest) {
  try {
    const { customerId, password } = await req.json()

    if (!customerId || !password) {
      return NextResponse.json({ error: 'customerId and password are required' }, { status: 400 })
    }

    const customer = await prisma.customer.findUnique({ where: { id: customerId } })
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (!customer.password) {
      // Customer has no password — login without verification
      const res = NextResponse.json({
        ok: true,
        customer: { id: customer.id, name: customer.name },
      })
      res.cookies.set('intera_customer_id', customer.id, {
        path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30,
      })
      res.cookies.set('intera_auth', '1', {
        path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30,
      })
      return res
    }

    const valid = compareSync(password, customer.password)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    const res = NextResponse.json({
      ok: true,
      customer: { id: customer.id, name: customer.name },
    })
    res.cookies.set('intera_customer_id', customer.id, {
      path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30,
    })
    res.cookies.set('intera_auth', '1', {
      path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30,
    })
    return res
  } catch (err) {
    console.error('[Auth] login error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

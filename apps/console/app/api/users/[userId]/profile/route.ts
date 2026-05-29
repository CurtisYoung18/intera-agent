// GET/PUT /api/users/[userId]/profile

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params
  try {
    let profile = await prisma.userProfile.findUnique({ where: { userId } })
    if (!profile) {
      profile = await prisma.userProfile.create({ data: { userId } })
    }
    return NextResponse.json({ profile })
  } catch (err) {
    console.error('[API] GET user profile:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params
  try {
    const body = await req.json()
    const profile = await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, profile: body.profile ?? '' },
      update: { profile: body.profile },
    })
    return NextResponse.json({ profile })
  } catch (err) {
    console.error('[API] PUT user profile:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

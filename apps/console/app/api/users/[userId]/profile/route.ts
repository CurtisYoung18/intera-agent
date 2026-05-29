// GET/PUT/DELETE /api/users/[userId]/profile

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params
  const decoded = decodeURIComponent(userId)
  try {
    // Query real-time stats from DB, not stale cached counts
    const [cases, profile, chats] = await Promise.all([
      prisma.case.findMany({
        where: { userId: decoded },
        select: { status: true, type: true, updatedAt: true, createdAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.userProfile.findUnique({ where: { userId: decoded } }),
      prisma.case.findMany({
        where: { userId: decoded },
        select: { chatId: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ])

    const totalCases = cases.length
    const resolvedCases = cases.filter((c) => c.status === 'resolved').length
    const escalatedCases = cases.filter((c) => c.status === 'escalated' || c.status === 'waiting_human').length
    const lastCase = cases[0]
    const lastCaseType = lastCase?.type ?? null
    const firstSeenAt = cases.length > 0
      ? cases.reduce((earliest, c) => c.createdAt < earliest ? c.createdAt : earliest, cases[0].createdAt)
      : null
    const lastSeenAt = lastCase?.updatedAt?.toISOString() ?? lastCase?.createdAt?.toISOString() ?? null

    // Count unique chats
    const chatIds = new Set(chats.map((c) => c.chatId).filter(Boolean) as string[])
    const totalChats = chatIds.size

    return NextResponse.json({
      profile: {
        userId: decoded,
        profile: profile?.profile ?? '',
        totalChats,
        totalCases,
        resolvedCases,
        escalatedCases,
        lastCaseType,
        firstSeenAt: firstSeenAt?.toISOString() ?? null,
        lastSeenAt,
        updatedAt: profile?.updatedAt?.toISOString() ?? new Date().toISOString(),
      },
    })
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
  const decoded = decodeURIComponent(userId)
  try {
    const body = await req.json()
    const profile = await prisma.userProfile.upsert({
      where: { userId: decoded },
      create: { userId: decoded, profile: body.profile ?? '' },
      update: { profile: body.profile },
    })
    return NextResponse.json({ profile })
  } catch (err) {
    console.error('[API] PUT user profile:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params
  const decoded = decodeURIComponent(userId)
  try {
    // Delete all stored data for this user: cases cascade to messages/memory/traces,
    // external conversations, and the user profile itself.
    await Promise.all([
      prisma.case.deleteMany({ where: { userId: decoded } }),
      prisma.externalConversation.deleteMany({ where: { internalCaseId: { in: (await prisma.case.findMany({ where: { userId: decoded }, select: { id: true } })).map(c => c.id) } } }),
      prisma.userProfile.deleteMany({ where: { userId: decoded } }),
    ])

    return NextResponse.json({ ok: true, deleted: decoded })
  } catch (err) {
    console.error('[API] DELETE user data:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

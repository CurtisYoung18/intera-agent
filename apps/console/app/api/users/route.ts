// GET /api/users — List users that have an accumulated UserProfile.
// UserProfile.userId stores a profileKey ("user:<id>" or "chat:<id>"); we strip
// the prefix for display. (vendorId is not reliably set on UserProfile yet, so
// this lists all profiles — an ops-wide view.)

import { NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET() {
  try {
    const profiles = await prisma.userProfile.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })

    const users = profiles.map((p) => {
      const key = p.userId
      const kind = key.startsWith('user:') ? 'member' : key.startsWith('chat:') ? 'anonymous' : 'unknown'
      const label = key.replace(/^(user:|chat:)/, '')
      return {
        userId: key,            // the stored profileKey — use for /ops/users/[userId]
        label,                  // display name (prefix stripped)
        kind,                   // member | anonymous | unknown
        totalChats: p.totalChats,
        totalCases: p.totalCases,
        resolvedCases: p.resolvedCases,
        escalatedCases: p.escalatedCases,
        lastCaseType: p.lastCaseType,
        hasProfile: !!p.profile && p.profile.trim().length > 0,
        lastSeenAt: p.lastSeenAt?.toISOString() ?? p.updatedAt.toISOString(),
      }
    })

    return NextResponse.json({ users, total: users.length })
  } catch (err) {
    console.error('[API] GET users list:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

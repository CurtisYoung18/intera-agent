// GET /api/auth/memberships — List all org memberships for the current user.
//
// Returns { orgs: Array<{ orgId, role, name }> }
// Used by the org-picker page to show available organizations.

import { NextResponse } from 'next/server'
import { getSession, getUserOrgs } from '@/lib/auth'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orgs = await getUserOrgs(session.userId)
    return NextResponse.json({ orgs })
  } catch (err) {
    console.error('[Auth] memberships error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

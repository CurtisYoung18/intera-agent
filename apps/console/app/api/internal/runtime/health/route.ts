import { NextRequest, NextResponse } from 'next/server'

import { getRuntimeSessionStats } from '@/lib/agent/session-store'
import { isTrustedInternalCall } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  if (!isTrustedInternalCall(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const stats = getRuntimeSessionStats()
  return NextResponse.json({
    status: 'ok',
    sessions: stats.liveSessions,
    activeRuns: stats.activeRuns,
    queueDepth: stats.queueDepth,
    stats,
  })
}

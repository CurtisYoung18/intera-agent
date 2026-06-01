// Health check endpoint for load balancers and orchestration systems.
// Verifies the app process is alive and DB connectivity is functional.

import { prisma } from '@intera/shared/prisma'

export async function GET() {
  let dbOk = false
  try {
    await prisma.$queryRaw`SELECT 1`
    dbOk = true
  } catch {
    // DB unreachable
  }

  return Response.json(
    {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'connected' : 'unreachable',
      timestamp: new Date().toISOString(),
    },
    {
      status: dbOk ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}

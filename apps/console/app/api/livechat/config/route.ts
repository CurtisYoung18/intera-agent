// GET /api/livechat/config — Anonymous widget-facing route
// Returns only non-sensitive fields. Migrated to defineRoute (G1 contract seam).

import { NextResponse } from 'next/server'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export const GET = defineRoute({
  method: 'GET',
  auth: 'none',
  async handler({ session, repo }) {
    const row = await repo.liveChatConfig.findUnique({
      where: { orgId: session.orgId },
      select: { enabled: true, showSkillStatus: true, region: true },
    })

    return NextResponse.json({
      orgId: session.orgId,
      enabled: row?.enabled ?? false,
      showSkillStatus: row?.showSkillStatus ?? true,
      region: row?.region ?? 'dal',
    }, { headers: CORS })
  },
})

// PUT intentionally removed — writes are gated at /api/admin/livechat/config

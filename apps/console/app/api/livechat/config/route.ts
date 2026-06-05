// GET /api/livechat/config — Anonymous widget-facing route
// Returns only non-sensitive fields from channel_bindings.
// Does NOT use getLiveChatConfig because this route must return the config
// even when enabled=false. Migrated to defineRoute (G1 contract seam).

import { NextResponse } from 'next/server'
import { defineRoute } from '@/lib/api/define-route'
import { prisma } from '@intera/shared/prisma'

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
  async handler({ session }) {
    // Read directly (bypass config-store enabled filter)
    const cbRow = await prisma.channelBinding.findFirst({
      where: { orgId: session.orgId, channel: 'livechat', agentName: null },
      select: { enabled: true, credentials: true },
    })

    if (!cbRow) {
      return NextResponse.json({
        orgId: session.orgId,
        enabled: false,
        showSkillStatus: true,
        region: 'dal',
      }, { headers: CORS })
    }

    let creds: Record<string, unknown> = {}
    try { creds = JSON.parse(cbRow.credentials) } catch { /* keep empty */ }
    return NextResponse.json({
      orgId: session.orgId,
      enabled: cbRow.enabled,
      showSkillStatus: (creds.showSkillStatus as boolean) ?? true,
      region: (creds.region as string) ?? 'dal',
    }, { headers: CORS })
  },
})

// PUT intentionally removed — writes are gated at /api/admin/livechat/config

// apps/chat/app/api/livechat/groups/route.ts
// Proxies LiveChat list_groups API — called by Console to populate the group picker.

import { NextRequest, NextResponse } from 'next/server'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { listGroups } from '@/lib/livechat/livechat-api'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...(init?.headers as Record<string, string> ?? {}), ...CORS } })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId') ?? 'default'

  try {
    const config = await getLiveChatConfig(orgId)
    if (!config) {
      return json({ groups: [] })
    }

    const groups = await listGroups(config.botAccessToken, config.licenseId, config.region, config.authType, config.accountId)
    return json({ groups })
  } catch (err) {
    console.error('[LiveChat] Failed to list groups:', err)
    return json({ groups: [], error: 'Failed to fetch groups' }, { status: 502 })
  }
}

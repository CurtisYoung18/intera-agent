// apps/chat/app/api/livechat/groups/route.ts
// Proxies LiveChat list_groups API — called by Console to populate the group picker.

import { NextRequest, NextResponse } from 'next/server'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { listGroups } from '@/lib/livechat/livechat-api'

export async function GET(request: NextRequest) {
  const customerId = request.nextUrl.searchParams.get('customerId') ?? 'default'

  try {
    const config = await getLiveChatConfig(customerId)
    if (!config) {
      return NextResponse.json({ groups: [] })
    }

    const groups = await listGroups(config.botAccessToken, config.licenseId)
    return NextResponse.json({ groups })
  } catch (err) {
    console.error('[LiveChat] Failed to list groups:', err)
    return NextResponse.json({ groups: [], error: 'Failed to fetch groups' }, { status: 502 })
  }
}

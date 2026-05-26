// apps/chat/app/api/livechat/config/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getLiveChatConfig, upsertLiveChatConfig } from '@/lib/livechat/config-store'

export async function GET(request: NextRequest) {
  const customerId = request.nextUrl.searchParams.get('customerId') ?? 'default'
  const config = await getLiveChatConfig(customerId)
  if (!config) {
    return NextResponse.json({
      customerId,
      botAccessToken: '',
      licenseId: '',
      showSkillStatus: true,
      enabled: false,
    })
  }
  // Mask the token in GET response — Console only needs to know it's set
  return NextResponse.json({
    ...config,
    botAccessToken: config.botAccessToken ? '••••••••' : '',
  })
}

export async function PUT(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { customerId, botAccessToken, licenseId, showSkillStatus, enabled } = body as {
    customerId: string
    botAccessToken: string
    licenseId: string
    showSkillStatus: boolean
    enabled: boolean
  }

  if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 })

  // If botAccessToken is the mask string, preserve the existing token
  let tokenToSave = botAccessToken
  if (botAccessToken === '••••••••') {
    const existing = await getLiveChatConfig(customerId)
    tokenToSave = existing?.botAccessToken ?? ''
  }

  await upsertLiveChatConfig(customerId, {
    botAccessToken: tokenToSave,
    licenseId: licenseId ?? '',
    showSkillStatus: showSkillStatus ?? true,
    enabled: enabled ?? false,
  })

  return NextResponse.json({ ok: true })
}

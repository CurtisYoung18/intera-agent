// apps/chat/app/api/livechat/config/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getLiveChatConfig, upsertLiveChatConfig } from '@/lib/livechat/config-store'
import { prisma } from '@intera/shared/prisma'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...(init?.headers as Record<string, string> ?? {}), ...CORS } })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  const vendorId = request.nextUrl.searchParams.get('vendorId') ?? 'default'
  const config = await getLiveChatConfig(vendorId)
  if (!config) {
    return json({ vendorId, botAccessToken: '', licenseId: '', webhookSecret: '', showSkillStatus: true, enabled: false })
  }
  return json({
    ...config,
    botAccessToken: config.botAccessToken ? '••••••••' : '',
    webhookSecret: config.webhookSecret ? '••••••••' : '',
  })
}

export async function PUT(request: NextRequest) {
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { vendorId, botAccessToken, licenseId, webhookSecret, region, authType, accountId, agentAccountId, showSkillStatus, enabled, transferGroupId, transferMessage } = body as {
    vendorId: string; botAccessToken: string; licenseId: string; webhookSecret?: string
    region?: string; authType?: string; accountId?: string; agentAccountId?: string
    showSkillStatus: boolean; enabled: boolean
    transferGroupId?: number; transferMessage?: string
  }

  if (!vendorId) return json({ error: 'vendorId required' }, { status: 400 })

  let tokenToSave = botAccessToken
  let secretToSave = webhookSecret ?? ''
  if (botAccessToken === '••••••••' || webhookSecret === '••••••••') {
    const existing = await prisma.liveChatConfig.findUnique({
      where: { vendorId }, select: { botAccessToken: true, webhookSecret: true },
    })
    if (botAccessToken === '••••••••') tokenToSave = existing?.botAccessToken ?? ''
    if (webhookSecret === '••••••••') secretToSave = existing?.webhookSecret ?? ''
  }

  await upsertLiveChatConfig(vendorId, {
    botAccessToken: tokenToSave, licenseId: licenseId ?? '',
    webhookSecret: secretToSave,
    region: region ?? undefined,
    authType: (authType as 'bearer' | 'basic' | 'auto' | undefined) ?? undefined,
    accountId: accountId ?? undefined,
    agentAccountId: agentAccountId ?? undefined,
    showSkillStatus: showSkillStatus ?? true, enabled: enabled ?? false,
    transferGroupId: transferGroupId ?? undefined,
    transferMessage: transferMessage ?? undefined,
  })

  return json({ ok: true })
}

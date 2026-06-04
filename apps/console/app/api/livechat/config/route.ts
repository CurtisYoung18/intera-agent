// GET /api/livechat/config — Anonymous widget-facing route.
// Returns only non-sensitive fields (no secrets, no transfer routing).
// orgId comes from the widget embed query param (no session required).
//
// B1 fix: PUT was moved to the gated /api/admin/livechat/config route.
// This route no longer accepts writes.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...(init?.headers as Record<string, string> ?? {}), ...CORS },
  })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId') || 'default'

  const row = await prisma.liveChatConfig.findUnique({
    where: { orgId },
    select: { enabled: true, showSkillStatus: true, region: true },
  })

  // Widget-facing response: ONLY non-sensitive fields.
  // Never expose botAccessToken, licenseId, webhookSecret, transfer config.
  return json({
    orgId,
    enabled: row?.enabled ?? false,
    showSkillStatus: row?.showSkillStatus ?? true,
    region: row?.region ?? 'dal',
  })
}

// PUT intentionally removed — writes are gated at /api/admin/livechat/config

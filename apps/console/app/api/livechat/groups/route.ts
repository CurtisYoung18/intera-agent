// apps/chat/app/api/livechat/groups/route.ts
// Proxies LiveChat list_groups API — called by Console to populate the group picker.

import { NextRequest, NextResponse } from 'next/server'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { listGroups } from '@/lib/livechat/livechat-api'
import { getSession } from '@/lib/auth'

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
  const session = await getSession()
  const orgId = session?.orgId || request.nextUrl.searchParams.get('orgId') || 'default'

  try {
    const config = await getLiveChatConfig(orgId)
    if (!config) {
      return json({ groups: [] })
    }

    const groups = await listGroups(config.botAccessToken, config.licenseId, config.region, config.authType, config.accountId)
    return json({ groups })
  } catch (err) {
    console.error('[LiveChat] Failed to list groups:', err)

    // Classify the error to return a machine-readable code the frontend can map to i18n.
    const msg = String((err as Error)?.message ?? String(err) ?? '').toLowerCase()
    const code = inferErrorCode(err, msg)

    const messages: Record<string, string> = {
      credentials: 'Invalid credentials — check License ID / Bot token.',
      region: 'Region mismatch — token region differs from setting.',
      permission: 'Permission denied — token lacks required scope.',
      network: 'Network error — could not reach LiveChat.',
      unknown: 'Connection failed — check server logs for details.',
    }

    return json({ groups: [], error: messages[code], code }, { status: 502 })
  }
}

/** Map a thrown error to one of five stable error categories for the UI. */
function inferErrorCode(err: unknown, msg: string): string {
  // If the thrown error has a status-like property
  const status =
    (err as { status?: number })?.status ??
    (err as { statusCode?: number })?.statusCode

  if (status === 401) return 'credentials'
  if (status === 403) return 'permission'

  // Region mismatch: LiveChat API often returns a 4xx with a message hinting at region.
  if (msg.includes('region') || msg.includes('fra') || msg.includes('dal')) return 'region'

  // Network / fetch errors — no HTTP status available.
  const isNetwork =
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('abort')
  if (isNetwork) return 'network'

  return 'unknown'
}

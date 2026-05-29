// apps/chat/app/api/livechat/form-submit/route.ts
// BUG-F fix: SDK-independent form-result delivery.
//
// The form webview is served from our own domain, so it can POST answers
// straight here instead of relying on the LiveChat Moments SDK (which is not
// available inside a plain `webview` button iframe). We look up the bridge
// session by chatId, then drive the SAME path the webhook uses for
// `intera_form_submit` — handleIncomingEvent → /api/messages (formResult) →
// agent reply streamed back into the LiveChat chat via the bridge.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/livechat/session-store'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { handleIncomingEvent } from '@/lib/livechat/bridge'

export async function POST(request: NextRequest) {
  let body: { chatId?: unknown; caseId?: unknown; answers?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const chatId = typeof body.chatId === 'string' ? body.chatId : ''
  const caseId = typeof body.caseId === 'string' ? body.caseId : ''
  const answers = body.answers

  if (!chatId) {
    return NextResponse.json({ error: 'chatId is required' }, { status: 400 })
  }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return NextResponse.json({ error: 'answers must be an object' }, { status: 400 })
  }
  if (JSON.stringify(answers).length > 50_000) {
    return NextResponse.json({ error: 'answers too large (max 50KB)' }, { status: 413 })
  }

  // Normalize to Record<string, string>
  const normalized: Record<string, string> = {}
  for (const [k, v] of Object.entries(answers as Record<string, unknown>)) {
    if (v == null) continue
    normalized[k] = String(v)
  }

  const session = await getSession(chatId)
  if (!session) {
    return NextResponse.json({ error: 'Session not found for chatId' }, { status: 404 })
  }

  const config = await getLiveChatConfig(session.vendorId)
  if (!config?.enabled) {
    return NextResponse.json({ error: 'LiveChat channel not configured' }, { status: 404 })
  }

  // Fire the bridge (same as webhook's intera_form_submit). Do NOT await the full
  // agent turn — the reply streams back into the LiveChat chat via the bridge.
  // We return as soon as delivery is accepted so the webview can close promptly.
  handleIncomingEvent(
    chatId,
    session.vendorId,
    session.userId,
    { type: 'form_submit', form: { caseId: caseId || session.caseId, answers: normalized } },
    config,
  ).catch((err) => console.error('[FormSubmit] bridge error:', err))

  return NextResponse.json({ ok: true })
}

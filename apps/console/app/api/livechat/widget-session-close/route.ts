import { NextRequest, NextResponse } from 'next/server'
import { generateCaseId } from '@/lib/utils'
import { getSession, rotateSessionCase } from '@/lib/livechat/session-store'

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const chatId = typeof (body as { chatId?: unknown })?.chatId === 'string'
    ? (body as { chatId: string }).chatId.trim()
    : ''
  const orgId = typeof (body as { orgId?: unknown })?.orgId === 'string'
    ? (body as { orgId: string }).orgId.trim()
    : ''
  const agentConfigId = typeof (body as { agentConfigId?: unknown })?.agentConfigId === 'string'
    ? (body as { agentConfigId: string }).agentConfigId.trim()
    : ''

  if (!chatId) {
    return NextResponse.json({ error: 'chatId is required' }, { status: 400 })
  }
  if (!orgId) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }
  if (!agentConfigId) {
    return NextResponse.json({ error: 'agentConfigId is required' }, { status: 400 })
  }

  const session = await getSession(chatId)
  if (!session) {
    return NextResponse.json({ error: 'Session not found for chatId' }, { status: 404 })
  }
  if (session.orgId !== orgId || session.agentConfigId !== agentConfigId) {
    return NextResponse.json({ error: 'Session scope mismatch' }, { status: 403 })
  }

  await rotateSessionCase(chatId, generateCaseId())
  return NextResponse.json({ ok: true })
}

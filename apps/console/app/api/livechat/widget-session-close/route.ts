import { NextRequest, NextResponse } from 'next/server'
import { generateCaseId } from '@/lib/utils'
import { rotateSessionCase } from '@/lib/livechat/session-store'

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

  if (!chatId) {
    return NextResponse.json({ error: 'chatId is required' }, { status: 400 })
  }

  await rotateSessionCase(chatId, generateCaseId())
  return NextResponse.json({ ok: true })
}

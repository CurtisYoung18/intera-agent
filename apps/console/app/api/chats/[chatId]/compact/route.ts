// POST /api/chats/[chatId]/compact — Manually trigger chat memory compaction.
//
// Proxies to the chat app's /api/internal/compact-chat, which owns the LLM
// provider keys and compaction logic. The Console process does not have the
// MiniMax/DeepSeek keys, so it must NOT run compaction locally.

import { NextRequest, NextResponse } from 'next/server'


export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params
  try {
    const res = await fetch('/api/internal/compact-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId }),
    })
    const data = await res.json().catch(() => ({ error: 'Invalid response from chat engine' }))
    return NextResponse.json(data, { status: res.ok ? 200 : res.status })
  } catch (err) {
    console.error('[API] POST chat compact (proxy):', err)
    return NextResponse.json({ error: 'Chat engine unreachable' }, { status: 502 })
  }
}

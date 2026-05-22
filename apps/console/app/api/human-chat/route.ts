// POST /api/human-chat — runtime proxy to chat app (avoids build-time URL hardcoding)
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const chatBase = process.env.NEXT_PUBLIC_CHAT_API_URL ||
    process.env.RAILWAY_SERVICE_CHAT_URL ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    'http://localhost:3000'

  const url = `${chatBase.replace(/\/$/, '')}/api/human-chat`

  try {
    const body = await request.text()
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    })

    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    console.error('[Console human-chat proxy]', err)
    return new Response('Proxy error', { status: 502 })
  }
}

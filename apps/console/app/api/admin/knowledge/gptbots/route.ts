// GET /api/admin/knowledge/gptbots — Proxy GPTBots knowledge base list

import { NextResponse } from 'next/server'

const GPTBOTS_KB_API = 'https://api-sg.gptbots.ai/v1/bot/knowledge/base/page'
const API_KEY = process.env.GPTBOTS_API_KEY

export async function GET() {
  try {
    if (!API_KEY) {
      return NextResponse.json({ error: 'GPTBOTS_API_KEY not configured' }, { status: 503 })
    }

    const response = await fetch(GPTBOTS_KB_API, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `GPTBots API error: ${response.status}` },
        { status: 502 },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (err) {
    console.error('[Admin] GET gptbots KB list:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

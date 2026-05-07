import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { endpoint, httpMethod = 'POST', headers = '{}', timeoutMs = 8000 } = await req.json()
    if (!endpoint) return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })

    let parsedHeaders: Record<string, string> = {}
    try { parsedHeaders = JSON.parse(headers) } catch { /* use empty */ }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 15000))

    const start = Date.now()
    const res = await fetch(endpoint, {
      method: httpMethod,
      headers: { 'Content-Type': 'application/json', ...parsedHeaders },
      body: httpMethod === 'POST' ? JSON.stringify({ test: true }) : undefined,
      signal: controller.signal,
    })
    clearTimeout(timer)

    const latencyMs = Date.now() - start
    let body: unknown
    const text = await res.text()
    try { body = JSON.parse(text) } catch { body = text }

    return NextResponse.json({ ok: res.ok, status: res.status, latencyMs, body })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Request failed' }, { status: 500 })
  }
}

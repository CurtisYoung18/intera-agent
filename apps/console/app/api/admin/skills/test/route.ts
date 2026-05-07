import { NextResponse } from 'next/server'

const BLOCKED_HOSTS = [
  'localhost', '127.0.0.1', '0.0.0.0',
  'metadata.google.internal', '169.254.169.254',
  '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
  '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
  '172.30.', '172.31.', '192.168.',
]

function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true
    const hostname = parsed.hostname.toLowerCase()
    return BLOCKED_HOSTS.some(h => hostname === h || hostname.startsWith(h))
  } catch { return true }
}

export async function POST(req: Request) {
  try {
    const { endpoint, httpMethod = 'POST', headers = '{}', timeoutMs = 8000 } = await req.json()
    if (!endpoint || typeof endpoint !== 'string') {
      return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
    }
    if (isBlockedUrl(endpoint)) {
      return NextResponse.json({ error: 'URL not allowed (internal/private network blocked)' }, { status: 400 })
    }

    let parsedHeaders: Record<string, string> = {}
    try { parsedHeaders = JSON.parse(headers) } catch { /* use empty */ }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1000), 15000))

    const start = Date.now()
    const res = await fetch(endpoint, {
      method: httpMethod === 'GET' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...parsedHeaders },
      body: httpMethod === 'POST' ? JSON.stringify({ test: true }) : undefined,
      signal: controller.signal,
      redirect: 'error',
    })
    clearTimeout(timer)

    const latencyMs = Date.now() - start
    let body: unknown
    const text = await res.text()
    try { body = JSON.parse(text) } catch { body = text }

    return NextResponse.json({ ok: res.ok, status: res.status, latencyMs, body })
  } catch (e: any) {
    const msg = e.cause?.code || e.message
    return NextResponse.json({ error: typeof msg === 'string' ? msg : 'Request failed' }, { status: 500 })
  }
}

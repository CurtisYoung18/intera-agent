// POST /api/admin/skills/test — Test external endpoint (SSRF-protected)
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute, RouteError, ValidationError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

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

const testSchema = z.object({
  endpoint: z.string().min(1, 'endpoint is required'),
  httpMethod: z.enum(['GET', 'POST']).optional().default('POST'),
  headers: z.string().optional().default('{}'),
  timeoutMs: z.number().int().min(1000).max(15000).optional().default(8000),
})
type TestInput = z.infer<typeof testSchema>

export const POST = defineRoute<TestInput>({
  method: 'POST',
  inputSchema: testSchema,
  async handler({ input }) {
    if (isBlockedUrl(input.endpoint)) {
      throw new ValidationError('URL not allowed (internal/private network blocked)')
    }

    let parsedHeaders: Record<string, string> = {}
    try { parsedHeaders = JSON.parse(input.headers) } catch { /* use empty */ }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), input.timeoutMs)

    const start = Date.now()
    try {
      const res = await fetch(input.endpoint, {
        method: input.httpMethod,
        headers: { 'Content-Type': 'application/json', ...parsedHeaders },
        body: input.httpMethod === 'POST' ? JSON.stringify({ test: true }) : undefined,
        signal: controller.signal,
        redirect: 'error',
      })
      clearTimeout(timer)

      const latencyMs = Date.now() - start
      let body: unknown
      const text = await res.text()
      try { body = JSON.parse(text) } catch { body = text }

      return apiOk({ ok: res.ok, status: res.status, latencyMs, body })
    } catch (e: any) {
      clearTimeout(timer)
      const msg = e.cause?.code || e.message
      throw new RouteError('internal', typeof msg === 'string' ? msg : 'Request failed')
    }
  },
})

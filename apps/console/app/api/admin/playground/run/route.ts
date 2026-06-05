// POST /api/admin/playground/run — Playground debug endpoint (SSE streaming)
// Note: NOT wrapped by defineRoute because SSE streaming is incompatible with ApiEnvelope pattern.

import { NextRequest } from 'next/server'
import { getActiveOrgId, getActiveVendor } from '@/lib/auth'
import { runPlaygroundTurn, type PlaygroundConfig } from '@/lib/agent/playground-runner'
import type { SSEEvent, ContentBlock } from '@intera/shared/types'

const DEFAULT_PLAYGROUND_CONFIG: PlaygroundConfig = { debug: false }

export async function POST(request: NextRequest) {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return new Response(JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'Unauthorized — admin session required' } }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }
  let body: { message?: string; config?: Partial<PlaygroundConfig>; configId?: string | null; contentBlocks?: ContentBlock[] }
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ ok: false, error: { code: 'validation', message: 'Invalid JSON body' } }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  const message = (body.message as string)?.trim()
  if (!message || message.length > 5000) {
    return new Response(JSON.stringify({ ok: false, error: { code: 'validation', message: 'message required (max 5000 chars)' } }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  const playgroundConfig: PlaygroundConfig = { ...DEFAULT_PLAYGROUND_CONFIG, ...(body.config || {}) }
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)) } catch { /* client disconnected */ } }
      try {
        for await (const event of runPlaygroundTurn({ orgId, message, playgroundConfig, configId: body.configId ?? undefined, contentBlocks: body.contentBlocks })) { send(event) }
      } catch (err) {
        send({ type: 'error', data: { code: 'internal', message: err instanceof Error ? err.message : 'Internal error' }, timestamp: new Date().toISOString() })
      } finally { try { controller.close() } catch { /* ignore */ } }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  })
}

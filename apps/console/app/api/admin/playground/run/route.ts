// POST /api/admin/playground/run — Playground debug endpoint (SSE streaming)
// Note: NOT wrapped by defineRoute because SSE streaming is incompatible with ApiEnvelope pattern.

import { NextRequest } from 'next/server'
import { getActiveOrgId, getActiveVendor } from '@/lib/auth'
import { runPlaygroundTurn, type PlaygroundConfig } from '@/lib/agent/playground-runner'
import type { SSEEvent, ContentBlock } from '@intera/shared/types'

const DEFAULT_PLAYGROUND_CONFIG: PlaygroundConfig = { debug: false, toolExecutionMode: 'runtime' }

export async function POST(request: NextRequest) {
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return new Response(JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'Unauthorized — admin session required' } }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }
  let body: { message?: string; config?: Partial<PlaygroundConfig>; configId?: string | null; contentBlocks?: ContentBlock[]; chatId?: string }
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ ok: false, error: { code: 'validation', message: 'Invalid JSON body' } }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const contentBlocks = Array.isArray(body.contentBlocks) ? body.contentBlocks : []
  const hasContentBlock = contentBlocks.some((block) => {
    if (!block || typeof block !== 'object') return false
    const candidate = block as { type?: unknown; text?: unknown; source?: { type?: unknown; data?: unknown } }
    if (candidate.type === 'text') return typeof candidate.text === 'string' && candidate.text.trim().length > 0
    if (candidate.type === 'image') return candidate.source?.type === 'base64' && typeof candidate.source.data === 'string' && candidate.source.data.length > 0
    return false
  })
  if ((!message && !hasContentBlock) || message.length > 5000) {
    return new Response(JSON.stringify({ ok: false, error: { code: 'validation', message: 'message or image content required (message max 5000 chars)' } }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  const requestedConfig = body.config || {}
  const playgroundConfig: PlaygroundConfig = {
    ...DEFAULT_PLAYGROUND_CONFIG,
    ...requestedConfig,
    toolExecutionMode: requestedConfig.toolExecutionMode === 'dry_run' ? 'dry_run' : 'runtime',
  }
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)) } catch { /* client disconnected */ } }
      try {
        for await (const event of runPlaygroundTurn({ orgId, message, playgroundConfig, configId: body.configId ?? undefined, contentBlocks, chatId: body.chatId, userId: vendor.userId ?? 'playground' })) { send(event) }
      } catch (err) {
        send({ type: 'error', data: { code: 'internal', message: err instanceof Error ? err.message : 'Internal error' }, timestamp: new Date().toISOString() })
      } finally { try { controller.close() } catch { /* ignore */ } }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  })
}

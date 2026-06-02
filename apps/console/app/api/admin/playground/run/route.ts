// POST /api/admin/playground/run — Playground debug endpoint
// Runs a single agent turn with real config, dry-run tools, zero DB writes.
// Auth: admin cookie session only (not API key accessible).

import { NextRequest } from 'next/server'
import { getActiveOrgId, getActiveVendor } from '@/lib/auth'
import { runPlaygroundTurn, type PlaygroundConfig } from '@/lib/agent/playground-runner'
import type { SSEEvent } from '@intera/shared/types'

const DEFAULT_PLAYGROUND_CONFIG: PlaygroundConfig = {
  model: 'claude-sonnet',
  persona: 'concise',
  memory: true,
  knowledge: true,
  debug: false,
  guardrails: { pii: true, refundPolicy: true, profanity: true, escalation: true },
}

export async function POST(request: NextRequest) {
  // ── Auth: admin cookie only ──
  const orgId = await getActiveOrgId()
  const vendor = await getActiveVendor()
  if (!vendor?.isAuthed) {
    return new Response(JSON.stringify({ error: 'Unauthorized — admin session required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Parse body ──
  let body: { message?: string; config?: Partial<PlaygroundConfig>; configId?: string | null }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const message = (body.message as string)?.trim()
  if (!message || message.length > 5000) {
    return new Response(JSON.stringify({ error: 'message required (max 5000 chars)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const playgroundConfig: PlaygroundConfig = {
    ...DEFAULT_PLAYGROUND_CONFIG,
    ...body.config,
    guardrails: { ...DEFAULT_PLAYGROUND_CONFIG.guardrails, ...(body.config?.guardrails || {}) },
  }

  // ── SSE stream ──
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch { /* client disconnected */ }
      }

      try {
        for await (const event of runPlaygroundTurn({ orgId, message, playgroundConfig, configId: body.configId ?? undefined })) {
          send(event)
        }
      } catch (err) {
        send({
          type: 'error',
          data: err instanceof Error ? err.message : 'Internal error',
          timestamp: new Date().toISOString(),
        })
      } finally {
        try { controller.close() } catch { /* ignore */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

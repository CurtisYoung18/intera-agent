/**
 * POST /api/cases/[caseId]/message
 *
 * CC-aligned message injection endpoint.
 * Enqueues a message into the in-memory session for [caseId] and returns 200
 * immediately — the actual processing and streaming happen on the persistent
 * SSE connection at GET /api/cases/[caseId]/stream.
 *
 * If no session exists yet (POST arrived before SSE opened), we pre-create the
 * session entry so the message is buffered and picked up when SSE connects.
 *
 * Payload (same shape as /api/messages for compatibility):
 *   { message?, formResult?, interactionResult?, resumeTrigger?, orgId, userId }
 */

import { NextRequest, NextResponse } from 'next/server'
import { enqueueMessageOrCreate } from '@/lib/agent/session-store'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params

  // Validate caseId
  if (!caseId || !/^[a-zA-Z0-9_-]+$/.test(caseId) || caseId.length > 128) {
    return NextResponse.json({ error: 'Invalid caseId' }, { status: 400 })
  }

  // Body size guard
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > 100_000) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    message,
    formResult,
    interactionResult,
    resumeTrigger,
    contentBlocks,
  } = body as {
    message?: string
    formResult?: { caseId?: string; answers: Record<string, string> }
    interactionResult?: { caseId?: string; optionId: string; input?: string }
    resumeTrigger?: string
    orgId?: string
    userId?: string
    contentBlocks?: { type: string; text?: string; source?: { type: string; media_type: string; data: string } }[]
  }

  // ── Build content string from whichever trigger fired ──────────────────────

  let content: string | undefined
  let formAnswers: Record<string, string> | undefined

  if (formResult && !message) {
    // Form submission: mirror /api/messages encoding
    const answers = (formResult.answers || {}) as Record<string, string>
    const answersJson = JSON.stringify(answers)
    if (answersJson.length > 50_000) {
      return NextResponse.json({ error: 'Form answers too large' }, { status: 413 })
    }
    formAnswers = answers
    content = `Tool request_user_input result: ${answersJson}`
  } else if (interactionResult && !message && !formResult) {
    const { optionId, input } = interactionResult
    if (!optionId || typeof optionId !== 'string' || optionId.length > 256) {
      return NextResponse.json({ error: 'Invalid interaction option' }, { status: 400 })
    }
    const payload: Record<string, unknown> = { optionId }
    if (input) payload.input = input
    content = `Tool request_user_input result: ${JSON.stringify(payload)}`
  } else if (resumeTrigger && !message) {
    // Human task resume — resolve via DB then inject
    // (Actual DB lookup happens inside the stream route's maybeInjectHumanTaskResume)
    content = `__RESUME__:${resumeTrigger}`
  } else if (message) {
    if (typeof message !== 'string' || message.length > 50_000) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 })
    }
    content = message
  }

  if (!content) {
    return NextResponse.json({ error: 'No actionable payload (message, formResult, interactionResult, or resumeTrigger required)' }, { status: 400 })
  }

  // ── Enqueue (creates session entry if needed) ──────────────────────────────
  enqueueMessageOrCreate(caseId, { content, formAnswers, contentBlocks: contentBlocks as any })

  return NextResponse.json({ ok: true, caseId, queued: true })
}

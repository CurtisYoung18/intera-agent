// POST /api/admin/playground/save-to-chat — Save a playground dry-run transcript as a tagged test Case
import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

const saveSchema = z.object({
  agentId: z.string(),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
      thinking: z.string().optional(),
    }),
  ),
  traces: z.array(z.any()).optional(),
})

interface CanonicalTraceRow {
  actionType: string
  title?: string | null
  detail?: string | null
  payload?: unknown
  createdAt?: string | null
}

function serializeTracePayload(payload: unknown): string | null {
  if (payload == null) return null
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload)
  } catch {
    return null
  }
}

function parseTraceCreatedAt(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function normalizeSavedTraceRows(turnTraces: unknown[]): CanonicalTraceRow[] {
  const rows: CanonicalTraceRow[] = []

  for (const step of turnTraces) {
    if (!step || typeof step !== 'object') continue

    const canonicalRows = Array.isArray((step as { json?: unknown[] }).json)
      ? ((step as { json?: unknown[] }).json ?? []).filter((candidate): candidate is CanonicalTraceRow => {
          return !!candidate && typeof candidate === 'object' && typeof (candidate as CanonicalTraceRow).actionType === 'string'
        })
      : []

    if (canonicalRows.length > 0) {
      rows.push(...canonicalRows)
      continue
    }

    const stage = typeof (step as { stage?: unknown }).stage === 'string' ? (step as { stage: string }).stage : null
    if (!stage) continue

    const usage = (step as { usage?: { inputTokens?: number; outputTokens?: number } }).usage
    const ms = typeof (step as { ms?: unknown }).ms === 'number' ? (step as { ms: number }).ms : 0
    const fired = (step as { fired?: unknown }).fired
    rows.push({
      actionType: stage,
      title: typeof (step as { summary?: unknown }).summary === 'string' ? (step as { summary: string }).summary : stage,
      detail:
        fired === false
          ? 'skipped'
          : `${ms}ms${usage ? ` · ↑${usage.inputTokens ?? 0}↓${usage.outputTokens ?? 0}` : ''}`,
      payload: usage ? { usage, ms, fired } : null,
    })
  }

  return rows
}

export const POST = defineRoute({
  method: 'POST',
  inputSchema: saveSchema,
  requireRole: ['admin', 'owner', 'operator'],
  async handler({ input, repo }) {
    const chatId = `pg_saved_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const userId = `playground-test-${Date.now()}`

    const newCase = await repo.case.create({
      data: {
        userId,
        chatId,
        type: 'playground',
        source: 'playground',
        status: 'resolved',
        goal: `Playground test — ${input.agentId}`,
      },
    })

    for (const msg of input.messages) {
      await repo.raw.message.create({
        data: {
          caseId: newCase.id,
          orgId: repo.orgId,
          chatId,
          runId: null,
          role: msg.role,
          content: msg.content,
        },
      })
    }

    // Persist ActionTrace rows from the dry-run traces so the chat detail page shows stats
    if (input.traces) {
      for (const turnTraces of input.traces) {
        for (const traceRow of normalizeSavedTraceRows(Array.isArray(turnTraces) ? turnTraces : [])) {
          await repo.raw.actionTrace.create({
            data: {
              caseId: newCase.id,
              orgId: repo.orgId,
              chatId,
              runId: null,
              actionType: traceRow.actionType,
              title: traceRow.title || traceRow.actionType,
              detail: traceRow.detail ?? null,
              payload: serializeTracePayload(traceRow.payload),
              createdAt: parseTraceCreatedAt(traceRow.createdAt),
            },
          })
        }
      }
    }

    return apiOk({ caseId: newCase.id, chatId })
  },
})

// GET /api/admin/playground/sessions/[chatId] — Restore session messages
// DELETE /api/admin/playground/sessions/[chatId] — Reset (delete session)

import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { getActiveVendor } from '@/lib/auth'
import { hydrateMessageFromDb, isCustomerVisibleMessage } from '@/lib/agent/provider-transcript'
import { z } from 'zod'

/** Extract agent config id from chatId format pg_{configId}_{timestamp}_{random}. */
function extractConfigId(chatId: string): string | null {
  if (!chatId.startsWith('pg_')) return null
  const rest = chatId.slice(3)
  const parts = rest.split('_')
  // Last part is random, second-to-last is numeric timestamp
  if (parts.length < 3) return null
  return parts.slice(0, -2).join('_')
}

const querySchema = z.object({
  configId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>, { chatId: string }>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  requireRole: ['admin', 'owner', 'operator'],
  async handler({ input, params, repo }) {
    const vendor = await getActiveVendor()
    if (!vendor?.isAuthed || !vendor.userId) {
      throw new NotFoundError('Session not found')
    }

    const c = await repo.raw.case.findFirst({
      where: {
        orgId: repo.orgId,
        chatId: params.chatId,
        type: 'playground',
        userId: vendor.userId,
      },
      select: { id: true },
    })
    if (!c) throw new NotFoundError('Session not found')

    const messages = await repo.raw.message.findMany({
      where: { caseId: c.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, contentBlocks: true, providerContent: true, providerMeta: true, createdAt: true },
    })

    // Load traces for this case
    const traces = await repo.raw.actionTrace.findMany({
      where: { caseId: c.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, actionType: true, title: true, detail: true, payload: true, createdAt: true },
    })

    // Load tool renderHints for the agent config so the frontend can
    // rebuild liveTools (RenderHintCard components) on session restore.
    const configId = input?.configId || extractConfigId(params.chatId)
    let renderHintsMap: Record<string, unknown> = {}
    if (configId) {
      try {
        const config = await repo.raw.agentConfig.findFirst({
          where: { id: configId, orgId: repo.orgId },
          select: { id: true },
        })
        const tools = config
          ? await repo.raw.tool.findMany({
              where: {
                agentConfigId: config.id,
                renderHints: { not: null },
              },
              select: { name: true, renderHints: true },
            })
          : []
        for (const tool of tools) {
          try {
            if (tool.renderHints) {
              renderHintsMap[tool.name] = JSON.parse(tool.renderHints)
            }
          } catch { /* ignore invalid JSON */ }
        }
      } catch { /* non-critical; best-effort */ }
    }

    return apiOk({
      chatId: params.chatId,
      messages: messages.map((m) => hydrateMessageFromDb(m as any)).filter(isCustomerVisibleMessage).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        contentBlocks: m.contentBlocks,
        createdAt: m.createdAt.toISOString(),
      })),
      traces: traces.map((t) => ({
        id: t.id,
        actionType: t.actionType,
        title: t.title,
        detail: t.detail,
        payload: t.payload,
        createdAt: t.createdAt.toISOString(),
      })),
      renderHintsMap,
    })
  },
})

export const DELETE = defineRoute<void, { chatId: string }>({
  method: 'DELETE',
  requireRole: ['admin', 'owner', 'operator'],
  async handler({ params, repo }) {
    const vendor = await getActiveVendor()
    if (!vendor?.isAuthed || !vendor.userId) {
      throw new NotFoundError('Session not found')
    }

    const c = await repo.raw.case.findFirst({
      where: {
        orgId: repo.orgId,
        chatId: params.chatId,
        type: 'playground',
        userId: vendor.userId,
      },
      select: { id: true },
    })
    if (!c) throw new NotFoundError('Session not found')

    // CASCADE deletes all messages
    await repo.raw.case.delete({ where: { id: c.id } })

    return apiOk({ ok: true })
  },
})

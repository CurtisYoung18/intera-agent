// GET /api/admin/playground/sessions/[chatId] — Restore session messages
// DELETE /api/admin/playground/sessions/[chatId] — Reset (delete session)

import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { getActiveVendor } from '@/lib/auth'

export const GET = defineRoute<void, { chatId: string }>({
  method: 'GET',
  requireRole: ['admin', 'owner', 'operator'],
  async handler({ params, repo }) {
    const vendor = await getActiveVendor()
    if (!vendor?.isAuthed || !vendor.userId) {
      throw new NotFoundError('Session not found')
    }

    const c = await repo.raw.case.findFirst({
      where: { chatId: params.chatId, type: 'playground', userId: vendor.userId },
      select: { id: true },
    })
    if (!c) throw new NotFoundError('Session not found')

    const messages = await repo.raw.message.findMany({
      where: { caseId: c.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, contentBlocks: true, createdAt: true },
    })

    // Load traces for this case
    const traces = await repo.raw.actionTrace.findMany({
      where: { caseId: c.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, actionType: true, title: true, detail: true, payload: true, createdAt: true },
    })

    return apiOk({
      chatId: params.chatId,
      messages: messages.map((m) => ({
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
      where: { chatId: params.chatId, type: 'playground', userId: vendor.userId },
      select: { id: true },
    })
    if (!c) throw new NotFoundError('Session not found')

    // CASCADE deletes all messages
    await repo.raw.case.delete({ where: { id: c.id } })

    return apiOk({ ok: true })
  },
})

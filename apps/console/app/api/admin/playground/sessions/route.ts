// GET /api/admin/playground/sessions — List playground sessions for the current admin account

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { getActiveVendor } from '@/lib/auth'

export const GET = defineRoute({
  method: 'GET',
  requireRole: ['admin', 'owner', 'operator'],
  async handler({ repo }) {
    const vendor = await getActiveVendor()
    if (!vendor?.isAuthed || !vendor.userId) {
      return apiOk({ sessions: [] })
    }

    const cases = await repo.raw.case.findMany({
      where: { userId: vendor.userId, type: 'playground' },
      orderBy: { createdAt: 'desc' },
      select: {
        chatId: true,
        createdAt: true,
        messages: {
          take: 1,
          orderBy: { createdAt: 'asc' },
          select: { content: true },
        },
      },
    })

    const sessions = cases.map((c) => ({
      chatId: c.chatId,
      firstMessage: c.messages[0]?.content?.slice(0, 100) ?? '',
      createdAt: c.createdAt.toISOString(),
    }))

    return apiOk({ sessions })
  },
})

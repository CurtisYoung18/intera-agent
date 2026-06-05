// GET /api/admin/playground/sessions — List playground sessions scoped by (account, agent)

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { getActiveVendor } from '@/lib/auth'

const querySchema = z.object({
  configId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  requireRole: ['admin', 'owner', 'operator'],
  async handler({ input, repo }) {
    const vendor = await getActiveVendor()
    if (!vendor?.isAuthed || !vendor.userId) {
      return apiOk({ sessions: [] })
    }

    const configId = input?.configId || 'default'

    const cases = await repo.raw.case.findMany({
      where: {
        userId: vendor.userId,
        type: 'playground',
        chatId: { startsWith: `pg_${configId}_` },
      },
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

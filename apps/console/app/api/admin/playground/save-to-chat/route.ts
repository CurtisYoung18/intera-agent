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
          role: msg.role,
          content: msg.content,
        },
      })
    }

    return apiOk({ caseId: newCase.id, chatId })
  },
})

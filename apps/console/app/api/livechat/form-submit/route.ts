// POST /api/livechat/form-submit — Anonymous form-result delivery
// Migrated to defineRoute (G1 contract seam).

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { getSession } from '@/lib/livechat/session-store'
import { getLiveChatConfigForFamily } from '@/lib/livechat/config-store'
import { handleIncomingEvent } from '@/lib/livechat/bridge'

const formSchema = z.object({
  chatId: z.string().min(1, 'chatId is required'),
  orgId: z.string().min(1, 'orgId is required'),
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
  caseId: z.string().optional().default(''),
  answers: z.record(z.unknown()).refine(v => !Array.isArray(v), 'answers must be an object'),
}).refine(data => JSON.stringify(data.answers).length <= 50_000, 'answers too large (max 50KB)')

export const POST = defineRoute<z.infer<typeof formSchema>>({
  method: 'POST',
  auth: 'none',
  inputSchema: formSchema,
  async handler({ input }) {
    const normalized: Record<string, string> = {}
    for (const [k, v] of Object.entries(input.answers)) {
      if (v == null) continue
      normalized[k] = String(v)
    }

    const session = await getSession(input.chatId)
    if (!session) return NextResponse.json({ error: 'Session not found for chatId' }, { status: 404 })
    if (session.orgId !== input.orgId || session.agentConfigId !== input.agentConfigId) {
      return NextResponse.json({ error: 'Session scope mismatch' }, { status: 403 })
    }

    const resolvedAgentConfigId = session.agentConfigId
    const config = await getLiveChatConfigForFamily(session.agentConfigId)

    if (!config?.enabled) {
      return NextResponse.json({ error: 'LiveChat channel not configured' }, { status: 404 })
    }

    handleIncomingEvent(
      input.chatId, session.orgId, session.userId,
      { type: 'form_submit', form: { caseId: input.caseId || session.caseId, answers: normalized } },
      config,
      resolvedAgentConfigId,
    ).catch(err => console.error('[FormSubmit] bridge error:', err))

    return NextResponse.json({ ok: true })
  },
})

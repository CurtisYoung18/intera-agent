// POST /api/livechat/form-submit — Anonymous form-result delivery
// Migrated to defineRoute (G1 contract seam).

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { getSession } from '@/lib/livechat/session-store'
import { getLiveChatConfigForFamily, getLiveChatConfigForOrg } from '@/lib/livechat/config-store'
import { handleIncomingEvent } from '@/lib/livechat/bridge'
import { validateFormAnswers } from '@/lib/livechat/form-validation'

const fieldSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.enum(['text', 'number', 'select', 'textarea', 'file', 'date']),
  label: z.string().min(1).max(200),
  required: z.boolean().optional(),
  options: z.array(z.string().min(1).max(200)).max(50).optional(),
  placeholder: z.string().max(400).optional(),
  validation: z.object({
    dateRange: z.object({
      pairId: z.string().min(1).max(120).optional(),
      role: z.enum(['start', 'end']),
    }).optional(),
  }).optional(),
})

const formSchema = z.object({
  chatId: z.string().min(1, 'chatId is required'),
  caseId: z.string().optional().default(''),
  toolCallId: z.string().min(1).max(200).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  fields: z.array(fieldSchema).max(30).optional(),
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

    const validation = validateFormAnswers(input.fields, normalized)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const session = await getSession(input.chatId)
    if (!session) return NextResponse.json({ error: 'Session not found for chatId' }, { status: 404 })

    let resolvedAgentConfigId = session.agentConfigId
    let config = session.agentConfigId
      ? await getLiveChatConfigForFamily(session.agentConfigId)
      : null

    if (!config?.enabled) {
      const fallback = await getLiveChatConfigForOrg(session.orgId)
      resolvedAgentConfigId = fallback?.agentConfigId
      config = fallback?.config ?? null
    }

    if (!config?.enabled) return NextResponse.json({ error: 'LiveChat channel not configured' }, { status: 404 })

    handleIncomingEvent(
      input.chatId, session.orgId, session.userId,
      {
        type: 'form_submit',
        form: {
          caseId: input.caseId || session.caseId,
          answers: normalized,
          ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.fields?.length ? { fields: input.fields } : {}),
        },
      },
      config,
      resolvedAgentConfigId,
    ).catch(err => console.error('[FormSubmit] bridge error:', err))

    return NextResponse.json({ ok: true })
  },
})

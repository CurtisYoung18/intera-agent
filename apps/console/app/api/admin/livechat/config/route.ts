// GET + PUT /api/admin/livechat/config — Gated admin route.
// orgId is STRICTLY from the verified session (never from body or query param).
// Replaces the unauthenticated /api/livechat/config PUT (B1 fix).

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { getLiveChatConfig, upsertLiveChatConfig } from '@/lib/livechat/config-store'
import { z } from 'zod'

const livechatConfigSchema = z.object({
  botAccessToken: z.string(),
  licenseId: z.string(),
  webhookSecret: z.string().optional(),
  region: z.string().optional(),
  authType: z.enum(['bearer', 'basic', 'auto']).optional(),
  accountId: z.string().optional(),
  agentAccountId: z.string().optional(),
  showSkillStatus: z.boolean(),
  enabled: z.boolean(),
  transferGroupId: z.number().optional(),
  transferMessage: z.string().optional(),
})

export const GET = defineRoute({
  method: 'GET',
  async handler({ session }) {
    const config = await getLiveChatConfig(session.orgId)
    if (!config) {
      return apiOk({ config: { orgId: session.orgId, enabled: false } })
    }
    return apiOk({
      config: {
        ...config,
        botAccessToken: config.botAccessToken ? '••••••••' : '',
        webhookSecret: config.webhookSecret ? '••••••••' : '',
      },
    })
  },
})

export const PUT = defineRoute({
  method: 'PUT',
  inputSchema: livechatConfigSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, session, audit }) {
    // Preserve existing secrets when masked value is sent
    if (input.botAccessToken === '••••••••' || input.webhookSecret === '••••••••') {
      const existing = await getLiveChatConfig(session.orgId)
      if (existing) {
        if (input.botAccessToken === '••••••••') input.botAccessToken = existing.botAccessToken
        if (input.webhookSecret === '••••••••') input.webhookSecret = existing.webhookSecret ?? ''
      }
    }

    await upsertLiveChatConfig(session.orgId, input)
    await audit({ action: 'livechat.config.update', target: `org:${session.orgId}` })

    return apiOk({ ok: true })
  },
})

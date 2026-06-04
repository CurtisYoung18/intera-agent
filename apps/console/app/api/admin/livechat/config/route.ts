// GET + PUT /api/admin/livechat/config — Gated admin route.
// orgId is STRICTLY from the verified session (never from body or query param).
// Replaces the unauthenticated /api/livechat/config PUT (B1 fix).

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
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
  async handler({ session, repo }) {
    const config = await repo.liveChatConfig.findUnique({ where: { orgId: session.orgId } })
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
  async handler({ input, session, repo, audit }) {
    let tokenToSave = input.botAccessToken
    let secretToSave = input.webhookSecret ?? ''

    // Preserve existing secrets when masked value is sent
    if (input.botAccessToken === '••••••••' || input.webhookSecret === '••••••••') {
      const existing = await repo.raw.liveChatConfig.findUnique({
        where: { orgId: session.orgId },
        select: { botAccessToken: true, webhookSecret: true },
      })
      if (input.botAccessToken === '••••••••') tokenToSave = existing?.botAccessToken ?? ''
      if (input.webhookSecret === '••••••••') secretToSave = existing?.webhookSecret ?? ''
    }

    await repo.liveChatConfig.upsert({
      where: { orgId: session.orgId },
      create: {
        orgId: session.orgId,
        botAccessToken: tokenToSave,
        licenseId: input.licenseId,
        webhookSecret: secretToSave,
        region: input.region ?? 'dal',
        authType: input.authType ?? 'auto',
        accountId: input.accountId ?? null,
        agentAccountId: input.agentAccountId ?? null,
        showSkillStatus: input.showSkillStatus,
        enabled: input.enabled,
        transferGroupId: input.transferGroupId ?? null,
        transferMessage: input.transferMessage ?? null,
      },
      update: {
        botAccessToken: tokenToSave,
        licenseId: input.licenseId,
        webhookSecret: secretToSave,
        region: input.region ?? 'dal',
        authType: input.authType ?? 'auto',
        accountId: input.accountId ?? null,
        agentAccountId: input.agentAccountId ?? null,
        showSkillStatus: input.showSkillStatus,
        enabled: input.enabled,
        transferGroupId: input.transferGroupId ?? null,
        transferMessage: input.transferMessage ?? null,
      },
    })

    await audit({ action: 'livechat.config.update', target: `org:${session.orgId}` })

    return apiOk({ ok: true })
  },
})

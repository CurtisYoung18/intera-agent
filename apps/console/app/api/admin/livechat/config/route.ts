// GET + PUT /api/admin/livechat/config — Gated admin route.
// agentConfigId is from the verified session or query param.
// Replaces the old orgId + agentName scoping with agentConfigId.

import { NextRequest } from 'next/server'
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

export async function GET(request: NextRequest) {
  const agentConfigId = request.nextUrl.searchParams.get('agentConfigId')

  return defineRoute({
    method: 'GET',
    async handler({}) {
      if (!agentConfigId) {
        return apiOk({
          config: {
            agentConfigId: '',
            botAccessToken: '',
            licenseId: '',
            showSkillStatus: true,
            enabled: false,
          },
        })
      }

      const config = await getLiveChatConfig(agentConfigId)

      if (!config) {
        return apiOk({
          config: {
            agentConfigId,
            botAccessToken: '',
            licenseId: '',
            showSkillStatus: true,
            enabled: false,
          },
        })
      }
      return apiOk({
        config: {
          ...config,
          agentConfigId,
          botAccessToken: config.botAccessToken ? '••••••••' : '',
          webhookSecret: config.webhookSecret ? '••••••••' : '',
        },
      })
    },
  })(request)
}

export async function PUT(request: NextRequest) {
  const agentConfigId = request.nextUrl.searchParams.get('agentConfigId')

  return defineRoute({
    method: 'PUT',
    inputSchema: livechatConfigSchema,
    requireRole: ['admin', 'owner'],
    async handler({ input, audit }) {
      if (!agentConfigId) {
        return apiOk({ ok: false, error: 'agentConfigId query param is required' })
      }

      // Preserve existing secrets when masked value is sent
      if (input.botAccessToken === '••••••••' || input.webhookSecret === '••••••••') {
        const existing = await getLiveChatConfig(agentConfigId)
        if (existing) {
          if (input.botAccessToken === '••••••••') input.botAccessToken = existing.botAccessToken
          if (input.webhookSecret === '••••••••') input.webhookSecret = existing.webhookSecret ?? ''
        }
      }

      await upsertLiveChatConfig(agentConfigId, input)
      await audit({
        action: 'livechat.config.update',
        target: `agent_config:${agentConfigId}`,
      })

      return apiOk({ ok: true })
    },
  })(request)
}

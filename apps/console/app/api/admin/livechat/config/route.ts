// GET + PUT /api/admin/livechat/config — Gated admin route.
// agentConfigId is from the verified session or query param.
// Replaces the old orgId + agentName scoping with agentConfigId.

import { NextRequest } from 'next/server'
import { defineRoute, ValidationError } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  getLiveChatConfigForFamily,
  resolveLiveChatFamilyAnchorId,
  upsertLiveChatConfigForFamily,
} from '@/lib/livechat/config-store'
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
  playerIdGuideImageUrl: z.string().optional(),
  failureMessages: z.object({
    engine_unreachable: z.string().optional(),
    stream_truncated: z.string().optional(),
    action_failed: z.string().optional(),
  }).optional(),
})

export async function GET(request: NextRequest) {
  const agentConfigId = request.nextUrl.searchParams.get('agentConfigId')

  return defineRoute({
    method: 'GET',
    async handler({ repo }) {
      if (!agentConfigId) {
        return apiOk({
          config: {
            agentConfigId: '',
            webhookAgentConfigId: '',
            botAccessToken: '',
            licenseId: '',
            showSkillStatus: true,
            enabled: false,
            failureMessages: {},
          },
        })
      }

      await assertAgentInOrg(repo, agentConfigId)
      const webhookAgentConfigId = await resolveLiveChatFamilyAnchorId(agentConfigId)

      const config = await getLiveChatConfigForFamily(agentConfigId)

      if (!config) {
        return apiOk({
          config: {
            agentConfigId,
            webhookAgentConfigId,
            botAccessToken: '',
            licenseId: '',
            showSkillStatus: true,
            enabled: false,
            failureMessages: {},
          },
        })
      }
      return apiOk({
        config: {
          ...config,
          agentConfigId,
          webhookAgentConfigId,
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
    async handler({ input, audit, repo }) {
      if (!agentConfigId) {
        return apiOk({ ok: false, error: 'agentConfigId query param is required' })
      }

      await assertAgentInOrg(repo, agentConfigId)

      // Preserve existing secrets when masked value is sent
      if (input.botAccessToken === '••••••••' || input.webhookSecret === '••••••••') {
        const existing = await getLiveChatConfigForFamily(agentConfigId)
        if (existing) {
          if (input.botAccessToken === '••••••••') input.botAccessToken = existing.botAccessToken
          if (input.webhookSecret === '••••••••') input.webhookSecret = existing.webhookSecret ?? ''
        }
      }

      if (input.enabled) {
        const missingFields: Record<string, string> = {}
        if (!input.licenseId.trim()) missingFields.licenseId = 'License ID is required to enable LiveChat'
        if (!input.botAccessToken.trim()) missingFields.botAccessToken = 'Bot Access Token is required to enable LiveChat'
        if (Object.keys(missingFields).length > 0) {
          throw new ValidationError('Fill License ID and Bot Access Token before enabling LiveChat', missingFields)
        }
      }

      const webhookAgentConfigId = await upsertLiveChatConfigForFamily(agentConfigId, input)
      await audit({
        action: 'livechat.config.update',
        target: `agent_config:${webhookAgentConfigId}`,
        after: { selectedAgentConfigId: agentConfigId, webhookAgentConfigId },
      })

      return apiOk({ ok: true })
    },
  })(request)
}

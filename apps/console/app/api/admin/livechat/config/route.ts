// GET + PUT /api/admin/livechat/config — Gated admin route.
// orgId is STRICTLY from the verified session (never from body or query param).
// Optional ?agentName=<name> scopes to a specific agent's LiveChat config.
// Without agentName: org-default config. Replaces the unauthenticated
// /api/livechat/config PUT (B1 fix).

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

async function resolveAgentName(repo: any, orgId: string, agentName: string | null) {
  if (!agentName) return null
  const agentConfig = await repo.agentConfig.findFirst({
    where: { name: agentName, isActive: true },
    select: { id: true, name: true },
  })
  return agentConfig?.name ?? null
}

export async function GET(request: NextRequest) {
  const agentName = request.nextUrl.searchParams.get('agentName')

  return defineRoute({
    method: 'GET',
    async handler({ session, repo }) {
      const resolvedName = agentName ? await resolveAgentName(repo, session.orgId, agentName) : null
      const config = await getLiveChatConfig(session.orgId, resolvedName, false)

      if (!config) {
        return apiOk({
          config: {
            orgId: session.orgId,
            agentName: resolvedName ?? undefined,
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
          agentName: resolvedName ?? undefined,
          botAccessToken: config.botAccessToken ? '••••••••' : '',
          webhookSecret: config.webhookSecret ? '••••••••' : '',
        },
      })
    },
  })(request)
}

export async function PUT(request: NextRequest) {
  const agentName = request.nextUrl.searchParams.get('agentName')

  return defineRoute({
    method: 'PUT',
    inputSchema: livechatConfigSchema,
    requireRole: ['admin', 'owner'],
    async handler({ input, session, repo, audit }) {
      const resolvedName = agentName ? await resolveAgentName(repo, session.orgId, agentName) : null

      // Preserve existing secrets when masked value is sent
      if (input.botAccessToken === '••••••••' || input.webhookSecret === '••••••••') {
        const existing = await getLiveChatConfig(session.orgId, resolvedName, false)
        if (existing) {
          if (input.botAccessToken === '••••••••') input.botAccessToken = existing.botAccessToken
          if (input.webhookSecret === '••••••••') input.webhookSecret = existing.webhookSecret ?? ''
        }
      }

      await upsertLiveChatConfig(session.orgId, input, resolvedName)
      await audit({
        action: 'livechat.config.update',
        target: `org:${session.orgId}/agent:${resolvedName ?? '_default'}`,
      })

      return apiOk({ ok: true })
    },
  })(request)
}

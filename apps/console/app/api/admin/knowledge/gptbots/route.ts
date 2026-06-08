// GET + PUT /api/admin/knowledge/gptbots — Proxy GPTBots knowledge base list + API key management
// Scoped by agentConfigId (agent-level GPTBots key).

import { z } from 'zod'
import { defineRoute, RouteError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

const GPTBOTS_KB_API = 'https://api-sg.gptbots.ai/v1/bot/knowledge/base/page'

async function getApiKey(repo: any, agentConfigId?: string): Promise<string | null> {
  try {
    if (agentConfigId) {
      const config = await repo.agentConfig.findUnique({ where: { id: agentConfigId }, select: { gptbotsApiKey: true } })
      if (config?.gptbotsApiKey) return config.gptbotsApiKey
    }
  } catch { /* DB may not be ready */ }
  return process.env.GPTBOTS_API_KEY ?? null
}

const getQuerySchema = z.object({ agentConfigId: z.string().optional() })

export const GET = defineRoute({
  method: 'GET',
  inputSchema: getQuerySchema,
  parseQuery: true,
  async handler({ input, repo }) {
    const apiKey = await getApiKey(repo, input.agentConfigId)
    if (!apiKey) return apiOk({ data: [], total: 0, note: 'GPTBots API key not configured' })

    const response = await fetch(GPTBOTS_KB_API, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new RouteError('internal', `GPTBots API error: ${response.status}`, undefined, 502)

    const data = await response.json()
    return apiOk(data)
  },
})

const putSchema = z.object({
  apiKey: z.string().nullable().optional(),
  agentConfigId: z.string().min(1, 'agentConfigId is required'),
})

export const PUT = defineRoute({
  method: 'PUT',
  inputSchema: putSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, repo }) {
    await repo.raw.agentConfig.update({
      where: { id: input.agentConfigId },
      data: { gptbotsApiKey: input.apiKey || null },
    })
    return apiOk({ ok: true })
  },
})

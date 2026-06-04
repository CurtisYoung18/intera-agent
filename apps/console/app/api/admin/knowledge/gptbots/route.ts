// GET + PUT /api/admin/knowledge/gptbots — Proxy GPTBots knowledge base list + API key management
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute, RouteError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { DEFAULT_MODEL } from '@intera/shared/defaults'

const GPTBOTS_KB_API = 'https://api-sg.gptbots.ai/v1/bot/knowledge/base/page'

async function getApiKey(repo: any): Promise<string | null> {
  try {
    const config = await repo.agentConfig.findFirst({ where: { isActive: true }, select: { gptbotsApiKey: true } })
    if (config?.gptbotsApiKey) return config.gptbotsApiKey
  } catch { /* DB may not be ready */ }
  return process.env.GPTBOTS_API_KEY ?? null
}

export const GET = defineRoute({
  method: 'GET',
  async handler({ repo }) {
    const apiKey = await getApiKey(repo)
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

const putSchema = z.object({ apiKey: z.string().nullable().optional() })

export const PUT = defineRoute({
  method: 'PUT',
  inputSchema: putSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, repo }) {
    const existing = await repo.agentConfig.findFirst({ where: { isActive: true } })
    if (existing) {
      await repo.agentConfig.update({
        where: { id: existing.id },
        data: { gptbotsApiKey: input.apiKey || null } as any,
      })
    } else {
      await repo.agentConfig.create({
        data: { model: DEFAULT_MODEL, gptbotsApiKey: input.apiKey || null, systemPrompt: '', memoryStrategy: '{}', policyHooks: '{}' } as any,
      })
    }
    return apiOk({ ok: true })
  },
})

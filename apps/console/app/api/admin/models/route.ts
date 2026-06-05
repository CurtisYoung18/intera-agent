// GET /api/admin/models — Returns available models from configured providers
// Migrated to defineRoute (G1 contract seam).

import '@intera/shared/prisma' // side-effect: layered env loader (root .env + app .env.local)
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

interface ModelInfo { id: string; name: string; provider: string; providerLabel: string; supportsVision: boolean }

export function buildModelList(): ModelInfo[] {
  const models: ModelInfo[] = []
  if (process.env.MINIMAX_API_KEY) {
    models.push(
      { id: 'MiniMax-M3', name: 'MiniMax M3', provider: 'minimax', providerLabel: 'MiniMax (Anthropic)', supportsVision: false },
      { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 Highspeed', provider: 'minimax', providerLabel: 'MiniMax (Anthropic)', supportsVision: false },
      { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax M2.5 Highspeed', provider: 'minimax', providerLabel: 'MiniMax (Anthropic)', supportsVision: false },
    )
  }
  if (process.env.DEEPSEEK_API_KEY) {
    models.push(
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', providerLabel: 'DeepSeek (Anthropic)', supportsVision: false },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', providerLabel: 'DeepSeek (Anthropic)', supportsVision: false },
    )
  }
  if (process.env.ANTHROPIC_AUTH_TOKEN && process.env.ANTHROPIC_BASE_URL) {
    const isMiniMaxProxy = process.env.ANTHROPIC_BASE_URL.includes('minimaxi')
    if (!isMiniMaxProxy) {
      models.push(
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', providerLabel: 'Anthropic', supportsVision: true },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', providerLabel: 'Anthropic', supportsVision: true },
      )
    }
  }
  if (process.env.OPENROUTER_API_KEY) {
    models.push(
      { id: 'google/gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'openrouter', providerLabel: 'OpenRouter', supportsVision: true },
      { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'openrouter', providerLabel: 'OpenRouter', supportsVision: true },
      { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (thinking)', provider: 'openrouter', providerLabel: 'OpenRouter', supportsVision: true },
      { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openrouter', providerLabel: 'OpenRouter', supportsVision: true },
      { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'openrouter', providerLabel: 'OpenRouter', supportsVision: true },
      { id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openrouter', providerLabel: 'OpenRouter', supportsVision: true },
      { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', provider: 'openrouter', providerLabel: 'OpenRouter', supportsVision: true },
      { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'openrouter', providerLabel: 'OpenRouter', supportsVision: true },
      { id: 'anthropic/claude-opus-4.7', name: 'Claude Opus 4.7', provider: 'openrouter', providerLabel: 'OpenRouter', supportsVision: true },
    )
  }
  return models
}

export const GET = defineRoute({
  method: 'GET',
  async handler() {
    const models = buildModelList()
    return apiOk({ models })
  },
})

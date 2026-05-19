// GET /api/admin/models — Returns available models from configured providers
// Reads from env vars to determine which models are available per provider.

import '@intera/shared/prisma' // side-effect: layered env loader (root .env + app .env.local)
import { NextResponse } from 'next/server'

interface ModelInfo {
  id: string
  name: string
  provider: string
  providerLabel: string
}

export async function GET() {
  const models: ModelInfo[] = []

  // MiniMax models (Anthropic-compatible endpoint)
  if (process.env.MINIMAX_API_KEY) {
    models.push(
      { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 Highspeed', provider: 'minimax', providerLabel: 'MiniMax (Anthropic)' },
      { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax M2.5 Highspeed', provider: 'minimax', providerLabel: 'MiniMax (Anthropic)' },
    )
  }

  // DeepSeek models (Anthropic-compatible endpoint)
  if (process.env.DEEPSEEK_API_KEY) {
    models.push(
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', providerLabel: 'DeepSeek (Anthropic)' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', providerLabel: 'DeepSeek (Anthropic)' },
    )
  }

  // Anthropic models
  if (process.env.ANTHROPIC_AUTH_TOKEN && process.env.ANTHROPIC_BASE_URL) {
    const isMiniMaxProxy = process.env.ANTHROPIC_BASE_URL.includes('minimaxi')
    // Only show Anthropic native models if NOT using MiniMax proxy (avoid duplicates)
    if (!isMiniMaxProxy) {
      models.push(
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', providerLabel: 'Anthropic' },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', providerLabel: 'Anthropic' },
      )
    }
  }

  return NextResponse.json({ models })
}

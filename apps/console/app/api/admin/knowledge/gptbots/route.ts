// GET /api/admin/knowledge/gptbots — Proxy GPTBots knowledge base list
// PUT /api/admin/knowledge/gptbots — Set per-customer GPTBots API key

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId } from '@/lib/auth'

const GPTBOTS_KB_API = 'https://api-sg.gptbots.ai/v1/bot/knowledge/base/page'

async function getApiKey(orgId: string): Promise<string | null> {
  // Try per-customer key first, fall back to env var
  try {
    const config = await prisma.agentConfig.findUnique({ where: { orgId }, select: { gptbotsApiKey: true } })
    if (config?.gptbotsApiKey) return config.gptbotsApiKey
  } catch { /* DB may not be ready */ }
  return process.env.GPTBOTS_API_KEY ?? null
}

export async function GET() {
  try {
    const orgId = await getActiveOrgId()
    const apiKey = await getApiKey(orgId)

    if (!apiKey) {
      return NextResponse.json({ error: 'GPTBOTS_API_KEY not configured' }, { status: 503 })
    }

    const response = await fetch(GPTBOTS_KB_API, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `GPTBots API error: ${response.status}` },
        { status: 502 },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (err) {
    console.error('[Admin] GET gptbots KB list:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const orgId = await getActiveOrgId()
    const { apiKey } = await req.json()
    await prisma.agentConfig.upsert({
      where: { orgId },
      update: { gptbotsApiKey: apiKey || null },
      create: { orgId, gptbotsApiKey: apiKey || null, systemPrompt: '', memoryStrategy: '{}', policyHooks: '{}' },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Admin] PUT gptbots key:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

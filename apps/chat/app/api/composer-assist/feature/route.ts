import { NextRequest, NextResponse } from 'next/server'
import { loadComposerAssistSettings } from '@/lib/agent/composer-assist-config'

/**
 * Lightweight flag for the Chat UI — enabled only when operator turns on composer assist + env key present.
 */
export async function GET(request: NextRequest) {
  const vendorId = request.nextUrl.searchParams.get('vendorId')?.trim() || 'default'
  const cfg = await loadComposerAssistSettings(vendorId)
  const hasKey = Boolean(process.env.DEEPSEEK_API_KEY?.trim())
  return NextResponse.json({
    enabled: cfg.enabled && hasKey,
    minDraftChars: cfg.minDraftChars,
    consoleAssistConfigured: cfg.enabled,
    missingDeepseekKey: cfg.enabled && !hasKey,
  })
}

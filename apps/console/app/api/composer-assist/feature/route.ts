import { NextRequest, NextResponse } from 'next/server'
import { loadComposerAssistSettings } from '@/lib/agent/composer-assist-config'
import { resolveOrgFromApiKey, isTrustedInternalCall } from '@/lib/api-auth'

/**
 * Lightweight flag for the Chat UI — enabled only when operator turns on composer assist + env key present.
 */
export async function GET(request: NextRequest) {
  // ── Auth gate ──
  const authOrgId = await resolveOrgFromApiKey(request)
  const isInternal = !authOrgId && isTrustedInternalCall(request)
  if (!authOrgId && !isInternal) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const queryOrgId = request.nextUrl.searchParams.get('orgId')?.trim() || ''
  if (authOrgId && queryOrgId && queryOrgId !== authOrgId) {
    return NextResponse.json({ error: 'orgId mismatch' }, { status: 400 })
  }
  const orgId = authOrgId || queryOrgId || 'default'
  const cfg = await loadComposerAssistSettings(orgId)
  const hasKey = Boolean(process.env.DEEPSEEK_API_KEY?.trim())
  return NextResponse.json({
    enabled: cfg.enabled && hasKey,
    minDraftChars: cfg.minDraftChars,
    consoleAssistConfigured: cfg.enabled,
    missingDeepseekKey: cfg.enabled && !hasKey,
  })
}

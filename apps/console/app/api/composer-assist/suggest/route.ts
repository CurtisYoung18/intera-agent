import { NextRequest, NextResponse } from 'next/server'
import { appendAssistantPrefixRow, completeDeepseekPrefixChat } from '@/lib/agent/deepseek-prefix-chat'
import {
  loadComposerAssistSettings,
  parseStopSequences,
} from '@/lib/agent/composer-assist-config'
import { resolveOrgFromApiKey, isTrustedInternalCall } from '@/lib/api-auth'

const DRAFT_MAX = 3800
const CONTINUATION_CAP = 360

const COMPOSER_SYSTEM_CORE = [
  'You help customers who may have difficulty expressing themselves while typing.',
  'Propose ONLY a natural continuation of their draft below — same language and tone.',
  'Output ONLY the continuation (no quotation marks around it, no labels like "Suggestion:", no apologies or meta commentary).',
  'Stop at a natural phrase boundary. Keep it concise unless the draft clearly needs more.',
].join(' ')

function normalizeContinuation(draft: string, raw: string): string {
  let t = raw.trim()
  if (!t) return ''
  const dEnd = draft.trimEnd()
  if (t.startsWith(dEnd)) t = t.slice(dEnd.length).trimStart()
  const lastLine = dEnd.split(/\n/).pop() ?? dEnd
  if (lastLine.length > 5 && t.startsWith(lastLine.trim())) {
    t = t.slice(lastLine.length).trimStart()
  }
  if (t.length > CONTINUATION_CAP) {
    t = `${t.slice(0, CONTINUATION_CAP).trimEnd()}…`
  }
  return t.trim()
}

export async function POST(request: NextRequest) {
  // ── Auth gate ──
  const authOrgId = await resolveOrgFromApiKey(request)
  const isInternal = !authOrgId && isTrustedInternalCall(request)
  if (!authOrgId && !isInternal) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { draft?: string; orgId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const bodyOrgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : ''
  if (authOrgId && bodyOrgId && bodyOrgId !== authOrgId) {
    return NextResponse.json({ error: 'orgId mismatch' }, { status: 400 })
  }
  const orgId = authOrgId || bodyOrgId || 'default'
  const draftRaw = typeof body.draft === 'string' ? body.draft : ''
  if (draftRaw.length > DRAFT_MAX) {
    return NextResponse.json({ error: 'Draft too long' }, { status: 400 })
  }
  const draft = draftRaw

  const cfgEarly = await loadComposerAssistSettings(orgId)
  const minDraft = cfgEarly.minDraftChars
  if (draft.trim().length < minDraft) {
    return NextResponse.json({ continuation: '' })
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    return NextResponse.json({ error: 'Composer assist is not configured' }, { status: 503 })
  }

  const cfg = cfgEarly
  if (!cfg.enabled) {
    return NextResponse.json({ continuation: '' })
  }

  const baseUrl =
    cfg.betaBaseUrl.trim() || process.env.DEEPSEEK_BETA_CHAT_BASE_URL?.trim() || 'https://api.deepseek.com/beta'

  const systemParts = [COMPOSER_SYSTEM_CORE]
  if (cfg.notes.length > 0) {
    systemParts.push(`Operator notes: ${cfg.notes}`)
  }
  const system = systemParts.join('\n\n')
  const stop = parseStopSequences(cfg.stopJson)

  const messages = appendAssistantPrefixRow([{ role: 'system', content: system }], draft)

  const { content, error } = await completeDeepseekPrefixChat({
    apiKey,
    baseUrl,
    model: cfg.chatModel,
    messages,
    temperature: 0.35,
    maxTokens: 160,
    stop: stop.length > 0 ? stop : undefined,
  })

  if (error) {
    console.warn('[composer-assist]', error)
    return NextResponse.json({ continuation: '' })
  }

  const continuation = normalizeContinuation(draft, content)
  return NextResponse.json({ continuation })
}

import { prisma } from '@intera/shared/prisma'
import { clampComposerMinDraftChars } from '@intera/shared/composer-min-draft'

export type ComposerAssistSettings = {
  enabled: boolean
  chatModel: string
  betaBaseUrl: string
  /** Appended to the fixed system prompt (operator-tunable style / accessibility notes). */
  notes: string
  stopJson?: string
  minDraftChars: number
}

const DEFAULT_BASE = 'https://api.deepseek.com/beta'

export async function loadComposerAssistSettings(orgId: string): Promise<ComposerAssistSettings> {
  const row = await prisma.agentConfig.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } })
  if (!row) {
    return {
      enabled: false,
      chatModel: 'deepseek-chat',
      betaBaseUrl: DEFAULT_BASE,
      notes: '',
      minDraftChars: 4,
    }
  }
  const r = row as Record<string, unknown>
  return {
    enabled: Boolean(r.prefixContinuationEnabled),
    chatModel: String(r.prefixContinuationChatModel || '').trim() || 'deepseek-chat',
    betaBaseUrl: String(r.prefixContinuationBaseUrl || '').trim() || DEFAULT_BASE,
    notes: String(r.prefixContinuationAssistantPrefix ?? '').trim(),
    stopJson: typeof r.prefixContinuationStop === 'string' ? r.prefixContinuationStop : undefined,
    minDraftChars: clampComposerMinDraftChars(r.prefixContinuationMinDraftChars, 4),
  }
}

export function parseStopSequences(stopJson: string | undefined): string[] {
  if (!stopJson) return []
  try {
    const parsed = JSON.parse(stopJson)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

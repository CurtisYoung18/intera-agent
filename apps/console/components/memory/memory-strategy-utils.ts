import type { MemoryStrategy } from '@/app/admin/agent/types'
import { DEFAULT_MEMORY } from '@/app/admin/agent/types'

export type MemoryMode = 'short' | 'balanced' | 'long' | 'custom'

export type PreserveField =
  | 'preserveFacts'
  | 'preserveToolEvidence'
  | 'preserveProcedureProgress'
  | 'preserveHumanHandoffStatus'
  | 'preserveProfileSignals'

export type MemoryStrategyUi = MemoryStrategy & {
  preserveFacts?: boolean
  preserveToolEvidence?: boolean
  preserveProcedureProgress?: boolean
  preserveHumanHandoffStatus?: boolean
  preserveProfileSignals?: boolean
  factExtractionModel?: string
  profilePromotionRules?: string
}

type MemoryPreset = Pick<
  MemoryStrategy,
  'autocompactThresholdTokens' | 'compactionKeepMin' | 'l1MaxMessages' | 'compactMaxMessages'
>

export const MEMORY_MODE_PRESETS: Record<Exclude<MemoryMode, 'custom'>, MemoryPreset> = {
  short: {
    autocompactThresholdTokens: 20000,
    compactionKeepMin: 10,
    l1MaxMessages: 10,
    compactMaxMessages: 24,
  },
  balanced: {
    autocompactThresholdTokens: 40000,
    compactionKeepMin: 20,
    l1MaxMessages: 20,
    compactMaxMessages: 40,
  },
  long: {
    autocompactThresholdTokens: 80000,
    compactionKeepMin: 30,
    l1MaxMessages: 30,
    compactMaxMessages: 56,
  },
}

const DEFAULT_MEMORY_UI: Pick<
  MemoryStrategyUi,
  | 'preserveFacts'
  | 'preserveToolEvidence'
  | 'preserveProcedureProgress'
  | 'preserveHumanHandoffStatus'
  | 'preserveProfileSignals'
  | 'factExtractionModel'
  | 'profilePromotionRules'
> = {
  preserveFacts: true,
  preserveToolEvidence: true,
  preserveProcedureProgress: true,
  preserveHumanHandoffStatus: true,
  preserveProfileSignals: true,
  factExtractionModel: DEFAULT_MEMORY.compactModel,
  profilePromotionRules:
    'Promote stable identity, preference, risk, and service-history signals after repeated user confirmation or verified tool evidence.',
}

export function normalizeMemoryStrategy(raw: unknown): MemoryStrategyUi {
  let parsed: Record<string, unknown> = {}
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw || '{}') as Record<string, unknown>
    } catch {
      parsed = {}
    }
  } else if (raw && typeof raw === 'object') {
    parsed = raw as Record<string, unknown>
  }

  const compactableTools =
    typeof parsed.compactableTools === 'string'
      ? parsed.compactableTools
          .split(',')
          .map((tool) => tool.trim())
          .filter(Boolean)
      : Array.isArray(parsed.compactableTools)
        ? parsed.compactableTools
        : DEFAULT_MEMORY.compactableTools

  const merged = {
    ...DEFAULT_MEMORY,
    ...DEFAULT_MEMORY_UI,
    ...parsed,
    compactableTools,
  } as MemoryStrategyUi

  if (!merged.factExtractionModel) merged.factExtractionModel = merged.compactModel

  return merged
}

export function detectMemoryMode(strategy: MemoryStrategyUi): MemoryMode {
  for (const mode of ['short', 'balanced', 'long'] as const) {
    const preset = MEMORY_MODE_PRESETS[mode]
    if (
      strategy.autocompactThresholdTokens === preset.autocompactThresholdTokens &&
      strategy.compactionKeepMin === preset.compactionKeepMin &&
      strategy.l1MaxMessages === preset.l1MaxMessages &&
      strategy.compactMaxMessages === preset.compactMaxMessages
    ) {
      return mode
    }
  }
  return 'custom'
}

export function applyMemoryMode(strategy: MemoryStrategyUi, mode: Exclude<MemoryMode, 'custom'>): MemoryStrategyUi {
  return {
    ...strategy,
    ...MEMORY_MODE_PRESETS[mode],
  }
}

export type CompactCheckKey = 'facts' | 'toolEvidence' | 'procedureProgress' | 'handoffStatus'

export interface CompactCheck {
  key: CompactCheckKey
  label: string
  detail: string
  status: 'preserved' | 'missing' | 'disabled'
}

export interface CompactFixtureResult {
  before: {
    messages: number
    approxTokens: number
    summary: string
  }
  after: {
    approxTokens: number
    summary: string
  }
  checks: CompactCheck[]
}

function estimateTokens(text: string, strategy: MemoryStrategyUi): number {
  const latin = text.replace(/[^\x00-\x7F]/g, '').length
  const cjk = text.length - latin
  return Math.max(
    strategy.minTokenEstimate,
    Math.ceil(latin / Math.max(1, strategy.latinCharPerToken)) +
      Math.ceil(cjk / Math.max(1, strategy.cjkCharPerToken)),
  )
}

function countMessages(text: string): number {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean).length
}

export function runCompactFixture(sample: string, strategy: MemoryStrategyUi): CompactFixtureResult {
  const lower = sample.toLowerCase()
  const hasFact = /txn|transaction|amount|member|order|deposit|withdraw|vip/.test(lower)
  const hasToolEvidence = /tool|api|get_latest|query_|lookup|result/.test(lower)
  const hasProcedureProgress = /procedure|step|verify|collect|handoff|resolve/.test(lower)
  const hasHandoff = /human|handoff|transfer|operator|agent group/.test(lower)

  const beforeTokens = estimateTokens(sample, strategy)
  const preservedFacts = strategy.preserveFacts !== false && hasFact
  const preservedToolEvidence = strategy.preserveToolEvidence !== false && hasToolEvidence
  const preservedProcedureProgress = strategy.preserveProcedureProgress !== false && hasProcedureProgress
  const preservedHandoff = strategy.preserveHumanHandoffStatus !== false && hasHandoff

  const factsLine = preservedFacts
    ? 'Business facts stay in the context map: member, transaction, amount, and stated issue.'
    : 'No durable business fact was detected for this fixture.'
  const toolLine = preservedToolEvidence
    ? 'Tool evidence is summarized with source and result status.'
    : 'Tool evidence is not present or is disabled for this strategy.'
  const procedureLine = preservedProcedureProgress
    ? 'Procedure progress stays in working memory as current step state, not the context map.'
    : 'Procedure runtime state needs review for this fixture.'
  const handoffLine = preservedHandoff
    ? 'Human handoff status remains visible for operator continuity.'
    : 'No human handoff status was detected for this fixture.'

  const afterSummary = [factsLine, toolLine, procedureLine, handoffLine].join(' ')

  const checks: CompactCheck[] = [
    {
      key: 'facts',
      label: 'Business facts',
      detail: 'Facts belong in the context map only when they describe the customer or case.',
      status: strategy.preserveFacts === false ? 'disabled' : preservedFacts ? 'preserved' : 'missing',
    },
    {
      key: 'toolEvidence',
      label: 'Tool evidence',
      detail: 'Tool result source, freshness, and outcome remain audit evidence.',
      status: strategy.preserveToolEvidence === false ? 'disabled' : preservedToolEvidence ? 'preserved' : 'missing',
    },
    {
      key: 'procedureProgress',
      label: 'Procedure progress',
      detail: 'procedureRun stays in structured working memory instead of the context map.',
      status:
        strategy.preserveProcedureProgress === false
          ? 'disabled'
          : preservedProcedureProgress
            ? 'preserved'
            : 'missing',
    },
    {
      key: 'handoffStatus',
      label: 'Human handoff status',
      detail: 'Handoff owner, reason, and waiting state stay available to delivery staff.',
      status:
        strategy.preserveHumanHandoffStatus === false ? 'disabled' : preservedHandoff ? 'preserved' : 'missing',
    },
  ]

  return {
    before: {
      messages: countMessages(sample),
      approxTokens: beforeTokens,
      summary: 'Full sample transcript with all recent messages and evidence still attached.',
    },
    after: {
      approxTokens: Math.max(strategy.minTokenEstimate, Math.ceil(beforeTokens * 0.34)),
      summary: afterSummary,
    },
    checks,
  }
}

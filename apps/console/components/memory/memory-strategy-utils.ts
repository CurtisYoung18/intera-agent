import type { MemoryStrategy } from '@/app/admin/agent/types'
import { DEFAULT_MEMORY } from '@/app/admin/agent/types'

export type MemoryMode = 'short' | 'balanced' | 'long' | 'custom'

export type MemoryStrategyUi = MemoryStrategy & {
  factExtractionModel?: string
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
  'factExtractionModel'
> = {
  factExtractionModel: DEFAULT_MEMORY.compactModel,
}

function coerceNumeric(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) {
      const parsed = Number(trimmed)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return fallback
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
  }
  return fallback
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
  const mutableMerged = merged as unknown as Record<string, unknown>

  for (const [key, defaultValue] of Object.entries(DEFAULT_MEMORY)) {
    const typedKey = key as keyof MemoryStrategy
    if (typeof defaultValue === 'number') {
      mutableMerged[typedKey] = coerceNumeric(merged[typedKey], defaultValue)
    } else if (typeof defaultValue === 'boolean') {
      mutableMerged[typedKey] = coerceBoolean(merged[typedKey], defaultValue)
    }
  }

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

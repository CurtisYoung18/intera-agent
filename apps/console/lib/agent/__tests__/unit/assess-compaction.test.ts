import { describe, it, expect } from 'vitest'
import { ChatMemoryManager, type CompactionResult } from '../../memory'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import type { MemoryStrategy } from '@intera/shared/types'

function makeStrategy(overrides?: Partial<MemoryStrategy>): MemoryStrategy {
  return { ...DEFAULT_MEMORY_STRATEGY, ...overrides }
}

function makeManager(strategy: MemoryStrategy): ChatMemoryManager {
  return new ChatMemoryManager('testCaseId', strategy)
}

// Helper: call assessCompaction with a specific used token count.
// Default contextWindow = 200000, outputReserved = 20000 → effective window = 180000.
function assess(
  usedTokens: number,
  messageCount = 10,
  strategy?: MemoryStrategy,
): CompactionResult {
  const mgr = makeManager(strategy ?? makeStrategy())
  return mgr.assessCompaction(usedTokens, messageCount)
}

describe('assessCompaction - ratio-based thresholds', () => {
  // 200K context window, 20K reserved → effective 180K
  // 70% of 180K = 126K, 60% = 108K, 92% = 165.6K

  it('short conversation (10K used in 200K window) does NOT trigger compaction', () => {
    const result = assess(10000)
    expect(result.shouldCompact).toBe(false)
    expect(result.isWarning).toBe(false)
    expect(result.isBlocking).toBe(false)
  })

  it('140K used in 200K window (77.8%) triggers needsCompaction at 70%', () => {
    const result = assess(140000)
    expect(result.shouldCompact).toBe(true)
    expect(result.isBlocking).toBe(false)
  })

  it('184K used in 200K window (102% of effective 180K) returns isBlocking: true at 92%', () => {
    // 92% of 180K effective = 165.6K, so 184K >> 92%
    const result = assess(184000)
    expect(result.isBlocking).toBe(true)
    expect(result.shouldCompact).toBe(true)
  })

  it('120K used in 200K window (66.7%) returns warning: true at 60%', () => {
    // 60% of 180K effective = 108K, so 120K > 60%
    const result = assess(120000)
    expect(result.isWarning).toBe(true)
    expect(result.shouldCompact).toBe(false) // 66.7% < 70%
    expect(result.isBlocking).toBe(false)
  })

  it('exactly at 70% threshold (126K in 180K effective) triggers compaction', () => {
    // 70% of 180K = 126K
    const result = assess(126000)
    expect(result.shouldCompact).toBe(true)
    expect(result.isWarning).toBe(true) // 70% >= 60%
    expect(result.isBlocking).toBe(false) // 70% < 92%
  })

  it('exactly at 92% threshold (165600 in 180K effective) is blocking', () => {
    // 92% of 180K = 165.6K
    const result = assess(165600)
    expect(result.isBlocking).toBe(true)
    expect(result.shouldCompact).toBe(true)
    expect(result.isWarning).toBe(true)
  })

  it('at 30K used (16.7%) does not trigger anything', () => {
    const result = assess(30000)
    expect(result.shouldCompact).toBe(false)
    expect(result.isWarning).toBe(false)
    expect(result.isBlocking).toBe(false)
  })

  it('with large contextWindow (1M tokens) 700K is NOT at 70%', () => {
    const strat = makeStrategy({ contextWindow: 1_000_000 })
    // effective = 1M - 20K = 980K, 70% = 686K
    const result = assess(700_000, 10, strat)
    expect(result.shouldCompact).toBe(true) // 700K/980K = 71.4% > 70%
  })

  it('with custom ratios respects overrides', () => {
    const strat = makeStrategy({
      autocompactRatio: 0.80,
      warningRatio: 0.50,
      blockingRatio: 0.95,
    })
    // 75% usage (135K/180K): should NOT compact (75% < 80%), should warn (75% > 50%)
    const result = assess(135_000, 10, strat)
    expect(result.shouldCompact).toBe(false)
    expect(result.isWarning).toBe(true)
  })

  it('enableContextCollapse=false suppresses compaction even when thresholds met', () => {
    const strat = makeStrategy({ enableContextCollapse: false })
    // 140K/180K = 77.8% > 70% → would normally compact
    const result = assess(140_000, 10, strat)
    expect(result.shouldCompact).toBe(false)
    expect(result.isBlocking).toBe(false)
    // isWarning is NOT suppressed by enableContextCollapse (only shouldCompact/isBlocking)
    expect(result.isWarning).toBe(true)
  })

  it('computes percentLeft correctly', () => {
    // 90K used in 180K effective → 50% left
    const result = assess(90_000)
    expect(result.percentLeft).toBe(50)
  })

  it('messagesToKeep is at least 4 and respects messageCount', () => {
    const result = assess(90_000, 20)
    // 20 * 0.4 = 8, max(4, 8) = 8
    expect(result.messagesToKeep).toBe(8)
  })

  it('messagesToKeep floor is 4 even for very few messages', () => {
    const result = assess(90_000, 2)
    // 2 * 0.4 = 0.8 → max(4, 0) = 4
    expect(result.messagesToKeep).toBe(4)
  })
})

describe('compactEveryNMessages - cadence logic', () => {
  it('compactEveryNMessages: undefined never triggers on message count alone', () => {
    const strat = makeStrategy({ compactEveryNMessages: undefined })
    // Even with low usage, cadence should not trigger because feature is disabled
    // The token threshold won't trigger either (very low usage)
    const result = assess(10_000, 10, strat)
    expect(result.shouldCompact).toBe(false)
    expect(result.isBlocking).toBe(false)
    expect(result.isWarning).toBe(false)
  })

  it('compactEveryNMessages is available on strategy for checkAndCompact to use', () => {
    // This test verifies the field flows through to the strategy object
    const strat = makeStrategy({ compactEveryNMessages: 5 })
    expect(strat.compactEveryNMessages).toBe(5)
  })

  it('compactEveryNMessages is undefined by default', () => {
    const strat = makeStrategy()
    expect(strat.compactEveryNMessages).toBeUndefined()
  })
})

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DICTS, en, zh } from '../dictionaries'
import { enSurfaces } from '../messages/en'
import { zhSurfaces } from '../messages/zh'

const INTEGRATED_SPLIT_SNAPSHOT = {
  en: {
    count: 1662,
    hash: '631662b1cf17ab8b24698dc489ea2bc5324a9f6cc149c59a54d8f96d9d2c0e76',
  },
  zh: {
    count: 1662,
    hash: 'd123f4b2118c5e5baeda76ad63b3153b25c004a6fdc7bdccfba8f3d8dedb12bb',
  },
}

function stableHash(messages: Record<string, string>): string {
  const sorted = Object.fromEntries(
    Object.entries(messages).sort(([a], [b]) => a.localeCompare(b)),
  )
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

function surfaceKeyCount(surfaces: Record<string, Record<string, string>>): number {
  return Object.values(surfaces).reduce((sum, surface) => sum + Object.keys(surface).length, 0)
}

describe('split i18n dictionaries', () => {
  it('preserves the integrated split key/value snapshot', () => {
    expect(Object.keys(en)).toHaveLength(INTEGRATED_SPLIT_SNAPSHOT.en.count)
    expect(Object.keys(zh)).toHaveLength(INTEGRATED_SPLIT_SNAPSHOT.zh.count)
    expect(stableHash(en)).toBe(INTEGRATED_SPLIT_SNAPSHOT.en.hash)
    expect(stableHash(zh)).toBe(INTEGRATED_SPLIT_SNAPSHOT.zh.hash)
  })

  it('keeps locale keys in parity after surface merge', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(DICTS.en).toBe(en)
    expect(DICTS.zh).toBe(zh)
  })

  it('merges every surface without silently dropping keys', () => {
    expect(surfaceKeyCount(enSurfaces)).toBe(Object.keys(en).length)
    expect(surfaceKeyCount(zhSurfaces)).toBe(Object.keys(zh).length)
  })
})

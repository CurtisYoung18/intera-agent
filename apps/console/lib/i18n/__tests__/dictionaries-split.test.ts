import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DICTS, en, zh } from '../dictionaries'
import { enSurfaces } from '../messages/en'
import { zhSurfaces } from '../messages/zh'

const INTEGRATED_SPLIT_SNAPSHOT = {
  en: {
    count: 1680,
    hash: 'e173732b3f1e170bfa5550627645f360638ce494e02a52524772e22ecd01f82e',
  },
  zh: {
    count: 1680,
    hash: '080850cfba78e396c7e754521a2435f69deb69301cb1453d9cef8aa335f9420d',
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
